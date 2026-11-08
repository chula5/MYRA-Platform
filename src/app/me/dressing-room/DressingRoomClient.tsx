'use client'

// DRESSING ROOM — the room across the top, her rail under it, and MYRA
// working down the right.
//
// Tapping a piece stands it up on the right with every outfit there ALREADY is
// around it — her own looks and the ones MYRA keeps — from a memory the room
// loads once behind the rail, so the tap costs no round trip. On a phone the
// panel slides in from the right over the rail (Chloe, 2026-11-08: the outfits
// used to appear below the grid, where she could not see anything happening),
// and every tile carries the number of outfits it is in. Building NEW outfits
// is a deliberate press that goes through the styled-ways queue, so the first
// one lands in seconds and the work carries on if she leaves. The piece's own
// page (STYLE THIS by occasion, the finders) is one tap further in.

import Link from 'next/link'
import { useEffect, useMemo, useRef, useState } from 'react'
import FallbackImage from '@/components/FallbackImage'
import type { DressingRoomPiece, DressingRoomView, StyledLook } from '@/app/admin/private-stylist/actions'
import { keepStyledLook, myLooksWithPiece, myWardrobeOutfits, styleMyPiece } from './actions'
import { noticePieces, openWaysToWear, pollWaysToWear } from '@/app/me/ways/actions'
import { WAYS, type StyledWayLook } from '@/lib/styled-ways-core'
import BuiltOutfit from './BuiltOutfit'
import SavedPieces from './SavedPieces'
import SaveScreenshot from '@/components/me/SaveScreenshot'
import DressingRoomScene from '@/components/me/DressingRoomScene'
import ServiceMark from '@/components/me/ServiceMark'
import MicButton from '@/components/me/MicButton'
import EmailFinds from './EmailFinds'
import FoundPieces from './FoundPieces'
import { loadEmailPanel } from './email-actions'
import { useScrollTo } from '@/lib/smooth-scroll'

const TYPES: { id: string; label: string; slots: string[] }[] = [
  { id: 'all', label: 'Everything', slots: [] },
  { id: 'top', label: 'Tops', slots: ['top'] },
  { id: 'bottom', label: 'Bottoms', slots: ['bottom'] },
  { id: 'dress', label: 'Dresses', slots: ['dress'] },
  { id: 'outerwear', label: 'Coats', slots: ['outerwear'] },
  { id: 'shoe', label: 'Shoes', slots: ['shoe'] },
  { id: 'bag', label: 'Bags', slots: ['bag'] },
  { id: 'jewellery', label: 'Jewellery', slots: ['jewellery', 'accessory'] },
]

const CARD = 'bg-white/85 shadow-[0_2px_14px_rgba(43,43,43,0.08)] rounded-[18px]'

// The room is three shelves, one open at a time (Chloe, 2026-10-15: the
// pieces she saved out shopping sat under the wardrobe where nobody would
// look): her own pieces, what she saved from the shops, and what her order
// emails turned up. A link can open a shelf — /me/dressing-room?tab=saved,
// or the old #saved-pieces / #email-finds / ?piece= — and the tour asks for
// one with the DRESSING_TAB_EVENT.
export type DressingTab = 'wardrobe' | 'saved' | 'email'
export const DRESSING_TAB_EVENT = 'myra:dressing-tab'
const TABS: { id: DressingTab; label: string }[] = [
  // Two short words each, so all four sit side by side on a phone.
  { id: 'wardrobe', label: 'Your wardrobe' },
  { id: 'saved', label: 'Saved pieces' },
  { id: 'email', label: 'Email finds' },
]
function tabFromUrl(): DressingTab {
  if (typeof window === 'undefined') return 'wardrobe'
  const q = new URLSearchParams(window.location.search)
  const t = q.get('tab')
  if (t === 'saved' || t === 'email' || t === 'wardrobe') return t
  if (q.get('piece') || window.location.hash === '#saved-pieces') return 'saved'
  if (window.location.hash === '#email-finds') return 'email'
  return 'wardrobe'
}
// The buttons at the top of the room: each app's own mark in a circle, no
// words on them (Chloe, 2026-10-17: the labelled pills were too much); one
// line beside them says what they are for.
const ROOM_BTN = 'shrink-0 rounded-full transition-opacity hover:opacity-85 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2B2B2B] focus-visible:ring-offset-2'
function PhotoIcon() {
  return (
    <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-white text-[#2B2B2B] shadow-[0_2px_8px_rgba(43,43,43,0.12)]">
      <svg viewBox="0 0 24 24" className="w-6 h-6" aria-hidden><rect x="3" y="5" width="18" height="14" rx="2" fill="none" stroke="currentColor" strokeWidth="1.8" /><path d="m5 17 5-5 4 4 2-2 3 3" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" /><circle cx="16" cy="9.5" r="1.5" fill="currentColor" /></svg>
    </span>
  )
}

export default function DressingRoomClient({
  view, testMemberId, onOpenPiece,
}: {
  view: DressingRoomView
  testMemberId?: string
  /** HER VIEW opens the piece's own page in place rather than navigating. */
  onOpenPiece?: (itemId: string) => void
}) {
  const [typeFilter, setTypeFilter] = useState('all')
  // Which shelf is open, and whether the saved shelf is bare (its empty note is written here).
  const [tab, setTab] = useState<DressingTab>('wardrobe')
  const [savedCount, setSavedCount] = useState<number | null>(null)
  useEffect(() => {
    setTab(tabFromUrl())
    const onAsk = (e: Event) => {
      const t = (e as CustomEvent).detail
      if (t === 'wardrobe' || t === 'saved' || t === 'email') setTab(t)
    }
    window.addEventListener(DRESSING_TAB_EVENT, onAsk)
    return () => window.removeEventListener(DRESSING_TAB_EVENT, onAsk)
  }, [])
  // Is an inbox connected? Decides what the button in the room says.
  const [inboxes, setInboxes] = useState<number | null>(null)
  const scrollTo = useScrollTo()
  useEffect(() => {
    let live = true
    loadEmailPanel(testMemberId).then((v) => { if (live) setInboxes(v.connections.filter((c) => c.status !== 'disconnected').length) }).catch(() => { if (live) setInboxes(0) })
    return () => { live = false }
  }, [testMemberId])
  const emailSync = () => {
    setTab('email')
    setTimeout(() => { const el = document.getElementById('email-finds'); if (el) scrollTo(el, { offset: -24 }) }, 60)
    if (inboxes) window.dispatchEvent(new CustomEvent('myra:email-sync'))
  }
  const [picked, setPicked] = useState<DressingRoomPiece | null>(null)
  // What she already has with this piece (her looks), what MYRA keeps around
  // it (ways), and what a worded ask built just now (looks).
  const [worn, setWorn] = useState<StyledLook[]>([])
  const [ways, setWays] = useState<StyledWayLook[]>([])
  const [looks, setLooks] = useState<StyledLook[]>([])
  const [loadingWorn, setLoadingWorn] = useState(false)
  const [styling, setStyling] = useState(false)
  const [building, setBuilding] = useState(false)
  const [slow, setSlow] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  // Only the latest tap's outfits are shown, however fast she moves.
  const wanted = useRef<string | null>(null)

  // THE RAIL'S MEMORY — every outfit around every piece, read once. A tap
  // answers from here; until it lands, a tap asks the server for that piece.
  type PieceOutfits = { looks: StyledLook[]; ways: StyledWayLook[] }
  const [memory, setMemory] = useState<Record<string, PieceOutfits> | null>(null)
  const pieceIds = useMemo(() => view.pieces.map((p) => p.item_id).join('|'), [view.pieces])
  useEffect(() => {
    if (!view.pieces.length) { setMemory({}); return }
    let live = true
    myWardrobeOutfits(testMemberId)
      .then((r) => {
        if (!live) return
        const got = (r.byPiece ?? {}) as Record<string, PieceOutfits>
        setMemory(got)
        // MYRA starts on the pieces nothing has been made around yet, so by
        // the time she taps one, its outfits are waiting (the queue skips what
        // is already kept and keeps to the daily cap).
        const bare = view.pieces.filter((p) => !(got[p.item_id]?.ways.length) && p.image_url).map((p) => p.item_id).slice(0, 24)
        if (bare.length) void noticePieces(bare, 'blend', 'view', testMemberId).catch(() => { /* warm-ups are best effort */ })
      })
      .catch(() => { if (live) setMemory({}) })
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pieceIds, testMemberId])
  const remember = (itemId: string, patch: Partial<PieceOutfits>) =>
    setMemory((m) => ({ ...(m ?? {}), [itemId]: { looks: [], ways: [], ...(m?.[itemId] ?? {}), ...patch } }))
  /** The number on a tile: her looks with it plus MYRA's kept outfits. */
  const outfitCount = (p: DressingRoomPiece) => {
    const m = memory?.[p.item_id]
    return m ? m.looks.length + m.ways.length : memory ? 0 : p.styled_in + p.ways_in
  }

  const counts = useMemo(() => {
    const m = new Map<string, number>()
    for (const p of view.pieces) m.set(p.slot ?? 'other', (m.get(p.slot ?? 'other') ?? 0) + 1)
    return m
  }, [view.pieces])

  const types = TYPES.filter((t) => t.id === 'all' || t.slots.some((s) => (counts.get(s) ?? 0) > 0))
  const shown = useMemo(() => {
    const t = TYPES.find((x) => x.id === typeFilter)
    return !t || !t.slots.length ? view.pieces : view.pieces.filter((p) => t.slots.includes(p.slot ?? ''))
  }, [typeFilter, view.pieces])

  /** Tapping a piece shows every outfit there already is around it — from memory, at once. */
  async function pick(p: DressingRoomPiece) {
    setPicked(p)
    setLooks([])
    setNote(null)
    setAsk('')
    setShuffle(0)
    setBuilding(false)
    setSlow(false)
    wanted.current = p.item_id
    const m = memory?.[p.item_id]
    if (memory) {
      setWorn(m?.looks ?? [])
      setWays(m?.ways ?? [])
      setLoadingWorn(false)
      return
    }
    // The memory has not landed yet: ask for this one piece.
    setWorn([])
    setWays([])
    setLoadingWorn(true)
    const r = await myLooksWithPiece(p.item_id, testMemberId)
    if (wanted.current !== p.item_id) return
    setLoadingWorn(false)
    setWorn(r.looks ?? [])
    if (r.error) setNote(r.error)
  }
  // The memory landed after she tapped: fill the panel from it.
  useEffect(() => {
    if (!memory || !picked) return
    const m = memory[picked.item_id]
    if (m && !ways.length && !worn.length) { setWorn(m.looks); setWays(m.ways) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memory])

  /**
   * BUILD — new outfits through the styled-ways queue: the first lands in a
   * few seconds and the rest follow while she watches; if she leaves, the job
   * finishes anyway and is kept for the next tap. `more` asks for another
   * round around the same piece, different from what is kept.
   */
  const startedAt = useRef(0)
  async function build(p: DressingRoomPiece, more: boolean) {
    setBuilding(true)
    setSlow(false)
    setNote(null)
    wanted.current = p.item_id
    startedAt.current = Date.now()
    const v = await openWaysToWear(p.item_id, { more }, testMemberId)
    if (wanted.current !== p.item_id) return
    if (v.looks.length) { setWays(v.looks); remember(p.item_id, { ways: v.looks }) }
    if (v.status !== 'working') {
      setBuilding(false)
      if (v.error) setNote(v.error)
      else if (!v.looks.length) setNote('Nothing in the library goes with this one yet.')
      return
    }
    const poll = async () => {
      if (wanted.current !== p.item_id) return
      let next: Awaited<ReturnType<typeof pollWaysToWear>> | null = null
      try { next = await pollWaysToWear(p.item_id, 'blend', testMemberId) } catch { /* try again */ }
      if (wanted.current !== p.item_id) return
      if (next) {
        if (next.looks.length) { setWays(next.looks); remember(p.item_id, { ways: next.looks }) }
        if (next.status !== 'working') {
          setBuilding(false)
          if (next.error && !next.looks.length) setNote(next.error)
          else if (next.status === 'none' && !next.looks.length) setNote('Nothing in the library goes with this one yet.')
          return
        }
      }
      const elapsed = Date.now() - startedAt.current
      if (elapsed >= 60_000) setSlow(true)
      if (elapsed >= 5 * 60_000) { setBuilding(false); setNote('MYRA is still working on this one — come back in a minute and it will be here.'); return }
      setTimeout(poll, elapsed >= 60_000 ? 5_000 : 2_000)
    }
    setTimeout(poll, 2_000)
  }

  /** A worded ask ("a black top to go with these") composes now, checked before it shows. */
  async function styleNow(p: DressingRoomPiece, opts: { shuffle?: number; query?: string } = {}) {
    setStyling(true)
    setNote(null)
    wanted.current = p.item_id
    const r = await styleMyPiece(p.item_id, { shuffle: opts.shuffle ?? 0, query: opts.query ?? null }, testMemberId)
    if (wanted.current !== p.item_id) return
    setStyling(false)
    setLooks(r.looks ?? [])
    setNote(r.error ?? (r.looks?.length ? null : 'Nothing in the library goes with this one yet.'))
  }

  // The stylist can accept a built outfit into her looks (HER VIEW only).
  const [keptIdx, setKeptIdx] = useState<Record<string, 'saving' | 'done' | string>>({})
  async function acceptLook(key: string, items: any[], why: string) {
    setKeptIdx((k) => ({ ...k, [key]: 'saving' }))
    const r = await keepStyledLook(items, why, null, testMemberId)
    setKeptIdx((k) => ({ ...k, [key]: r.error ? r.error : 'done' }))
  }

  // Ask again for different answers, or ask for something in particular.
  const [shuffle, setShuffle] = useState(0)
  const [ask, setAsk] = useState('')
  function reshuffle(p: DressingRoomPiece) {
    if (ask.trim()) { const next = shuffle + 1; setShuffle(next); void styleNow(p, { shuffle: next, query: ask }); return }
    void build(p, true)
  }

  // The panel on a phone closes on Escape, and the rail stays where it was.
  const close = () => { wanted.current = null; setPicked(null); setBuilding(false); setStyling(false) }
  useEffect(() => {
    if (!picked) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picked])

  const openPiece = (itemId: string) => { if (onOpenPiece) onOpenPiece(itemId) }

  return (
    <div className={`myra-pearl relative -mx-6 sm:-ml-8 sm:-mr-10 min-h-screen ${testMemberId ? '' : '-my-10'}`}>
      <div className="w-full px-6 sm:px-10 py-8 pb-16 space-y-6">
        {/* The room, drawn — with what she is dressing for over it */}
        <section className="relative rounded-[18px] overflow-hidden shadow-[0_2px_14px_rgba(43,43,43,0.08)] lg:min-h-[300px]">
          {/* The room is the wall behind the words; the card is only as tall as what is written on it. */}
          <DressingRoomScene className="absolute inset-0 h-full w-full object-cover" />
          <div className="relative px-6 sm:px-8 py-6 sm:py-7 lg:pr-[330px] 2xl:pr-[440px]">
            {/* Just the room's name (Chloe, 2026-10-17: no "own pieces" line, no count). */}
            <h1 className="text-[clamp(26px,3.2vw,46px)] 2xl:text-[clamp(44px,3.4vw,72px)] tracking-[0.14em] text-[#2B2B2B] leading-[1.05]">DRESSING ROOM</h1>

            {/* The ways to fill the room: the apps' marks in circles, one line saying why. */}
            <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-3">
              <div className="flex items-center gap-3">
                {/* Shown at once; whether a tap syncs or connects is decided when she taps. */}
                <button type="button" onClick={emailSync} data-tour="email-sync" className={ROOM_BTN} aria-label={inboxes ? 'Sync email' : 'Connect email'} title={inboxes ? 'Read your inbox again for new orders' : 'Connect your email and MYRA finds what you have bought'}>
                  <ServiceMark service="gmail" size="circle" />
                </button>
                {!testMemberId && (
                  <>
                    <Link href="/me/inspiration#archival-looks" className={ROOM_BTN} aria-label="Instagram" title="Add your own outfits from Instagram">
                      <ServiceMark service="instagram" size="circle" />
                    </Link>
                    <Link href="/me/inspiration#archival-looks" className={ROOM_BTN} aria-label="Photos" title="Add your own outfits from your photos">
                      <PhotoIcon />
                    </Link>
                  </>
                )}
              </div>
              <p className="text-[17px] xl:text-[20px] 2xl:text-[24px] text-[#4A4E57]">Sync your apps to pull in your pieces.</p>
            </div>
          </div>

          {/* Your look — the card standing in the room */}
          <aside className="hidden lg:flex absolute top-7 right-7 w-[280px] 2xl:w-[380px] flex-col items-center text-center gap-4 rounded-[16px] bg-[rgba(255,255,255,0.92)] px-6 py-6 shadow-[0_2px_14px_rgba(43,43,43,0.1)]">
            <p className="text-[21px] xl:text-[24px] 2xl:text-[28px] tracking-[0.14em] text-[#2B2B2B]">YOUR LOOK</p>
            <svg viewBox="0 0 64 64" className="w-16 h-16 text-[#55534E]" aria-hidden>
              <path d="M24 10l8 5 8-5 4 11-4 4 5 26H19l5-26-4-4z" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
            </svg>
            <p className="text-[20px] xl:text-[23px] 2xl:text-[27px] text-[#4A4E57] leading-snug">
              {picked ? picked.product_name : 'Choose a piece to style.'}
            </p>
            {picked && (
              onOpenPiece ? (
                <button onClick={() => openPiece(picked.item_id)} className="text-[19px] xl:text-[22px] 2xl:text-[26px] px-5 py-2.5 rounded-full border border-[#2B2B2B] text-[#2B2B2B]">Open its page</button>
              ) : (
                <Link href={`/me/dressing-room/${picked.item_id}`} className="text-[19px] xl:text-[22px] 2xl:text-[26px] px-5 py-2.5 rounded-full border border-[#2B2B2B] text-[#2B2B2B]">Open its page</Link>
              )
            )}
          </aside>
        </section>

        {view.error && <p className="text-[20px] xl:text-[23px] 2xl:text-[27px] text-[#B83A3A] text-center">{view.error}</p>}

        {/* The three shelves, all in view at once on any width; no counts on
            them (Chloe, 2026-10-17). A label may take two lines on a phone. */}
        <div role="tablist" aria-label="Your dressing room" className="grid grid-cols-3 gap-2">
          {TABS.map((t) => {
            const on = tab === t.id
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={on}
                data-tour={`tab-${t.id}`}
                onClick={() => setTab(t.id)}
                className={`flex items-center justify-center rounded-full px-1.5 py-3 text-center text-[15px] sm:text-[18px] xl:text-[21px] 2xl:text-[24px] leading-[1.15] tracking-[0.03em] uppercase transition-colors ${on ? 'bg-[#2B2B2B] text-white' : 'bg-white/85 text-[#55534E] shadow-[0_2px_14px_rgba(43,43,43,0.08)] hover:text-[#2B2B2B]'}`}
              >
                {t.label}
              </button>
            )
          })}
        </div>

        {/* The pieces MYRA found in her photos, waiting for her yes. */}
        {!testMemberId && tab === 'wardrobe' && <FoundPieces />}

        {/* Her rail, and MYRA's panel: down the right on a desk, sliding in over the rail on a phone */}
        {tab === 'wardrobe' && view.pieces.length > 0 && (
          <section className={`${CARD} px-6 sm:px-8 py-8`}>
            <div className="grid xl:grid-cols-[minmax(0,1fr)_minmax(460px,36%)] 2xl:grid-cols-[minmax(0,1fr)_42%] gap-8">
              <div className="min-w-0">
                <h2 className="text-[26px] xl:text-[29px] 2xl:text-[33px] tracking-[0.06em] text-[#2B2B2B] mb-4">YOUR WARDROBE</h2>
                {types.length > 1 && (
                  <div data-lenis-prevent className="flex gap-2 overflow-x-auto pb-2 mb-5 -mx-1 px-1" role="tablist" aria-label="Filter wardrobe by type">
                    {types.map((t) => {
                      const on = typeFilter === t.id
                      return (
                        <button
                          key={t.id}
                          type="button"
                          role="tab"
                          aria-selected={on}
                          onClick={() => setTypeFilter(t.id)}
                          className={`shrink-0 rounded-full px-4 py-2 text-[17px] xl:text-[20px] 2xl:text-[24px] tracking-[0.08em] transition-colors ${on ? 'bg-[#2B2B2B] text-white' : 'bg-[#F3F2F0] text-[#55534E] hover:text-[#2B2B2B]'}`}
                        >
                          {t.label}
                        </button>
                      )
                    })}
                  </div>
                )}
                <div data-tour="wardrobe" className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-3 2xl:grid-cols-4 min-[2200px]:grid-cols-5 min-[2800px]:grid-cols-6 gap-4">
                  {shown.map((p) => {
                    const on = picked?.item_id === p.item_id
                    const n = outfitCount(p)
                    return (
                      <button
                        key={p.item_id}
                        onClick={() => pick(p)}
                        aria-label={`${p.product_name}${n ? ` — in ${n} outfit${n === 1 ? '' : 's'}` : ''}`}
                        className={`text-left bg-white rounded-[16px] overflow-hidden transition-shadow ${on ? 'ring-2 ring-[#2B2B2B]' : 'shadow-[0_1px_8px_rgba(43,43,43,0.06)] hover:shadow-[0_4px_18px_rgba(43,43,43,0.12)]'}`}
                      >
                        <div className="relative aspect-[3/4] bg-[#F3F2F0] overflow-hidden">
                          {p.image_url && (
                            <FallbackImage src={p.image_url} thumbWidth={600} alt={p.product_name} className="absolute inset-0 w-full h-full object-contain" />
                          )}
                          {/* How many outfits it is already in — so she knows before she taps. */}
                          {n > 0 && (
                            <span className="absolute top-2 right-2 min-w-[30px] h-[30px] px-2 rounded-full bg-[#2B2B2B] text-white text-[15px] xl:text-[17px] leading-[30px] text-center tabular-nums shadow-[0_2px_8px_rgba(43,43,43,0.25)]" aria-hidden>
                              {n}
                            </span>
                          )}
                        </div>
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* On a phone the panel slides in from the right over the rail; the rail stays under it. */}
              {picked && (
                <button
                  type="button"
                  aria-label="Close"
                  onClick={close}
                  className="fixed inset-0 z-[129] bg-[rgba(43,43,43,0.28)] xl:hidden"
                />
              )}
              <aside
                data-tour="styling-pane"
                data-lenis-prevent
                role="region"
                aria-label="Outfits with this piece"
                aria-hidden={!picked}
                className={`fixed top-0 right-0 bottom-[calc(68px+env(safe-area-inset-bottom))] sm:bottom-0 z-[130] w-[90vw] max-w-[640px] overflow-y-auto bg-white px-5 sm:px-7 pt-[calc(20px+env(safe-area-inset-top,0px))] pb-10 shadow-[-16px_0_48px_rgba(43,43,43,0.22)] transition-transform duration-300 ease-out space-y-5 ${picked ? 'translate-x-0' : 'translate-x-full pointer-events-none'} xl:sticky xl:top-6 xl:right-auto xl:bottom-auto xl:z-auto xl:w-auto xl:max-w-none xl:overflow-visible xl:bg-transparent xl:p-0 xl:shadow-none xl:translate-x-0 xl:pointer-events-auto xl:self-start xl:transition-none`}
              >
                {!picked && (
                  <div className="hidden xl:block rounded-[16px] bg-white/70 px-6 py-12 text-center">
                    <p className="text-[21px] xl:text-[24px] 2xl:text-[28px] text-[#4A4E57]">Tap a piece to see its outfits.</p>
                  </div>
                )}
                {picked && (
                  <>
                    <div className="flex gap-4 items-start">
                      <div className="relative w-[110px] sm:w-[130px] xl:w-[150px] 2xl:w-[200px] aspect-[3/4] bg-[#F3F2F0] rounded-[14px] overflow-hidden shrink-0 shadow-[0_1px_8px_rgba(43,43,43,0.06)]">
                        {picked.image_url && (
                          <FallbackImage src={picked.image_url} thumbWidth={400} alt={picked.product_name} className="absolute inset-0 w-full h-full object-contain" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start gap-3">
                          <p className="text-[21px] xl:text-[24px] 2xl:text-[28px] text-[#2B2B2B] leading-tight flex-1">{picked.product_name}</p>
                          <button type="button" onClick={close} aria-label="Close" className="xl:hidden shrink-0 -mt-1 -mr-1 w-11 h-11 rounded-full bg-[#F3F2F0] text-[#2B2B2B] text-[26px] leading-[44px] text-center">×</button>
                        </div>
                        <p className="text-[19px] xl:text-[22px] 2xl:text-[26px] text-[#6E6B65] mt-1">
                          {[picked.item_type?.replace(/_/g, ' '), picked.colour_family].filter(Boolean).join(' · ')}
                        </p>
                        <p className="text-[18px] xl:text-[21px] tracking-[0.12em] text-[#6E6B65] mt-3">ASK MYRA TO BUILD AN OUTFIT</p>
                        <div className="mt-3 flex flex-wrap gap-3">
                          <button
                            onClick={() => build(picked, ways.length > 0)}
                            disabled={building || styling}
                            className="text-[19px] xl:text-[22px] 2xl:text-[26px] px-5 py-2.5 rounded-full bg-[#2B2B2B] text-white disabled:opacity-40"
                          >
                            {building ? 'Building…' : ways.length || looks.length ? 'Build more' : 'Build outfit'}
                          </button>
                          {(ways.length > 0 || looks.length > 0) && (
                            <button
                              onClick={() => reshuffle(picked)}
                              disabled={building || styling}
                              className="text-[19px] xl:text-[22px] 2xl:text-[26px] px-5 py-2.5 rounded-full bg-white text-[#2B2B2B] shadow-[0_8px_18px_-12px_rgba(43,43,43,0.5)] disabled:opacity-40"
                            >
                              Reshuffle
                            </button>
                          )}
                        </div>
                        {onOpenPiece ? (
                          <button onClick={() => openPiece(picked.item_id)} className="mt-3 text-[18px] xl:text-[21px] text-[#2B2B2B] underline underline-offset-4">Open its page</button>
                        ) : (
                          <Link href={`/me/dressing-room/${picked.item_id}`} className="inline-block mt-3 text-[18px] xl:text-[21px] text-[#2B2B2B] underline underline-offset-4">Open its page</Link>
                        )}
                      </div>
                    </div>

                    {/* Ask for something in particular: "a white shirt to go with this". */}
                    <form
                      onSubmit={(e) => { e.preventDefault(); void styleNow(picked, { shuffle, query: ask }) }}
                      className="flex flex-wrap gap-3 items-center"
                    >
                      <input
                        value={ask}
                        onChange={(e) => setAsk(e.target.value)}
                        placeholder="Find a black top to go with these bottoms…"
                        className="myra-guide-text flex-1 min-w-[200px] rounded-full bg-[#F7F6F4] xl:bg-white px-6 py-3 text-[19px] xl:text-[22px] 2xl:text-[26px] outline-none border-2 border-transparent focus:border-[#C9C9C9]"
                      />
                      <MicButton size="sm" onText={(t, final) => { setAsk(t); if (final && t.trim() && !styling) void styleNow(picked, { shuffle, query: t }) }} />
                      <button type="submit" disabled={styling || building || !ask.trim()} className="text-[19px] xl:text-[22px] 2xl:text-[26px] px-5 py-2.5 rounded-full bg-[#2B2B2B] text-white disabled:opacity-40">
                        Find it
                      </button>
                      {ask && (
                        <button type="button" onClick={() => { setAsk(''); setLooks([]) }} className="text-[19px] xl:text-[22px] text-[#6E6B65] underline underline-offset-4">
                          Clear
                        </button>
                      )}
                    </form>

                    {loadingWorn && <p className="text-[20px] xl:text-[23px] 2xl:text-[27px] text-[#6E6B65]">Looking for what you wear it with…</p>}

                    {(styling || building) && (
                      <div className="rounded-[16px] bg-[#F7F6F4] xl:bg-white/70 px-6 py-8 text-center">
                        <img src="/myra-mirror-transparent.png" alt="" className="myra-mirror-wiggle h-20 w-auto mx-auto" />
                        <p className="text-[20px] xl:text-[23px] 2xl:text-[27px] text-[#4A4E57] mt-4">
                          {styling ? 'Finding it…' : ways.length ? 'Building another outfit around it…' : 'Building outfits around it — the first lands in a few seconds.'}
                        </p>
                        {slow && <p className="text-[18px] xl:text-[21px] text-[#6E6B65] mt-2">Taking longer than usual. It will be here when it is done, even if you leave.</p>}
                      </div>
                    )}

                    {note && !styling && !building && <p className="text-[20px] xl:text-[23px] 2xl:text-[27px] text-[#4A4E57]">{note}</p>}

                    {!loadingWorn && !worn.length && !ways.length && !looks.length && !styling && !building && !note && (
                      <p className="text-[20px] xl:text-[23px] 2xl:text-[27px] text-[#4A4E57]">MYRA hasn&rsquo;t styled this one yet. Build an outfit around it.</p>
                    )}

                    {/* Built for a worded ask, just now: every piece can be swapped, with undo. */}
                    {looks.length > 0 && (
                      <p className="text-[19px] xl:text-[22px] 2xl:text-[26px] tracking-[0.12em] text-[#6E6B65]">NEW — BUILT JUST NOW</p>
                    )}
                    <div className="grid grid-cols-1 2xl:grid-cols-2 gap-4">
                      {looks.map((l, i) => (
                        <div key={`new-${i}`} className="space-y-2">
                          <BuiltOutfit
                            items={l.items}
                            heroId={picked.item_id}
                            why={l.why}
                            testMemberId={testMemberId}
                            onChange={(next) => setLooks((cur) => cur.map((x, j) => (j === i ? { ...x, items: next } : x)))}
                          />
                          {testMemberId && <AcceptRow state={keptIdx[`new-${i}`]} onAccept={() => acceptLook(`new-${i}`, l.items, l.why)} />}
                        </div>
                      ))}
                    </div>

                    {/* What MYRA keeps around it — instant from the rail's memory, growing as a build lands. */}
                    {ways.length > 0 && (
                      <p className="text-[19px] xl:text-[22px] 2xl:text-[26px] tracking-[0.12em] text-[#6E6B65]">
                        MYRA&rsquo;S OUTFITS — {ways.length}
                      </p>
                    )}
                    <div className="grid grid-cols-1 2xl:grid-cols-2 gap-4">
                      {ways.map((l) => (
                        <div key={l.styled_way_id} className="space-y-2">
                          <BuiltOutfit
                            items={l.items}
                            heroId={picked.item_id}
                            why={l.why}
                            testMemberId={testMemberId}
                            onChange={(next) => setWays((cur) => cur.map((x) => (x.styled_way_id === l.styled_way_id ? { ...x, items: next } : x)))}
                          />
                          {testMemberId && <AcceptRow state={keptIdx[l.styled_way_id]} onAccept={() => acceptLook(l.styled_way_id, l.items, l.why)} />}
                        </div>
                      ))}
                    </div>

                    {/* Her own looks that already use it. */}
                    {worn.length > 0 && (
                      <p className="text-[19px] xl:text-[22px] 2xl:text-[26px] tracking-[0.12em] text-[#6E6B65]">
                        IN YOUR LOOKS — {worn.length}
                      </p>
                    )}
                    <div className="grid grid-cols-1 2xl:grid-cols-2 gap-4">
                      {worn.map((l, i) => (
                        <div key={l.look_id ?? i} className="bg-white rounded-[16px] overflow-hidden shadow-[0_1px_8px_rgba(43,43,43,0.06)]">
                          <div className="relative aspect-[3/4] bg-[#F3F2F0] overflow-hidden">
                            {l.image_url ? (
                              <FallbackImage src={l.image_url} thumbWidth={800} alt="" className="absolute inset-0 w-full h-full object-cover" />
                            ) : (
                              // No shoot for a look composed just now: show its pieces.
                              <div className="absolute inset-0 grid grid-cols-2 gap-px bg-[#EDEBE7]">
                                {l.items.slice(0, 4).map((it, j) => (
                                  <div key={j} className="relative bg-white overflow-hidden">
                                    {it.image_url && (
                                      <FallbackImage src={it.image_url} thumbWidth={400} alt={it.product_name} className="absolute inset-0 w-full h-full object-contain" />
                                    )}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                          {l.why && <p className="text-[19px] xl:text-[22px] 2xl:text-[26px] text-[#4A4E57] px-4 py-3 leading-snug">{l.why}</p>}
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </aside>
            </div>
          </section>
        )}

        {tab === 'wardrobe' && !view.pieces.length && (
          <section className={`${CARD} px-6 sm:px-8 py-10 text-center`}>
            <p className="text-[21px] xl:text-[24px] 2xl:text-[28px] text-[#4A4E57]">Nothing in your wardrobe yet.</p>
          </section>
        )}

        {/* What she kept with the mirror while she was out shopping. The
            section keeps loading and watching behind the other tabs, so its
            count is right and a styling she left carries on. */}
        <div className={tab === 'saved' ? 'space-y-6' : 'hidden'}>
          {/* No Mirror needed: a screenshot of a piece lands on this shelf too. */}
          <div className="flex justify-center">
            <SaveScreenshot testMemberId={testMemberId} />
          </div>
          <SavedPieces testMemberId={testMemberId} onCount={setSavedCount} />
          {savedCount === 0 && (
            <section className={`${CARD} px-6 sm:px-8 py-10 text-center`}>
              <p className="text-[21px] xl:text-[24px] 2xl:text-[28px] text-[#4A4E57]">Nothing saved yet. Tap the heart in the MYRA Mirror while you shop, or save a screenshot of a piece above, and it lands here — styled three ways.</p>
            </section>
          )}
        </div>

        {/* Fill the dressing room from her order emails. */}
        <div className={tab === 'email' ? '' : 'hidden'}>
          <EmailFinds testMemberId={testMemberId} />
        </div>

        {!testMemberId && tab === 'wardrobe' && (
          <p className="text-center">
            <Link href="/me/wardrobe" className={view.pieces.length ? 'text-[22px] xl:text-[25px] 2xl:text-[29px] text-[#2B2B2B] underline underline-offset-4' : 'inline-block text-[22px] xl:text-[25px] 2xl:text-[29px] px-7 py-4 bg-[#2B2B2B] text-white rounded-full'}>
              {view.pieces.length ? 'Add more pieces →' : 'Add your pieces'}
            </Link>
          </p>
        )}
      </div>
    </div>
  )
}

/** HER VIEW: the stylist sends a built outfit to her looks. */
function AcceptRow({ state, onAccept }: { state: 'saving' | 'done' | string | undefined; onAccept: () => void }) {
  return (
    <div className="flex items-center gap-3 flex-wrap">
      <button
        onClick={onAccept}
        disabled={state === 'saving' || state === 'done'}
        className="text-[19px] xl:text-[22px] px-5 py-2.5 rounded-full bg-[#2B2B2B] text-white disabled:opacity-40"
      >
        {state === 'saving' ? 'Sending…' : state === 'done' ? 'In her looks' : 'Accept — add to her looks'}
      </button>
      {state && state !== 'saving' && state !== 'done' && <span className="text-[19px] text-[#9B3A3A]">{state}</span>}
    </div>
  )
}
