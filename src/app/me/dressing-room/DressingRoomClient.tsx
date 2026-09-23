'use client'

// DRESSING ROOM — the room across the top, her rail under it, and MYRA
// working down the right.
//
// Tapping a piece stands it up on the right with the looks she ALREADY has
// with it — free, instant, her own looks. Building new outfits is a deliberate
// press, because that composes and checks for real. The piece's own page (how
// it has been styled, STYLE THIS by occasion, the finders) is one tap further in.

import Link from 'next/link'
import { useEffect, useMemo, useRef, useState } from 'react'
import FallbackImage from '@/components/FallbackImage'
import type { DressingRoomPiece, DressingRoomView, StyledLook } from '@/app/admin/private-stylist/actions'
import { keepStyledLook, myLooksWithPiece, styleMyPiece } from './actions'
import BuiltOutfit from './BuiltOutfit'
import SavedPieces from './SavedPieces'
import DressingRoomScene from '@/components/me/DressingRoomScene'
import EmailFinds from './EmailFinds'
import ArchivalLooks from './ArchivalLooks'
import CalendarPanel from './CalendarPanel'
import OutfitBuilder from './OutfitBuilder'
import { loadEmailPanel } from './email-actions'
import { useScrollTo } from '@/lib/smooth-scroll'

const TABS: { id: string; label: string; slots: string[] }[] = [
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

export default function DressingRoomClient({
  view, testMemberId, onOpenPiece,
}: {
  view: DressingRoomView
  testMemberId?: string
  /** HER VIEW opens the piece's own page in place rather than navigating. */
  onOpenPiece?: (itemId: string) => void
}) {
  const [tab, setTab] = useState('all')
  // Is an inbox connected? Decides what the button in the room says.
  const [inboxes, setInboxes] = useState<number | null>(null)
  const scrollTo = useScrollTo()
  useEffect(() => {
    let live = true
    loadEmailPanel(testMemberId).then((v) => { if (live) setInboxes(v.connections.filter((c) => c.status !== 'disconnected').length) }).catch(() => { if (live) setInboxes(0) })
    return () => { live = false }
  }, [testMemberId])
  const emailSync = () => {
    const el = document.getElementById('email-finds')
    if (el) scrollTo(el, { offset: -24 })
    if (inboxes) window.dispatchEvent(new CustomEvent('myra:email-sync'))
  }
  const [picked, setPicked] = useState<DressingRoomPiece | null>(null)
  // What she already has with this piece, and what MYRA makes when she asks.
  const [worn, setWorn] = useState<StyledLook[]>([])
  const [looks, setLooks] = useState<StyledLook[]>([])
  const [loadingWorn, setLoadingWorn] = useState(false)
  const [styling, setStyling] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  // Only the latest tap's outfits are shown, however fast she moves.
  const wanted = useRef<string | null>(null)

  const counts = useMemo(() => {
    const m = new Map<string, number>()
    for (const p of view.pieces) m.set(p.slot ?? 'other', (m.get(p.slot ?? 'other') ?? 0) + 1)
    return m
  }, [view.pieces])

  const tabs = TABS.filter((t) => t.id === 'all' || t.slots.some((s) => (counts.get(s) ?? 0) > 0))
  const shown = useMemo(() => {
    const t = TABS.find((x) => x.id === tab)
    return !t || !t.slots.length ? view.pieces : view.pieces.filter((p) => t.slots.includes(p.slot ?? ''))
  }, [tab, view.pieces])

  /** Tapping a piece shows the looks she already has with it — free and instant. */
  async function pick(p: DressingRoomPiece) {
    setPicked(p)
    setWorn([])
    setLooks([])
    setNote(null)
    setLoadingWorn(true)
    wanted.current = p.item_id
    const r = await myLooksWithPiece(p.item_id, testMemberId)
    if (wanted.current !== p.item_id) return
    setLoadingWorn(false)
    setWorn(r.looks ?? [])
    if (r.error) setNote(r.error)
  }

  /** New outfits are built only when she asks: real composing, checked before it shows. */
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
  const [keptIdx, setKeptIdx] = useState<Record<number, 'saving' | 'done' | string>>({})
  async function acceptLook(i: number, items: any[], why: string) {
    setKeptIdx((k) => ({ ...k, [i]: 'saving' }))
    const r = await keepStyledLook(items, why, null, testMemberId)
    setKeptIdx((k) => ({ ...k, [i]: r.error ? r.error : 'done' }))
  }

  // Ask again for different answers, or ask for something in particular.
  const [shuffle, setShuffle] = useState(0)
  const [ask, setAsk] = useState('')
  function reshuffle(p: DressingRoomPiece) {
    const next = shuffle + 1
    setShuffle(next)
    void styleNow(p, { shuffle: next, query: ask })
  }

  const openPiece = (itemId: string) => { if (onOpenPiece) onOpenPiece(itemId) }
  const styledCount = view.pieces.reduce((n, p) => n + (p.styled_in > 0 ? 1 : 0), 0)

  return (
    <div className={`myra-pearl relative left-1/2 right-1/2 -ml-[50vw] -mr-[50vw] w-screen min-h-screen ${testMemberId ? '' : '-my-10'}`}>
      <div className="w-full px-6 sm:px-10 py-8 pb-16 space-y-6">
        {/* The room, drawn — with what she is dressing for over it */}
        <section className="relative rounded-[18px] overflow-hidden shadow-[0_2px_14px_rgba(43,43,43,0.08)]">
          <DressingRoomScene className="w-full h-[300px] md:h-[360px] min-[1440px]:h-auto min-[1440px]:aspect-[4/1] object-cover" />
          <div className="absolute inset-0 flex flex-col justify-between px-8 py-7">
            <div>
              <p className="text-[20px] xl:text-[23px] 2xl:text-[27px] tracking-[0.18em] text-[#6E6B65]">DRESSING ROOM</p>
              <h1 className="text-[clamp(28px,3.4vw,48px)] 2xl:text-[clamp(44px,3.4vw,72px)] tracking-[0.03em] text-[#2B2B2B] leading-[1.05] mt-2">
                {view.firstName ? `${view.firstName.toUpperCase()}\u2019S OWN PIECES` : 'YOUR OWN PIECES'}
              </h1>
              <p className="text-[21px] xl:text-[24px] 2xl:text-[28px] text-[#4A4E57] mt-2 max-w-md">
                {view.pieces.length
                  ? `${view.pieces.length} piece${view.pieces.length === 1 ? '' : 's'} in here${styledCount ? `, ${styledCount} already styled` : ''}.`
                  : 'Nothing in here yet — add your pieces, or find what you have bought below.'}
              </p>
              {inboxes !== null && (
                <button
                  onClick={emailSync}
                  data-tour="email-sync"
                  className="mt-4 inline-flex items-center gap-2.5 text-[19px] xl:text-[22px] 2xl:text-[26px] px-5 py-2.5 rounded-full bg-[#2B2B2B] text-white hover:opacity-85 transition-opacity"
                >
                  {inboxes ? 'Update email sync' : 'Connect your email'} <span aria-hidden>→</span>
                </button>
              )}
            </div>

            {/* The two ways to fill the room, from the top of it. */}
            <div className="flex flex-wrap gap-4 mb-4">
              <a href="#archival-looks" className="text-[20px] xl:text-[23px] underline underline-offset-4 text-[#2B2B2B]">
                Add from Instagram or your photos
              </a>
              <a href="#email-finds" className="text-[20px] xl:text-[23px] underline underline-offset-4 text-[#2B2B2B]">
                Find what you&rsquo;ve bought
              </a>
            </div>

            {view.pieces.length > 0 && (
              <div className="flex flex-wrap gap-2.5">
                {tabs.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setTab(t.id)}
                    className={`text-[20px] xl:text-[23px] 2xl:text-[27px] px-5 py-2.5 rounded-full transition-colors ${tab === t.id ? 'bg-[#2B2B2B] text-white' : 'bg-[rgba(255,255,255,0.75)] text-[#4A4E57] hover:bg-white'}`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Your look — the card standing in the room */}
          <aside className="hidden lg:flex absolute top-7 right-7 w-[280px] 2xl:w-[380px] flex-col items-center text-center gap-4 rounded-[16px] bg-[rgba(255,255,255,0.92)] px-6 py-6 shadow-[0_2px_14px_rgba(43,43,43,0.1)]">
            <p className="text-[21px] xl:text-[24px] 2xl:text-[28px] tracking-[0.14em] text-[#2B2B2B]">YOUR LOOK</p>
            <svg viewBox="0 0 64 64" className="w-16 h-16 text-[#55534E]" aria-hidden>
              <path d="M24 10l8 5 8-5 4 11-4 4 5 26H19l5-26-4-4z" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
            </svg>
            <p className="text-[20px] xl:text-[23px] 2xl:text-[27px] text-[#4A4E57] leading-snug">
              {picked ? picked.product_name : 'Tap a piece and MYRA builds the outfit around it.'}
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

        {/* Her rail, and MYRA working down the right */}
        {view.pieces.length > 0 && (
          <section className={`${CARD} px-6 sm:px-8 py-8`}>
            <div className="grid xl:grid-cols-[minmax(0,1fr)_minmax(460px,36%)] 2xl:grid-cols-[minmax(0,1fr)_42%] gap-8">
              <div className="min-w-0">
                <div className="flex flex-wrap items-baseline justify-between gap-4 mb-6">
                  <h2 className="text-[26px] xl:text-[29px] 2xl:text-[33px] tracking-[0.06em] text-[#2B2B2B]">YOUR WARDROBE</h2>
                  <p className="text-[20px] xl:text-[23px] 2xl:text-[27px] text-[#6E6B65]">{shown.length} shown</p>
                </div>
                <div data-tour="wardrobe" className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-3 2xl:grid-cols-4 min-[2200px]:grid-cols-5 min-[2800px]:grid-cols-6 gap-4">
                  {shown.map((p) => {
                    const on = picked?.item_id === p.item_id
                    return (
                      <button
                        key={p.item_id}
                        onClick={() => pick(p)}
                        className={`text-left bg-white rounded-[16px] overflow-hidden transition-shadow ${on ? 'ring-2 ring-[#2B2B2B]' : 'shadow-[0_1px_8px_rgba(43,43,43,0.06)] hover:shadow-[0_4px_18px_rgba(43,43,43,0.12)]'}`}
                      >
                        <div className="relative aspect-[3/4] bg-[#F3F2F0] overflow-hidden">
                          {p.image_url && (
                            <FallbackImage src={p.image_url} thumbWidth={600} alt={p.product_name} className="absolute inset-0 w-full h-full object-contain" />
                          )}
                        </div>
                        <div className="px-4 py-3">
                          <p className="text-[19px] xl:text-[22px] 2xl:text-[26px] text-[#2B2B2B] leading-tight line-clamp-2">{p.product_name}</p>
                          <p className="text-[18px] xl:text-[21px] 2xl:text-[25px] text-[#6E6B65] mt-1">
                            {p.styled_in ? `In ${p.styled_in} look${p.styled_in === 1 ? '' : 's'}` : 'Not styled yet'}
                          </p>
                        </div>
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* The right pane: the piece, then the outfits MYRA makes with it */}
              <aside data-tour="styling-pane" className="xl:sticky xl:top-6 self-start space-y-4">
                {!picked && (
                  <div className="rounded-[16px] bg-white/70 px-6 py-12 text-center">
                    <p className="text-[21px] xl:text-[24px] 2xl:text-[28px] text-[#4A4E57]">Tap a piece and MYRA styles it here, from your own wardrobe.</p>
                  </div>
                )}
                {picked && (
                  <>
                    <div className="flex gap-4 items-start">
                      <div className="relative w-[120px] xl:w-[150px] 2xl:w-[200px] aspect-[3/4] bg-white rounded-[14px] overflow-hidden shrink-0 shadow-[0_1px_8px_rgba(43,43,43,0.06)]">
                        {picked.image_url && (
                          <FallbackImage src={picked.image_url} thumbWidth={400} alt={picked.product_name} className="absolute inset-0 w-full h-full object-contain" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className="text-[21px] xl:text-[24px] 2xl:text-[28px] text-[#2B2B2B] leading-tight">{picked.product_name}</p>
                        <p className="text-[19px] xl:text-[22px] 2xl:text-[26px] text-[#6E6B65] mt-1">
                          {[picked.item_type?.replace(/_/g, ' '), picked.colour_family].filter(Boolean).join(' · ')}
                        </p>
                        <button
                          onClick={() => styleNow(picked)}
                          disabled={styling}
                          className="mt-3 text-[19px] xl:text-[22px] 2xl:text-[26px] px-5 py-2.5 rounded-full bg-[#2B2B2B] text-white disabled:opacity-40"
                        >
                          {styling ? 'Building…' : looks.length ? 'Build more outfits' : 'Build new outfits'}
                        </button>
                        {looks.length > 0 && (
                          <button
                            onClick={() => reshuffle(picked)}
                            disabled={styling}
                            className="mt-3 ml-3 text-[19px] xl:text-[22px] 2xl:text-[26px] px-5 py-2.5 rounded-full bg-white text-[#2B2B2B] shadow-[0_8px_18px_-12px_rgba(43,43,43,0.5)] disabled:opacity-40"
                          >
                            Reshuffle
                          </button>
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
                        placeholder="Find a white shirt to go with this…"
                        className="myra-guide-text flex-1 min-w-[240px] rounded-full bg-white px-6 py-3 text-[19px] xl:text-[22px] 2xl:text-[26px] outline-none border-2 border-transparent focus:border-[#C9C9C9]"
                      />
                      <button type="submit" disabled={styling || !ask.trim()} className="text-[19px] xl:text-[22px] 2xl:text-[26px] px-5 py-2.5 rounded-full bg-[#2B2B2B] text-white disabled:opacity-40">
                        Find it
                      </button>
                      {ask && (
                        <button type="button" onClick={() => { setAsk(''); void styleNow(picked, { shuffle }) }} className="text-[19px] xl:text-[22px] text-[#6E6B65] underline underline-offset-4">
                          Clear
                        </button>
                      )}
                    </form>

                    {loadingWorn && <p className="text-[20px] xl:text-[23px] 2xl:text-[27px] text-[#6E6B65]">Looking for what you wear it with…</p>}

                    {worn.length > 0 && (
                      <p className="text-[19px] xl:text-[22px] 2xl:text-[26px] tracking-[0.12em] text-[#6E6B65]">
                        ALREADY STYLED — {worn.length} LOOK{worn.length === 1 ? '' : 'S'}
                      </p>
                    )}
                    {!loadingWorn && !worn.length && !looks.length && !styling && (
                      <p className="text-[20px] xl:text-[23px] 2xl:text-[27px] text-[#4A4E57]">MYRA hasn&rsquo;t styled this one yet. Build an outfit around it.</p>
                    )}

                    {styling && (
                      <div className="rounded-[16px] bg-white/70 px-6 py-10 text-center">
                        <img src="/myra-mirror-transparent.png" alt="" className="myra-mirror-wiggle h-24 w-auto mx-auto" />
                        <p className="text-[20px] xl:text-[23px] 2xl:text-[27px] text-[#4A4E57] mt-4">Building outfits around it…</p>
                      </div>
                    )}

                    {note && !styling && <p className="text-[20px] xl:text-[23px] 2xl:text-[27px] text-[#4A4E57]">{note}</p>}

                    {looks.length > 0 && (
                      <p className="text-[19px] xl:text-[22px] 2xl:text-[26px] tracking-[0.12em] text-[#6E6B65]">NEW — BUILT JUST NOW</p>
                    )}

                    <div className="grid grid-cols-1 2xl:grid-cols-2 gap-4">
                    {/* Built just now: every piece can be swapped, with undo. */}
                    {looks.map((l, i) => (
                      <div key={`new-${i}`} className="space-y-2">
                        <BuiltOutfit
                          items={l.items}
                          heroId={picked.item_id}
                          why={l.why}
                          testMemberId={testMemberId}
                          onChange={(next) => setLooks((cur) => cur.map((x, j) => (j === i ? { ...x, items: next } : x)))}
                        />
                        {testMemberId && (
                          <div className="flex items-center gap-3 flex-wrap">
                            <button
                              onClick={() => acceptLook(i, l.items, l.why)}
                              disabled={keptIdx[i] === 'saving' || keptIdx[i] === 'done'}
                              className="text-[19px] xl:text-[22px] px-5 py-2.5 rounded-full bg-[#2B2B2B] text-white disabled:opacity-40"
                            >
                              {keptIdx[i] === 'saving' ? 'Sending…' : keptIdx[i] === 'done' ? 'In her looks' : 'Accept — add to her looks'}
                            </button>
                            {keptIdx[i] && keptIdx[i] !== 'saving' && keptIdx[i] !== 'done' && (
                              <span className="text-[19px] text-[#9B3A3A]">{keptIdx[i]}</span>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
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

        {/* Her turn: pieces she owns and pieces she saved, to try against each
            other. It sits under the rail because the rail is what it draws on. */}
        <OutfitBuilder testMemberId={testMemberId} />

        {/* What she already wears, and how — from Instagram or her own photos. */}
        {/* What is coming up, from her calendar — so MYRA can plan for it. */}
        <CalendarPanel testMemberId={testMemberId} />

        {/* What she kept with the mirror while she was out shopping. */}
        <SavedPieces testMemberId={testMemberId} />

        <ArchivalLooks testMemberId={testMemberId} />

        {/* Fill the dressing room from her order emails. */}
        <EmailFinds testMemberId={testMemberId} />

        {!testMemberId && (
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
