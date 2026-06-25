'use client'

import { useEffect, useState } from 'react'
import { composeForReview, type ReviewAnchor, type ReviewCandidate } from './actions'
import { approveCandidate } from '@/app/admin/composer/actions'

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
  const [visible, setVisible] = useState(4)

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
            onClick={() => setVisible((v) => v + 4)}
            className="border border-[#0A0A0A] text-[#4A4E57] px-8 py-3 text-[11px] tracking-[0.16em] rounded-full hover:bg-[#0A0A0A] hover:text-white transition-colors"
          >
            LOAD MORE ANCHORS ({anchors.length - visible} LEFT)
          </button>
        </div>
      )}
    </div>
  )
}

function AnchorReview({ anchor }: { anchor: ReviewAnchor }) {
  const [loading, setLoading] = useState(true)
  const [candidates, setCandidates] = useState<ReviewCandidate[]>([])
  const [error, setError] = useState<string | null>(null)
  const [states, setStates] = useState<Record<number, CandState>>({})

  useEffect(() => {
    let alive = true
    ;(async () => {
      const res = await composeForReview(anchor.item_id)
      if (!alive) return
      setLoading(false)
      if (res.error) { setError(res.error); return }
      setCandidates(res.candidates ?? [])
    })()
    return () => { alive = false }
  }, [anchor.item_id])

  async function approve(idx: number, c: ReviewCandidate) {
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

  const liveCandidates = candidates.filter((_, i) => !states[i]?.discarded)

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
        </div>
        <div className="text-right flex-shrink-0">
          <p className="text-[18px] tracking-[0.04em] text-[#4A4E57] leading-none">{anchor.existingCount}<span className="text-[#A8A8A4]"> / 3</span></p>
          <p className="text-[8px] tracking-[0.16em] text-[#C4A882] mt-1">OUTFITS BUILT</p>
        </div>
      </div>

      {/* Candidates */}
      <div className="p-4">
        {loading && (
          <p className="text-[11px] tracking-[0.16em] text-[#A8A8A4] py-8 text-center">COMPOSING POTENTIAL OUTFITS…</p>
        )}
        {!loading && error && (
          <p className="text-[10px] tracking-[0.12em] text-[#B83A3A] py-6 text-center">{error.toUpperCase()}</p>
        )}
        {!loading && !error && liveCandidates.length === 0 && (
          <p className="text-[10px] tracking-[0.14em] text-[#A8A8A4] py-6 text-center">
            NO BRAND-COHERENT COMBINATIONS FOUND — ADD MORE COMPATIBLE ITEMS TO THE LIBRARY.
          </p>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {candidates.map((c, idx) => {
            if (states[idx]?.discarded) return null
            const st = states[idx]
            return (
              <div key={idx} className="border border-[#E2E0DB] rounded-[10px] p-3">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-[9px] tracking-[0.16em] text-[#6B6B6B]">
                    POTENTIAL OUTFIT {String(idx + 1).padStart(2, '0')}
                  </p>
                  <p className="text-[9px] tracking-[0.12em] text-[#A8A8A4]">COHERENCE {(c.score * 100).toFixed(0)}</p>
                </div>

                {/* Item grid: anchor + additions */}
                <div className="grid grid-cols-4 gap-1.5 mb-3">
                  <div className="relative">
                    <div className="aspect-[3/4] rounded-[6px] overflow-hidden bg-[#F2F2F0]">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={anchor.image_url} alt="" className="w-full h-full object-cover" />
                    </div>
                    <span className="absolute top-1 left-1 bg-[#0A0A0A] text-white text-[7px] tracking-[0.10em] px-1 py-0.5 rounded">ANCHOR</span>
                  </div>
                  {c.items.map((item) => (
                    <div key={item.item_id} className="relative">
                      <div className="aspect-[3/4] rounded-[6px] overflow-hidden bg-[#F2F2F0]">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={item.image_url} alt="" className="w-full h-full object-cover" />
                      </div>
                      <p className="text-[7px] tracking-[0.10em] text-[#A8A8A4] mt-0.5 truncate">{SLOT_LABEL[item.slot] ?? item.slot}</p>
                      <p className="text-[7px] tracking-[0.06em] text-[#6B6B6B] truncate">{(item.brand_name ?? '').toUpperCase()}</p>
                    </div>
                  ))}
                </div>

                {/* Actions */}
                {st?.approved ? (
                  <div>
                    <a
                      href={`/admin/projects/${st.projectId}/outfits/${st.outfitId}/edit`}
                      className="block text-center bg-[#C4A882] text-white py-2.5 text-[10px] tracking-[0.16em] rounded-full"
                    >
                      ✓ YES → EDIT DRAFT
                    </a>
                    <p className="mt-2 text-[8px] tracking-[0.10em] text-[#C4A882] leading-relaxed">
                      ✦ HIGGSFIELD SHOOT GENERATING IN THE BACKGROUND (~30–60S) — IT&rsquo;LL BECOME THE DISPLAY IMAGE.
                    </p>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => approve(idx, c)}
                      disabled={st?.approving}
                      className="flex-1 bg-[#0A0A0A] text-white py-2.5 text-[10px] tracking-[0.18em] rounded-full hover:opacity-85 transition-opacity disabled:opacity-50"
                    >
                      {st?.approving ? 'CREATING…' : 'YES ✓'}
                    </button>
                    <button
                      onClick={() => discard(idx)}
                      disabled={st?.approving}
                      className="px-4 py-2.5 text-[10px] tracking-[0.14em] border border-[#E2E0DB] text-[#6B6B6B] rounded-full hover:border-[#0A0A0A] transition-colors disabled:opacity-50"
                    >
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
    </div>
  )
}
