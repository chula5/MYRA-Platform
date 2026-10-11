'use client'

import { useEffect, useRef, useState } from 'react'
import { thumbUrl } from '@/lib/image-utils'
import { composeForReview, getReviewQueue } from './actions.gated'
import type { QueueFacet, ReviewAnchor, ReviewCandidate, ReviewItem } from './actions'
import { PICKER_COLOURS, PICKER_TYPES } from '@/components/admin/ItemPickerModal'
import { approveCandidate, rescoreCandidate, recordSkipDecision, recordSwap, recordFastLaneOutcome, recordReviewOutcome } from '@/app/admin/composer/actions.gated'
import { generateHiggsfieldShootForOutfit } from '@/app/admin/projects/higgsfield-actions.gated'
import type { Slot } from '@/lib/composer'

// Swap/add item search via a ROUTE HANDLER rather than a server action. Server
// actions run sequentially in Next, so a long-running Higgsfield shoot (kicked
// off by YES) would otherwise freeze the search. A plain fetch runs concurrently.
async function fetchReviewOptions(params: {
  mode: 'swap' | 'add'
  anchor: string
  slot?: string
  present?: string[]
  exclude: string[]
  q: string
  brand?: string
  colour?: string
  itemType?: string
}): Promise<{ options: ReviewItem[]; missingSlots?: string[]; brands?: { name: string; count: number }[] }> {
  const sp = new URLSearchParams()
  sp.set('mode', params.mode)
  sp.set('anchor', params.anchor)
  sp.set('q', params.q)
  sp.set('exclude', params.exclude.join(','))
  if (params.slot) sp.set('slot', params.slot)
  if (params.present) sp.set('present', params.present.join(','))
  if (params.brand) sp.set('brand', params.brand)
  if (params.colour) sp.set('colour', params.colour)
  if (params.itemType) sp.set('type', params.itemType)
  try {
    const r = await fetch(`/api/admin/review-options?${sp.toString()}`, { cache: 'no-store' })
    if (!r.ok) return { options: [] }
    return await r.json()
  } catch {
    return { options: [] }
  }
}

const SLOT_LABEL: Record<string, string> = {
  outerwear: 'OUTERWEAR', top: 'TOP', bottom: 'BOTTOM', dress: 'DRESS',
  shoe: 'SHOES', bag: 'BAG', jewellery: 'JEWELLERY', accessory: 'ACCESSORY',
}

// Compact stock indicator from the last stock check. In-stock sizes are the
// available sizes; otherwise the coarse status. Empty when never checked.
function StockTag({ item }: { item: { stock_status?: string | null; stock_sizes?: string[] | null } }) {
  const sizes = item.stock_sizes ?? []
  const out = item.stock_status === 'out_of_stock'
  const low = item.stock_status === 'low_stock'
  let text = ''
  if (sizes.length > 0) text = sizes.join('·')
  else if (out) text = 'OUT OF STOCK'
  else if (low) text = 'LOW STOCK'
  else if (item.stock_status === 'in_stock') text = 'IN STOCK'
  if (!text) return null
  const tone = out ? 'text-[#B83A3A]' : low ? 'text-[#7C838B]' : 'text-[#3D7A50]'
  return <p className={`text-[7px] tracking-[0.06em] ${tone} truncate`}>{text}</p>
}

interface CandState {
  approving?: boolean
  approved?: boolean
  discarded?: boolean
  edited?: boolean   // swapped/added an item — a fast-lane approve becomes an override
  outfitId?: string
  projectId?: string
  error?: string
  shoot?: 'running' | 'done' | 'failed'
  shootError?: string
}

// Chip labels/swatches from the shared picker constants, so the queue's type
// and colour chips match every other picker in the admin.
const TYPE_LABEL = Object.fromEntries(PICKER_TYPES.map((t) => [t.value, t.label])) as Record<string, string>
const COLOUR_SWATCH = Object.fromEntries(PICKER_COLOURS.map((c) => [c.value, c.swatch])) as Record<string, string>
const CHIP = 'px-3 py-1.5 text-[9px] tracking-[0.1em] rounded-full border transition-colors disabled:opacity-50'
const CHIP_ON = 'bg-[#0A0A0A] text-white border-[#0A0A0A]'
const CHIP_OFF = 'text-[#6B6B6B] border-[#E2E0DB] hover:border-[#0A0A0A]'

// Facets in the picker's order (coats first, then shirts…; colours by swatch
// list), any value the picker doesn't know appended after.
function orderFacets(facets: QueueFacet[], order: { value: string }[]): QueueFacet[] {
  const byValue = new Map(facets.map((f) => [f.value, f]))
  const known = order.map((o) => byValue.get(o.value)).filter((f): f is QueueFacet => !!f)
  const rest = facets.filter((f) => !order.some((o) => o.value === f.value))
  return [...known, ...rest]
}

function typeLabel(value: string): string {
  return (TYPE_LABEL[value] ?? value.replace(/_/g, ' ')).toUpperCase()
}

type QueueQuery = { brand: string | null; type: string | null; colour: string | null; q: string }

export default function OutfitReviewClient({
  anchors,
  brands = [],
  types = [],
  colours = [],
  mode = 'needs-more',
}: {
  anchors: ReviewAnchor[]
  brands?: { name: string; count: number }[]
  types?: QueueFacet[]
  colours?: QueueFacet[]
  mode?: 'needs-more' | 'exactly-one'
}) {
  const [queue, setQueue] = useState(anchors)
  const [visible, setVisible] = useState(8)
  const [refreshKey, setRefreshKey] = useState(0)  // remount cards on refresh
  const [refreshing, setRefreshing] = useState(false)
  // Filters — brand, item type, colour and a text search — all AND together.
  // null / '' = everything. A filtered queue loads up to 500 matching anchors
  // still needing outfits (not just the shuffled 60) — more than any one type.
  const [filter, setFilter] = useState<QueueQuery>({ brand: null, type: null, colour: null, q: '' })
  const [searchInput, setSearchInput] = useState('')
  const [loading, setLoading] = useState(false)
  const reqRef = useRef(0) // drop stale responses when filters change quickly
  const filtered = !!(filter.brand || filter.type || filter.colour || filter.q.trim())

  async function loadQueue(next: QueueQuery, shuffle = false) {
    const id = ++reqRef.current
    const any = !!(next.brand || next.type || next.colour || next.q.trim())
    setLoading(true)
    const res = await getReviewQueue(any ? 500 : 60, shuffle, mode, next.brand, {
      q: next.q,
      itemType: next.type ?? '',
      colour: next.colour ?? '',
      includeOuterwear: true,
    })
    if (id !== reqRef.current) return
    setLoading(false)
    setQueue(res.anchors ?? [])
    setVisible(8)
    setRefreshKey((k) => k + 1)
  }

  function applyFilter(patch: Partial<QueueQuery>) {
    const next = { ...filter, ...patch }
    setFilter(next)
    void loadQueue(next)
  }

  // Text search, debounced: name, brand, type, colour or material.
  useEffect(() => {
    const q = searchInput.trim()
    if (q === filter.q) return
    const t = setTimeout(() => applyFilter({ q }), 300)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput])

  // Reshuffle which anchors appear (they're the same on every page load otherwise).
  async function refresh() {
    setRefreshing(true)
    await loadQueue(filter, true)
    setRefreshing(false)
  }

  function clearFilters() {
    setSearchInput('')
    applyFilter({ brand: null, type: null, colour: null, q: '' })
  }

  const typeChips = orderFacets(types, PICKER_TYPES)
  const colourChips = orderFacets(colours, PICKER_COLOURS)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-[10px] tracking-[0.14em] text-[#A8A8A4]">
          {loading ? 'LOADING…' : `${queue.length} ANCHOR${queue.length === 1 ? '' : 'S'} IN QUEUE`}
          {filter.brand && <span className="text-[#4A4E57]"> · {filter.brand.toUpperCase()}</span>}
          {filter.type && <span className="text-[#4A4E57]"> · {typeLabel(filter.type)}</span>}
          {filter.colour && <span className="text-[#4A4E57]"> · {filter.colour.toUpperCase()}</span>}
          {filter.q && <span className="text-[#4A4E57]"> · “{filter.q.toUpperCase()}”</span>}
        </p>
        <button
          onClick={refresh}
          disabled={refreshing || loading}
          className="border border-[#0A0A0A] text-[#4A4E57] px-5 py-2 text-[10px] tracking-[0.14em] rounded-full hover:bg-[#0A0A0A] hover:text-white transition-colors disabled:opacity-50"
        >
          {refreshing ? 'SHUFFLING…' : '↻ REFRESH ANCHORS'}
        </button>
      </div>

      {/* Search — "fur", "leopard", "silk", "wide leg": name, brand, type, colour or material */}
      <div className="flex flex-col sm:flex-row gap-2">
        <input
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="SEARCH ANCHORS — FUR, LEOPARD, SILK, WIDE LEG, A BRAND…"
          className="flex-1 border border-[#E2E0DB] rounded-[10px] px-4 py-2.5 text-[11px] tracking-[0.08em] text-[#4A4E57] placeholder:text-[#A8A8A4] focus:outline-none focus:border-[#0A0A0A]"
        />
        {filtered && (
          <button
            onClick={clearFilters}
            className="px-4 py-2.5 text-[10px] tracking-[0.14em] border border-[#E2E0DB] text-[#6B6B6B] rounded-full hover:border-[#0A0A0A] transition-colors"
          >
            ✕ CLEAR FILTERS
          </button>
        )}
      </div>

      {/* Brand — tap a brand to see only its pieces still needing outfits */}
      {brands.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[8px] tracking-[0.18em] text-[#A8A8A4] w-14">BRAND</span>
          <button
            onClick={() => applyFilter({ brand: null })}
            disabled={loading}
            className={`${CHIP} ${filter.brand === null ? CHIP_ON : CHIP_OFF}`}
          >
            ALL BRANDS
          </button>
          {brands.map((b) => (
            <button
              key={b.name}
              onClick={() => applyFilter({ brand: filter.brand === b.name ? null : b.name })}
              disabled={loading}
              className={`${CHIP} ${filter.brand === b.name ? CHIP_ON : CHIP_OFF}`}
            >
              {b.name.toUpperCase()} <span className="opacity-50">{b.count}</span>
            </button>
          ))}
        </div>
      )}

      {/* Item type — coats and jackets are anchors too, so "fur coat outfits" is one tap */}
      {typeChips.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[8px] tracking-[0.18em] text-[#A8A8A4] w-14">TYPE</span>
          {typeChips.map((t) => (
            <button
              key={t.value}
              onClick={() => applyFilter({ type: filter.type === t.value ? null : t.value })}
              disabled={loading}
              className={`${CHIP} ${filter.type === t.value ? CHIP_ON : CHIP_OFF}`}
            >
              {typeLabel(t.value)} <span className="opacity-50">{t.count}</span>
            </button>
          ))}
        </div>
      )}

      {/* Colour */}
      {colourChips.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[8px] tracking-[0.18em] text-[#A8A8A4] w-14">COLOUR</span>
          {colourChips.map((c) => (
            <button
              key={c.value}
              onClick={() => applyFilter({ colour: filter.colour === c.value ? null : c.value })}
              disabled={loading}
              className={`${CHIP} flex items-center gap-1.5 ${filter.colour === c.value ? CHIP_ON : CHIP_OFF}`}
            >
              {COLOUR_SWATCH[c.value] && (
                <span className="w-2.5 h-2.5 rounded-full border border-[#E2E0DB]" style={{ background: COLOUR_SWATCH[c.value] }} />
              )}
              {c.value.toUpperCase()} <span className="opacity-50">{c.count}</span>
            </button>
          ))}
        </div>
      )}

      {queue.length === 0 ? (
        <p className="text-[12px] tracking-[0.09em] text-[#A8A8A4] py-20 text-center">
          {loading ? 'LOADING…' : filtered ? 'NO ANCHORS MATCH THESE FILTERS.' : 'EVERY ANCHOR ALREADY HAS 3+ OUTFITS — NOTHING TO REVIEW. 🎉'}
        </p>
      ) : (
        <div className="space-y-12">
          {queue.slice(0, visible).map((a) => (
            <AnchorReview key={`${a.item_id}-${refreshKey}`} anchor={a} />
          ))}
          {visible < queue.length && (
            <div className="text-center pt-2">
              <button
                onClick={() => setVisible((v) => v + 8)}
                className="border border-[#0A0A0A] text-[#4A4E57] px-8 py-3 text-[11px] tracking-[0.16em] rounded-full hover:bg-[#0A0A0A] hover:text-white transition-colors"
              >
                LOAD MORE ANCHORS ({queue.length - visible} LEFT)
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

type SwapTarget = { candIdx: number; itemIdx: number; slot: string; mode: 'swap' | 'add' }

function AnchorReview({ anchor }: { anchor: ReviewAnchor }) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [cands, setCands] = useState<ReviewCandidate[]>([])
  const [states, setStates] = useState<Record<number, CandState>>({})
  // Outfits approved this session, added on top of the saved count.
  const [built, setBuilt] = useState(0)

  // Swap modal
  const [swap, setSwap] = useState<SwapTarget | null>(null)
  const [swapOptions, setSwapOptions] = useState<ReviewItem[]>([])
  const [swapQuery, setSwapQuery] = useState('')
  const [swapBrand, setSwapBrand] = useState('')
  const [swapColour, setSwapColour] = useState('')
  const [swapType, setSwapType] = useState('')
  const [swapBrands, setSwapBrands] = useState<{ name: string; count: number }[]>([])
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
    // autoShoot:false — we drive the Higgsfield shoot ourselves below so we can
    // await it and show live status (instead of an unreliable server background job).
    const res: any = await approveCandidate(
      anchor.item_id,
      c.items.map((i) => i.item_id),
      c.items.map((i) => i.slot as Slot),
      { autoShoot: false, source: 'review', score: c.score },
    )
    if (res?.error) {
      setStates((s) => ({ ...s, [idx]: { ...s[idx], approving: false, error: res.error } }))
      return
    }
    const wasEdited = !!states[idx]?.edited
    setStates((s) => ({ ...s, [idx]: { ...s[idx], approving: false, approved: true, outfitId: res.outfitId, projectId: res.projectId, shoot: 'running' } }))
    setBuilt((b) => b + 1)

    // Adaptive threshold: a fast-lane candidate approved untouched is a clean
    // one-tap; approved after edits it's an override (tightens the gate).
    // recordFastLaneOutcome also feeds the autonomy tracker for fast lane;
    // standard-lane approvals feed it via recordReviewOutcome.
    if (c.lane === 'fast') void recordFastLaneOutcome(wasEdited ? 'override' : 'clean_approve')
    else void recordReviewOutcome('standard', wasEdited, true)

    // Coordinate the Refined Higgsfield shoot now, awaiting the result so the
    // card reflects whether it actually generated. ~30–90s.
    try {
      const shot: any = await generateHiggsfieldShootForOutfit(res.outfitId, 'F6')
      setStates((s) => ({
        ...s,
        [idx]: { ...s[idx], shoot: shot?.imageUrl ? 'done' : 'failed', shootError: shot?.error },
      }))
    } catch (err: any) {
      setStates((s) => ({ ...s, [idx]: { ...s[idx], shoot: 'failed', shootError: err?.message } }))
    }
  }

  function discard(idx: number) {
    setStates((s) => ({ ...s, [idx]: { ...s[idx], discarded: true } }))
    // Style Brain: a SKIP is a negative training signal. Also feeds the
    // autonomy tracker (a reject resets the streak).
    const c = cands[idx]
    if (c) {
      void recordSkipDecision(anchor.item_id, c.items.map((i) => i.item_id), 'review', c.score)
      void recordReviewOutcome(c.lane ?? 'standard', false, false)
    }
  }

  async function openSwap(candIdx: number, itemIdx: number, slot: string) {
    setSwap({ candIdx, itemIdx, slot, mode: 'swap' })
    setSwapQuery('')
    setSwapBrand('')
    setSwapColour('')
    setSwapType('')
    setSwapLoading(true)
    const exclude = [anchor.item_id, ...cands[candIdx].items.map((i) => i.item_id)]
    const res = await fetchReviewOptions({ mode: 'swap', anchor: anchor.item_id, slot, exclude, q: '' })
    setSwapOptions(res.options)
    setSwapBrands(res.brands ?? [])
    setSwapLoading(false)
  }

  // ADD a new item to the candidate — defaults to the slots not yet filled
  // (bag, shoes, jewellery, a bottom…), or search the whole library.
  async function openAdd(candIdx: number) {
    setSwap({ candIdx, itemIdx: -1, slot: '', mode: 'add' })
    setSwapQuery('')
    setSwapBrand('')
    setSwapColour('')
    setSwapType('')
    setSwapLoading(true)
    const exclude = [anchor.item_id, ...cands[candIdx].items.map((i) => i.item_id)]
    const present = cands[candIdx].items.map((i) => i.slot)
    const res = await fetchReviewOptions({ mode: 'add', anchor: anchor.item_id, present, exclude, q: '' })
    setSwapOptions(res.options)
    setSwapBrands(res.brands ?? [])
    setSwapLoading(false)
  }

  // Re-run the current swap/add search with the given text query + brand,
  // colour and type filters (all AND).
  async function runSwapSearch(q: string, brand: string, colour = swapColour, itemType = swapType) {
    if (!swap) return
    setSwapLoading(true)
    const exclude = [anchor.item_id, ...cands[swap.candIdx].items.map((i) => i.item_id)]
    const res =
      swap.mode === 'add'
        ? await fetchReviewOptions({ mode: 'add', anchor: anchor.item_id, present: cands[swap.candIdx].items.map((i) => i.slot), exclude, q, brand, colour, itemType })
        : await fetchReviewOptions({ mode: 'swap', anchor: anchor.item_id, slot: swap.slot, exclude, q, brand, colour, itemType })
    setSwapOptions(res.options)
    // Keep the brand list in sync with the current text query (but not the
    // brand filter itself — the server computes it before applying the filter).
    setSwapBrands(res.brands ?? [])
    setSwapLoading(false)
  }

  function runSwapQuery(q: string) {
    setSwapQuery(q)
    void runSwapSearch(q, swapBrand)
  }

  function runSwapBrand(brand: string) {
    setSwapBrand(brand)
    void runSwapSearch(swapQuery, brand)
  }

  function runSwapColour(colour: string) {
    const next = swapColour === colour ? '' : colour
    setSwapColour(next)
    void runSwapSearch(swapQuery, swapBrand, next, swapType)
  }

  function runSwapType(itemType: string) {
    const next = swapType === itemType ? '' : itemType
    setSwapType(next)
    void runSwapSearch(swapQuery, swapBrand, swapColour, next)
  }

  async function performSwap(opt: ReviewItem) {
    if (!swap) return
    const { candIdx, itemIdx, mode } = swap
    // Swapping out a piece for `opt` — record the from→to detail, the scored-
    // dimension delta, and the ejection context for the Style Brain.
    if (mode === 'swap' && cands[candIdx].items[itemIdx]) {
      void recordSwap(anchor.item_id, cands[candIdx].items[itemIdx].item_id, opt.item_id, {
        candidateItemIds: [anchor.item_id, ...cands[candIdx].items.map((i) => i.item_id)],
      })
    }
    setStates((s) => ({ ...s, [candIdx]: { ...s[candIdx], edited: true } }))
    // Compute the new item list (append in add mode, replace in swap mode).
    const items =
      mode === 'add'
        ? [...cands[candIdx].items, { ...opt, slot: opt.slot }]
        : cands[candIdx].items.map((it, i) => (i === itemIdx ? { ...opt, slot: opt.slot } : it))
    setCands((prev) => {
      const next = prev.map((c) => ({ ...c, items: [...c.items] }))
      next[candIdx].items = items
      return next
    })
    setSwap(null)
    // Rescore coherence with the new combo.
    const res: any = await rescoreCandidate(anchor.item_id, items.map((i) => ({ itemId: i.item_id, slot: i.slot as Slot })))
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
          <img src={thumbUrl(anchor.image_url, 600)} alt="" className="w-full h-full object-cover" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[9px] tracking-[0.18em] text-[#A8A8A4] mb-0.5">ANCHOR · {anchor.item_type.replace(/_/g, ' ').toUpperCase()}</p>
          <p className="text-[10px] tracking-[0.10em] text-[#6B6B6B]">{(anchor.brand_name ?? '').toUpperCase()}</p>
          <p className="text-[13px] tracking-[0.04em] text-[#4A4E57] truncate">{anchor.product_name.toUpperCase()}</p>
          <div className="flex items-center gap-2 mt-0.5">
            {anchor.price && <p className="text-[10px] tracking-[0.06em] text-[#6B6B6B]">{anchor.price}</p>}
            <StockTag item={anchor} />
          </div>
        </div>
        <div className="text-right flex-shrink-0">
          <p className="text-[18px] tracking-[0.04em] text-[#4A4E57] leading-none">{anchor.existingCount + built}<span className="text-[#A8A8A4]"> / 3</span></p>
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
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-2">
                    <p className="text-[9px] tracking-[0.16em] text-[#6B6B6B]">POTENTIAL OUTFIT {String(idx + 1).padStart(2, '0')}</p>
                    {c.lane === 'fast' && (
                      <span className="bg-[#3D7A50] text-white text-[7px] tracking-[0.12em] px-1.5 py-0.5 rounded">FAST LANE</span>
                    )}
                  </div>
                  <p className="text-[9px] tracking-[0.12em] text-[#A8A8A4]">
                    COHERENCE {(c.score * 100).toFixed(0)}
                    {typeof c.confidence === 'number' && <span> · CONFIDENCE {(c.confidence * 100).toFixed(0)}</span>}
                  </p>
                </div>
                {/* House Style read-out: the one deliberate surprise + what echoes */}
                {(c.statement || (c.echoes?.length ?? 0) > 0) && (
                  <p className="mb-1.5 text-[8px] tracking-[0.06em] text-[#A8A8A4] leading-relaxed">
                    {c.statement && <span className="text-[#4A4E57]">STATEMENT: {c.statement.toUpperCase()}</span>}
                    {c.statement && (c.echoes?.length ?? 0) > 0 && ' · '}
                    {(c.echoes?.length ?? 0) > 0 && <span>ECHO: {c.echoes[0].toUpperCase()}</span>}
                  </p>
                )}
                {/* Why the confidence gate scored this low — shown so a skip/swap is informed */}
                {(c.reasons?.length ?? 0) > 0 && (
                  <ul className="mb-2 space-y-0.5">
                    {c.reasons.map((r, ri) => (
                      <li key={ri} className="text-[8px] tracking-[0.06em] text-[#7C838B] leading-relaxed">▲ {r.toUpperCase()}</li>
                    ))}
                  </ul>
                )}

                <div className="grid grid-cols-4 gap-1.5 mb-3">
                  {/* Anchor */}
                  <div className="relative">
                    <div className="aspect-[3/4] rounded-[6px] overflow-hidden bg-[#F2F2F0]">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={thumbUrl(anchor.image_url, 600)} alt="" className="w-full h-full object-cover" />
                    </div>
                    <span className="absolute top-1 left-1 bg-[#0A0A0A] text-white text-[7px] tracking-[0.10em] px-1 py-0.5 rounded">ANCHOR</span>
                    {anchor.price && <p className="text-[7px] tracking-[0.04em] text-[#4A4E57] mt-0.5">{anchor.price}</p>}
                  </div>
                  {/* Additions */}
                  {c.items.map((item, itemIdx) => (
                    <div key={`${item.item_id}-${itemIdx}`} className="relative group">
                      <div className={`aspect-[3/4] rounded-[6px] overflow-hidden bg-[#F2F2F0] ${item.stock_status === 'out_of_stock' ? 'ring-1 ring-[#E8B4B4]' : ''}`}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={thumbUrl(item.image_url, 600)} alt="" className="w-full h-full object-cover" />
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
                      <StockTag item={item} />
                    </div>
                  ))}
                  {editable && (
                    <button
                      onClick={() => openAdd(idx)}
                      className="aspect-[3/4] rounded-[6px] border border-dashed border-[#C9C7C2] flex flex-col items-center justify-center text-[#A8A8A4] hover:border-[#0A0A0A] hover:text-[#4A4E57] transition-colors"
                    >
                      <span className="text-[18px] leading-none">+</span>
                      <span className="text-[7px] tracking-[0.12em] mt-1">ADD ITEM</span>
                    </button>
                  )}
                </div>

                {st?.approved ? (
                  <div>
                    <a href={`/admin/projects/${st.projectId}/outfits/${st.outfitId}/edit`} className="block text-center bg-[#C4A882] text-white py-2.5 text-[10px] tracking-[0.16em] rounded-full">
                      ✓ YES → EDIT DRAFT
                    </a>
                    {st.shoot === 'running' && (
                      <p className="mt-2 text-[8px] tracking-[0.10em] text-[#C4A882] leading-relaxed">✦ HIGGSFIELD SHOOT GENERATING (~30–90S) — KEEP THIS TAB OPEN; IT&rsquo;LL BECOME THE DISPLAY IMAGE.</p>
                    )}
                    {st.shoot === 'done' && (
                      <p className="mt-2 text-[8px] tracking-[0.10em] text-[#4A7A5A] leading-relaxed">✓ HIGGSFIELD SHOOT DONE — SET AS THE DISPLAY IMAGE.</p>
                    )}
                    {st.shoot === 'failed' && (
                      <p className="mt-2 text-[8px] tracking-[0.10em] text-[#B83A3A] leading-relaxed">✕ SHOOT FAILED{st.shootError ? ` — ${st.shootError.slice(0, 80).toUpperCase()}` : ''}. THE DRAFT IS STILL SAVED.</p>
                    )}
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
          <div data-lenis-prevent className="bg-white border border-[#E2E0DB] rounded-[12px] w-full max-w-3xl max-h-[80vh] overflow-y-auto p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-baseline justify-between mb-4 pb-3 border-b border-[#E2E0DB]">
              <p className="text-[10px] tracking-[0.16em] text-[#6B6B6B]">
                {swap.mode === 'add' ? 'ADD ITEM' : `SWAP · ${SLOT_LABEL[swap.slot] ?? swap.slot}`}
              </p>
              <button onClick={() => setSwap(null)} className="text-[#A8A8A4] hover:text-[#0A0A0A] text-[18px] leading-none">×</button>
            </div>
            <div className="flex flex-col sm:flex-row gap-2 mb-4">
              <input
                value={swapQuery}
                onChange={(e) => runSwapQuery(e.target.value)}
                placeholder="SEARCH ANY ITEM BY NAME, BRAND OR TYPE…"
                className="flex-1 border border-[#E2E0DB] rounded-[10px] px-4 py-2.5 text-[11px] tracking-[0.08em] text-[#4A4E57] placeholder:text-[#A8A8A4] focus:outline-none focus:border-[#0A0A0A]"
              />
              <select
                value={swapBrand}
                onChange={(e) => runSwapBrand(e.target.value)}
                className="sm:w-[200px] border border-[#E2E0DB] rounded-[10px] px-3 py-2.5 text-[11px] tracking-[0.08em] text-[#4A4E57] bg-white focus:outline-none focus:border-[#0A0A0A]"
              >
                <option value="">ALL BRANDS</option>
                {swapBrands.map((b) => (
                  <option key={b.name} value={b.name}>{b.name.toUpperCase()} ({b.count})</option>
                ))}
              </select>
            </div>
            {/* Colour + type chips — the same filters as every other picker */}
            <div className="flex flex-wrap gap-1.5 mb-2">
              {PICKER_COLOURS.map((c) => (
                <button
                  key={c.value}
                  onClick={() => runSwapColour(c.value)}
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 text-[8px] tracking-[0.08em] rounded-full border transition-colors ${
                    swapColour === c.value ? 'border-[#0A0A0A] bg-[#0A0A0A] text-white' : 'border-[#E2E0DB] text-[#4A4E57] hover:border-[#0A0A0A]'
                  }`}
                >
                  <span className="w-2.5 h-2.5 rounded-full border border-[#E2E0DB]" style={{ background: c.swatch }} />
                  {c.label}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap gap-1.5 mb-4">
              {PICKER_TYPES.map((t) => (
                <button
                  key={t.value}
                  onClick={() => runSwapType(t.value)}
                  className={`px-2.5 py-1.5 text-[8px] tracking-[0.08em] rounded-full border transition-colors ${
                    swapType === t.value ? 'border-[#0A0A0A] bg-[#0A0A0A] text-white' : 'border-[#E2E0DB] text-[#4A4E57] hover:border-[#0A0A0A]'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
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
