'use client'

import { useState } from 'react'
import { thumbUrl } from '@/lib/image-utils'
import { swapOutfitItemForStock, type StockOutfit, type StockOutfitItem } from './stock-impact'
import { generateHiggsfieldShootForOutfit } from '@/app/admin/projects/higgsfield-actions'
import type { ReviewItem } from '@/app/admin/outfit-review/actions'

const SLOT_LABEL: Record<string, string> = {
  outerwear: 'OUTERWEAR', top: 'TOP', bottom: 'BOTTOM', dress: 'DRESS',
  shoe: 'SHOES', bag: 'BAG', jewellery: 'JEWELLERY', accessory: 'ACCESSORY',
}

// Status change + swap search via route handlers (not server actions) so they
// keep working while a Refined shoot is generating.
async function postStatus(projectId: string, outfitIds: string[], status: 'live' | 'draft') {
  try {
    const r = await fetch('/api/admin/set-outfit-status', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId, outfitIds, status }),
    })
    if (!r.ok) return { error: `Failed (${r.status})` }
    return await r.json() as { error?: string }
  } catch (err) { return { error: err instanceof Error ? err.message : 'Failed' } }
}
async function fetchSwapOptions(anchor: string, slot: string, exclude: string[], q: string): Promise<ReviewItem[]> {
  const sp = new URLSearchParams({ mode: 'swap', anchor, slot, q, exclude: exclude.join(',') })
  try {
    const r = await fetch(`/api/admin/review-options?${sp.toString()}`, { cache: 'no-store' })
    if (!r.ok) return []
    return (await r.json()).options ?? []
  } catch { return [] }
}

function StockBadge({ status }: { status: StockOutfitItem['stock_status'] }) {
  if (status === 'out_of_stock') return <span className="text-[7px] tracking-[0.08em] text-[#B83A3A]">OUT OF STOCK</span>
  if (status === 'low_stock') return <span className="text-[7px] tracking-[0.08em] text-[#8B5E00]">LOW STOCK</span>
  if (status === 'in_stock') return <span className="text-[7px] tracking-[0.08em] text-[#3D7A50]">IN STOCK</span>
  return <span className="text-[7px] tracking-[0.08em] text-[#A8A8A4]">UNCHECKED</span>
}

type SwapTarget = { outfitId: string; outfitItemId: string; slot: string; anchor: string; exclude: string[] }

export default function StockImpactClient({ outfits: initial }: { outfits: StockOutfit[] }) {
  const [outfits, setOutfits] = useState<StockOutfit[]>(initial)
  const [statusOverride, setStatusOverride] = useState<Record<string, string>>({})
  const [busyStatus, setBusyStatus] = useState<string | null>(null)
  const [changed, setChanged] = useState<Set<string>>(new Set())
  const [refining, setRefining] = useState<Set<string>>(new Set())
  const [imageOverride, setImageOverride] = useState<Record<string, string>>({})
  const [msg, setMsg] = useState<Record<string, string>>({})

  // Swap modal
  const [swap, setSwap] = useState<SwapTarget | null>(null)
  const [swapOptions, setSwapOptions] = useState<ReviewItem[]>([])
  const [swapQuery, setSwapQuery] = useState('')
  const [swapLoading, setSwapLoading] = useState(false)

  function recompute(o: StockOutfit): StockOutfit {
    return { ...o, hasOut: o.items.some((it) => it.stock_status === 'out_of_stock'), hasLow: o.items.some((it) => it.stock_status === 'low_stock') }
  }

  async function toggleStatus(o: StockOutfit) {
    if (!o.project_id || busyStatus) return
    const current = statusOverride[o.outfit_id] ?? o.status
    const next = current === 'live' ? 'draft' : 'live'
    setBusyStatus(o.outfit_id)
    setStatusOverride((p) => ({ ...p, [o.outfit_id]: next }))
    const res = await postStatus(o.project_id, [o.outfit_id], next)
    setBusyStatus(null)
    if (res.error) { setStatusOverride((p) => ({ ...p, [o.outfit_id]: current })); setMsg((m) => ({ ...m, [o.outfit_id]: res.error! })) }
  }

  async function openSwap(o: StockOutfit, item: StockOutfitItem) {
    const anchor = o.items.find((it) => it.stock_status === 'in_stock' && it.item_id !== item.item_id)?.item_id
      ?? o.items.find((it) => it.item_id !== item.item_id)?.item_id
      ?? item.item_id
    const exclude = o.items.map((it) => it.item_id)
    setSwap({ outfitId: o.outfit_id, outfitItemId: item.outfit_item_id, slot: item.slot, anchor, exclude })
    setSwapQuery(''); setSwapLoading(true)
    setSwapOptions(await fetchSwapOptions(anchor, item.slot, exclude, ''))
    setSwapLoading(false)
  }
  async function runSwapQuery(q: string) {
    setSwapQuery(q); if (!swap) return
    setSwapLoading(true)
    setSwapOptions(await fetchSwapOptions(swap.anchor, swap.slot, swap.exclude, q))
    setSwapLoading(false)
  }
  async function performSwap(opt: ReviewItem) {
    if (!swap) return
    const target = swap
    setSwap(null)
    const res = await swapOutfitItemForStock(target.outfitId, target.outfitItemId, opt.item_id, target.slot)
    if (res.error) { setMsg((m) => ({ ...m, [target.outfitId]: res.error! })); return }
    // Replace the item in local state; the swapped-in piece is assumed in stock.
    setOutfits((prev) => prev.map((o) => {
      if (o.outfit_id !== target.outfitId) return o
      const items = o.items.map((it) => it.outfit_item_id === target.outfitItemId
        ? { outfit_item_id: it.outfit_item_id, item_id: opt.item_id, slot: opt.slot, product_name: opt.product_name, brand_name: opt.brand_name, image_url: opt.image_url, stock_status: 'in_stock' as const }
        : it)
      return recompute({ ...o, items })
    }))
    setChanged((s) => new Set(s).add(target.outfitId))
  }

  async function refine(outfitId: string) {
    if (refining.has(outfitId)) return
    setRefining((s) => new Set(s).add(outfitId))
    setMsg((m) => { const n = { ...m }; delete n[outfitId]; return n })
    try {
      const res: any = await generateHiggsfieldShootForOutfit(outfitId, 'E5')
      if (res?.error) setMsg((m) => ({ ...m, [outfitId]: res.error }))
      else if (res?.imageUrl) { setImageOverride((p) => ({ ...p, [outfitId]: res.imageUrl })); setChanged((s) => { const n = new Set(s); n.delete(outfitId); return n }) }
    } catch (err: any) {
      setMsg((m) => ({ ...m, [outfitId]: err?.message ?? 'Refine failed' }))
    } finally {
      setRefining((s) => { const n = new Set(s); n.delete(outfitId); return n })
    }
  }

  if (outfits.length === 0) {
    return (
      <div className="border border-dashed border-[#E2E0DB] rounded-[12px] py-16 text-center">
        <p className="text-[11px] tracking-[0.1em] text-[#6B6B6B]">NO OUTFITS AFFECTED BY STOCK</p>
        <p className="mt-2 text-[9px] tracking-[0.06em] text-[#A8A8A4]">RUN A STOCK CHECK ON THE ITEM LIBRARY FIRST, THEN COME BACK HERE.</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {outfits.map((o) => {
        const status = statusOverride[o.outfit_id] ?? o.status
        const isLive = status === 'live'
        const isChanged = changed.has(o.outfit_id)
        const isRefining = refining.has(o.outfit_id)
        return (
          <div key={o.outfit_id} className={`border rounded-[14px] overflow-hidden bg-white ${o.hasOut ? 'border-[#E8B4B4]' : 'border-[#E2E0DB]'}`}>
            <div className="flex flex-col sm:flex-row">
              {/* Outfit image */}
              <div className="relative sm:w-48 flex-shrink-0 aspect-[3/4] sm:aspect-auto bg-[#F2F2F0] overflow-hidden">
                {(imageOverride[o.outfit_id] ?? o.image_url)
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={thumbUrl(imageOverride[o.outfit_id] ?? o.image_url!, 600)} alt="" loading="lazy" className="w-full h-full object-cover" />
                  : <div className="w-full h-full flex items-center justify-center"><span className="text-[9px] tracking-[0.1em] text-[#A8A8A4]">NO IMAGE</span></div>}
                {isRefining && (
                  <div className="absolute inset-0 bg-white/75 flex flex-col items-center justify-center gap-2">
                    <div className="w-6 h-6 border-2 border-[#C4A882] border-t-transparent rounded-full animate-spin" />
                    <span className="text-[9px] tracking-[0.12em] text-[#4A4E57]">REFINING…</span>
                  </div>
                )}
              </div>

              {/* Body */}
              <div className="flex-1 min-w-0 p-4">
                <div className="flex items-center justify-between gap-3 mb-3">
                  <div className="min-w-0">
                    <p className="text-[12px] tracking-[0.05em] text-[#4A4E57] truncate">{o.aesthetic_label?.toUpperCase() || 'OUTFIT'}</p>
                    <p className="text-[8px] tracking-[0.1em] mt-0.5">
                      {o.hasOut ? <span className="text-[#B83A3A]">CONTAINS OUT-OF-STOCK</span> : <span className="text-[#8B5E00]">CONTAINS LOW STOCK</span>}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className={`text-[8px] tracking-[0.1em] px-2 py-1 rounded-full border ${isLive ? 'bg-[#EAF3EC] border-[#BBD9C2] text-[#3D7A50]' : 'bg-[#FAFAF8] border-[#E2E0DB] text-[#6B6B6B]'}`}>
                      {isLive ? 'LIVE' : status.toUpperCase()}
                    </span>
                    {o.project_id && (
                      <button
                        onClick={() => toggleStatus(o)}
                        disabled={busyStatus === o.outfit_id}
                        className="text-[8px] tracking-[0.1em] px-3 py-1 rounded-full border border-[#0A0A0A] text-[#4A4E57] hover:bg-[#0A0A0A] hover:text-white transition-colors disabled:opacity-40"
                      >
                        {busyStatus === o.outfit_id ? '…' : isLive ? 'PULL TO DRAFT' : 'SET LIVE'}
                      </button>
                    )}
                  </div>
                </div>

                {/* Items */}
                <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                  {o.items.map((it) => {
                    const flagged = it.stock_status === 'out_of_stock' || it.stock_status === 'low_stock'
                    return (
                      <div key={it.outfit_item_id} className={`rounded-[8px] p-1.5 ${flagged ? 'bg-[#FDECEC]' : ''}`}>
                        <div className="relative aspect-[3/4] rounded-[6px] overflow-hidden bg-[#F2F2F0]">
                          {it.image_url
                            // eslint-disable-next-line @next/next/no-img-element
                            ? <img src={thumbUrl(it.image_url, 400)} alt="" loading="lazy" className="w-full h-full object-cover" />
                            : <div className="w-full h-full" />}
                          {flagged && (
                            <button
                              onClick={() => openSwap(o, it)}
                              className="absolute inset-0 bg-black/0 hover:bg-black/45 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity"
                            >
                              <span className="bg-white text-[#0A0A0A] text-[8px] tracking-[0.12em] px-2 py-1 rounded">SWAP</span>
                            </button>
                          )}
                        </div>
                        <p className="text-[7px] tracking-[0.08em] text-[#A8A8A4] mt-1 truncate">{SLOT_LABEL[it.slot] ?? it.slot}</p>
                        <StockBadge status={it.stock_status} />
                      </div>
                    )
                  })}
                </div>

                {/* Actions */}
                <div className="flex items-center gap-3 mt-3 flex-wrap">
                  <button
                    onClick={() => refine(o.outfit_id)}
                    disabled={isRefining}
                    className={`inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-[9px] tracking-[0.1em] transition-colors disabled:opacity-40 ${
                      isChanged ? 'bg-[#C4A882] text-white hover:opacity-85' : 'border border-[#C4A882] text-[#8A7A4E] hover:bg-[#FBF6EA]'
                    }`}
                  >
                    {isRefining ? 'REFINING…' : '✦ REFINE SHOOT'}
                  </button>
                  {isChanged && <span className="text-[8px] tracking-[0.08em] text-[#3D7A50]">SWAPPED — REGENERATE THE IMAGE</span>}
                  {o.project_id && (
                    <a href={`/admin/projects/${o.project_id}/outfits/${o.outfit_id}/edit`} className="text-[8px] tracking-[0.1em] text-[#6B6B6B] hover:text-[#0A0A0A]">OPEN OUTFIT →</a>
                  )}
                  {msg[o.outfit_id] && <span className="text-[8px] tracking-[0.08em] text-[#B83A3A]">{msg[o.outfit_id].toUpperCase()}</span>}
                </div>
              </div>
            </div>
          </div>
        )
      })}

      {/* Swap modal */}
      {swap && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center pt-16 px-4" onClick={() => setSwap(null)}>
          <div className="bg-white border border-[#E2E0DB] rounded-[12px] w-full max-w-3xl max-h-[80vh] overflow-y-auto p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-baseline justify-between mb-4 pb-3 border-b border-[#E2E0DB]">
              <p className="text-[10px] tracking-[0.16em] text-[#6B6B6B]">SWAP · {SLOT_LABEL[swap.slot] ?? swap.slot}</p>
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
