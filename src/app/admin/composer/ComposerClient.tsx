'use client'

import { useState, useTransition, useEffect, useRef } from 'react'
import {
  composeForAnchor,
  searchAnchorItems,
  approveCandidate,
  getSwapOptions,
  rescoreCandidate,
  type ComposedCandidatePayload,
  type SlotPlanPayload,
  type SwapOption,
} from './actions'

type Slot = 'outerwear' | 'top' | 'bottom' | 'dress' | 'shoe' | 'bag' | 'jewellery' | 'accessory'

type CandidateItem = ComposedCandidatePayload['items'][number]

interface AnchorItem {
  item_id: string
  product_name: string
  image_url: string
  item_type: string
  brand_name: string | null
}

interface ComposerClientProps {
  initialAnchorId: string | null
  initialAnchor: AnchorItem | null
  initialItems: AnchorItem[]
  libraryCount: number
}

const SLOT_LABEL: Record<string, string> = {
  outerwear: 'OUTERWEAR',
  top: 'TOP',
  bottom: 'BOTTOM',
  dress: 'DRESS',
  shoe: 'SHOE',
  bag: 'BAG',
  jewellery: 'JEWELLERY',
  accessory: 'ACCESSORY',
}

// Map an item_type to its slot. Mirrors composer.ts so we don't have to wait
// on the server response to decide which slots are optional.
const ITEM_TYPE_TO_SLOT_CLIENT: Record<string, Slot> = {
  coat: 'outerwear', trench: 'outerwear', jacket: 'outerwear',
  blazer: 'outerwear', gilet: 'outerwear', cape: 'outerwear',
  shirt: 'top', blouse: 'top', 't-shirt': 'top',
  knitwear: 'top', corset: 'top', bodysuit: 'top',
  trousers: 'bottom', jeans: 'bottom', shorts: 'bottom', skirt: 'bottom',
  mini_dress: 'dress', midi_dress: 'dress', maxi_dress: 'dress',
  shirt_dress: 'dress', slip_dress: 'dress',
  boot: 'shoe', heel: 'shoe', flat: 'shoe',
  sneaker: 'shoe', mule: 'shoe', sandal: 'shoe',
  tote: 'bag', shoulder_bag: 'bag', clutch: 'bag',
  crossbody: 'bag', structured_bag: 'bag',
  belt: 'accessory', scarf: 'accessory', hat: 'accessory',
  gloves: 'accessory', sunglasses: 'accessory', hair_accessory: 'accessory',
  necklace: 'jewellery', earrings: 'jewellery', bracelet: 'jewellery',
  ring: 'jewellery', brooch: 'jewellery',
}

function deriveSlotPlanFromItemType(itemType: string): { required: Slot[]; optional: Slot[] } {
  const anchorSlot = ITEM_TYPE_TO_SLOT_CLIENT[itemType] ?? 'top'
  switch (anchorSlot) {
    case 'dress':
      return { required: ['shoe'], optional: ['outerwear', 'bag', 'jewellery'] }
    case 'top':
      return { required: ['bottom', 'shoe'], optional: ['outerwear', 'bag', 'jewellery'] }
    case 'bottom':
      return { required: ['top', 'shoe'], optional: ['outerwear', 'bag', 'jewellery'] }
    case 'outerwear':
      return { required: ['top', 'bottom', 'shoe'], optional: ['bag', 'jewellery'] }
    case 'shoe':
      return { required: ['top', 'bottom'], optional: ['outerwear', 'bag', 'jewellery'] }
    case 'bag':
      return { required: ['top', 'bottom', 'shoe'], optional: ['outerwear', 'jewellery'] }
    case 'jewellery':
    case 'accessory':
      return { required: ['top', 'bottom', 'shoe'], optional: ['outerwear', 'bag'] }
  }
}

export default function ComposerClient({
  initialAnchor,
  initialItems,
  libraryCount,
}: ComposerClientProps) {
  const [anchor, setAnchor] = useState<AnchorItem | null>(initialAnchor)
  const [searchOpen, setSearchOpen] = useState(initialAnchor === null)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<AnchorItem[]>(initialItems)
  const [searching, startSearch] = useTransition()
  const [composing, startCompose] = useTransition()
  const [candidates, setCandidates] = useState<ComposedCandidatePayload[]>([])
  const [error, setError] = useState<string | null>(null)
  const [approvalState, setApprovalState] = useState<Record<number, { approving: boolean; approved: boolean; outfitId?: string; projectId?: string }>>({})
  const [dismissed, setDismissed] = useState<Set<number>>(new Set())
  const [slotPlan, setSlotPlan] = useState<SlotPlanPayload | null>(null)
  // Per-candidate edits — if present, these override the original server items/score
  const [edits, setEdits] = useState<Record<number, CandidateItem[]>>({})
  const [editScores, setEditScores] = useState<Record<number, number>>({})
  const [rescoring, setRescoring] = useState<Record<number, boolean>>({})
  // Swap modal state
  const [swap, setSwap] = useState<{ candidateIdx: number; itemIdx: number | null; slot: Slot } | null>(null)
  const [swapOptions, setSwapOptions] = useState<SwapOption[]>([])
  const [swapLoading, setSwapLoading] = useState(false)
  const [swapQuery, setSwapQuery] = useState('')
  const swapDebounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Auto-compose if landed with an anchor in the URL
  useEffect(() => {
    if (initialAnchor && candidates.length === 0) {
      compose(initialAnchor.item_id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function compose(anchorId: string) {
    setError(null)
    startCompose(async () => {
      const res = await composeForAnchor(anchorId)
      if (res.error) {
        setError(res.error)
        setCandidates([])
        setSlotPlan(null)
        return
      }
      setCandidates(res.candidates ?? [])
      setSlotPlan(res.slotPlan ?? null)
      setApprovalState({})
      setDismissed(new Set())
      setEdits({})
      setEditScores({})
    })
  }

  function itemsFor(idx: number, candidate: ComposedCandidatePayload): CandidateItem[] {
    return edits[idx] ?? candidate.items
  }

  function scoreFor(idx: number, candidate: ComposedCandidatePayload): number {
    return editScores[idx] ?? candidate.score
  }

  function effectivePlan(): { required: Slot[]; optional: Slot[] } {
    if (slotPlan) return { required: slotPlan.required, optional: slotPlan.optional }
    if (anchor) return deriveSlotPlanFromItemType(anchor.item_type)
    return { required: [], optional: [] }
  }

  function isOptionalSlot(slot: Slot): boolean {
    return effectivePlan().optional.includes(slot)
  }

  function slotsNotFilled(idx: number, candidate: ComposedCandidatePayload): Slot[] {
    const plan = effectivePlan()
    if (plan.optional.length === 0) return []
    const filled = new Set(itemsFor(idx, candidate).map((i) => i.slot as Slot))
    return plan.optional.filter((s) => !filled.has(s))
  }

  // Shared fetch for the swap/add picker. `query` empty → relevant same-slot
  // suggestions; non-empty → search the whole library across every slot.
  async function fetchSwapOptions(slot: Slot, excludeIds: string[], query: string) {
    if (!anchor) { setSwapLoading(false); return }
    setSwapLoading(true)
    const res = await getSwapOptions(anchor.item_id, slot, excludeIds, query)
    setSwapOptions(res.options ?? [])
    setSwapLoading(false)
  }

  async function openSwap(candidateIdx: number, itemIdx: number, slot: Slot) {
    setSwap({ candidateIdx, itemIdx, slot })
    setSwapQuery('')
    setSwapOptions([])
    const candidate = candidates[candidateIdx]
    const current = itemsFor(candidateIdx, candidate)
    await fetchSwapOptions(slot, current.map((i) => i.item_id), '')
  }

  async function openAddSlot(candidateIdx: number, slot: Slot) {
    setSwap({ candidateIdx, itemIdx: null, slot })
    setSwapQuery('')
    setSwapOptions([])
    const candidate = candidates[candidateIdx]
    const current = itemsFor(candidateIdx, candidate)
    await fetchSwapOptions(slot, current.map((i) => i.item_id), '')
  }

  // Debounced search inside the swap picker — searches the full library.
  function onSwapQueryChange(q: string) {
    setSwapQuery(q)
    if (!swap) return
    const candidate = candidates[swap.candidateIdx]
    const current = itemsFor(swap.candidateIdx, candidate)
    const excludeIds = current.map((i) => i.item_id)
    if (swapDebounce.current) clearTimeout(swapDebounce.current)
    swapDebounce.current = setTimeout(() => {
      fetchSwapOptions(swap.slot, excludeIds, q)
    }, 220)
  }

  async function performSwap(option: SwapOption) {
    if (!swap || !anchor) return
    const candidate = candidates[swap.candidateIdx]
    const current = itemsFor(swap.candidateIdx, candidate)
    const replacement: CandidateItem = {
      // Use the picked item's OWN slot so a cross-slot pick lands correctly.
      slot: option.slot,
      item_id: option.item_id,
      product_name: option.product_name,
      brand_name: option.brand_name,
      image_url: option.image_url,
      compat: option.compat,
    }
    const next =
      swap.itemIdx === null
        ? [...current, replacement] // adding a new slot
        : current.map((it, i) => (i === swap.itemIdx ? replacement : it))
    setEdits((e) => ({ ...e, [swap.candidateIdx]: next }))
    setSwap(null)
    setSwapOptions([])
    await applyRescore(swap.candidateIdx, next)
  }

  async function removeItem(candidateIdx: number, itemIdx: number) {
    if (!anchor) return
    const candidate = candidates[candidateIdx]
    const current = itemsFor(candidateIdx, candidate)
    const next = current.filter((_, i) => i !== itemIdx)
    setEdits((e) => ({ ...e, [candidateIdx]: next }))
    await applyRescore(candidateIdx, next)
  }

  async function applyRescore(candidateIdx: number, items: CandidateItem[]) {
    if (!anchor) return
    setRescoring((r) => ({ ...r, [candidateIdx]: true }))
    const res = await rescoreCandidate(
      anchor.item_id,
      items.map((i) => ({ itemId: i.item_id, slot: i.slot })),
    )
    setRescoring((r) => ({ ...r, [candidateIdx]: false }))
    if (res.score === undefined) return
    setEditScores((s) => ({ ...s, [candidateIdx]: res.score! }))
    // Also update per-item compats so the detail strip shows fresh numbers
    setEdits((e) => {
      const list = e[candidateIdx]
      if (!list) return e
      return {
        ...e,
        [candidateIdx]: list.map((it) => ({
          ...it,
          compat: res.itemCompat?.[it.item_id] ?? it.compat,
        })),
      }
    })
  }

  function pickAnchor(item: AnchorItem) {
    setAnchor(item)
    setSearchOpen(false)
    setSearchQuery('')
    compose(item.item_id)
  }

  function runSearch(q: string) {
    setSearchQuery(q)
    startSearch(async () => {
      const res = await searchAnchorItems(q)
      if (res.data) setSearchResults(res.data)
    })
  }

  async function approve(candidateIdx: number, candidate: ComposedCandidatePayload) {
    if (!anchor) return
    const items = itemsFor(candidateIdx, candidate)
    setApprovalState(s => ({ ...s, [candidateIdx]: { approving: true, approved: false } }))
    const res = await approveCandidate(
      anchor.item_id,
      items.map(i => i.item_id),
      items.map(i => i.slot),
    )
    if (res.error) {
      setApprovalState(s => ({ ...s, [candidateIdx]: { approving: false, approved: false } }))
      setError(res.error)
      return
    }
    setApprovalState(s => ({
      ...s,
      [candidateIdx]: { approving: false, approved: true, outfitId: res.outfitId, projectId: res.projectId },
    }))
  }

  function discard(candidateIdx: number) {
    setDismissed(s => {
      const next = new Set(Array.from(s))
      next.add(candidateIdx)
      return next
    })
  }

  const visibleCandidates = candidates.filter((_, i) => !dismissed.has(i))

  return (
    <div>
      {/* Anchor strip */}
      <div className="bg-white border border-[#E2E0DB] mb-8 p-6 flex items-start gap-6">
        <div className="w-32 h-40 flex-shrink-0 bg-[#F2F2F0] overflow-hidden">
          {anchor ? (
            <img src={anchor.image_url} alt={anchor.product_name} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <span className="text-[9px] tracking-[0.20em] text-[#A8A8A4]">NO ANCHOR</span>
            </div>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[10px] tracking-[0.25em] text-[#6B6B6B] mb-2">ANCHOR ITEM</p>
          {anchor ? (
            <>
              <p className="text-[11px] tracking-[0.20em] text-[#A8A8A4] mb-1">
                {(anchor.brand_name ?? '—').toUpperCase()}
              </p>
              <p className="text-[18px] tracking-[0.08em] text-[#0A0A0A] mb-2">
                {anchor.product_name.toUpperCase()}
              </p>
              <p className="text-[10px] tracking-[0.20em] text-[#6B6B6B]">
                {anchor.item_type.replace(/_/g, ' ').toUpperCase()}
              </p>
            </>
          ) : (
            <p className="text-[13px] tracking-[0.10em] text-[#6B6B6B]">
              PICK AN ITEM FROM YOUR LIBRARY TO ANCHOR THE COMPOSITION.
            </p>
          )}
          <div className="mt-4 flex items-center gap-3">
            <button
              type="button"
              onClick={() => setSearchOpen(o => !o)}
              className="bg-[#0A0A0A] text-white px-6 py-2.5 text-[10px] tracking-[0.20em] hover:bg-[#333] transition-colors duration-300"
            >
              {anchor ? 'CHANGE ANCHOR' : 'PICK ANCHOR'}
            </button>
            {anchor && (
              <button
                type="button"
                onClick={() => compose(anchor.item_id)}
                disabled={composing}
                className="border border-[#0A0A0A] text-[#0A0A0A] px-6 py-2.5 text-[10px] tracking-[0.20em] hover:bg-[#0A0A0A] hover:text-white transition-colors duration-300 disabled:opacity-50"
              >
                {composing ? 'COMPOSING…' : 'RECOMPOSE'}
              </button>
            )}
            <span className="text-[10px] tracking-[0.20em] text-[#A8A8A4]">
              LIBRARY: {libraryCount} READY/LIVE ITEMS
            </span>
          </div>
        </div>
      </div>

      {/* Anchor picker drawer */}
      {searchOpen && (
        <div className="bg-white border border-[#E2E0DB] mb-8 p-6">
          <p className="text-[10px] tracking-[0.25em] text-[#6B6B6B] mb-4">SELECT ANCHOR</p>
          <input
            type="text"
            placeholder="SEARCH BY PRODUCT NAME"
            value={searchQuery}
            onChange={(e) => runSearch(e.target.value)}
            className="w-full border border-[#E2E0DB] bg-white px-4 py-2.5 text-[12px] tracking-[0.10em] text-[#0A0A0A] focus:outline-none focus:border-[#0A0A0A] mb-4"
          />
          <div className="grid grid-cols-6 gap-3 max-h-[480px] overflow-y-auto">
            {searching && searchResults.length === 0 && (
              <p className="col-span-6 text-[10px] tracking-[0.20em] text-[#A8A8A4]">SEARCHING…</p>
            )}
            {searchResults.length === 0 && !searching && (
              <p className="col-span-6 text-[10px] tracking-[0.20em] text-[#A8A8A4]">NO MATCHES</p>
            )}
            {searchResults.map((item) => (
              <button
                key={item.item_id}
                type="button"
                onClick={() => pickAnchor(item)}
                className="group text-left"
              >
                <div className="aspect-[3/4] bg-[#F2F2F0] overflow-hidden mb-2 group-hover:opacity-85 transition-opacity">
                  {item.image_url ? (
                    <img src={item.image_url} alt={item.product_name} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <span className="text-[9px] tracking-[0.15em] text-[#A8A8A4]">NO IMAGE</span>
                    </div>
                  )}
                </div>
                <p className="text-[9px] tracking-[0.20em] text-[#A8A8A4] truncate">
                  {(item.brand_name ?? '—').toUpperCase()}
                </p>
                <p className="text-[10px] tracking-[0.10em] text-[#0A0A0A] truncate">
                  {item.product_name.toUpperCase()}
                </p>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="mb-6 p-4 border border-[#E8B4B4] bg-[#FDECEC]">
          <p className="text-[10px] tracking-[0.20em] text-[#B83A3A]">{error.toUpperCase()}</p>
        </div>
      )}

      {/* Candidates */}
      {composing && (
        <div className="py-20 text-center">
          <p className="text-[11px] tracking-[0.25em] text-[#A8A8A4]">COMPOSING…</p>
        </div>
      )}

      {!composing && anchor && visibleCandidates.length === 0 && candidates.length === 0 && !error && (
        <div className="py-20 text-center">
          <p className="text-[11px] tracking-[0.25em] text-[#A8A8A4]">
            NO COMPATIBLE COMPOSITIONS FOUND IN THE CURRENT LIBRARY.
          </p>
          <p className="text-[10px] tracking-[0.20em] text-[#A8A8A4] mt-2">
            ADD MORE READY/LIVE ITEMS OR PICK A DIFFERENT ANCHOR.
          </p>
        </div>
      )}

      {!composing && visibleCandidates.length > 0 && (
        <div>
          <div className="flex items-baseline justify-between mb-6">
            <p className="text-[10px] tracking-[0.25em] text-[#6B6B6B]">
              {visibleCandidates.length} CANDIDATE COMPOSITION{visibleCandidates.length === 1 ? '' : 'S'}
            </p>
            <p className="text-[9px] tracking-[0.20em] text-[#A8A8A4]">
              RANKED BY COMPOSITIONAL COHERENCE
            </p>
          </div>
          <div className="grid grid-cols-2 gap-6">
            {candidates.map((candidate, idx) => {
              if (dismissed.has(idx)) return null
              const state = approvalState[idx]
              const items = itemsFor(idx, candidate)
              const score = scoreFor(idx, candidate)
              const isEdited = !!edits[idx]
              const missingOptionalSlots = slotsNotFilled(idx, candidate)
              const isRescoring = !!rescoring[idx]
              return (
                <div key={idx} className="bg-white border border-[#E2E0DB] p-5">
                  <div className="flex items-baseline justify-between mb-4">
                    <p className="text-[10px] tracking-[0.25em] text-[#0A0A0A]">
                      COMPOSITION {String(idx + 1).padStart(2, '0')}
                      {isEdited && (
                        <span className="ml-2 text-[9px] tracking-[0.20em] text-[#C4A882]">EDITED</span>
                      )}
                    </p>
                    <p className="text-[9px] tracking-[0.20em] text-[#A8A8A4]">
                      {isRescoring ? 'RESCORING…' : `COHERENCE ${(score * 100).toFixed(0)}`}
                    </p>
                  </div>

                  {/* Item grid: anchor + additions */}
                  <div className="grid grid-cols-4 gap-2 mb-5">
                    {anchor && (
                      <div className="relative">
                        <div className="aspect-[3/4] bg-[#F2F2F0] overflow-hidden">
                          <img src={anchor.image_url} alt={anchor.product_name} className="w-full h-full object-cover" />
                        </div>
                        <div className="absolute top-1 left-1 bg-[#0A0A0A] text-white px-1.5 py-0.5 text-[8px] tracking-[0.15em]">
                          ANCHOR
                        </div>
                        <p className="text-[8px] tracking-[0.15em] text-[#A8A8A4] mt-1 truncate">
                          {(anchor.brand_name ?? '—').toUpperCase()}
                        </p>
                      </div>
                    )}
                    {items.map((item, itemIdx) => {
                      const optional = isOptionalSlot(item.slot as Slot)
                      return (
                        <div key={`${item.item_id}-${itemIdx}`} className="relative group">
                          <div className="aspect-[3/4] bg-[#F2F2F0] overflow-hidden">
                            {item.image_url ? (
                              <img src={item.image_url} alt={item.product_name} className="w-full h-full object-cover" />
                            ) : (
                              <div className="w-full h-full" />
                            )}
                          </div>
                          {/* Hover overlay with actions */}
                          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors duration-200 flex flex-col items-center justify-center gap-1 opacity-0 group-hover:opacity-100">
                            <button
                              type="button"
                              onClick={() => openSwap(idx, itemIdx, item.slot as Slot)}
                              className="bg-white text-[#0A0A0A] px-2 py-1 text-[9px] tracking-[0.20em] hover:bg-[#0A0A0A] hover:text-white transition-colors"
                            >
                              SWAP
                            </button>
                            {optional && (
                              <button
                                type="button"
                                onClick={() => removeItem(idx, itemIdx)}
                                className="bg-white/90 text-[#0A0A0A] px-2 py-1 text-[9px] tracking-[0.20em] hover:bg-[#0A0A0A] hover:text-white transition-colors"
                              >
                                REMOVE
                              </button>
                            )}
                          </div>
                          <p className="text-[8px] tracking-[0.20em] text-[#6B6B6B] mt-1">
                            {SLOT_LABEL[item.slot] ?? item.slot.toUpperCase()}
                          </p>
                          <p className="text-[8px] tracking-[0.15em] text-[#A8A8A4] truncate">
                            {(item.brand_name ?? '—').toUpperCase()}
                          </p>
                        </div>
                      )
                    })}
                  </div>

                  {/* Missing optional slots — add buttons */}
                  {missingOptionalSlots.length > 0 && (
                    <div className="flex flex-wrap items-center gap-2 mb-5">
                      <span className="text-[9px] tracking-[0.20em] text-[#A8A8A4]">ADD:</span>
                      {missingOptionalSlots.map((slot) => (
                        <button
                          key={slot}
                          type="button"
                          onClick={() => openAddSlot(idx, slot)}
                          className="border border-[#E2E0DB] text-[#6B6B6B] px-2 py-1 text-[9px] tracking-[0.20em] hover:border-[#0A0A0A] hover:text-[#0A0A0A] transition-colors"
                        >
                          + {SLOT_LABEL[slot] ?? slot.toUpperCase()}
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Detail strip */}
                  <div className="border-t border-[#E2E0DB] pt-3 mb-4 space-y-1">
                    {items.map((item, itemIdx) => (
                      <div key={`${item.item_id}-${itemIdx}-row`} className="flex items-center justify-between text-[10px] tracking-[0.10em]">
                        <span className="text-[#0A0A0A] truncate flex-1 mr-3">
                          <span className="text-[#6B6B6B] mr-2">{SLOT_LABEL[item.slot] ?? item.slot}</span>
                          {item.product_name}
                        </span>
                        <span className="text-[#A8A8A4] flex-shrink-0">
                          {(item.compat * 100).toFixed(0)}
                        </span>
                      </div>
                    ))}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2">
                    {state?.approved && state.outfitId && state.projectId ? (
                      <a
                        href={`/admin/projects/${state.projectId}/outfits/${state.outfitId}/edit`}
                        className="flex-1 bg-[#C4A882] text-white px-4 py-2.5 text-[10px] tracking-[0.20em] text-center hover:opacity-85 transition-opacity"
                      >
                        APPROVED → EDIT DRAFT
                      </a>
                    ) : (
                      <button
                        type="button"
                        disabled={state?.approving || isRescoring}
                        onClick={() => approve(idx, candidate)}
                        className="flex-1 bg-[#0A0A0A] text-white px-4 py-2.5 text-[10px] tracking-[0.20em] hover:bg-[#333] transition-colors duration-300 disabled:opacity-50"
                      >
                        {state?.approving ? 'APPROVING…' : 'APPROVE TO DRAFT'}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => discard(idx)}
                      className="border border-[#E2E0DB] text-[#6B6B6B] px-4 py-2.5 text-[10px] tracking-[0.20em] hover:border-[#0A0A0A] hover:text-[#0A0A0A] transition-colors duration-300"
                    >
                      DISCARD
                    </button>
                  </div>

                  {state?.approved && (
                    <p className="mt-3 text-[9px] tracking-[0.18em] text-[#C4A882] leading-relaxed">
                      ✦ REFINED HIGGSFIELD SHOOT GENERATING IN THE BACKGROUND (~30–60S) — IT&rsquo;LL BE SAVED TO CLOUDINARY AND SET AS THE DRAFT&rsquo;S DISPLAY IMAGE.
                    </p>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Swap modal */}
      {swap && (
        <div
          className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center pt-16"
          onClick={() => setSwap(null)}
        >
          <div
            className="bg-white border border-[#E2E0DB] w-full max-w-3xl mx-6 p-6 max-h-[80vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-baseline justify-between mb-4 pb-3 border-b border-[#E2E0DB]">
              <div>
                <p className="text-[10px] tracking-[0.25em] text-[#6B6B6B]">
                  {swap.itemIdx === null ? 'ADD' : 'SWAP'} · {SLOT_LABEL[swap.slot] ?? swap.slot.toUpperCase()}
                </p>
                <p className="text-[9px] tracking-[0.20em] text-[#A8A8A4] mt-1">
                  {swapQuery.trim()
                    ? 'SEARCHING ALL ITEMS · MOST RELEVANT FIRST'
                    : 'SUGGESTED FOR THIS SLOT · SEARCH TO PICK ANY ITEM'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSwap(null)}
                className="text-[18px] text-[#A8A8A4] hover:text-[#0A0A0A] transition-colors"
              >
                ×
              </button>
            </div>

            {/* Search the entire library — pick any item, any slot */}
            <input
              type="text"
              autoFocus
              placeholder="SEARCH ANY ITEM BY NAME, BRAND OR TYPE…"
              value={swapQuery}
              onChange={(e) => onSwapQueryChange(e.target.value)}
              className="w-full border border-[#E2E0DB] bg-white px-4 py-2.5 text-[12px] tracking-[0.10em] text-[#0A0A0A] focus:outline-none focus:border-[#0A0A0A] mb-5"
            />

            {swapLoading ? (
              <p className="text-[10px] tracking-[0.20em] text-[#A8A8A4] py-10 text-center">LOADING…</p>
            ) : swapOptions.length === 0 ? (
              <p className="text-[10px] tracking-[0.20em] text-[#A8A8A4] py-10 text-center">
                {swapQuery.trim() ? 'NO ITEMS MATCH THAT SEARCH.' : 'NO ITEMS IN THIS SLOT — SEARCH TO PICK ANY ITEM.'}
              </p>
            ) : (
              <div className="grid grid-cols-4 gap-3">
                {swapOptions.map((opt) => (
                  <button
                    key={opt.item_id}
                    type="button"
                    onClick={() => performSwap(opt)}
                    className="group text-left"
                  >
                    <div className="aspect-[3/4] bg-[#F2F2F0] overflow-hidden mb-2 group-hover:opacity-85 transition-opacity">
                      {opt.image_url ? (
                        <img src={opt.image_url} alt={opt.product_name} className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full" />
                      )}
                    </div>
                    <p className="text-[9px] tracking-[0.20em] text-[#A8A8A4] truncate">
                      {(opt.brand_name ?? '—').toUpperCase()}
                    </p>
                    <p className="text-[10px] tracking-[0.10em] text-[#0A0A0A] truncate">
                      {opt.product_name.toUpperCase()}
                    </p>
                    <div className="flex items-center justify-between mt-0.5">
                      <span className="text-[9px] tracking-[0.20em] text-[#A8A8A4]">
                        COMPAT {(opt.compat * 100).toFixed(0)}
                      </span>
                      {!opt.sameSlot && (
                        <span className="text-[8px] tracking-[0.15em] text-[#C4A882]">
                          → {SLOT_LABEL[opt.slot] ?? opt.slot.toUpperCase()}
                        </span>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
