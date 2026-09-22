'use client'

// WHAT SHE DID, RECORDED FROM HER SIDE.
//
// Mounted once in the /me layout, so it survives navigation between her rooms
// and one visit stays one session rather than fragmenting per page.
//
// Two streams leave this component, and they are deliberately independent:
//
//   EVENTS     small, structured, cheap — room opens, taps, scroll depth,
//              searches, click-throughs. These drive every number on the
//              JOURNEY tab and the timeline. They always record.
//   RECORDING  rrweb's DOM stream, which is what makes the visit watchable as
//              video. Much heavier, so it is capped; past the cap the events
//              carry on alone and the timeline still tells the whole story.
//
// THREE THINGS THIS DELIBERATELY DOES NOT DO:
//   · It never claims an identity. The payload carries a session id and events;
//     who that is gets decided server-side from her cookie.
//   · It never records Chloe. The layout only mounts it for a signed-in client,
//     and a browser that has ever touched /admin opts itself out for good — the
//     same flag SessionTracker uses, so the two agree about whose browsing counts.
//   · It never types what she types. rrweb masks every input, and the only text
//     that leaves here is a search query or a question she deliberately sent.

import { useEffect, useRef } from 'react'
import { usePathname } from 'next/navigation'

const ENDPOINT = '/api/me/journey'
const SESSION_KEY = 'myra_journey_sid'
/** When the visit began. Persisted beside the id, because a reload re-runs this
 *  component and a fresh `Date.now()` would restart every event's offset at
 *  zero — replaying the second half of a visit on top of the first. */
const STARTED_KEY = 'myra_journey_start'
const SEEN_KEY = 'myra_journey_seen'
const ADMIN_FLAG = 'myra_is_admin'

const FLUSH_MS = 8_000
const PING_MS = 20_000
/** Beyond this the tab is treated as abandoned, not as time on the app. */
const IDLE_MS = 60_000
const MAX_BUFFER = 60

// The recording cap. A chunk is ~10s of DOM activity, so this is roughly half
// an hour of watchable video per visit — far longer than any real session in
// the pilot, and a hard stop on one runaway tab filling the table.
const MAX_RECORDING_CHUNKS = 180
const RECORDING_FLUSH_MS = 10_000
const RECORDING_MAX_EVENTS = 400

type Json = Record<string, unknown>

interface Buffered {
  type: string
  ms_offset: number
  seq: number
  room: string | null
  path: string | null
  label: string | null
  target_kind: string | null
  target_id: string | null
  meta: Json
}

/** Path → room id, mirroring MeChrome's longest-match rule so the JOURNEY tab
 *  and her own highlighted nav item always name the same room. */
const ROOM_BY_PREFIX: [string, string][] = [
  ['/me/dressing-room', 'dressing_room'],
  ['/me/inspiration', 'inspiration'],
  ['/me/magazine', 'magazine'],
  ['/me/threads', 'threads'],
  ['/me/profile', 'profile'],
  ['/me/looks', 'all_looks'],
  ['/me/wardrobe', 'dressing_room'],
  ['/me/welcome', 'for_you'],
  ['/me', 'for_you'],
]

function roomOf(path: string): string {
  for (const [prefix, room] of ROOM_BY_PREFIX) {
    if (path === prefix || path.startsWith(`${prefix}/`)) return room
  }
  return 'for_you'
}

function uuid(): string {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  } catch { /* ignore */ }
  // The server only accepts a uuid shape, so the fallback has to be one too.
  return '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, (c) =>
    (Number(c) ^ (Math.floor(Math.random() * 256) & (15 >> (Number(c) / 4)))).toString(16),
  )
}

function deviceOf(width: number): string {
  if (width < 640) return 'mobile'
  if (width < 1024) return 'tablet'
  return 'desktop'
}

/**
 * What a tap reads as in the replay.
 *
 * `data-journey` wins wherever it is set, because a hand-written label beats
 * anything inferred. Otherwise the element's own text, an image's alt, or an
 * aria-label — in that order — and never more than a few words: this is a line
 * in a log, not a transcript of the page.
 */
function labelFor(el: HTMLElement): string {
  const tagged = el.closest<HTMLElement>('[data-journey]')?.dataset.journey
  if (tagged) return tagged.slice(0, 80)

  const aria = el.closest<HTMLElement>('[aria-label]')?.getAttribute('aria-label')
  const text = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim()
  const alt = el.querySelector('img')?.getAttribute('alt')
    || el.closest('a,button')?.querySelector('img')?.getAttribute('alt')

  const best = (text && text.length <= 60 ? text : '') || alt || aria || text
  return (best || 'SOMETHING UNLABELLED').slice(0, 80)
}

export default function ClientJourneyTracker() {
  const pathname = usePathname() ?? '/me'

  // Everything the listeners need lives in refs: the effect that installs them
  // runs once, and re-running it on every navigation would re-open the session.
  const sessionId = useRef<string>('')
  const startedAt = useRef<number>(0)
  const seq = useRef<number>(0)
  const buffer = useRef<Buffered[]>([])
  const live = useRef<boolean>(false)

  // Time on the app counts only while the tab is in front of her.
  const activeMs = useRef<number>(0)
  const visibleSince = useRef<number>(0)

  const lastPath = useRef<string>('')
  const maxScroll = useRef<number>(0)
  const chunkIndex = useRef<number>(0)

  // The path the click listener should attribute a tap to. A ref, because the
  // listener is installed once and would otherwise close over the first path
  // she ever landed on and blame every later tap on it.
  const currentPath = useRef<string>(pathname)
  currentPath.current = pathname

  useEffect(() => {
    if (typeof window === 'undefined') return
    // Chloe's browser, and any other that has been in /admin, is not data.
    try { if (localStorage.getItem(ADMIN_FLAG) === '1') return } catch { /* ignore */ }

    let stopRecording: (() => void) | null = null
    let recordingBuffer: any[] = []
    let flushTimer: ReturnType<typeof setInterval> | null = null
    let pingTimer: ReturnType<typeof setInterval> | null = null
    let recordingTimer: ReturnType<typeof setInterval> | null = null

    // ── Session identity ────────────────────────────────────────────────────
    let fresh = false
    let isReturning = false
    let restoredStart = 0
    try {
      sessionId.current = sessionStorage.getItem(SESSION_KEY) || ''
      restoredStart = Number(sessionStorage.getItem(STARTED_KEY) ?? 0)
      if (!sessionId.current) {
        sessionId.current = uuid()
        sessionStorage.setItem(SESSION_KEY, sessionId.current)
        restoredStart = 0
        fresh = true
      }
      if (!restoredStart || !Number.isFinite(restoredStart)) {
        restoredStart = Date.now()
        sessionStorage.setItem(STARTED_KEY, String(restoredStart))
      }
      isReturning = localStorage.getItem(SEEN_KEY) === '1'
      localStorage.setItem(SEEN_KEY, '1')
    } catch {
      // Storage blocked. Still worth tracking the visit; it simply cannot be
      // stitched to a reload, so each page becomes its own short session.
      sessionId.current = uuid()
      restoredStart = Date.now()
      fresh = true
    }

    startedAt.current = restoredStart
    visibleSince.current = document.visibilityState === 'visible' ? Date.now() : 0
    live.current = true

    // Nothing may be written into a visit before the visit exists — the ingest
    // route refuses events for an unknown session, precisely so one member
    // cannot append to another's. So every later request queues behind the
    // opening one rather than racing it.
    let opened: Promise<unknown> = Promise.resolve()

    const send = (payload: Json, keepalive: boolean) =>
      fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: sessionId.current, ...payload }),
        keepalive,
      }).catch(() => { /* analytics must never surface an error to her */ })

    const post = (payload: Json, keepalive = false, first = false) => {
      try {
        if (first) { opened = send(payload, keepalive); return }
        // A keepalive send is the tab on its way out; there is no later to
        // wait for, and by then the opening request has long since landed.
        if (keepalive) { void send(payload, true); return }
        void opened.then(() => send(payload, false)).catch(() => { /* ignore */ })
      } catch { /* ignore */ }
    }

    /** Active time so far, including the stretch in progress. */
    const currentActive = () =>
      activeMs.current + (visibleSince.current ? Date.now() - visibleSince.current : 0)

    const push = (type: string, fields: Partial<Buffered> = {}) => {
      if (!live.current) return
      buffer.current.push({
        type,
        ms_offset: Math.max(0, Date.now() - startedAt.current),
        seq: seq.current++,
        room: fields.room ?? roomOf(currentPath.current),
        path: fields.path ?? currentPath.current,
        label: fields.label ?? null,
        target_kind: fields.target_kind ?? null,
        target_id: fields.target_id ?? null,
        meta: fields.meta ?? {},
      })
      if (buffer.current.length >= MAX_BUFFER) flush()
    }

    const flush = (keepalive = false, ended = false) => {
      if (!buffer.current.length && !ended) return
      const events = buffer.current
      buffer.current = []
      post({ kind: 'events', events, activeMs: currentActive(), ended }, keepalive)
    }

    // ── Open the visit ──────────────────────────────────────────────────────
    // keepalive, so a visit that is opened and abandoned in the same second is
    // still recorded as a visit — that she opened it and left immediately is
    // itself worth knowing.
    post({
      kind: 'start',
      entryPath: pathname,
      // A reload re-announces the same visit. Sending when it actually began
      // keeps the upsert from restamping it as starting now.
      startedAtMs: restoredStart,
      isReturning,
      device: deviceOf(window.innerWidth),
      viewportW: window.innerWidth,
      viewportH: window.innerHeight,
      referrer: document.referrer || null,
    }, true, true)
    push('session_start', { meta: { fresh, returning: isReturning, device: deviceOf(window.innerWidth) } })

    // ── Taps ────────────────────────────────────────────────────────────────
    // Capture phase, so a tap is recorded even when the handler under it stops
    // propagation — which most of her cards do.
    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null
      if (!target || !target.closest) return
      const el = target.closest<HTMLElement>('a,button,[role="button"],[data-journey]')
      if (!el) return

      const label = labelFor(el)
      const dataset = el.closest<HTMLElement>('[data-journey-id]')?.dataset ?? ({} as DOMStringMap)
      const targetId = dataset.journeyId ?? null
      const targetKind = dataset.journeyKind ?? (el.tagName === 'A' ? 'link' : 'button')
      // Where on the screen she touched, so the replay can put a dot there.
      const meta: Json = { x: Math.round(e.clientX), y: Math.round(e.clientY), vw: window.innerWidth }

      const href = (el as HTMLAnchorElement).href || ''
      let external = false
      try {
        external = Boolean(href) && new URL(href, window.location.href).host !== window.location.host
      } catch { /* a non-URL href is simply not external */ }

      if (external) {
        let host = ''
        try { host = new URL(href, window.location.href).host.replace(/^www\./, '') } catch { /* ignore */ }
        push('click_out', {
          label: host || label,
          target_kind: 'link',
          target_id: targetId,
          meta: { ...meta, host, href: href.slice(0, 300) },
        })
        // She is leaving for a retailer. Send it now with keepalive — the tab
        // may never come back to flush on its own.
        flush(true)
        return
      }

      const kind = targetKind === 'look' ? 'look_open' : targetKind === 'item' ? 'item_open' : 'click'
      push(kind, { label, target_kind: targetKind, target_id: targetId, meta })
    }

    // ── Searches and questions ──────────────────────────────────────────────
    // Her search bar and the Threads composer are ordinary forms; the submitted
    // value is the one piece of typed text worth keeping, because it is the
    // clearest statement of what she wants that the pilot ever gets.
    const onSubmit = (e: Event) => {
      const form = e.target as HTMLFormElement | null
      if (!form || typeof form.querySelector !== 'function') return
      const field = form.querySelector<HTMLInputElement | HTMLTextAreaElement>(
        'input[type="search"],input[type="text"],textarea',
      )
      const value = (field?.value ?? '').trim()
      if (!value) return
      const isChat = roomOf(currentPath.current) === 'threads'
        || Boolean(form.closest('[data-journey-form="chat"]'))
      push(isChat ? 'chat_send' : 'search', { label: value.slice(0, 160) })
      flush()
    }

    // ── Scroll depth ────────────────────────────────────────────────────────
    // Only the deepest point of each page is worth a row; a row per scroll tick
    // would be most of the table and would tell you nothing extra.
    let scrollPending = false
    const onScroll = () => {
      if (scrollPending) return
      scrollPending = true
      window.requestAnimationFrame(() => {
        scrollPending = false
        const doc = document.documentElement
        const scrollable = doc.scrollHeight - window.innerHeight
        if (scrollable <= 0) return
        const depth = Math.min(1, (window.scrollY + window.innerHeight) / doc.scrollHeight)
        if (depth > maxScroll.current + 0.15) {
          maxScroll.current = depth
          push('scroll', { meta: { depth: Math.round(depth * 100) / 100 } })
        }
      })
    }

    // ── Attention ───────────────────────────────────────────────────────────
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        if (visibleSince.current) {
          const stretch = Date.now() - visibleSince.current
          // A tab left open overnight is not four hours of styling. Anything
          // past the idle ceiling is banked at the ceiling and no further.
          activeMs.current += Math.min(stretch, IDLE_MS)
          visibleSince.current = 0
        }
        push('idle')
        flush(true)
      } else {
        visibleSince.current = Date.now()
        push('resume')
      }
    }

    const onPageHide = () => {
      if (!live.current) return
      if (visibleSince.current) {
        activeMs.current += Math.min(Date.now() - visibleSince.current, IDLE_MS)
        visibleSince.current = 0
      }
      push('session_end')
      flush(true, true)
      flushRecording(true)
      live.current = false
    }

    // ── The recording ───────────────────────────────────────────────────────
    //
    // A `keepalive` request — the only kind that survives the tab closing — is
    // capped by the browser at 64KB, and a slice of DOM mutations can easily be
    // larger than that. Over the limit the request is not truncated, it is
    // REFUSED, so the tail of every visit would vanish silently. The final
    // flush therefore halves an oversized slice until each piece fits, and each
    // piece takes its own chunk index so the recording still reassembles in
    // order. The periodic flushes are ordinary requests with no such limit.
    const KEEPALIVE_LIMIT = 56_000

    const sendChunk = (events: any[], keepalive: boolean) => {
      if (!events.length) return
      if (chunkIndex.current >= MAX_RECORDING_CHUNKS) return
      if (keepalive && events.length > 1) {
        const size = (() => {
          try { return JSON.stringify(events).length } catch { return Infinity }
        })()
        if (size > KEEPALIVE_LIMIT) {
          const half = Math.ceil(events.length / 2)
          sendChunk(events.slice(0, half), true)
          sendChunk(events.slice(half), true)
          return
        }
      }
      post({ kind: 'recording', chunkIndex: chunkIndex.current++, events }, keepalive)
    }

    const flushRecording = (keepalive = false) => {
      if (!recordingBuffer.length) return
      if (chunkIndex.current >= MAX_RECORDING_CHUNKS) { recordingBuffer = []; return }
      const events = recordingBuffer
      recordingBuffer = []
      sendChunk(events, keepalive)
    }

    // rrweb is loaded on demand and never blocks her first paint: the video is
    // the nice-to-have, her app is not. If the import fails — an old browser, a
    // blocked chunk — the events above carry the visit on their own.
    let cancelled = false
    import('rrweb')
      .then(({ record }) => {
        if (cancelled || !live.current) return
        stopRecording = record({
          emit(event: any) {
            recordingBuffer.push(event)
            if (recordingBuffer.length >= RECORDING_MAX_EVENTS) flushRecording()
          },
          // Nothing she types is ever recorded — only that a field was used.
          maskAllInputs: true,
          // Canvas and cross-origin stylesheets are the two expensive captures,
          // and her pages need neither to replay legibly.
          recordCanvas: false,
          inlineStylesheet: true,
          collectFonts: false,
          sampling: { scroll: 150, media: 800, input: 'last' },
          blockClass: 'journey-block',
          maskTextClass: 'journey-mask',
          // The recorder raising inside her page would be the one way this
          // component could break the app it is measuring. Returning true tells
          // rrweb the error is handled and to carry on.
          errorHandler: () => true,
        }) ?? null
        recordingTimer = setInterval(() => flushRecording(), RECORDING_FLUSH_MS)
      })
      .catch(() => { /* no video for this visit; the timeline still works */ })

    // ── Wiring ──────────────────────────────────────────────────────────────
    document.addEventListener('click', onClick, true)
    document.addEventListener('submit', onSubmit, true)
    window.addEventListener('scroll', onScroll, { passive: true })
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pagehide', onPageHide)

    flushTimer = setInterval(() => flush(), FLUSH_MS)
    pingTimer = setInterval(() => {
      if (document.visibilityState === 'visible') {
        post({ kind: 'ping', activeMs: currentActive() })
      }
    }, PING_MS)

    return () => {
      cancelled = true
      onPageHide()
      document.removeEventListener('click', onClick, true)
      document.removeEventListener('submit', onSubmit, true)
      window.removeEventListener('scroll', onScroll)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pagehide', onPageHide)
      if (flushTimer) clearInterval(flushTimer)
      if (pingTimer) clearInterval(pingTimer)
      if (recordingTimer) clearInterval(recordingTimer)
      try { stopRecording?.() } catch { /* ignore */ }
    }
    // Installed once per visit on purpose — see the refs above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Room changes ──────────────────────────────────────────────────────────
  // A separate effect, because this one SHOULD run on every navigation.
  useEffect(() => {
    if (!live.current || !sessionId.current) return
    if (lastPath.current === pathname) return
    const previous = lastPath.current
    lastPath.current = pathname
    maxScroll.current = 0

    buffer.current.push({
      type: previous ? 'room_open' : 'page_view',
      ms_offset: Math.max(0, Date.now() - startedAt.current),
      seq: seq.current++,
      room: roomOf(pathname),
      path: pathname,
      label: null,
      target_kind: 'nav',
      target_id: null,
      meta: previous ? { from: roomOf(previous) } : { entry: true },
    })
  }, [pathname])

  return null
}
