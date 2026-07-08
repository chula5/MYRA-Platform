'use client'

import { useState } from 'react'
import { ingestAndComposeUrl, type IngestComposeResult } from './actions'
import { approveCandidate, rescoreCandidate, recordSkipDecision, recordSwap } from '@/app/admin/composer/actions'
import { getReviewSwapOptions, getReviewAddOptions, type ReviewItem } from '@/app/admin/outfit-review/actions'
import type { Slot } from '@/lib/composer'

const SLOT_LABEL: Record<string, string> = {
  outerwear: 'OUTERWEAR', top: 'TOP', bottom: 'BOTTOM', dress: 'DRESS',
  shoe: 'SHOES', bag: 'BAG', jewellery: 'JEWELLERY', accessory: 'ACCESSORY',
}

interface CandItem { slot: string; item_id: string; product_name: string; brand_name: string | null; image_url: string; compat: number }
interface CandState { approving?: boolean; approved?: boolean; discarded?: boolean; outfitId?: string; projectId?: string; error?: string }
type Block = Omit<IngestComposeResult, 'candidates'> & { candidates?: { candidateIndex: number; score: number; items: CandItem[] }[]; states: Record<number, CandState> }
type SwapTarget = { bi: number; ci: number; itemIdx: number; slot: string; mode: 'swap' | 'add' }

export default function IngestComposeClient() {
  const [urls, setUrls] = useState('')
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [blocks, setBlocks] = useState<Block[]>([])

  // Swap / add modal
  const [swap, setSwap] = useState<SwapTarget | null>(null)
  const [swapOptions, setSwapOptions] = useState<ReviewItem[]>([])
  const [swapQuery, setSwapQuery] = useState('')
  const [swapLoading, setSwapLoading] = useState(false)

  async function run() {
    const list = urls.split('\n').map((u) => u.trim()).filter(Boolean)
    if (!list.length || running) return
    setRunning(true)
    setProgress({ done: 0, total: list.length })
    for (let i = 0; i < list.length; i++) {
      const res = await ingestAndComposeUrl(list[i])
      setBlocks((prev) => [...prev, { ...res, states: {} } as Block])
      setProgress({ done: i + 1, total: list.length })
    }
    setRunning(false)
    setUrls('')
    setProgress(null)
  }

  function setState(bi: number, ci: number, patch: CandState) {
    setBlocks((prev) => prev.map((b, i) => (i === bi ? { ...b, states: { ...b.states, [ci]: { ...b.states[ci], ...patch } } } : b)))
  }
  function setItems(bi: number, ci: number, items: CandItem[], score?: number) {
    setBlocks((prev) => prev.map((b, i) => i === bi
      ? { ...b, candidates: b.candidates?.map((c, j) => (j === ci ? { ...c, items, score: score ?? c.score } : c)) }
      : b))
  }

  async function approve(bi: number, ci: number) {
    const block = blocks[bi]; const cand = block.candidates?.[ci]
    if (!cand || !block.item) return
    setState(bi, ci, { approving: true, error: undefined })
    // approveCandidate records the YES into the Style Brain automatically.
    const r: any = await approveCandidate(block.item.item_id, cand.items.map((x) => x.item_id), cand.items.map((x) => x.slot as Slot), { score: cand.score })
    if (r?.error) setState(bi, ci, { approving: false, error: r.error })
    else setState(bi, ci, { approved: true, outfitId: r.outfitId, projectId: r.projectId })
  }

  function skip(bi: number, ci: number) {
    const block = blocks[bi]; const cand = block.candidates?.[ci]
    setState(bi, ci, { discarded: true })
    // Feed the SKIP to the Style Brain as a negative signal.
    if (block?.item && cand) void recordSkipDecision(block.item.item_id, cand.items.map((x) => x.item_id), 'composer', cand.score)
  }

  async function openSwap(bi: number, ci: number, itemIdx: number, slot: string) {
    const block = blocks[bi]; if (!block.item) return
    setSwap({ bi, ci, itemIdx, slot, mode: 'swap' })
    setSwapQuery(''); setSwapLoading(true)
    const exclude = [block.item.item_id, ...(block.candidates?.[ci].items ?? []).map((x) => x.item_id)]
    const res = await getReviewSwapOptions(block.item.item_id, slot, exclude, '')
    setSwapOptions(res.options); setSwapLoading(false)
  }
  async function openAdd(bi: number, ci: number) {
    const block = blocks[bi]; if (!block.item) return
    setSwap({ bi, ci, itemIdx: -1, slot: '', mode: 'add' })
    setSwapQuery(''); setSwapLoading(true)
    const present = (block.candidates?.[ci].items ?? []).map((x) => x.slot)
    const exclude = [block.item.item_id, ...(block.candidates?.[ci].items ?? []).map((x) => x.item_id)]
    const res = await getReviewAddOptions(block.item.item_id, present, exclude, '')
    setSwapOptions(res.options); setSwapLoading(false)
  }
  async function runSwapQuery(q: string) {
    setSwapQuery(q); if (!swap) return
    const block = blocks[swap.bi]; if (!block.item) return
    setSwapLoading(true)
    const exclude = [block.item.item_id, ...(block.candidates?.[swap.ci].items ?? []).map((x) => x.item_id)]
    const res = swap.mode === 'add'
      ? await getReviewAddOptions(block.item.item_id, (block.candidates?.[swap.ci].items ?? []).map((x) => x.slot), exclude, q)
      : await getReviewSwapOptions(block.item.item_id, swap.slot, exclude, q)
    setSwapOptions(res.options); setSwapLoading(false)
  }
  async function removeItem(bi: number, ci: number, itemIdx: number) {
    const block = blocks[bi]; const cand = block.candidates?.[ci]
    if (!cand || !block.item) return
    const removed = cand.items[itemIdx]
    // Removing a piece is a "not this one here" signal for the Style Brain.
    if (removed) void recordSwap(block.item.item_id, removed.item_id, null)
    const items = cand.items.filter((_, i) => i !== itemIdx)
    setItems(bi, ci, items)
    const res: any = await rescoreCandidate(block.item.item_id, items.map((i) => ({ itemId: i.item_id, slot: i.slot as Slot })))
    if (typeof res?.score === 'number') setItems(bi, ci, items, res.score)
  }

  async function performSwap(opt: ReviewItem) {
    if (!swap) return
    const { bi, ci, itemIdx, mode } = swap
    const block = blocks[bi]; const cand = block.candidates?.[ci]; if (!cand || !block.item) return
    // A swap means you rejected the piece that was there for `opt` — record the
    // from→to detail for the Style Brain.
    if (mode === 'swap' && cand.items[itemIdx]) void recordSwap(block.item.item_id, cand.items[itemIdx].item_id, opt.item_id)
    const mapped: CandItem = { slot: opt.slot, item_id: opt.item_id, product_name: opt.product_name, brand_name: opt.brand_name, image_url: opt.image_url, compat: opt.compat }
    const items = mode === 'add' ? [...cand.items, mapped] : cand.items.map((it, i) => (i === itemIdx ? mapped : it))
    setItems(bi, ci, items)
    setSwap(null)
    const res: any = await rescoreCandidate(block.item.item_id, items.map((i) => ({ itemId: i.item_id, slot: i.slot as Slot })))
    if (typeof res?.score === 'number') setItems(bi, ci, items, res.score)
  }

  return (
    <div>
      {/* Input */}
      <div className="border border-[#E2E0DB] bg-white rounded-[12px] p-6 mb-10 max-w-[760px]">
        <p className="text-[10px] tracking-[0.099em] text-[#6B6B6B] mb-3">PRODUCT URLS · ONE PER LINE</p>
        <textarea
          value={urls}
          onChange={(e) => setUrls(e.target.value)}
          rows={4}
          placeholder={'https://www.net-a-porter.com/…\nhttps://www.matchesfashion.com/…'}
          className="w-full border border-[#E2E0DB] bg-[#FAFAF8] rounded-[10px] px-4 py-3 text-[12px] tracking-[0.03em] text-[#4A4E57] placeholder:text-[#A8A8A4] focus:outline-none focus:border-[#0A0A0A] mb-3"
        />
        <div className="flex items-center gap-4">
          <button onClick={run} disabled={running || !urls.trim()} className="bg-[#0A0A0A] text-white rounded-full px-7 py-3 text-[10px] tracking-[0.16em] hover:opacity-85 transition-opacity disabled:opacity-40">
            {running ? 'ADDING & COMPOSING…' : 'ADD & COMPOSE'}
          </button>
          {progress && <span className="text-[10px] tracking-[0.09em] text-[#A8A8A4]">{progress.done} / {progress.total} DONE</span>}
        </div>
        <p className="text-[9px] tracking-[0.054em] text-[#A8A8A4] mt-3 leading-relaxed">
          Each URL is scraped, AI-scored, saved as a READY item, then outfit options are composed against your
          library. Hover a piece to SWAP or remove it (×), use + ADD to add a bag/shoes/etc. YES saves a draft
          (Higgsfield shoot); YES &amp; SKIP both train the Style Brain.
        </p>
      </div>

      {/* Results */}
      <div className="space-y-10">
        {blocks.map((block, bi) => (
          <div key={bi} className="border border-[#E2E0DB] bg-white rounded-[14px] overflow-hidden">
            <div className="flex items-center gap-4 p-4 border-b border-[#E2E0DB] bg-[#FAFAF8]">
              {block.item?.image_url
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={block.item.image_url} alt="" className="w-16 h-20 flex-shrink-0 rounded-[8px] object-cover bg-[#F2F2F0]" />
                : <div className="w-16 h-20 flex-shrink-0 rounded-[8px] bg-[#F2F2F0]" />}
              <div className="flex-1 min-w-0">
                <p className="text-[9px] tracking-[0.18em] text-[#A8A8A4] mb-0.5">NEW ITEM{block.item?.item_type ? ` · ${block.item.item_type.replace(/_/g, ' ').toUpperCase()}` : ''}</p>
                <p className="text-[10px] tracking-[0.10em] text-[#6B6B6B]">{(block.item?.brand_name ?? '').toUpperCase()}</p>
                <p className="text-[13px] tracking-[0.04em] text-[#4A4E57] truncate">{(block.item?.product_name ?? block.sourceUrl).toUpperCase()}</p>
                {block.item?.price && <p className="text-[10px] tracking-[0.06em] text-[#6B6B6B] mt-0.5">{block.item.price}</p>}
              </div>
            </div>

            <div className="p-4">
              {block.error && <p className="text-[10px] tracking-[0.12em] text-[#B83A3A] py-4 text-center">{block.error.toUpperCase()}</p>}
              {!block.error && (!block.candidates || block.candidates.length === 0) && (
                <p className="text-[10px] tracking-[0.14em] text-[#A8A8A4] py-4 text-center">ITEM SAVED — NO BRAND-COHERENT COMBINATIONS FOUND YET.</p>
              )}

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {(block.candidates ?? []).map((c, ci) => {
                  const st = block.states[ci]
                  if (st?.discarded) return null
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
                            {block.item?.image_url && <img src={block.item.image_url} alt="" className="w-full h-full object-cover" />}
                          </div>
                          <span className="absolute top-1 left-1 bg-[#0A0A0A] text-white text-[7px] tracking-[0.10em] px-1 py-0.5 rounded">NEW</span>
                        </div>
                        {c.items.map((item, k) => (
                          <div key={`${item.item_id}-${k}`} className="relative group">
                            <div className="aspect-[3/4] rounded-[6px] overflow-hidden bg-[#F2F2F0]">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={item.image_url} alt="" className="w-full h-full object-cover" />
                              {editable && (
                                <button onClick={() => openSwap(bi, ci, k, item.slot)} className="absolute inset-0 bg-black/0 group-hover:bg-black/45 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                                  <span className="bg-white text-[#0A0A0A] text-[8px] tracking-[0.12em] px-2 py-1 rounded">SWAP</span>
                                </button>
                              )}
                              {editable && (
                                <button
                                  onClick={(e) => { e.stopPropagation(); removeItem(bi, ci, k) }}
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
                          <button onClick={() => openAdd(bi, ci)} className="aspect-[3/4] rounded-[6px] border border-dashed border-[#C9C7C2] flex flex-col items-center justify-center text-[#A8A8A4] hover:border-[#0A0A0A] hover:text-[#4A4E57] transition-colors">
                            <span className="text-[18px] leading-none">+</span>
                            <span className="text-[7px] tracking-[0.12em] mt-1">ADD</span>
                          </button>
                        )}
                      </div>

                      {st?.approved ? (
                        <div>
                          <a href={`/admin/projects/${st.projectId}/outfits/${st.outfitId}/edit`} className="block text-center bg-[#C4A882] text-white py-2.5 text-[10px] tracking-[0.16em] rounded-full">✓ YES → EDIT DRAFT</a>
                          <p className="mt-2 text-[8px] tracking-[0.10em] text-[#C4A882] leading-relaxed">✦ HIGGSFIELD SHOOT GENERATING IN THE BACKGROUND (~30–60S).</p>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <button onClick={() => approve(bi, ci)} disabled={st?.approving} className="flex-1 bg-[#0A0A0A] text-white py-2.5 text-[10px] tracking-[0.18em] rounded-full hover:opacity-85 transition-opacity disabled:opacity-50">{st?.approving ? 'CREATING…' : 'YES ✓'}</button>
                          <button onClick={() => skip(bi, ci)} disabled={st?.approving} className="px-4 py-2.5 text-[10px] tracking-[0.14em] border border-[#E2E0DB] text-[#6B6B6B] rounded-full hover:border-[#0A0A0A] transition-colors disabled:opacity-50">SKIP</button>
                        </div>
                      )}
                      {st?.error && <p className="mt-2 text-[8px] tracking-[0.10em] text-[#B83A3A]">{st.error.toUpperCase()}</p>}
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Swap / add modal */}
      {swap && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center pt-16 px-4" onClick={() => setSwap(null)}>
          <div className="bg-white border border-[#E2E0DB] rounded-[12px] w-full max-w-3xl max-h-[80vh] overflow-y-auto p-5" onClick={(e) => e.stopPropagation()}>
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
                      <img src={opt.image_url} alt="" className="w-full h-full object-cover group-hover:opacity-90" />
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
