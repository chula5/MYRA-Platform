'use client'

import { useState } from 'react'
import { thumbUrl } from '@/lib/image-utils'
import { approveCandidate, rescoreCandidate, recordSkipDecision, recordSwap } from '@/app/admin/composer/actions'
import { generateHiggsfieldShootForOutfit } from '@/app/admin/projects/higgsfield-actions'
import type { ReviewItem } from '@/app/admin/outfit-review/actions'
import type { Slot } from '@/lib/composer'

const SLOT_LABEL: Record<string, string> = {
  outerwear: 'OUTERWEAR', top: 'TOP', bottom: 'BOTTOM', dress: 'DRESS',
  shoe: 'SHOES', bag: 'BAG', jewellery: 'JEWELLERY', accessory: 'ACCESSORY',
}

export interface ComposeAnchor {
  item_id: string
  product_name: string
  brand_name: string | null
  image_url: string
  price: string | null
  item_type: string | null
}
export interface ComposeCandItem {
  slot: string
  item_id: string
  product_name: string
  brand_name: string | null
  image_url: string
  compat: number
}
export interface ComposeCandidate { candidateIndex: number; score: number; items: ComposeCandItem[] }

type CandState = {
  approving?: boolean
  approved?: boolean
  discarded?: boolean
  outfitId?: string
  projectId?: string
  shoot?: 'running' | 'done' | 'failed'
  shootError?: string
  error?: string
}
type SwapTarget = { ci: number; itemIdx: number; slot: string; mode: 'swap' | 'add' }

// Swap/add search via the route handler (not a server action) so it keeps
// working while a long-running Higgsfield shoot is in flight.
async function fetchReviewOptions(params: {
  mode: 'swap' | 'add'; anchor: string; slot?: string; present?: string[]; exclude: string[]; q: string
}): Promise<{ options: ReviewItem[] }> {
  const sp = new URLSearchParams()
  sp.set('mode', params.mode)
  sp.set('anchor', params.anchor)
  sp.set('q', params.q)
  sp.set('exclude', params.exclude.join(','))
  if (params.slot) sp.set('slot', params.slot)
  if (params.present) sp.set('present', params.present.join(','))
  try {
    const r = await fetch(`/api/admin/review-options?${sp.toString()}`, { cache: 'no-store' })
    if (!r.ok) return { options: [] }
    return await r.json()
  } catch {
    return { options: [] }
  }
}

// One composed block: the anchor item + its outfit candidates. Handles swap,
// add, remove, YES (creates draft → records into the Style Brain → triggers the
// Refined Higgsfield shoot and swaps the display image), and SKIP (trains too).
export default function OutfitComposePanel({
  anchor,
  initialCandidates,
}: {
  anchor: ComposeAnchor
  initialCandidates: ComposeCandidate[]
}) {
  const [cands, setCands] = useState<ComposeCandidate[]>(initialCandidates)
  const [states, setStates] = useState<Record<number, CandState>>({})
  const [swap, setSwap] = useState<SwapTarget | null>(null)
  const [swapOptions, setSwapOptions] = useState<ReviewItem[]>([])
  const [swapQuery, setSwapQuery] = useState('')
  const [swapLoading, setSwapLoading] = useState(false)

  const setState = (ci: number, patch: CandState) =>
    setStates((s) => ({ ...s, [ci]: { ...s[ci], ...patch } }))
  const setItems = (ci: number, items: ComposeCandItem[], score?: number) =>
    setCands((prev) => prev.map((c, j) => (j === ci ? { ...c, items, score: score ?? c.score } : c)))

  async function approve(ci: number) {
    const cand = cands[ci]
    if (!cand) return
    setState(ci, { approving: true, error: undefined })
    // autoShoot:false — we drive the shoot ourselves so we can await it and show
    // live status. approveCandidate records the YES into the Style Brain.
    const r: any = await approveCandidate(
      anchor.item_id,
      cand.items.map((x) => x.item_id),
      cand.items.map((x) => x.slot as Slot),
      { autoShoot: false, source: 'composer', score: cand.score },
    )
    if (r?.error) { setState(ci, { approving: false, error: r.error }); return }
    setState(ci, { approved: true, outfitId: r.outfitId, projectId: r.projectId, shoot: 'running' })
    try {
      const shot: any = await generateHiggsfieldShootForOutfit(r.outfitId, 'F6')
      setState(ci, { shoot: shot?.imageUrl ? 'done' : 'failed', shootError: shot?.error })
    } catch (err: any) {
      setState(ci, { shoot: 'failed', shootError: err?.message })
    }
  }

  function skip(ci: number) {
    const cand = cands[ci]
    setState(ci, { discarded: true })
    if (cand) void recordSkipDecision(anchor.item_id, cand.items.map((x) => x.item_id), 'composer', cand.score)
  }

  async function openSwap(ci: number, itemIdx: number, slot: string) {
    setSwap({ ci, itemIdx, slot, mode: 'swap' })
    setSwapQuery(''); setSwapLoading(true)
    const exclude = [anchor.item_id, ...cands[ci].items.map((x) => x.item_id)]
    const res = await fetchReviewOptions({ mode: 'swap', anchor: anchor.item_id, slot, exclude, q: '' })
    setSwapOptions(res.options); setSwapLoading(false)
  }
  async function openAdd(ci: number) {
    setSwap({ ci, itemIdx: -1, slot: '', mode: 'add' })
    setSwapQuery(''); setSwapLoading(true)
    const present = cands[ci].items.map((x) => x.slot)
    const exclude = [anchor.item_id, ...cands[ci].items.map((x) => x.item_id)]
    const res = await fetchReviewOptions({ mode: 'add', anchor: anchor.item_id, present, exclude, q: '' })
    setSwapOptions(res.options); setSwapLoading(false)
  }
  async function runSwapQuery(q: string) {
    setSwapQuery(q); if (!swap) return
    setSwapLoading(true)
    const exclude = [anchor.item_id, ...cands[swap.ci].items.map((x) => x.item_id)]
    const res = swap.mode === 'add'
      ? await fetchReviewOptions({ mode: 'add', anchor: anchor.item_id, present: cands[swap.ci].items.map((x) => x.slot), exclude, q })
      : await fetchReviewOptions({ mode: 'swap', anchor: anchor.item_id, slot: swap.slot, exclude, q })
    setSwapOptions(res.options); setSwapLoading(false)
  }
  async function removeItem(ci: number, itemIdx: number) {
    const cand = cands[ci]; if (!cand) return
    const removed = cand.items[itemIdx]
    if (removed) void recordSwap(anchor.item_id, removed.item_id, null)
    const items = cand.items.filter((_, i) => i !== itemIdx)
    setItems(ci, items)
    const res: any = await rescoreCandidate(anchor.item_id, items.map((i) => ({ itemId: i.item_id, slot: i.slot as Slot })))
    if (typeof res?.score === 'number') setItems(ci, items, res.score)
  }
  async function performSwap(opt: ReviewItem) {
    if (!swap) return
    const { ci, itemIdx, mode } = swap
    const cand = cands[ci]; if (!cand) return
    if (mode === 'swap' && cand.items[itemIdx]) void recordSwap(anchor.item_id, cand.items[itemIdx].item_id, opt.item_id)
    const mapped: ComposeCandItem = { slot: opt.slot, item_id: opt.item_id, product_name: opt.product_name, brand_name: opt.brand_name, image_url: opt.image_url, compat: opt.compat }
    const items = mode === 'add' ? [...cand.items, mapped] : cand.items.map((it, i) => (i === itemIdx ? mapped : it))
    setItems(ci, items)
    setSwap(null)
    const res: any = await rescoreCandidate(anchor.item_id, items.map((i) => ({ itemId: i.item_id, slot: i.slot as Slot })))
    if (typeof res?.score === 'number') setItems(ci, items, res.score)
  }

  const visible = cands.map((c, ci) => ({ c, ci })).filter(({ ci }) => !states[ci]?.discarded)

  return (
    <div>
      {visible.length === 0 && (
        <p className="text-[10px] tracking-[0.14em] text-[#A8A8A4] py-4 text-center">NO OUTFIT OPTIONS.</p>
      )}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {visible.map(({ c, ci }) => {
          const st = states[ci]
          const editable = !st?.approved
          return (
            <div key={ci} className="border border-[#E2E0DB] rounded-[10px] p-3">
              <div className="flex items-center justify-between mb-3">
                <p className="text-[9px] tracking-[0.16em] text-[#6B6B6B]">OPTION {String(ci + 1).padStart(2, '0')}</p>
                <p className="text-[9px] tracking-[0.12em] text-[#A8A8A4]">COHERENCE {(c.score * 100).toFixed(0)}</p>
              </div>
              <div className="grid grid-cols-4 gap-1.5 mb-3">
                <div className="relative">
                  <div className="aspect-[3/4] rounded-[6px] overflow-hidden bg-[#F2F2F0]">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {anchor.image_url && <img src={thumbUrl(anchor.image_url, 600)} alt="" className="w-full h-full object-cover" />}
                  </div>
                  <span className="absolute top-1 left-1 bg-[#0A0A0A] text-white text-[7px] tracking-[0.10em] px-1 py-0.5 rounded">NEW</span>
                </div>
                {c.items.map((item, k) => (
                  <div key={`${item.item_id}-${k}`} className="relative group">
                    <div className="aspect-[3/4] rounded-[6px] overflow-hidden bg-[#F2F2F0]">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={thumbUrl(item.image_url, 600)} alt="" className="w-full h-full object-cover" />
                      {editable && (
                        <button onClick={() => openSwap(ci, k, item.slot)} className="absolute inset-0 bg-black/0 group-hover:bg-black/45 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                          <span className="bg-white text-[#0A0A0A] text-[8px] tracking-[0.12em] px-2 py-1 rounded">SWAP</span>
                        </button>
                      )}
                      {editable && (
                        <button
                          onClick={(e) => { e.stopPropagation(); removeItem(ci, k) }}
                          className="absolute top-1 right-1 z-20 w-4 h-4 rounded-full bg-black/60 text-white text-[11px] leading-none flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-[#B83A3A]"
                          aria-label="Remove item"
                        >
                          ×
                        </button>
                      )}
                    </div>
                    <p className="text-[7px] tracking-[0.10em] text-[#A8A8A4] mt-0.5 truncate">{SLOT_LABEL[item.slot] ?? item.slot}</p>
                    <p className="text-[7px] tracking-[0.06em] text-[#6B6B6B] truncate">{(item.brand_name ?? '').toUpperCase()}</p>
                  </div>
                ))}
                {editable && (
                  <button onClick={() => openAdd(ci)} className="aspect-[3/4] rounded-[6px] border border-dashed border-[#C9C7C2] flex flex-col items-center justify-center text-[#A8A8A4] hover:border-[#0A0A0A] hover:text-[#4A4E57] transition-colors">
                    <span className="text-[18px] leading-none">+</span>
                    <span className="text-[7px] tracking-[0.12em] mt-1">ADD</span>
                  </button>
                )}
              </div>

              {st?.approved ? (
                <div>
                  <a href={`/admin/projects/${st.projectId}/outfits/${st.outfitId}/edit`} className="block text-center bg-[#C4A882] text-white py-2.5 text-[10px] tracking-[0.16em] rounded-full">✓ YES → EDIT DRAFT</a>
                  {st.shoot === 'running' && <p className="mt-2 text-[8px] tracking-[0.10em] text-[#C4A882] leading-relaxed">✦ REFINED SHOOT GENERATING… (~30–90S)</p>}
                  {st.shoot === 'done' && <p className="mt-2 text-[8px] tracking-[0.10em] text-[#3D7A50] leading-relaxed">✦ REFINED SHOOT DONE — SET AS DISPLAY IMAGE.</p>}
                  {st.shoot === 'failed' && <p className="mt-2 text-[8px] tracking-[0.10em] text-[#B83A3A] leading-relaxed">SHOOT FAILED{st.shootError ? ` · ${st.shootError.toUpperCase()}` : ''}</p>}
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <button onClick={() => approve(ci)} disabled={st?.approving} className="flex-1 bg-[#0A0A0A] text-white py-2.5 text-[10px] tracking-[0.18em] rounded-full hover:opacity-85 transition-opacity disabled:opacity-50">{st?.approving ? 'CREATING…' : 'YES ✓'}</button>
                  <button onClick={() => skip(ci)} disabled={st?.approving} className="px-4 py-2.5 text-[10px] tracking-[0.14em] border border-[#E2E0DB] text-[#6B6B6B] rounded-full hover:border-[#0A0A0A] transition-colors disabled:opacity-50">SKIP</button>
                </div>
              )}
              {st?.error && <p className="mt-2 text-[8px] tracking-[0.10em] text-[#B83A3A]">{st.error.toUpperCase()}</p>}
            </div>
          )
        })}
      </div>

      {/* Swap / add modal */}
      {swap && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center pt-16 px-4" onClick={() => setSwap(null)}>
          <div data-lenis-prevent className="bg-white border border-[#E2E0DB] rounded-[12px] w-full max-w-3xl max-h-[80vh] overflow-y-auto p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-baseline justify-between mb-4 pb-3 border-b border-[#E2E0DB]">
              <p className="text-[10px] tracking-[0.16em] text-[#6B6B6B]">{swap.mode === 'add' ? 'ADD ITEM' : `SWAP · ${SLOT_LABEL[swap.slot] ?? swap.slot}`}</p>
              <button onClick={() => setSwap(null)} className="text-[#A8A8A4] hover:text-[#0A0A0A] text-[18px] leading-none">×</button>
            </div>
            <input value={swapQuery} onChange={(e) => runSwapQuery(e.target.value)} placeholder="SEARCH ANY ITEM BY NAME, BRAND OR TYPE…" className="w-full border border-[#E2E0DB] rounded-[10px] px-4 py-2.5 text-[11px] tracking-[0.08em] text-[#4A4E57] placeholder:text-[#A8A8A4] focus:outline-none focus:border-[#0A0A0A] mb-4" />
            {swapLoading ? (
              <p className="text-[10px] tracking-[0.16em] text-[#A8A8A4] py-8 text-center">LOADING…</p>
            ) : (
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
                {swapOptions.map((opt) => (
                  <button key={opt.item_id} onClick={() => performSwap(opt)} className="group text-left">
                    <div className="aspect-[3/4] rounded-[6px] overflow-hidden bg-[#F2F2F0]">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={thumbUrl(opt.image_url, 600)} alt="" className="w-full h-full object-cover group-hover:opacity-90" />
                    </div>
                    <p className="text-[8px] tracking-[0.08em] text-[#6B6B6B] mt-1 truncate">{(opt.brand_name ?? '').toUpperCase()}</p>
                    <p className="text-[9px] tracking-[0.04em] text-[#4A4E57] truncate">{opt.product_name}</p>
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
