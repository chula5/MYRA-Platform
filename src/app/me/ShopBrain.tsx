'use client'

// MYRA WORKED WHILE YOU SHOPPED.
//
// Three answers to a question she has not asked yet, sitting above her looks:
// more like the pieces she kept out there, more from the labels she was
// reading, and those pieces already styled. She hearts something on a brand's
// own site and by the time she opens MYRA the thinking has been done.
//
// Each answer is one card — a cover picture and a clear title. Hover and the
// card turns over to show a grid of what is inside; tap and the whole section
// opens underneath as a grid she can shop or style from.
//
// It draws nothing at all until she has kept something — an empty promise is
// worse than no promise.

import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react'
import Link from 'next/link'
import FallbackImage from '@/components/FallbackImage'
import ShopLink from '@/components/ShopLink'
import ComposedLookCard from '@/components/me/ComposedLookCard'
import StylingBadge from '@/components/me/StylingBadge'
import { STYLING_OPEN_EVENT, clearStylingReady, getStylingProgress, keepWatchingStyling, publishStyling, stopWatchingStyling } from '@/components/me/styling-progress'
import { WAYS } from '@/lib/styled-ways-core'
import { useScrollTo } from '@/lib/smooth-scroll'
import { loadShopBrain, type ShopBrainView, type ShopPiece } from './shop-brain-actions'
import { warmUpShopBrain, pollWaysMany, openWaysToWear } from './ways/actions'
import type { StyledLook } from '@/app/admin/private-stylist/actions'
import type { StyledWayLook } from '@/lib/styled-ways-core'

type Door = 'similar' | 'brands' | 'styled'

const HEAD = 'myra-section-label !text-[clamp(28px,3vw,46px)]'
const NOTE = 'myra-section-note mt-2 !text-[clamp(17px,1.6vw,24px)]'
const FLIP = 'transition-transform duration-[600ms] [transition-timing-function:cubic-bezier(0.175,0.885,0.32,1.275)]'

function Piece({ piece }: { piece: ShopPiece }) {
  const body = (
    <>
      <div className="relative aspect-[3/4] bg-white overflow-hidden rounded-[14px]">
        {piece.image_url && (
          <FallbackImage src={piece.image_url} thumbWidth={400} alt={piece.product_name} className="absolute inset-0 w-full h-full object-contain" />
        )}
      </div>
      <p className="mt-3 text-[22px] xl:text-[26px] text-[#2B2B2B] leading-[1.2]">{piece.brand ?? piece.product_name}</p>
      <p className="text-[19px] xl:text-[22px] text-[#7C838B] leading-[1.25] line-clamp-1">{piece.product_name}</p>
      {piece.price_gbp != null && <p className="text-[19px] xl:text-[22px] text-[#7C838B]">£{Math.round(piece.price_gbp)}</p>}
    </>
  )
  if (!piece.url) return <div className="block">{body}</div>
  return (
    <ShopLink
      item={{ item_id: piece.item_id, retailer_url: piece.url, product_name: piece.product_name, brand: { name: piece.brand } }}
      className="block group"
    >
      {body}
    </ShopLink>
  )
}

const PIECE_GRID = 'grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-x-6 gap-y-10'

// Once a door is open the three fold into a row of pills at the top and what
// is behind the open one sits straight beneath — on a phone the doors stack
// full height, and a section drawn under all three was a long way down
// (Chloe, 2026-10-16). CLOSE stands the doors back up.
const DOOR_TABS: { id: Door; label: string; short: string }[] = [
  { id: 'similar', label: 'MORE OF THE SAME', short: 'SAME' },
  { id: 'brands', label: 'MORE FROM YOUR BRANDS', short: 'BRANDS' },
  { id: 'styled', label: 'STYLED FOR YOU', short: 'STYLED' },
]

// ONE OUTFIT, small — her picture when the look has one, otherwise its
// pieces two by two on white, the piece it was built around first.
function LookThumb({ look, heroId }: { look: StyledLook; heroId?: string }) {
  if (look.image_url) {
    return (
      <div className="relative aspect-[3/4] bg-[#E4E2DD] rounded-[10px] overflow-hidden">
        <FallbackImage src={look.image_url} thumbWidth={360} alt="" className="absolute inset-0 w-full h-full object-cover" />
      </div>
    )
  }
  const items = [...look.items].sort((a, b) => (a.item_id === heroId ? -1 : b.item_id === heroId ? 1 : 0)).slice(0, 4)
  return (
    <div className="aspect-[3/4] grid grid-cols-2 grid-rows-2 gap-[3px] p-[3px] bg-[#E4E2DD] rounded-[10px] overflow-hidden">
      {items.map((it, j) => (
        <div key={j} className="relative bg-white overflow-hidden">
          {it.image_url && <FallbackImage src={it.image_url} thumbWidth={200} alt={it.product_name} className="absolute inset-0 w-full h-full object-contain p-[2px]" />}
        </div>
      ))}
    </div>
  )
}

// THREE OUTFITS for one of her pieces, side by side — or quiet placeholders
// while MYRA is still putting them together.
function ThreeLooks({ looks, heroId, working, note }: { looks?: StyledLook[]; heroId?: string; working?: boolean; note?: string }) {
  if (looks?.length) {
    return (
      <div className="grid grid-cols-3 gap-2">
        {looks.slice(0, 3).map((l, i) => <LookThumb key={i} look={l} heroId={heroId} />)}
      </div>
    )
  }
  if (note && !working) return <p className="text-[17px] xl:text-[19px] text-[#55534E] py-2">{note}</p>
  return (
    <div className="grid grid-cols-3 gap-2">
      {[0, 1, 2].map((i) => (
        <div key={i} className="aspect-[3/4] rounded-[10px] bg-gradient-to-r from-[#E9E9E7] via-[#F4F4F2] to-[#E9E9E7] animate-pulse" />
      ))}
    </div>
  )
}

// ONE OF HER PIECES in the open section: the piece on white; hover and its
// three outfits turn up over it, the same way the doors turn.
function StyledPiece({ piece, looks, working, note, active, onPick }: {
  piece: ShopPiece; looks?: StyledLook[]; working: boolean; note?: string; active: boolean; onPick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onPick}
      aria-label={`See your ${piece.brand ?? piece.product_name} styled`}
      className={`group block w-full text-left outline-none focus:outline-none`}
    >
      {/* No card, no frame: the piece sits on the page the way it does in
          every other grid, and only its own picture holds the eye. */}
      <div className="relative aspect-[3/4] bg-white rounded-[14px] overflow-hidden [perspective:1000px]">
        {piece.image_url && <FallbackImage src={piece.image_url} thumbWidth={600} alt={piece.product_name} className="absolute inset-0 w-full h-full object-contain" />}
        <div className={`absolute inset-0 bg-[#F2F2F2] p-3 flex flex-col justify-center origin-bottom [transform:rotateX(-90deg)]
          group-hover:[transform:rotateX(0deg)] group-focus-visible:[transform:rotateX(0deg)] motion-reduce:transition-none ${FLIP}`}>
          <ThreeLooks looks={looks} heroId={piece.item_id} working={working} note={note} />
        </div>
      </div>
      {/* The piece whose outfits are open below says so in its name — there is
          no card left to shade. */}
      <p className={`mt-3 text-[22px] xl:text-[26px] text-[#2B2B2B] leading-[1.2] ${active ? 'underline underline-offset-4' : ''}`}>{piece.brand ?? piece.product_name}</p>
      <p className="text-[19px] xl:text-[22px] text-[#7C838B] leading-[1.25] line-clamp-1">{piece.product_name}</p>
    </button>
  )
}

// ONE DOOR — a portrait card in the MYRA shape. The front is a cover picture
// with the title in a white band; on hover the inside turns up from the
// bottom edge, a small grid of what she will find behind it.
function Door({
  title, cover, coverFit = 'cover', inside, insideNode, open, onOpen, empty,
}: {
  title: string
  cover: string | null
  coverFit?: 'contain' | 'cover'
  inside: (string | null)[]
  /** Replaces the picture grid when the inside is something richer. */
  insideNode?: ReactNode
  open: boolean
  onOpen: () => void
  empty?: string
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-expanded={open}
      className={`group relative w-full aspect-[3/4] rounded-[24px] overflow-hidden text-left
        [perspective:1000px]
        hover:scale-[1.03] focus-visible:scale-[1.03] outline-none focus:outline-none ${FLIP}`}
    >
      {/* Front: no card or frame, just the rounded cover image and its title. */}
      <div className="absolute inset-0">
        {cover ? (
          <FallbackImage src={cover} thumbWidth={900} alt="" className={`absolute inset-0 w-full h-full ${coverFit === 'cover' ? 'object-cover' : 'object-contain p-4'}`} />
        ) : (
          <p className="absolute inset-x-6 bottom-10 text-center text-[19px] text-[#55534E]">{empty}</p>
        )}
        <div className="absolute inset-0 flex items-center justify-center px-2 sm:px-3">
          {/* One pill for all three doors, and the same box on every one: the
              width and the height are set inline, in the viewport's own units,
              because a utility class for them did not survive into the built
              CSS. Kept small — it sits over the picture, so it is sized to the
              words and no more. The height is FIXED rather than a floor, so a
              label that wraps to two lines cannot grow taller than its
              neighbours, and it is set above the tallest wrap so nothing is
              clipped. */}
          <p
            className="bg-[rgba(255,255,255,0.9)] backdrop-blur-[2px] rounded-full flex items-center justify-center px-4 sm:px-5 text-center text-[19px] md:text-[23px] xl:text-[27px] tracking-[0.05em] leading-[1.15] text-[#2B2B2B] shadow-[0_2px_16px_rgba(43,43,43,0.16)]"
            style={{ width: 'min(360px, 92%)', height: 'clamp(70px, 4.8vw, 92px)' }}
          >
            {title}
          </p>
        </div>
      </div>

      {/* Inside: turns up from the bottom edge on hover, a grid of what is in here. */}
      {(inside.length > 0 || insideNode) && (
        <div
          className={`absolute inset-0 bg-[#F2F2F2] p-5 md:p-6 flex flex-col origin-bottom [transform:rotateX(-90deg)]
            group-hover:[transform:rotateX(0deg)] group-focus-visible:[transform:rotateX(0deg)] motion-reduce:transition-none ${FLIP}`}
        >
          <div className="flex items-baseline justify-between gap-3 mb-3">
            <p className="text-[clamp(20px,1.6vw,32px)] tracking-[0.05em] text-[#2B2B2B] leading-[1.05]">{title}</p>
            <p className="text-[clamp(15px,1vw,19px)] tracking-[0.14em] text-[#7C838B] whitespace-nowrap">OPEN →</p>
          </div>
          {insideNode ?? (
            <div className="grid grid-cols-3 gap-3 flex-1 content-start">
              {inside.slice(0, 9).map((src, i) => (
                <div key={i} className="relative aspect-[3/4] bg-white rounded-[10px] overflow-hidden">
                  {src && <FallbackImage src={src} thumbWidth={240} alt="" className="absolute inset-0 w-full h-full object-contain p-1" />}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </button>
  )
}

/** Does this view draw anything at all? Mirrors the early return below. */
const hasContent = (v: ShopBrainView | null) => !!v && (v.saved.length > 0 || v.similar.length > 0 || v.fromBrands.length > 0)

export default function ShopBrain({ testMemberId, initialView, onReady }: {
  testMemberId?: string
  /** Gathered on the server behind the mirror — drawn at once, no fetch. */
  initialView?: ShopBrainView
  /** Called once the section knows what it has — so the page's curtain can
   *  wait for it, and so an empty page can say so instead of staying blank. */
  onReady?: (hasContent: boolean) => void
}) {
  const [view, setView] = useState<ShopBrainView | null>(initialView ?? null)
  const onReadyRef = useRef(onReady)
  useEffect(() => { onReadyRef.current = onReady }, [onReady])
  const told = useRef(false)
  const tell = (has: boolean) => { if (told.current) return; told.current = true; onReadyRef.current?.(has) }
  const [door, setDoor] = useState<Door | null>(null)
  const [anchor, setAnchor] = useState<string | null>(null)
  const [looks, setLooks] = useState<Record<string, StyledLook[]>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [failed, setFailed] = useState<Record<string, string>>({})
  const queued = useRef(false)
  const openRef = useRef<HTMLDivElement>(null)
  const tabsRef = useRef<HTMLDivElement>(null)
  const outfitsRef = useRef<HTMLDivElement>(null)
  const scrollTo = useScrollTo()
  // Pieces MYRA is styling on this visit (the pill at the top counts them),
  // the ones she tapped herself, and the last of those to come back ready.
  const [track, setTrack] = useState<string[]>([])
  const trackRef = useRef<string[]>([])
  trackRef.current = track
  const tapped = useRef<Set<string>>(new Set())
  // A piece that came back ready while she was in another room is still READY here.
  const [ready, setReady] = useState<string | null>(() => getStylingProgress().ready)
  const [hintGone, setHintGone] = useState(false)
  // A phone gets her outfits as a sheet in from the right; a wider screen
  // opens them in the grid, straight under the piece she tapped.
  const [phone, setPhone] = useState(false)
  const [sheet, setSheet] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 639px)')
    const on = () => setPhone(mq.matches)
    on()
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  const [, bump] = useState(0)
  const pageLive = useRef(true)
  useEffect(() => { pageLive.current = true; return () => { pageLive.current = false } }, [])

  // The mark in the corner is shared with every room (components/me/
  // styling-progress): this page counts while it is open, and hands the
  // count on when she leaves with pieces still being styled.
  useEffect(() => {
    stopWatchingStyling('/me')
    return () => {
      const pending = trackRef.current.filter((id) => !done.current.has(id))
      if (pending.length) keepWatchingStyling(pending, Array.from(tapped.current), testMemberId)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [testMemberId])
  // Tapped in another room: the mark brings her here with ?styled=1.
  const wantOpen = useRef(typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('styled') === '1')

  // The section draws nothing until the view arrives, and on a phone the call
  // can be dropped with the page — a suspended tab, a flaky network — so it
  // retries, and picks the load back up when she returns with nothing shown.
  const viewRef = useRef<ShopBrainView | null>(initialView ?? null)
  useEffect(() => {
    let live = true
    const load = async (attempt: number) => {
      try {
        // Already here from the server: skip straight to the fresh check.
        const v = attempt === 0 && viewRef.current ? viewRef.current : await loadShopBrain(testMemberId)
        if (!live) return
        viewRef.current = v
        setView(v)
        tell(hasContent(v))
        // That was her kept view, there at once. Now the fresh one, quietly:
        // swapped in only if it says something different, and never an empty
        // answer (a failed rebuild) over one that had pieces in it.
        if (attempt === 0) void loadShopBrain(testMemberId, { fresh: true }).then((f) => {
          if (!live || (!hasContent(f) && hasContent(v))) return
          if (JSON.stringify(f) === JSON.stringify(v)) return
          viewRef.current = f
          setView(f)
        }).catch(() => {})
      } catch {
        if (live && attempt < 2) setTimeout(() => void load(attempt + 1), 1500 * (attempt + 1))
        else if (live) tell(false)
      }
    }
    void load(0)
    const onVisible = () => { if (document.visibilityState === 'visible' && !viewRef.current) void load(1) }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      live = false
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [testMemberId])

  // The pieces she kept are styled without being asked. The work is queued
  // on the server (lib/styled-ways-queue) and judged before it is shown, so
  // it is done — and kept — whether or not she stays on the page; this only
  // watches the shelf fill. A piece never styled before reads as "working";
  // one MYRA could not style says so.
  const done = useRef<Set<string>>(new Set())

  // Watch pieces until MYRA has finished them. A piece she tapped herself
  // turns the pill to READY when its outfits land.
  async function pollUntilDone(ids: string[], live: () => boolean) {
    let pending = ids.filter((id) => !done.current.has(id))
    let polls = 0
    while (live() && pending.length && polls++ < 40) {
      await new Promise((r) => setTimeout(r, 3000))
      pending = pending.filter((id) => !done.current.has(id))
      if (!pending.length) break
      const r = await pollWaysMany(pending, testMemberId).catch(() => ({} as Awaited<ReturnType<typeof pollWaysMany>>))
      if (!live()) return
      for (const id of pending) {
        const x = r[id]
        if (!x) continue
        if (x.looks.length) setLooks((l) => ({ ...l, [id]: x.looks }))
        if (x.status !== 'working') {
          done.current.add(id)
          if (!x.looks.length) setFailed((f) => ({ ...f, [id]: x.error ?? 'Nothing MYRA would put with it yet.' }))
          else if (tapped.current.has(id)) setReady(id)
        }
      }
      pending = pending.filter((id) => !done.current.has(id))
      bump((n) => n + 1)
    }
  }

  useEffect(() => {
    if (!view?.saved.length || queued.current) return
    queued.current = true
    setAnchor((a) => a ?? view.saved[0].item_id)
    let live = true
    const ids = view.saved.slice(0, 12).map((s) => s.item_id)
    void (async () => {
      const w = await warmUpShopBrain(testMemberId).catch(() => ({ looks: {} as Record<string, StyledWayLook[]>, working: [] as string[], capped: false }))
      if (!live) return
      setLooks((l) => ({ ...l, ...w.looks }))
      for (const id of ids) if ((w.looks[id]?.length ?? 0) >= 3) done.current.add(id)
      let pending = ids.filter((id) => !done.current.has(id))
      for (const id of pending) if (!w.working.includes(id) && !w.looks[id]) {
        setFailed((f) => ({ ...f, [id]: w.capped ? 'MYRA will style this one a little later.' : 'Tap to see it styled.' }))
        done.current.add(id)
      }
      pending = pending.filter((id) => !done.current.has(id))
      setTrack((t) => Array.from(new Set([...t, ...pending])))
      await pollUntilDone(pending, () => live)
    })()
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view])

  // A TAP: her piece comes forward, the page goes down to its outfits, and a
  // piece without its three is styled now — a tap job jumps the warm-ups.
  async function pick(id: string) {
    setAnchor(id)
    setHintGone(true)
    setSheet(true)
    if (ready === id) setReady(null)
    // Keep the bottom of her piece in view above its outfits.
    if (!phone) setTimeout(() => { if (outfitsRef.current) scrollTo(outfitsRef.current, { offset: -220 }) }, 50)
    if ((looks[id]?.length ?? 0) >= WAYS) return
    done.current.delete(id)
    tapped.current.add(id)
    setFailed((f) => { const n = { ...f }; delete n[id]; return n })
    setTrack((t) => (t.includes(id) ? t : [...t, id]))
    const r = await openWaysToWear(id, {}, testMemberId).catch(() => null)
    if (!pageLive.current) return
    if (r?.looks.length) setLooks((l) => ({ ...l, [id]: r.looks as StyledWayLook[] }))
    if (!r || r.status !== 'working') {
      done.current.add(id)
      if (!r?.looks.length) setFailed((f) => ({ ...f, [id]: r?.error ?? 'MYRA could not style this piece just now.' }))
      bump((n) => n + 1)
      return
    }
    await pollUntilDone([id], () => pageLive.current)
  }

  // The pill: tap it and she is at the outfits, whichever door was open.
  function goToReady() {
    setDoor('styled')
    if (ready) setAnchor(ready)
    setReady(null)
    clearStylingReady()
    setSheet(true)
    if (!phone) setTimeout(() => { if (outfitsRef.current) scrollTo(outfitsRef.current, { offset: -220 }) }, 80)
  }

  function toggle(d: Door) {
    const next = door === d ? null : d
    setDoor(next)
    // Land on the row of pills, with the open section right under it.
    if (next) setTimeout(() => { const el = tabsRef.current ?? openRef.current; if (el) scrollTo(el, { offset: -24 }) }, 50)
  }

  // Tell the corner (it ignores a repeat of the same numbers).
  useEffect(() => { publishStyling({ total: track.length, finished: track.filter((id) => done.current.has(id)).length, ready, origin: '/me?styled=1', mode: 'blend' }) })
  // The mark was tapped on this page, or brought her here from another room.
  useEffect(() => {
    const onOpen = () => goToReady()
    window.addEventListener(STYLING_OPEN_EVENT, onOpen)
    return () => window.removeEventListener(STYLING_OPEN_EVENT, onOpen)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, phone])
  useEffect(() => {
    if (!wantOpen.current || !view) return
    wantOpen.current = false
    try { window.history.replaceState(null, '', window.location.pathname) } catch { /* fine */ }
    setTimeout(goToReady, 120)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view])

  if (!view || (!view.saved.length && !view.similar.length && !view.fromBrands.length)) return null
  const doors = view.saved.length ? 3 : 2

  const labels = view.brands.slice(0, 2)
  const current = anchor ? view.saved.find((s) => s.item_id === anchor) ?? view.saved[0] : view.saved[0]
  const shown = current ? looks[current.item_id] : undefined
  const stillWorking = track.filter((id) => !done.current.has(id))
  const finishedCount = track.length - stillWorking.length
  const currentWorking = !!current && !done.current.has(current.item_id)
  const brandsTitle = 'MORE FROM YOUR BRANDS'
  const brandsNote = 'FROM THE BRANDS YOU LOVE'

  // The tapped piece's outfits — drawn under it in the grid, or in the sheet
  // on a phone.
  const outfitsPanel = (
    <>
      {current && (
        <p ref={outfitsRef} className="text-[22px] xl:text-[26px] text-[#2B2B2B] scroll-mt-6">
          {current.brand ?? current.product_name}
          {current.host ? <span className="text-[#7C838B]"> · {current.kind === 'viewed' ? 'you looked at this on ' : ''}{current.host}</span> : null}
        </p>
      )}
      <div className="mt-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
        {shown?.length ? (
          // Each outfit shows the moment it is judged; the rest keep their place.
          <>
            {shown.map((l, i) => <ComposedLookCard key={i} look={l} heroId={current?.item_id} saveable testMemberId={testMemberId} />)}
            {currentWorking && Array.from({ length: Math.max(0, WAYS - shown.length) }).map((_, i) => (
              <div key={`w${i}`} className="h-[260px] rounded-[18px] bg-gradient-to-r from-[#EFEFED] via-[#F7F7F5] to-[#EFEFED] animate-pulse" />
            ))}
          </>
        ) : current && !failed[current.item_id] ? (
          [0, 1, 2].map((i) => (
            <div key={i} className="h-[260px] rounded-[18px] bg-gradient-to-r from-[#EFEFED] via-[#F7F7F5] to-[#EFEFED]" />
          ))
        ) : (
          <p className="text-[19px] xl:text-[21px] text-[#55534E]">{(current && failed[current.item_id]) ?? 'Tap a piece to see it styled.'}</p>
        )}
      </div>
    </>
  )
  const firstLook = current ? looks[current.item_id]?.[0] : undefined
  const styledCover = firstLook?.image_url ?? current?.image_url ?? null
  const styledInside = view.saved.slice(0, 9).map((s) => s.image_url ?? null)
  const styledBoxes = (
    <div data-lenis-prevent className="flex-1 min-h-0 overflow-hidden space-y-3">
      {view.saved.slice(0, 3).map((s) => (
        <div key={s.item_id} className="bg-white rounded-[14px] p-2.5 flex gap-2.5 items-stretch">
          <div className="relative w-[22%] flex-none aspect-[3/4] self-center">
            {s.image_url && <FallbackImage src={s.image_url} thumbWidth={200} alt={s.product_name} className="absolute inset-0 w-full h-full object-contain" />}
          </div>
          <div className="flex-1 min-w-0">
            <ThreeLooks looks={looks[s.item_id]} heroId={s.item_id} working={busy === s.item_id || !done.current.has(s.item_id)} note={failed[s.item_id]} />
          </div>
        </div>
      ))}
    </div>
  )

  return (
    <section className="mb-20 pt-2">
      <div className="text-center mb-10 lg:mb-12">
        <p className="text-[clamp(15px,1.3vw,21px)] tracking-[0.05em] text-[#2B2B2B]">MYRA WORKED WHILE YOU SHOPPED</p>
        {view.fromLooking && <p className="myra-section-note mt-3">FROM WHAT YOU LOOKED AT{view.searches.length ? ' AND SEARCHED FOR' : ''}</p>}
      </div>

      {/* The dress form that says what MYRA is styling lives in the member
          chrome now, so it follows her into every room. HER VIEW has no
          chrome, so it stands here for Chloe. */}
      {testMemberId && <StylingBadge onOpen={goToReady} />}

      {/* The three doors. A phone stacks them down the page, one at a time,
          so each picture is read at its own size; a desktop stands them in a
          row, which is how the row of three was drawn. The row waits for a
          desktop rather than a tablet: three doors across a narrow screen
          leave each picture too small to read and the label too narrow to
          sit in. */}
      {door ? (
        <div ref={tabsRef} role="tablist" aria-label="MYRA worked while you shopped" className="grid grid-cols-3 gap-2 sm:flex sm:flex-wrap sm:gap-3 px-2 sm:px-4 lg:px-8 scroll-mt-24">
          {DOOR_TABS.filter((t) => t.id !== 'styled' || view.saved.length > 0).map((t) => {
            const on = door === t.id
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => toggle(t.id)}
                className={`rounded-full px-3 sm:px-6 py-3 sm:py-3.5 text-[15px] sm:text-[19px] xl:text-[22px] 2xl:text-[25px] tracking-[0.08em] uppercase text-center transition-colors ${on ? 'bg-[#2B2B2B] text-white' : 'bg-white/85 text-[#55534E] shadow-[0_2px_14px_rgba(43,43,43,0.08)] hover:text-[#2B2B2B]'}`}
              >
                <span className="sm:hidden">{t.short}</span>
                <span className="hidden sm:inline">{t.id === 'brands' ? brandsTitle : t.label}</span>
              </button>
            )
          })}
        </div>
      ) : (
      <div className={`grid ${doors === 3 ? 'grid-cols-1 lg:grid-cols-3' : 'grid-cols-1 lg:grid-cols-2'} gap-5 sm:gap-8 lg:gap-12 2xl:gap-16 w-full px-2 sm:px-4 lg:px-8`}>
        <Door
          title="MORE OF THE SAME"
          cover={view.similar[0]?.image_url ?? null}
          inside={view.similar.slice(0, 9).map((p) => p.image_url ?? null)}
          open={door === 'similar'} onOpen={() => toggle('similar')}
          empty="Nothing close enough yet."
        />
        <Door
          title={brandsTitle}
          cover={view.fromBrands[0]?.image_url ?? null}
          inside={view.fromBrands.slice(0, 9).map((p) => p.image_url ?? null)}
          open={door === 'brands'} onOpen={() => toggle('brands')}
          empty={`Nothing from ${labels.length ? labels.join(' or ') : 'those labels'} yet.`}
        />
        {view.saved.length > 0 && <Door
          title="STYLED FOR YOU"
          // Filled to the tile like the other two, so it takes the same
          // rounded edge and stands the same size. It used to be contained
          // whenever the cover was a single piece rather than a composed
          // look, which shrank it inside the tile and left square corners.
          cover={styledCover} coverFit="cover"
          inside={styledInside}
          insideNode={styledBoxes}
          open={door === 'styled'} onOpen={() => toggle('styled')}
        />}
      </div>
      )}

      {/* The open door: the whole section as a grid, straight under the pills. */}
      {door && (
        <div ref={openRef} className="mt-5 mx-2 sm:mx-4 lg:mx-8 rounded-[24px] bg-white/85 shadow-[0_2px_18px_rgba(43,43,43,0.07)] px-6 md:px-10 py-9 scroll-mt-6">
          <div className="flex items-start justify-between gap-6 mb-6">
            <div>
              <p className={HEAD}>{door === 'similar' ? 'MORE OF THE SAME' : door === 'brands' ? brandsTitle : 'STYLED FOR YOU'}</p>
              <p className={NOTE}>
                {door === 'similar' ? 'CLOSE TO WHAT YOU KEPT' : door === 'brands' ? brandsNote : 'TAP A PIECE TO STYLE IT'}
              </p>
            </div>
            <div className="flex flex-col items-end gap-2 shrink-0">
              <button type="button" onClick={() => setDoor(null)} aria-label="Close" className="text-[21px] xl:text-[24px] tracking-[0.14em] text-[#4A4E57] underline underline-offset-4 whitespace-nowrap">
                CLOSE
              </button>
              {door === 'styled' && !testMemberId && (
                // Where the saved pieces live for good: the SAVED shelf of her Dressing Room.
                <Link href="/me/dressing-room?tab=saved" className="text-[17px] xl:text-[20px] tracking-[0.1em] text-[#2B2B2B] underline underline-offset-4 whitespace-nowrap">
                  ALL YOUR SAVED PIECES →
                </Link>
              )}
            </div>
          </div>

          {door === 'similar' && (
            view.similar.length ? (
              <>
                <div className={PIECE_GRID}>{view.similar.map((p) => <Piece key={p.item_id} piece={p} />)}</div>
                {view.similar[0]?.because && <p className="text-[15px] text-[#7C838B] mt-5">{view.similar[0].because}.</p>}
              </>
            ) : (
              <p className="text-[19px] text-[#55534E]">Nothing close enough yet — MYRA would rather show you nothing than something near it.</p>
            )
          )}

          {door === 'brands' && (
            view.fromBrands.length ? (
              <div className={PIECE_GRID}>{view.fromBrands.map((p) => <Piece key={p.item_id} piece={p} />)}</div>
            ) : (
              <p className="text-[19px] text-[#55534E]">Nothing from {labels.length ? labels.join(' or ') : 'those labels'} or their neighbours yet. MYRA is watching them.</p>
            )
          )}

          {door === 'styled' && (
            <>
              {/* Stays up the whole time the section is open — she asked for
                  it to be there, and big, not gone after the first tap. */}
              <div className="flex justify-center mb-10">
                <p
                  className={`${hintGone ? '' : 'animate-bounce'} bg-white rounded-full px-8 xl:px-10 py-4 xl:py-5 text-[21px] xl:text-[26px] tracking-[0.12em] text-[#2B2B2B] shadow-[0_2px_16px_rgba(43,43,43,0.16)]`}
                  style={{ animationIterationCount: 3 }}
                >
                  ♥ TAP A PIECE TO STYLE IT ↓
                </p>
              </div>
              {/* Dense flow: the outfits panel follows the tapped piece and
                  spans the row, and the pieces after it close up the gap — so
                  her outfits open directly beneath the piece, never down past
                  the whole grid where she might miss them. */}
              <div className="grid grid-flow-row-dense grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-x-6 gap-y-10">
                {view.saved.map((s) => (
                  <Fragment key={s.item_id}>
                    <StyledPiece
                      piece={s}
                      looks={looks[s.item_id]}
                      working={busy === s.item_id || !done.current.has(s.item_id)}
                      note={failed[s.item_id]}
                      active={current?.item_id === s.item_id}
                      onPick={() => void pick(s.item_id)}
                    />
                    {!phone && current?.item_id === s.item_id && (
                      <div className="col-span-full rounded-[22px] bg-[#F4F4F2] px-5 md:px-8 py-7 -mt-4">
                        {outfitsPanel}
                      </div>
                    )}
                  </Fragment>
                ))}
              </div>

              {phone && sheet && current && (
                <div className="fixed inset-0 z-[90]">
                  <div className="absolute inset-0 bg-black/30" onClick={() => setSheet(false)} />
                  <div data-lenis-prevent className="myra-sheet-in-right absolute inset-y-0 right-0 w-full bg-[#F7F7F5] overflow-y-auto overscroll-contain px-5 pt-[calc(24px+env(safe-area-inset-top,0px))] pb-16">
                    <button type="button" onClick={() => setSheet(false)} className="text-[19px] tracking-[0.12em] text-[#4A4E57] underline underline-offset-4 mb-4">
                      ← YOUR PIECES
                    </button>
                    {outfitsPanel}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </section>
  )
}
