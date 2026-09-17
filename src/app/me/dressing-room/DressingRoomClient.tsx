'use client'

// DRESSING ROOM — the room across the top, her rail under it, and MYRA
// working down the right.
//
// Tapping a piece stands it up on the right and MYRA styles it there: real
// outfits built from her own wardrobe and the library, checked before they
// show. The full page for a piece (how it has been styled, STYLE THIS by
// occasion, the finders) is one tap further in.

import Link from 'next/link'
import { useEffect, useMemo, useRef, useState } from 'react'
import FallbackImage from '@/components/FallbackImage'
import type { DressingRoomPiece, DressingRoomView, StyledLook } from '@/app/admin/private-stylist/actions'
import { styleMyPiece } from './actions'
import EmailFinds from './EmailFinds'

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
  const [picked, setPicked] = useState<DressingRoomPiece | null>(null)
  const [looks, setLooks] = useState<StyledLook[]>([])
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

  // Tapping a piece is the whole interaction: MYRA styles it on the right.
  async function pick(p: DressingRoomPiece) {
    setPicked(p)
    setLooks([])
    setNote(null)
    setStyling(true)
    wanted.current = p.item_id
    const r = await styleMyPiece(p.item_id, {}, testMemberId)
    if (wanted.current !== p.item_id) return
    setStyling(false)
    setLooks(r.looks ?? [])
    setNote(r.error ?? (r.looks?.length
      ? null
      : 'Nothing in the library goes with this one yet.'))
  }

  const openPiece = (itemId: string) => { if (onOpenPiece) onOpenPiece(itemId) }
  const styledCount = view.pieces.reduce((n, p) => n + (p.styled_in > 0 ? 1 : 0), 0)

  return (
    <div className={`myra-pearl relative left-1/2 right-1/2 -ml-[50vw] -mr-[50vw] w-screen min-h-screen ${testMemberId ? '' : '-my-10'}`}>
      <div className="w-full px-6 sm:px-10 py-8 pb-16 space-y-6">
        {/* The room */}
        <section className={`${CARD} overflow-hidden`}>
          <div className="grid lg:grid-cols-[1fr_380px]">
            <div className="px-8 py-10 flex flex-col justify-between gap-8">
              <div>
                <p className="text-[20px] tracking-[0.18em] text-[#6E6B65]">DRESSING ROOM</p>
                <h1 className="text-[clamp(30px,4vw,56px)] tracking-[0.03em] text-[#2B2B2B] leading-[1.05] mt-3">
                  {view.firstName ? `${view.firstName.toUpperCase()}’S OWN PIECES` : 'YOUR OWN PIECES'}
                </h1>
                <p className="text-[22px] text-[#4A4E57] mt-4 max-w-2xl">
                  {view.pieces.length
                    ? `${view.pieces.length} piece${view.pieces.length === 1 ? '' : 's'} in here${styledCount ? `, ${styledCount} already styled into looks` : ''}. Tap one and MYRA dresses it.`
                    : 'Nothing in here yet. Add your pieces, or find what you have bought below.'}
                </p>
                {view.test && (
                  <p className="text-[18px] tracking-[0.1em] text-[#8B5E00] mt-4">
                    TEST AS {view.firstName.toUpperCase()} — OUTFITS ARE COMPOSED FOR REAL, NOTHING IS SAVED
                  </p>
                )}
              </div>
              {view.pieces.length > 0 && (
                <div className="flex flex-wrap gap-3">
                  {tabs.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => setTab(t.id)}
                      className={`text-[20px] px-6 py-3 rounded-full transition-colors ${tab === t.id ? 'bg-[#2B2B2B] text-white' : 'bg-white/70 text-[#4A4E57] hover:bg-white'}`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Your look — what the room is for */}
            <aside className="bg-[rgba(255,255,255,0.55)] px-8 py-10 flex flex-col items-center justify-center text-center gap-5 border-t lg:border-t-0 lg:border-l border-[rgba(43,43,43,0.1)]">
              <p className="text-[22px] tracking-[0.14em] text-[#2B2B2B]">YOUR LOOK</p>
              <svg viewBox="0 0 64 64" className="w-20 h-20 text-[#55534E]" aria-hidden>
                <path d="M24 10l8 5 8-5 4 11-4 4 5 26H19l5-26-4-4z" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
              </svg>
              <p className="text-[21px] text-[#4A4E57] leading-snug">
                {picked ? `Styling ${picked.product_name}.` : 'Tap a piece and MYRA builds the outfit around it.'}
              </p>
              {picked && (
                onOpenPiece ? (
                  <button onClick={() => openPiece(picked.item_id)} className="text-[20px] px-6 py-3 rounded-full border border-[#2B2B2B] text-[#2B2B2B]">
                    Open its page
                  </button>
                ) : (
                  <Link href={`/me/dressing-room/${picked.item_id}`} className="text-[20px] px-6 py-3 rounded-full border border-[#2B2B2B] text-[#2B2B2B]">
                    Open its page
                  </Link>
                )
              )}
            </aside>
          </div>
        </section>

        {view.error && <p className="text-[20px] text-[#B83A3A] text-center">{view.error}</p>}

        {/* Her rail, and MYRA working down the right */}
        {view.pieces.length > 0 && (
          <section className={`${CARD} px-6 sm:px-8 py-8`}>
            <div className="grid xl:grid-cols-[1fr_420px] gap-8">
              <div>
                <div className="flex flex-wrap items-baseline justify-between gap-4 mb-6">
                  <h2 className="text-[26px] tracking-[0.06em] text-[#2B2B2B]">YOUR WARDROBE</h2>
                  <p className="text-[20px] text-[#6E6B65]">{shown.length} shown</p>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-6 gap-4">
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
                          <p className="text-[19px] text-[#2B2B2B] leading-tight line-clamp-2">{p.product_name}</p>
                          <p className="text-[18px] text-[#6E6B65] mt-1">
                            {p.styled_in ? `In ${p.styled_in} look${p.styled_in === 1 ? '' : 's'}` : 'Not styled yet'}
                          </p>
                        </div>
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* The right pane: the piece, then the outfits MYRA makes with it */}
              <aside className="xl:sticky xl:top-6 self-start space-y-4">
                {!picked && (
                  <div className="rounded-[16px] bg-white/70 px-6 py-12 text-center">
                    <p className="text-[21px] text-[#4A4E57]">Tap a piece and MYRA styles it here, from your own wardrobe.</p>
                  </div>
                )}
                {picked && (
                  <>
                    <div className="flex gap-4 items-start">
                      <div className="relative w-[120px] aspect-[3/4] bg-white rounded-[14px] overflow-hidden shrink-0 shadow-[0_1px_8px_rgba(43,43,43,0.06)]">
                        {picked.image_url && (
                          <FallbackImage src={picked.image_url} thumbWidth={400} alt={picked.product_name} className="absolute inset-0 w-full h-full object-contain" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className="text-[21px] text-[#2B2B2B] leading-tight">{picked.product_name}</p>
                        <p className="text-[19px] text-[#6E6B65] mt-1">
                          {[picked.item_type?.replace(/_/g, ' '), picked.colour_family].filter(Boolean).join(' · ')}
                        </p>
                        <button
                          onClick={() => pick(picked)}
                          disabled={styling}
                          className="mt-3 text-[19px] px-5 py-2.5 rounded-full bg-[#2B2B2B] text-white disabled:opacity-40"
                        >
                          {styling ? 'Styling…' : 'Style it again'}
                        </button>
                      </div>
                    </div>

                    {styling && (
                      <div className="rounded-[16px] bg-white/70 px-6 py-10 text-center">
                        <img src="/myra-mirror-transparent.png" alt="" className="myra-mirror-wiggle h-24 w-auto mx-auto" />
                        <p className="text-[20px] text-[#4A4E57] mt-4">Building outfits around it…</p>
                      </div>
                    )}

                    {note && !styling && <p className="text-[20px] text-[#4A4E57]">{note}</p>}

                    {looks.map((l, i) => (
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
                        {l.why && <p className="text-[19px] text-[#4A4E57] px-4 py-3 leading-snug">{l.why}</p>}
                      </div>
                    ))}
                  </>
                )}
              </aside>
            </div>
          </section>
        )}

        {/* Fill the dressing room from her order emails. */}
        <EmailFinds testMemberId={testMemberId} />

        {!testMemberId && (
          <p className="text-center">
            <Link href="/me/wardrobe" className={view.pieces.length ? 'text-[22px] text-[#2B2B2B] underline underline-offset-4' : 'inline-block text-[22px] px-7 py-4 bg-[#2B2B2B] text-white rounded-full'}>
              {view.pieces.length ? 'Add more pieces →' : 'Add your pieces'}
            </Link>
          </p>
        )}
      </div>
    </div>
  )
}
