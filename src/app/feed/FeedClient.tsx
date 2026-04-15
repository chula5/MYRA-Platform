'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import OutfitCard from '@/components/outfit-card/OutfitCard'
import { createClient } from '@/lib/supabase'
import type { OutfitWithItems, ItemType } from '@/types/database'

// ── Preset occasions ──────────────────────────────────────────
const PRESET_OCCASIONS = [
  { label: "FRIEND'S POP-UP", tag: "friends pop-up" },
  { label: 'RESTAURANT OPENING', tag: 'restaurant opening' },
  { label: 'WEEKEND AWAY', tag: 'weekend away' },
  { label: 'WORK MEETING', tag: 'work meeting' },
  { label: 'WEDDING GUEST', tag: 'wedding guest' },
  { label: 'DATE NIGHT', tag: 'date night' },
  { label: 'CREATIVE EVENT', tag: 'creative event' },
  { label: 'BLACK TIE', tag: 'black tie' },
]

export default function FeedClient() {
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
  }, [])

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
    router.push(`/outfit/${outfit.outfit_id}?styleItem=${itemId}&itemType=${itemType}`)
  }

  const handleSimilarLooks = (outfit: OutfitWithItems) => {
    router.push(`/outfit/${outfit.outfit_id}?mode=similar`)
  }

  const handleExploreStyles = (outfit: OutfitWithItems) => {
    router.push(`/outfit/${outfit.outfit_id}?mode=explore`)
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

        {/* Preset grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 max-w-[900px] mx-auto mb-10">
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
            {occasion.toUpperCase()}
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
