'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import OutfitCard from '@/components/outfit-card/OutfitCard'
import { createClient } from '@/lib/supabase'
import type { OutfitWithItems, ItemType } from '@/types/database'

// ── Preset occasions ──────────────────────────────────────────
const PRESET_OCCASIONS = [
  { label: 'WEEKEND AWAY', tag: 'weekend away' },
  { label: 'WORK MEETING', tag: 'work meeting' },
  { label: 'WEDDING GUEST', tag: 'wedding guest' },
  { label: 'DATE NIGHT', tag: 'date night' },
  { label: 'CITY SUMMER EVENING', tag: 'city summer evening' },
  { label: 'CASUAL SUMMER WEEKEND', tag: 'casual summer weekend' },
]

// ── Anti-repetition ordering ──────────────────────────────────
// Classify an outfit by its dominant garment (dress / skirt / trousers / top)
// so the feed can avoid showing two of the same kind back-to-back while scrolling.
function outfitCategory(o: OutfitWithItems): string {
  const types = (o.outfit_item ?? [])
    .filter((oi) => oi.item)
    .map((oi) => String(oi.item.item_type))
  if (types.some((t) => ['mini_dress', 'midi_dress', 'maxi_dress', 'shirt_dress', 'slip_dress'].includes(t))) return 'dress'
  if (types.includes('skirt')) return 'skirt'
  if (types.some((t) => ['trousers', 'jeans', 'shorts'].includes(t))) return 'trousers'
  if (types.some((t) => ['shirt', 'blouse', 't-shirt', 'knitwear', 'corset', 'bodysuit'].includes(t))) return 'top'
  return 'other'
}

// Greedily reorder so consecutive outfits have different garment categories
// (deterministic — same input always yields the same order, so pagination is stable).
function antiRepeatOrder(list: OutfitWithItems[]): OutfitWithItems[] {
  const buckets: Record<string, OutfitWithItems[]> = {}
  for (const o of list) {
    const c = outfitCategory(o)
    ;(buckets[c] ||= []).push(o)
  }
  const cats = Object.keys(buckets)
  if (cats.length <= 1) return list // nothing to interleave

  const result: OutfitWithItems[] = []
  let lastCat: string | null = null
  while (result.length < list.length) {
    // Pick the largest remaining bucket whose category isn't the previous one.
    let bestCat: string | null = null
    let bestLen = -1
    for (const cat of cats) {
      const arr = buckets[cat]
      if (arr.length === 0 || cat === lastCat) continue
      if (arr.length > bestLen) { bestLen = arr.length; bestCat = cat }
    }
    if (bestCat === null) {
      // Only the previous category remains — append whatever's left (unavoidable run).
      for (const cat of cats) { const arr = buckets[cat]; while (arr.length) result.push(arr.shift()!) }
      break
    }
    result.push(buckets[bestCat].shift()!)
    lastCat = bestCat
  }
  return result
}

// Optional props are only used by the admin preview; the public feed renders
// <FeedClient /> with none, so its behaviour is unchanged.
//   showAllOption   — adds a "view everything live" shortcut
//   injectedOutfits — render these server-fetched outfits (with full items, via
//                     the admin client) instead of fetching with the browser
//                     client, so source items / hotspots appear even when the
//                     linked items would be hidden by row-level security
//   detailHrefBase  — where cards link on click (default public detail route)
export default function FeedClient({
  showAllOption = false,
  injectedOutfits,
  detailHrefBase = '/outfit',
}: {
  showAllOption?: boolean
  injectedOutfits?: OutfitWithItems[]
  detailHrefBase?: string
}) {
  const [occasion, setOccasion] = useState<string | null>(null)
  const [customOccasion, setCustomOccasion] = useState('')
  const [outfits, setOutfits] = useState<OutfitWithItems[]>([])
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [offset, setOffset] = useState(0)
  const [hasMore, setHasMore] = useState(true)
  const loadMoreRef = useRef<HTMLDivElement>(null)

  const LIMIT = 9

  // ── Fetch outfits ──────────────────────────────────────────
  const fetchOutfits = useCallback(async (
    tag: string,
    currentOffset: number,
    append: boolean
  ) => {
    // Server-injected outfits (admin preview + early-access /edit): filter
    // client-side instead of querying the browser client (which can't read items
    // hidden by RLS). Paginate the render — showing every outfit at once renders
    // a Next/Image per card and crashes mobile Safari on memory.
    if (injectedOutfits) {
      const filtered = tag && tag !== 'all'
        ? injectedOutfits.filter((o) => (o.occasion_tags ?? []).includes(tag))
        : injectedOutfits
      // Reorder so two of the same garment type don't sit next to each other,
      // then paginate the interleaved sequence (stable across load-more).
      const ordered = antiRepeatOrder(filtered)
      const end = currentOffset + LIMIT
      setOutfits(ordered.slice(0, end))
      setHasMore(ordered.length > end)
      setLoading(false)
      setLoadingMore(false)
      return
    }

    const supabase = createClient()

    if (currentOffset === 0) setLoading(true)
    else setLoadingMore(true)

    let query = supabase
      .from('outfit')
      .select(`
        *,
        outfit_item (
          *,
          item (
            *,
            brand (*)
          )
        )
      `)
      .eq('status', 'live')
      .order('published_at', { ascending: false })
      .range(currentOffset, currentOffset + LIMIT - 1)

    if (tag && tag !== 'all') {
      query = query.contains('occasion_tags', [tag])
    }

    const { data, error } = await query

    if (!error && data) {
      const typed = data as OutfitWithItems[]
      setOutfits((prev) => append ? [...prev, ...typed] : typed)
      setHasMore(data.length === LIMIT)
    }

    setLoading(false)
    setLoadingMore(false)
  }, [injectedOutfits])

  // ── Load when occasion set ─────────────────────────────────
  useEffect(() => {
    if (!occasion) return
    setOffset(0)
    setHasMore(true)
    fetchOutfits(occasion, 0, false)
  }, [occasion, fetchOutfits])

  // ── Infinite scroll ────────────────────────────────────────
  useEffect(() => {
    if (!loadMoreRef.current || !occasion) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !loadingMore && !loading) {
          const nextOffset = offset + LIMIT
          setOffset(nextOffset)
          fetchOutfits(occasion, nextOffset, true)
        }
      },
      { threshold: 0.1 }
    )

    observer.observe(loadMoreRef.current)
    return () => observer.disconnect()
  }, [occasion, hasMore, loadingMore, loading, offset, fetchOutfits])

  // ── Style item handler ─────────────────────────────────────
  const router = useRouter()

  const handleStyleItem = (itemId: string, itemType: ItemType, outfit: OutfitWithItems) => {
    router.push(`${detailHrefBase}/${outfit.outfit_id}?styleItem=${itemId}&itemType=${itemType}`)
  }

  const handleSimilarLooks = (outfit: OutfitWithItems) => {
    router.push(`${detailHrefBase}/${outfit.outfit_id}?mode=similar`)
  }

  const handleExploreStyles = (outfit: OutfitWithItems) => {
    router.push(`${detailHrefBase}/${outfit.outfit_id}?mode=explore`)
  }

  // ── Select occasion ────────────────────────────────────────
  const selectOccasion = (tag: string) => {
    setOccasion(tag)
  }

  const handleCustomSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (customOccasion.trim()) {
      setOccasion(customOccasion.trim().toLowerCase())
    }
  }

  // ── Occasion selector view ────────────────────────────────
  if (!occasion) {
    return (
      <div className="max-w-[1440px] mx-auto px-10 py-16">
        {/* Heading */}
        <div className="text-center mb-12">
          <p className="text-[11px] tracking-[0.25em] text-[#6B6B6B] mb-4">
            YOUR OCCASION
          </p>
          <h1 className="text-[clamp(28px,3vw,40px)] tracking-[0.10em] text-[#0A0A0A] leading-tight">
            WHAT ARE YOU DRESSING FOR?
          </h1>
        </div>

        {/* Admin preview shortcut — show every live outfit regardless of tags */}
        {showAllOption && (
          <div className="max-w-[900px] mx-auto mb-6">
            <button
              onClick={() => selectOccasion('all')}
              className="w-full border border-[#0A0A0A] bg-[#0A0A0A] text-white px-4 py-4 text-[11px] tracking-[0.20em] rounded-[3px] hover:bg-[#333] transition-colors duration-300"
            >
              ↓ VIEW EVERYTHING LIVE
            </button>
          </div>
        )}

        {/* Preset grid */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 max-w-[900px] mx-auto mb-10">
          {PRESET_OCCASIONS.map((occ) => (
            <button
              key={occ.tag}
              onClick={() => selectOccasion(occ.tag)}
              className="
                border border-[#E2E0DB] bg-white
                px-4 py-6
                text-[11px] tracking-[0.20em] text-[#0A0A0A]
                text-center
                rounded-[3px]
                transition-all duration-400
                hover:border-[#0A0A0A] hover:bg-[#FAFAF8]
                active:bg-[#0A0A0A] active:text-white
              "
            >
              {occ.label}
            </button>
          ))}
        </div>

        {/* Divider */}
        <div className="flex items-center gap-6 max-w-[900px] mx-auto mb-8">
          <div className="flex-1 border-t border-[#E2E0DB]" />
          <span className="text-[10px] tracking-[0.25em] text-[#A8A8A4]">OR</span>
          <div className="flex-1 border-t border-[#E2E0DB]" />
        </div>

        {/* Custom input */}
        <form
          onSubmit={handleCustomSubmit}
          className="flex gap-3 max-w-[600px] mx-auto"
        >
          <input
            type="text"
            value={customOccasion}
            onChange={(e) => setCustomOccasion(e.target.value)}
            placeholder="DESCRIBE YOUR OCCASION"
            className="
              flex-1 border border-[#E2E0DB] bg-white
              px-5 py-3.5 rounded-[3px]
              text-[11px] tracking-[0.15em] text-[#0A0A0A]
              placeholder:text-[#A8A8A4]
              focus:outline-none focus:border-[#0A0A0A]
              transition-colors duration-300
            "
          />
          <button
            type="submit"
            className="
              bg-[#0A0A0A] text-white
              px-8 py-3.5 rounded-[3px]
              text-[11px] tracking-[0.20em]
              transition-opacity duration-400 hover:opacity-85
              flex-shrink-0
            "
          >
            FIND LOOKS
          </button>
        </form>
      </div>
    )
  }

  // ── Feed view ─────────────────────────────────────────────
  return (
    <div className="max-w-[1440px] mx-auto px-10 py-10">
      {/* Active occasion header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <p className="text-[11px] tracking-[0.25em] text-[#6B6B6B] mb-1">
            YOUR OCCASION
          </p>
          <h2 className="text-[22px] tracking-[0.10em] text-[#0A0A0A]">
            {occasion === 'all' ? 'EVERYTHING LIVE' : occasion.toUpperCase()}
          </h2>
        </div>
        <button
          onClick={() => setOccasion(null)}
          className="
            text-[11px] tracking-[0.20em] text-[#6B6B6B]
            border border-[#E2E0DB] px-5 py-2.5 rounded-[3px]
            hover:border-[#0A0A0A] hover:text-[#0A0A0A]
            transition-all duration-300
          "
        >
          CHANGE
        </button>
      </div>

      {/* Loading state */}
      {loading && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {[1, 2, 3, 4, 5, 6].map((n) => (
            <div key={n} className="aspect-[3/4] bg-[#F2F2F2] animate-pulse rounded-[2px]" />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!loading && outfits.length === 0 && (
        <div className="text-center py-24">
          <p className="text-[11px] tracking-[0.25em] text-[#A8A8A4] mb-6">
            NO OUTFITS YET FOR THIS OCCASION
          </p>
          <button
            onClick={() => setOccasion(null)}
            className="
              border border-[#0A0A0A] text-[#0A0A0A]
              px-8 py-3 rounded-[3px]
              text-[11px] tracking-[0.20em]
              hover:bg-[#0A0A0A] hover:text-white
              transition-all duration-400
            "
          >
            TRY ANOTHER OCCASION
          </button>
        </div>
      )}

      {/* Outfit grid */}
      {!loading && outfits.length > 0 && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {outfits.map((outfit) => (
              <OutfitCard
                key={outfit.outfit_id}
                outfit={outfit}
                detailHref={`${detailHrefBase}/${outfit.outfit_id}`}
                onSimilarLooks={handleSimilarLooks}
                onExploreStyles={handleExploreStyles}
                onStyleItem={handleStyleItem}
              />
            ))}
          </div>

          {/* Load more sentinel */}
          <div ref={loadMoreRef} className="py-8 flex justify-center">
            {loadingMore && (
              <div className="flex gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-[#A8A8A4] animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-1.5 h-1.5 rounded-full bg-[#A8A8A4] animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-1.5 h-1.5 rounded-full bg-[#A8A8A4] animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            )}
            {!hasMore && !loadingMore && outfits.length > 0 && (
              <p className="text-[10px] tracking-[0.25em] text-[#A8A8A4]">
                END OF EDIT
              </p>
            )}
          </div>
        </>
      )}
    </div>
  )
}
