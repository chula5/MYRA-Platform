'use client'

// WATCHING A VISIT BACK.
//
// Two ways to watch, because they answer different questions and neither one
// replaces the other:
//
//   VIDEO     rrweb's DOM recording, played back pixel for pixel. This is the
//             visit as she saw it — the actual pages, her actual scrolling.
//             It exists only when the recording got through; an old browser, a
//             blocked chunk or a visit past the recording cap has none.
//   TIMELINE  the event stream, played on a clock. Always available, because
//             the events are small enough to always record. It reads as a
//             sequence of decisions rather than pixels: which room, what she
//             touched, where she paused, what she left for.
//
// The timeline runs on COMPRESSED time. A real visit has a four-minute gap
// where she was deciding about a coat, and watching four minutes of a still
// frame tells you nothing that the gap's own label does not. Any pause longer
// than a few seconds is played short and marked, and the true clock is shown
// next to the playback clock so nothing is hidden.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
// The player's stylesheet is imported statically — it is inert CSS, safe to
// evaluate during prerender, and loading it lazily alongside the player makes
// the first frame flash unstyled. The player ITSELF stays dynamic below: it is
// a Svelte bundle that touches `document` when the module is evaluated, so a
// static import of it would break the server render of this page.
import 'rrweb-player/dist/style.css'
import { loadReplay } from './journey-actions'
import { ROOM_LABEL, describeEvent, fmtClock, fmtDuration, type JourneyEvent, type JourneyReplay as Replay } from '@/lib/journey'

type Mode = 'video' | 'timeline'

/** Real pauses longer than this are played at this length instead. */
const MAX_GAP_MS = 2_500
const SPEEDS = [1, 2, 4, 8] as const

/** The colour a step gets in the timeline — grouped by what kind of move it is,
 *  never one hue per event type (there are seventeen, and a legend that long is
 *  no longer a legend). */
function toneOf(type: string): string {
  if (type === 'click_out') return '#B0782A'
  if (type === 'look_open' || type === 'item_open') return '#0A0A0A'
  if (type === 'search' || type === 'chat_send') return '#2A78D6'
  if (type === 'idle' || type === 'session_end') return '#C9C7C2'
  if (type === 'room_open' || type === 'page_view') return '#C4A882'
  return '#A8A8A4'
}

interface Step extends JourneyEvent {
  /** Where this step sits on the compressed playback clock. */
  playAt: number
  /** The real pause before it, when that pause was long enough to matter. */
  heldMs: number
}

/** Lay the events out on a watchable clock, keeping a note of what was cut. */
function buildSteps(events: JourneyEvent[]): { steps: Step[]; total: number } {
  let clock = 0
  let previous = 0
  const steps: Step[] = events.map((e, i) => {
    const real = i === 0 ? 0 : Math.max(0, e.msOffset - previous)
    previous = e.msOffset
    clock += Math.min(real, MAX_GAP_MS)
    return { ...e, playAt: clock, heldMs: real > MAX_GAP_MS ? real : 0 }
  })
  return { steps, total: clock + 1200 }
}

export default function JourneyReplay({
  sessionId,
  onClose,
}: {
  sessionId: string
  onClose: () => void
}) {
  const [replay, setReplay] = useState<Replay | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [mode, setMode] = useState<Mode>('timeline')

  useEffect(() => {
    let liveRequest = true
    setReplay(null)
    setError(null)
    loadReplay(sessionId)
      .then((r) => {
        if (!liveRequest) return
        setReplay(r)
        // Open on the video when there is one — it is what she actually saw.
        if (r.recording.length > 1) setMode('video')
      })
      .catch((e) => liveRequest && setError(e instanceof Error ? e.message : String(e)))
    return () => { liveRequest = false }
  }, [sessionId])

  // Escape closes, as it does everywhere else in the studio.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const session = replay?.session ?? null
  const hasVideo = (replay?.recording.length ?? 0) > 1

  return (
    <div
      className="fixed inset-0 z-50 bg-[rgba(10,10,10,0.55)] flex items-start justify-center overflow-y-auto p-6"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Replay of a visit"
    >
      <div
        className="bg-white border border-[#E2E0DB] w-full max-w-[1180px] my-6"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div className="flex items-start justify-between gap-6 px-7 py-5 border-b border-[#E2E0DB]">
          <div className="min-w-0">
            <p className="text-[20px] tracking-[0.2em] text-[#C4A882] mb-1">A VISIT, PLAYED BACK</p>
            <h2 className="text-[26px] tracking-[0.06em] text-[#0A0A0A]">
              {session ? session.memberName.toUpperCase() : 'LOADING'}
            </h2>
            {session && (
              <p className="text-[20px] tracking-[0.06em] text-[#6B6B6B] mt-2">
                {new Date(session.startedAt).toLocaleString('en-GB', {
                  weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
                })}
                {' · '}{fmtDuration(session.activeMs)} ON THE APP
                {session.device ? ` · ${session.device.toUpperCase()}` : ''}
                {session.rooms.length ? ` · ${session.rooms.length} ROOM${session.rooms.length === 1 ? '' : 'S'}` : ''}
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            className="text-[20px] tracking-[0.1em] text-[#A8A8A4] hover:text-[#0A0A0A] transition-colors shrink-0"
          >
            CLOSE
          </button>
        </div>

        {/* ── Mode ───────────────────────────────────────────────────────── */}
        <div className="flex gap-5 px-7 pt-4 border-b border-[#E2E0DB]">
          {(['video', 'timeline'] as Mode[]).map((m) => {
            const disabled = m === 'video' && !hasVideo
            return (
              <button
                key={m}
                disabled={disabled}
                onClick={() => setMode(m)}
                className={`pb-3 text-[20px] tracking-[0.18em] transition-colors ${
                  mode === m
                    ? 'text-[#0A0A0A] border-b border-[#0A0A0A] -mb-px'
                    : disabled
                      ? 'text-[#DCDEE1] cursor-not-allowed'
                      : 'text-[#A8A8A4] hover:text-[#0A0A0A]'
                }`}
                title={disabled ? 'This visit was not recorded — watch the timeline instead' : undefined}
              >
                {m === 'video' ? 'VIDEO' : 'TIMELINE'}
              </button>
            )
          })}
        </div>

        <div className="p-7">
          {error && (
            <p className="text-[20px] tracking-[0.1em] text-[#B83A3A]">COULD NOT LOAD THIS VISIT — {error.toUpperCase()}</p>
          )}
          {!replay && !error && (
            <p className="text-[20px] tracking-[0.1em] text-[#A8A8A4]">LOADING THE VISIT…</p>
          )}
          {replay && !replay.available && (
            <p className="text-[20px] tracking-[0.1em] text-[#B83A3A]">
              MIGRATION 0063_CLIENT_JOURNEY.SQL HAS NOT BEEN RUN.
            </p>
          )}
          {replay?.available && mode === 'video' && hasVideo && (
            <VideoReplay events={replay.recording} fileBase={fileBaseOf(session)} />
          )}
          {replay?.available && mode === 'timeline' && (
            <TimelineReplay events={replay.events} />
          )}
          {replay?.available && mode === 'video' && !hasVideo && (
            <p className="text-[20px] tracking-[0.08em] text-[#7C838B]">
              THIS VISIT HAS NO RECORDING — WATCH THE TIMELINE INSTEAD.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

// ── VIDEO ───────────────────────────────────────────────────────────────────

/** "myra-visit-fiona-leeming-2026-10-25-1614" — what a saved visit is called. */
function fileBaseOf(session: Replay['session'] | null): string {
  if (!session) return 'myra-visit'
  const d = new Date(session.startedAt)
  const pad = (n: number) => String(n).padStart(2, '0')
  const when = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`
  const who = session.memberName.toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  return `myra-visit-${who}-${when}`
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

/** The player copied into public/ — jsDelivr serves the .cjs build as
 *  application/node, which browsers refuse to run. */
const PLAYER_JS = '/vendor/rrweb-player-2.1.6/rrweb-player.min.js'
const PLAYER_CSS = '/vendor/rrweb-player-2.1.6/style.min.css'

/** One HTML file that plays the visit anywhere, offline: the player and the
 *  recording are both inside it. */
async function replayFile(events: any[], title: string): Promise<Blob> {
  const [js, css] = await Promise.all([
    fetch(PLAYER_JS).then((r) => { if (!r.ok) throw new Error('player not found'); return r.text() }),
    fetch(PLAYER_CSS).then((r) => (r.ok ? r.text() : '')),
  ])
  // Nothing inside a <script> may read as a closing tag.
  const safe = (s: string) => s.replace(/<\/(script)/gi, '<\\/$1')
  const data = JSON.stringify(events).replace(/</g, '\\u003c')
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title.replace(/[<&]/g, '')}</title><style>${css}
body{margin:0;background:#FAFAF8;font-family:system-ui,sans-serif;display:flex;justify-content:center;padding:24px}</style></head>
<body><div id="player"></div><script>${safe(js)}</script><script>
var events=${data};
var P=window.rrwebPlayer.Player||window.rrwebPlayer.default||window.rrwebPlayer;
var w=Math.min(1100,window.innerWidth-48);
new P({target:document.getElementById('player'),props:{events:events,width:w,height:Math.round(w*0.62),autoPlay:false,skipInactive:true}});
</script></body></html>`
  return new Blob([html], { type: 'text/html' })
}

/** The best video format this browser can record: MP4 where Chrome has it
 *  (plays on an iPhone and in QuickTime), WebM otherwise. */
function videoType(): string {
  const options = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm']
  return options.find((m) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m)) ?? ''
}

/**
 * rrweb's own player, loaded on demand. It brings its own controls (play,
 * scrub, speed), so there is nothing to rebuild here — the work is confining it
 * to the width of this panel and tearing it down cleanly when the mode changes,
 * which it does not do by itself.
 *
 * Saving: an rrweb recording is pages, not pixels, so there is no video file to
 * hand over. SAVE AS VIDEO records the player while it plays (the browser asks
 * to share this tab; Chrome crops it to the frame), SAVE REPLAY FILE writes one
 * HTML file that plays the visit anywhere.
 */
function VideoReplay({ events, fileBase }: { events: any[]; fileBase: string }) {
  const host = useRef<HTMLDivElement | null>(null)
  const playerRef = useRef<any>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const [saving, setSaving] = useState<'idle' | 'video' | 'file'>('idle')
  const [saveError, setSaveError] = useState<string | null>(null)

  const saveFile = useCallback(async () => {
    setSaveError(null)
    setSaving('file')
    try {
      download(await replayFile(events, fileBase), `${fileBase}.html`)
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving('idle')
    }
  }, [events, fileBase])

  const stopVideo = useCallback(() => {
    const rec = recorderRef.current
    if (rec && rec.state !== 'inactive') rec.stop()
  }, [])

  const saveVideo = useCallback(async () => {
    const player = playerRef.current
    const mount = host.current
    if (!player || !mount) return
    setSaveError(null)
    if (!navigator.mediaDevices?.getDisplayMedia || typeof MediaRecorder === 'undefined') {
      setSaveError('this browser cannot record a tab — use Chrome, or save the replay file')
      return
    }
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 30 }, audio: false, preferCurrentTab: true, selfBrowserSurface: 'include',
      } as any)
    } catch {
      return // she said no to sharing the tab
    }
    const [track] = stream.getVideoTracks()
    // Chrome can crop the shared tab to the player's frame.
    const frame = (mount.querySelector('.rr-player__frame') as HTMLElement | null) ?? mount
    const Crop = (window as any).CropTarget
    if (Crop && typeof (track as any).cropTo === 'function') {
      try { await (track as any).cropTo(await Crop.fromElement(frame)) } catch { /* whole tab, then */ }
    }
    const type = videoType()
    const rec = new MediaRecorder(stream, type ? { mimeType: type, videoBitsPerSecond: 6_000_000 } : undefined)
    const chunks: Blob[] = []
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data) }
    rec.onstop = () => {
      stream.getTracks().forEach((t) => t.stop())
      try { player.pause() } catch { /* gone */ }
      const mime = rec.mimeType || type || 'video/webm'
      if (chunks.length) download(new Blob(chunks, { type: mime }), `${fileBase}.${mime.includes('mp4') ? 'mp4' : 'webm'}`)
      recorderRef.current = null
      setSaving('idle')
    }
    // Stopping the share from Chrome's own bar ends the video there.
    track.addEventListener('ended', () => { if (rec.state !== 'inactive') rec.stop() })
    recorderRef.current = rec
    setSaving('video')
    player.goto(0, false)
    // A beat for Chrome's "sharing this tab" bar to settle before the first frame.
    await new Promise((r) => setTimeout(r, 500))
    rec.start(1000)
    player.play()
  }, [fileBase])

  useEffect(() => {
    if (!host.current) return
    const mount = host.current
    let player: any = null
    let cancelled = false

    import('rrweb-player')
      .then((mod) => {
        if (cancelled || !mount) return
        const Player = (mod as any).default ?? mod
        const width = Math.max(480, mount.clientWidth || 960)
        player = new Player({
          target: mount,
          props: {
            events,
            width,
            height: Math.round(width * 0.62),
            autoPlay: false,
            showController: true,
            // Long pauses are skipped in the video too, so the two modes agree
            // about how a visit reads.
            skipInactive: true,
          },
        })
        playerRef.current = player
        // The end of the visit is the end of the video.
        player.addEventListener('finish', () => {
          const rec = recorderRef.current
          if (rec && rec.state === 'recording') setTimeout(() => rec.state === 'recording' && rec.stop(), 800)
        })
      })
      .catch((e) => {
        if (!cancelled) setFailed(e instanceof Error ? e.message : String(e))
      })

    return () => {
      cancelled = true
      const rec = recorderRef.current
      if (rec && rec.state !== 'inactive') rec.stop()
      playerRef.current = null
      try { player?.$destroy?.() } catch { /* already gone */ }
      if (mount) mount.innerHTML = ''
    }
  }, [events])

  return (
    <div>
      <p className="text-[20px] tracking-[0.06em] text-[#6B6B6B] mb-4 leading-relaxed">
        Her screen as she saw it. Everything she typed was masked at the point of recording, so
        the fields play back blank — what she deliberately sent is in the timeline.
      </p>
      <div className="flex items-center gap-6 flex-wrap mb-4">
        {saving === 'video' ? (
          <button onClick={stopVideo} className="text-[20px] tracking-[0.14em] text-[#B83A3A] hover:text-[#0A0A0A] transition-colors">
            ● RECORDING — STOP AND SAVE
          </button>
        ) : (
          <button
            onClick={saveVideo}
            disabled={saving !== 'idle'}
            className="text-[20px] tracking-[0.14em] text-[#0A0A0A] hover:text-[#7C838B] transition-colors disabled:text-[#C9C7C2]"
          >
            SAVE AS VIDEO
          </button>
        )}
        <button
          onClick={saveFile}
          disabled={saving !== 'idle'}
          className="text-[20px] tracking-[0.14em] text-[#0A0A0A] hover:text-[#7C838B] transition-colors disabled:text-[#C9C7C2]"
        >
          {saving === 'file' ? 'SAVING…' : 'SAVE REPLAY FILE'}
        </button>
      </div>
      <p className="text-[20px] tracking-[0.06em] text-[#A8A8A4] mb-4 leading-relaxed">
        {saving === 'video'
          ? 'Playing from the start and recording. Keep this tab open — the video saves itself when the visit ends, or when you stop it.'
          : 'Video: choose THIS TAB when Chrome asks, and it records at the speed set under the player. Replay file: one file that plays the visit in any browser, offline.'}
      </p>
      {saveError && (
        <p className="text-[20px] tracking-[0.1em] text-[#B83A3A] mb-4">COULD NOT SAVE — {saveError.toUpperCase()}</p>
      )}
      {failed && (
        <p className="text-[20px] tracking-[0.1em] text-[#B83A3A] mb-4">
          THE PLAYER DID NOT LOAD — {failed.toUpperCase()}. THE TIMELINE STILL WORKS.
        </p>
      )}
      <div ref={host} className="w-full overflow-x-auto [&_.rr-player]:max-w-full" />
    </div>
  )
}

// ── TIMELINE ────────────────────────────────────────────────────────────────

function TimelineReplay({ events }: { events: JourneyEvent[] }) {
  const { steps, total } = useMemo(() => buildSteps(events), [events])
  const [t, setT] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(2)
  const raf = useRef<number | null>(null)
  const last = useRef<number>(0)

  // The playback loop. Driven by requestAnimationFrame rather than an interval
  // so the clock stays true when the tab is throttled.
  useEffect(() => {
    if (!playing) return
    last.current = performance.now()
    const tick = (now: number) => {
      const dt = (now - last.current) * speed
      last.current = now
      // The updater only clamps. Stopping at the end is the separate effect
      // below: a setState from inside another one leaves the two out of step.
      setT((prev) => Math.min(total, prev + dt))
      raf.current = requestAnimationFrame(tick)
    }
    raf.current = requestAnimationFrame(tick)
    return () => { if (raf.current) cancelAnimationFrame(raf.current) }
  }, [playing, speed, total])

  useEffect(() => {
    if (playing && t >= total) setPlaying(false)
  }, [playing, t, total])

  const index = useMemo(() => {
    let i = -1
    for (let k = 0; k < steps.length; k++) {
      if (steps[k].playAt <= t) i = k
      else break
    }
    return i
  }, [steps, t])

  const current = index >= 0 ? steps[index] : null
  const shown = useMemo(() => steps.slice(0, index + 1).slice(-9).reverse(), [steps, index])
  const realElapsed = current?.msOffset ?? 0

  const seekTo = useCallback((ms: number) => {
    setT(Math.max(0, Math.min(total, ms)))
  }, [total])

  const jump = useCallback((delta: number) => {
    const next = index + delta
    if (next < 0) return seekTo(0)
    if (next >= steps.length) return seekTo(total)
    seekTo(steps[next].playAt)
  }, [index, steps, total, seekTo])

  if (!steps.length) {
    return (
      <p className="text-[20px] tracking-[0.08em] text-[#7C838B]">
        NOTHING WAS RECORDED IN THIS VISIT — SHE OPENED THE APP AND LEFT BEFORE ANYTHING FLUSHED.
      </p>
    )
  }

  const room = current?.room ? ROOM_LABEL[current.room] ?? current.room.toUpperCase() : '—'

  return (
    <div className="space-y-5">
      {/* ── The frame ─────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-[1.35fr_1fr] gap-6">
        <div className="relative border border-[#E2E0DB] bg-[#FAFAF8] aspect-[16/10] overflow-hidden">
          {/* Which room she is standing in, as the backdrop. */}
          <div className="absolute inset-0 flex flex-col items-center justify-center px-8 text-center">
            <p className="text-[20px] tracking-[0.2em] text-[#C4A882] mb-3">SHE IS IN</p>
            <p className="text-[38px] tracking-[0.08em] text-[#0A0A0A] leading-tight">{room}</p>
            <p className="text-[20px] tracking-[0.06em] text-[#4A4E57] mt-5 max-w-[34ch] leading-relaxed">
              {current ? describeEvent(current) : 'THE VISIT HAS NOT STARTED'}
            </p>
            {current?.heldMs ? (
              <p className="text-[20px] tracking-[0.1em] text-[#A8A8A4] mt-4">
                SHE STAYED HERE {fmtDuration(current.heldMs)} BEFORE THE NEXT MOVE
              </p>
            ) : null}
          </div>

          {/* Where she touched the screen, when the event carries coordinates. */}
          {current?.meta?.x !== undefined && current?.meta?.y !== undefined && (
            <span
              className="absolute w-5 h-5 rounded-full border-2 border-[#0A0A0A] -translate-x-1/2 -translate-y-1/2 pointer-events-none"
              style={{
                left: `${pctOf(Number(current.meta.x), Number(current.meta.vw ?? 1200))}%`,
                top: `${pctOf(Number(current.meta.y), 820)}%`,
                background: 'rgba(196,168,130,0.35)',
              }}
              aria-hidden
            />
          )}

          <span
            className="absolute left-4 top-4 text-[20px] tracking-[0.1em]"
            style={{ color: toneOf(current?.type ?? '') }}
          >
            {current ? current.type.replace(/_/g, ' ').toUpperCase() : ''}
          </span>
        </div>

        {/* ── The running log ───────────────────────────────────────────────── */}
        <div className="border border-[#E2E0DB] p-5 overflow-hidden">
          <p className="text-[20px] tracking-[0.14em] text-[#6B6B6B] mb-4">WHAT SHE DID</p>
          <ol className="space-y-2.5">
            {shown.map((s, i) => (
              <li key={s.eventId} className="flex items-baseline gap-3">
                <span
                  className="inline-block w-1.5 h-1.5 rounded-full shrink-0 translate-y-[-2px]"
                  style={{ background: toneOf(s.type), opacity: i === 0 ? 1 : 0.4 }}
                  aria-hidden
                />
                <span className="text-[20px] tracking-[0.06em] text-[#A8A8A4] shrink-0 tabular-nums">
                  {fmtClock(s.msOffset)}
                </span>
                <span
                  className="text-[20px] tracking-[0.04em] truncate"
                  style={{ color: i === 0 ? '#0A0A0A' : '#6B6B6B' }}
                >
                  {describeEvent(s)}
                </span>
              </li>
            ))}
          </ol>
        </div>
      </div>

      {/* ── Scrubber ──────────────────────────────────────────────────────── */}
      <div>
        <div
          className="relative h-9 cursor-pointer"
          onClick={(e) => {
            const box = e.currentTarget.getBoundingClientRect()
            seekTo(((e.clientX - box.left) / box.width) * total)
          }}
          role="slider"
          tabIndex={0}
          aria-label="Position in the visit"
          aria-valuemin={0}
          aria-valuemax={Math.round(total)}
          aria-valuenow={Math.round(t)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight') { e.preventDefault(); jump(1) }
            if (e.key === 'ArrowLeft') { e.preventDefault(); jump(-1) }
            if (e.key === ' ') { e.preventDefault(); setPlaying((p) => !p) }
          }}
        >
          <div className="absolute inset-x-0 top-4 h-[3px] bg-[#EDEBE6]" />
          <div
            className="absolute top-4 left-0 h-[3px] bg-[#0A0A0A]"
            style={{ width: `${(t / total) * 100}%` }}
          />
          {/* One tick per move, so the shape of the visit is visible before
              playing it — a dense run of taps reads differently from a long,
              deliberate browse. */}
          {steps.map((s) => (
            <span
              key={s.eventId}
              title={describeEvent(s)}
              className="absolute w-[2px] h-[11px] top-[10px] -translate-x-1/2"
              style={{ left: `${(s.playAt / total) * 100}%`, background: toneOf(s.type) }}
            />
          ))}
          <span
            className="absolute w-3 h-3 rounded-full bg-[#0A0A0A] top-[9px] -translate-x-1/2"
            style={{ left: `${(t / total) * 100}%` }}
          />
        </div>

        <div className="flex items-center justify-between gap-5 flex-wrap mt-2">
          <div className="flex items-center gap-4">
            <button
              onClick={() => { if (t >= total) setT(0); setPlaying((p) => !p) }}
              className="text-[20px] tracking-[0.14em] text-[#0A0A0A] hover:text-[#C4A882] transition-colors"
            >
              {playing ? 'PAUSE' : t >= total ? 'PLAY AGAIN' : 'PLAY'}
            </button>
            <button onClick={() => jump(-1)} className="text-[20px] tracking-[0.1em] text-[#6B6B6B] hover:text-[#0A0A0A] transition-colors">
              PREV
            </button>
            <button onClick={() => jump(1)} className="text-[20px] tracking-[0.1em] text-[#6B6B6B] hover:text-[#0A0A0A] transition-colors">
              NEXT
            </button>
            <div className="flex items-center gap-2">
              {SPEEDS.map((s) => (
                <button
                  key={s}
                  onClick={() => setSpeed(s)}
                  className={`text-[20px] tracking-[0.06em] transition-colors ${
                    speed === s ? 'text-[#0A0A0A]' : 'text-[#C9C7C2] hover:text-[#6B6B6B]'
                  }`}
                >
                  {s}×
                </button>
              ))}
            </div>
          </div>

          <p className="text-[20px] tracking-[0.08em] text-[#A8A8A4] tabular-nums">
            {fmtClock(t)} PLAYED · {fmtClock(realElapsed)} INTO HER REAL VISIT · STEP {Math.max(0, index + 1)}/{steps.length}
          </p>
        </div>

        <p className="text-[20px] tracking-[0.06em] text-[#7C838B] mt-3 leading-relaxed">
          Pauses longer than {Math.round(MAX_GAP_MS / 1000)} seconds are played short so the visit
          is watchable end to end. The real clock runs beside the playback clock, and any step she
          held on says how long she held it.
        </p>
      </div>
    </div>
  )
}

/** A recorded coordinate as a percentage of the frame, clamped so a click at
 *  the very edge of her screen still lands inside the box. */
function pctOf(value: number, extent: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(extent) || extent <= 0) return 50
  return Math.min(96, Math.max(4, (value / extent) * 100))
}
