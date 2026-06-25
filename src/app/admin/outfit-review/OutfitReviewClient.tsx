'use client'

import { useEffect, useState } from 'react'
import {
  composeForReview,
  getReviewSwapOptions,
  type ReviewAnchor,
  type ReviewCandidate,
  type ReviewItem,
} from './actions'
import { approveCandidate, rescoreCandidate } from '@/app/admin/composer/actions'

const SLOT_LABEL: Record<string, string> = {
  outerwear: 'OUTERWEAR', top: 'TOP', bottom: 'BOTTOM', dress: 'DRESS',
  shoe: 'SHOES', bag: 'BAG', jewellery: 'JEWELLERY', accessory: 'ACCESSORY',
}

interface CandState {
  approving?: boolean
  approved?: boolean
  discarded?: boolean
  outfitId?: string
  projectId?: string
  error?: string
}

export default function OutfitReviewClient({ anchors }: { anchors: ReviewAnchor[] }) {
  const [visible, setVisible] = useState(6)

  if (anchors.length === 0) {
    return (
      <p className="text-[12px] tracking-[0.09em] text-[#A8A8A4] py-20 text-center">
        EVERY ANCHOR ALREADY HAS 3+ OUTFITS — NOTHING TO REVIEW. 🎉
      </p>
    )
  }

  return (
    <div className="space-y-12">
      {anchors.slice(0, visible).map((a) => (
        <AnchorReview key={a.item_id} anchor={a} />
      ))}
      {visible < anchors.length && (
        <div className="text-center pt-2">
          <button
            onClick={() => setVisible((v) => v + 6)}
            className="border border-[#0A0A0A] text-[#4A4E57] px-8 py-3 text-[11px] tracking-[0.16em] rounded-full hover:bg-[#0A0A0A] hover:text-white transition-colors"
          >
            LOAD MORE ANCHORS ({anchors.length - visible} LEFT)
          </button>
        </div>
      )}
    </div>
  )
}

type SwapTarget = { candIdx: number; itemIdx: number; slot: string }

function AnchorReview({ anchor }: { anchor: ReviewAnchor }) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [cands, setCands] = useState<ReviewCandidate[]>([])
  const [states, setStates] = useState<Record<number, CandState>>({})

  // Swap modal
  const [swap, setSwap] = useState<SwapTarget | null>(null)
  const [swapOptions, setSwapOptions] = useState<ReviewItem[]>([])
  const [swapQuery, setSwapQuery] = useState('')
  const [swapLoading, setSwapLoading] = useState(false)

  useEffect(() => {
    let alive = true
    ;(async () => {
      const res = await composeForReview(anchor.item_id)
      if (!alive) return
      setLoading(false)
      if (res.error) { setError(res.error); return }
      setCands(res.candidates ?? [])
    })()
    return () => { alive = false }
  }, [anchor.item_id])

  async function approve(idx: number) {
    const c = cands[idx]
    setStates((s) => ({ ...s, [idx]: { ...s[idx], approving: true, error: undefined } }))
    const res: any = await approveCandidate(anchor.item_id, c.items.map((i) => i.item_id), c.items.map((i) => i.slot))
    if (res?.error) {
      setStates((s) => ({ ...s, [idx]: { ...s[idx], approving: false, error: res.error } }))
      return
    }
    setStates((s) => ({ ...s, [idx]: { approved: true, outfitId: res.outfitId, projectId: res.projectId } }))
  }

  function discard(idx: number) {
    setStates((s) => ({ ...s, [idx]: { ...s[idx], discarded: true } }))
  }

  async function openSwap(candIdx: number, itemIdx: number, slot: string) {
    setSwap({ candIdx, itemIdx, slot })
    setSwapQuery('')
    setSwapLoading(true)
    const exclude = [anchor.item_id, ...cands[candIdx].items.map((i) => i.item_id)]
    const res = await getReviewSwapOptions(anchor.item_id, slot, exclude, '')
    setSwapOptions(res.options)
    setSwapLoading(false)
  }

  async function runSwapQuery(q: string) {
    setSwapQuery(q)
    if (!swap) return
    setSwapLoading(true)
    const exclude = [anchor.item_id, ...cands[swap.candIdx].items.map((i) => i.item_id)]
    const res = await getReviewSwapOptions(anchor.item_id, swap.slot, exclude, q)
    setSwapOptions(res.options)
    setSwapLoading(false)
  }

  async function performSwap(opt: ReviewItem) {
    if (!swap) return
    const { candIdx, itemIdx } = swap
    setCands((prev) => {
      const next = prev.map((c) => ({ ...c, items: [...c.items] }))
      next[candIdx].items[itemIdx] = { ...opt, slot: opt.slot }
      return next
    })
    setSwap(null)
    // Rescore coherence with the new combo.
    const items = cands[candIdx].items.map((it, i) => (i === itemIdx ? opt : it))
    const res: any = await rescoreCandidate(anchor.item_id, items.map((i) => ({ itemId: i.item_id, slot: i.slot })))
    if (typeof res?.score === 'number') {
      setCands((prev) => {
        const next = [...prev]
        next[candIdx] = { ...next[candIdx], score: res.score }
        return next
      })
    }
  }

  return (
    <div className="border border-[#E2E0DB] bg-white rounded-[14px] overflow-hidden">
      {/* Anchor header */}
      <div className="flex items-center gap-4 p-4 border-b border-[#E2E0DB] bg-[#FAFAF8]">
        <div className="w-16 h-20 flex-shrink-0 rounded-[8px] overflow-hidden bg-[#F2F2F0]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={anchor.image_url} alt="" className="w-full h-full object-cover" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[9px] tracking-[0.18em] text-[#A8A8A4] mb-0.5">ANCHOR · {anchor.item_type.replace(/_/g, ' ').toUpperCase()}</p>
          <p className="text-[10px] tracking-[0.10em] text-[#6B6B6B]">{(anchor.brand_name ?? '').toUpperCase()}</p>
          <p className="text-[13px] tracking-[0.04em] text-[#4A4E57] truncate">{anchor.product_name.toUpperCase()}</p>
          {anchor.price && <p className="text-[10px] tracking-[0.06em] text-[#6B6B6B] mt-0.5">{anchor.price}</p>}
        </div>
        <div className="text-right flex-shrink-0">
          <p className="text-[18px] tracking-[0.04em] text-[#4A4E57] leading-none">{anchor.existingCount}<span className="text-[#A8A8A4]"> / 3</span></p>
          <p className="text-[8px] tracking-[0.16em] text-[#C4A882] mt-1">OUTFITS BUILT</p>
        </div>
      </div>

      {/* Candidates */}
      <div className="p-4">
        {loading && <p className="text-[11px] tracking-[0.16em] text-[#A8A8A4] py-8 text-center">COMPOSING POTENTIAL OUTFITS…</p>}
        {!loading && error && <p className="text-[10px] tracking-[0.12em] text-[#B83A3A] py-6 text-center">{error.toUpperCase()}</p>}
        {!loading && !error && cands.every((_, i) => states[i]?.discarded) && cands.length > 0 && (
          <p className="text-[10px] tracking-[0.14em] text-[#A8A8A4] py-4 text-center">ALL OPTIONS REVIEWED FOR THIS ANCHOR.</p>
        )}
        {!loading && !error && cands.length === 0 && (
          <p className="text-[10px] tracking-[0.14em] text-[#A8A8A4] py-6 text-center">NO BRAND-COHERENT COMBINATIONS FOUND.</p>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {cands.map((c, idx) => {
            if (states[idx]?.discarded) return null
            const st = states[idx]
            const editable = !st?.approved
            return (
              <div key={idx} className="border border-[#E2E0DB] rounded-[10px] p-3">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-[9px] tracking-[0.16em] text-[#6B6B6B]">POTENTIAL OUTFIT {String(idx + 1).padStart(2, '0')}</p>
                  <p className="text-[9px] tracking-[0.12em] text-[#A8A8A4]">COHERENCE {(c.score * 100).toFixed(0)}</p>
                </div>

                <div className="grid grid-cols-4 gap-1.5 mb-3">
                  {/* Anchor */}
                  <div className="relative">
                    <div className="aspect-[3/4] rounded-[6px] overflow-hidden bg-[#F2F2F0]">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={anchor.image_url} alt="" className="w-full h-full object-cover" />
                    </div>
                    <span className="absolute top-1 left-1 bg-[#0A0A0A] text-white text-[7px] tracking-[0.10em] px-1 py-0.5 rounded">ANCHOR</span>
                    {anchor.price && <p className="text-[7px] tracking-[0.04em] text-[#4A4E57] mt-0.5">{anchor.price}</p>}
                  </div>
                  {/* Additions */}
                  {c.items.map((item, itemIdx) => (
                    <div key={`${item.item_id}-${itemIdx}`} className="relative group">
                      <div className="aspect-[3/4] rounded-[6px] overflow-hidden bg-[#F2F2F0]">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={item.image_url} alt="" className="w-full h-full object-cover" />
                        {editable && (
                          <button
                            onClick={() => openSwap(idx, itemIdx, item.slot)}
                            className="absolute inset-0 bg-black/0 group-hover:bg-black/45 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                          >
                            <span className="bg-white text-[#0A0A0A] text-[8px] tracking-[0.12em] px-2 py-1 rounded">SWAP</span>
                          </button>
                        )}
                      </div>
                      <p className="text-[7px] tracking-[0.10em] text-[#A8A8A4] mt-0.5 truncate">{SLOT_LABEL[item.slot] ?? item.slot}</p>
                      <p className="text-[7px] tracking-[0.06em] text-[#6B6B6B] truncate">{(item.brand_name ?? '').toUpperCase()}</p>
                      {item.price && <p className="text-[7px] tracking-[0.04em] text-[#4A4E57]">{item.price}</p>}
                    </div>
                  ))}
                </div>

                {st?.approved ? (
                  <div>
                    <a href={`/admin/projects/${st.projectId}/outfits/${st.outfitId}/edit`} className="block text-center bg-[#C4A882] text-white py-2.5 text-[10px] tracking-[0.16em] rounded-full">
                      ✓ YES → EDIT DRAFT
                    </a>
                    <p className="mt-2 text-[8px] tracking-[0.10em] text-[#C4A882] leading-relaxed">✦ HIGGSFIELD SHOOT GENERATING (~30–60S) — IT&rsquo;LL BECOME THE DISPLAY IMAGE.</p>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <button onClick={() => approve(idx)} disabled={st?.approving} className="flex-1 bg-[#0A0A0A] text-white py-2.5 text-[10px] tracking-[0.18em] rounded-full hover:opacity-85 transition-opacity disabled:opacity-50">
                      {st?.approving ? 'CREATING…' : 'YES ✓'}
                    </button>
                    <button onClick={() => discard(idx)} disabled={st?.approving} className="px-4 py-2.5 text-[10px] tracking-[0.14em] border border-[#E2E0DB] text-[#6B6B6B] rounded-full hover:border-[#0A0A0A] transition-colors disabled:opacity-50">
                      SKIP
                    </button>
                  </div>
                )}
                {st?.error && <p className="mt-2 text-[8px] tracking-[0.10em] text-[#B83A3A]">{st.error.toUpperCase()}</p>}
              </div>
            )
          })}
        </div>
      </div>

      {/* Swap modal */}
      {swap && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center pt-16 px-4" onClick={() => setSwap(null)}>
          <div className="bg-white border border-[#E2E0DB] rounded-[12px] w-full max-w-3xl max-h-[80vh] overflow-y-auto p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-baseline justify-between mb-4 pb-3 border-b border-[#E2E0DB]">
              <p className="text-[10px] tracking-[0.16em] text-[#6B6B6B]">SWAP · {SLOT_LABEL[swap.slot] ?? swap.slot}</p>
              <button onClick={() => setSwap(null)} className="text-[#A8A8A4] hover:text-[#0A0A0A] text-[18px] leading-none">×</button>
            </div>
            <input
              value={swapQuery}
              onChange={(e) => runSwapQuery(e.target.value)}
              placeholder="SEARCH ANY ITEM BY NAME, BRAND OR TYPE…"
              className="w-full border border-[#E2E0DB] rounded-[10px] px-4 py-2.5 text-[11px] tracking-[0.08em] text-[#4A4E57] placeholder:text-[#A8A8A4] focus:outline-none focus:border-[#0A0A0A] mb-4"
            />
            {swapLoading ? (
              <p className="text-[10px] tracking-[0.16em] text-[#A8A8A4] py-8 text-center">LOADING…</p>
            ) : (
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
                {swapOptions.map((opt) => (
                  <button key={opt.item_id} onClick={() => performSwap(opt)} className="group text-left">
                    <div className="aspect-[3/4] rounded-[6px] overflow-hidden bg-[#F2F2F0]">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={opt.image_url} alt="" className="w-full h-full object-cover group-hover:opacity-90" />
                    </div>
                    <p className="text-[8px] tracking-[0.08em] text-[#6B6B6B] mt-1 truncate">{(opt.brand_name ?? '').toUpperCase()}</p>
                    <p className="text-[9px] tracking-[0.04em] text-[#4A4E57] truncate">{opt.product_name}</p>
                    <div className="flex items-center justify-between mt-0.5">
                      <span className="text-[8px] tracking-[0.06em] text-[#4A4E57]">{opt.price}</span>
                      <span className="text-[8px] tracking-[0.06em] text-[#A8A8A4]">{(opt.compat * 100).toFixed(0)}</span>
                    </div>
                  </button>
                ))}
                {swapOptions.length === 0 && <p className="col-span-full text-[10px] tracking-[0.14em] text-[#A8A8A4] py-6 text-center">NO MATCHES.</p>}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
