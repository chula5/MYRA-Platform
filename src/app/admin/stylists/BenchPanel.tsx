'use client'

// THE BENCH — search a piece, hand it to every stylist, read the columns.
//
// Only the stylist changes between columns: same client (or none), same
// library, same occasion. So a column that matches its neighbour is telling
// the truth about the house, and the panel says so out loud. The pictures do
// the talking: names are on hover, the brands a stylist reached for sit in
// one line, and the search grid steps aside once a piece is chosen.

import { useEffect, useState } from 'react'
import { CLIENT_OCCASIONS } from '@/lib/client-occasions'
import {
  searchBenchItems, listBenchMembers, styleAcrossStylists,
  type BenchItem, type BenchResult,
} from './bench-actions'

const LABEL = 'text-[9px] tracking-[0.12em] text-[#8B8880]'
const CARD = 'border border-[#E2E0DB] bg-white rounded-[14px]'
const SELECT = 'border border-[#E2E0DB] rounded-[8px] px-3 py-2 text-[13px] text-[#0A0A0A] bg-white'
const PILL = 'rounded-full px-4 py-2 text-[10px] tracking-[0.12em] disabled:opacity-40'

export default function BenchPanel() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [items, setItems] = useState<BenchItem[]>([])
  const [showItems, setShowItems] = useState(true)
  const [hero, setHero] = useState<BenchItem | null>(null)
  const [occasion, setOccasion] = useState<string>('')
  const [members, setMembers] = useState<{ member_id: string; name: string }[]>([])
  const [memberId, setMemberId] = useState('')
  const [result, setResult] = useState<BenchResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open || members.length) return
    void listBenchMembers().then((r) => {
      setMembers(r.members)
      if (r.error) setError(r.error)
    })
  }, [open, members.length])

  async function search() {
    setBusy(true); setError(null); setShowItems(true)
    const r = await searchBenchItems(query)
    setBusy(false)
    setItems(r.items)
    if (r.error) setError(r.error)
    else if (!r.items.length) setError('NOTHING IN READY OR LIVE MATCHES THAT')
  }

  async function styleIt(item: BenchItem) {
    // The grid has done its job: the piece is chosen, the columns are the point.
    setHero(item); setShowItems(false); setResult(null); setBusy(true); setError(null)
    const r = await styleAcrossStylists(item.item_id, occasion || null, memberId || null)
    setBusy(false)
    setResult(r)
    if (r.error) setError(r.error.toUpperCase())
  }

  return (
    <div className={`${CARD} p-5`}>
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-center justify-between gap-3">
        <div className="text-left">
          <p className="text-[15px] tracking-[0.08em] text-[#0A0A0A]">THE BENCH</p>
          <p className="mt-1 text-[11px] text-[#6B6862]">One piece, every stylist, side by side.</p>
        </div>
        <span className={LABEL}>{open ? 'CLOSE' : 'OPEN'}</span>
      </button>

      {open && (
        <div className="mt-5 space-y-5">
          {/* Who, what for, and the piece */}
          <div className="flex flex-wrap items-center gap-2">
            <select value={memberId} onChange={(e) => setMemberId(e.target.value)} className={SELECT} aria-label="Styled for">
              <option value="">The stylist alone</option>
              {members.map((m) => <option key={m.member_id} value={m.member_id}>{m.name}</option>)}
            </select>
            <select value={occasion} onChange={(e) => setOccasion(e.target.value)} className={SELECT} aria-label="Occasion">
              <option value="">No occasion</option>
              {CLIENT_OCCASIONS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void search() } }}
              placeholder="Search a piece"
              className={`flex-1 min-w-[200px] ${SELECT}`}
            />
            <button type="button" onClick={() => void search()} disabled={busy} className={`${PILL} bg-[#141414] text-[#F7F6F3]`}>
              {busy ? 'WORKING…' : 'SEARCH'}
            </button>
          </div>

          {error && <p className="text-[9px] tracking-[0.12em] text-[#9B3A3A]">{error}</p>}

          {/* Pick one — then the grid steps aside */}
          {showItems && !!items.length && (
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6">
              {items.map((it) => (
                <button
                  key={it.item_id}
                  type="button"
                  onClick={() => void styleIt(it)}
                  title={`${it.brand_name ?? ''} — ${it.product_name}`}
                  className={`overflow-hidden rounded-[10px] border border-[#E2E0DB] bg-white text-left ${hero?.item_id === it.item_id ? 'ring-2 ring-[#141414]' : ''}`}
                >
                  {it.image_url
                    ? <img src={it.image_url} alt="" className="aspect-[3/4] w-full object-cover" />
                    : <div className="aspect-[3/4] w-full bg-[#F2F1EE]" />}
                  <span className="block truncate px-2 py-1.5 text-[10px] text-[#0A0A0A]">{it.product_name}</span>
                </button>
              ))}
            </div>
          )}

          {/* The piece, then the mirror while it works, then the answer */}
          {hero && !showItems && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-4">
                {hero.image_url && <img src={hero.image_url} alt="" className="h-24 w-[72px] rounded-[8px] object-cover" />}
                <div className="flex-1 min-w-0">
                  <p className="text-[14px] text-[#0A0A0A]">{hero.product_name}</p>
                  <p className={`mt-1 ${LABEL}`}>
                    {(hero.brand_name ?? '').toUpperCase()}
                    {result?.occasion_label ? ` · ${result.occasion_label.toUpperCase()}` : ''}
                    {result ? (result.member_name ? ` · FOR ${result.member_name.toUpperCase()}` : ' · THE STYLIST ALONE') : ''}
                  </p>
                </div>
                <button type="button" onClick={() => setShowItems(true)} className={`${PILL} border border-[#E2E0DB] bg-white text-[#2B2B2B]`}>
                  CHANGE PIECE
                </button>
              </div>

              {busy && !result && (
                <div className="rounded-[16px] bg-white/70 px-6 py-10 text-center">
                  <img src="/myra-mirror-transparent.png" alt="" className="myra-mirror-wiggle h-24 w-auto mx-auto" />
                  <p className="mt-4 text-[13px] text-[#4A4E57]">Building outfits around it…</p>
                </div>
              )}

              {result?.identical && (
                <p className="rounded-[10px] border border-[#C4A882] bg-[#FBF7F0] px-4 py-3 text-[12px] text-[#6B5636]">
                  Every stylist returned the same pieces.
                </p>
              )}

              {result && <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
                {result.columns.map((c) => (
                  <div key={c.stylist_id} className={`${CARD} p-4`}>
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="text-[13px] tracking-[0.06em] text-[#0A0A0A]">{c.stylist_name.toUpperCase()}</p>
                      {/* Only worth a word when there is nothing to style with. */}
                      {!c.has_brief && !c.has_envelope && <span className="text-[9px] tracking-[0.12em] text-[#9B3A3A]">HOUSE DEFAULT</span>}
                    </div>

                    {c.error
                      ? <p className="mt-3 text-[11px] text-[#9B3A3A]">{c.error}</p>
                      : (
                        <>
                          <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
                            {c.pieces.map((p, i) => (
                              p.image_url
                                ? <img key={`${p.item_id}-${i}`} src={p.image_url} alt="" title={`${p.brand} — ${p.product_name}`}
                                    className={`aspect-[3/4] w-full rounded-[8px] object-cover ${p.is_hero ? 'ring-2 ring-[#141414]' : ''}`} />
                                : <div key={`${p.item_id}-${i}`} title={`${p.brand} — ${p.product_name}`} className="aspect-[3/4] w-full rounded-[8px] bg-[#F2F1EE]" />
                            ))}
                          </div>
                          {!!c.brands.length && (
                            <p className={`mt-3 ${LABEL}`}>{c.brands.join(' · ').toUpperCase()}</p>
                          )}
                        </>
                      )}
                  </div>
                ))}
              </div>}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
