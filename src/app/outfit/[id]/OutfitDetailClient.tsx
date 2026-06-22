'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import Hotspot from '@/components/hotspot/Hotspot'
import SourcePanel from '@/components/source-panel/SourcePanel'
import OutfitCard from '@/components/outfit-card/OutfitCard'
import CardButton from '@/components/ui/CardButton'
import { createClient } from '@/lib/supabase'
import { getRelatedOutfits } from './related-actions'
import type { OutfitWithItems, Item, Brand, ItemType } from '@/types/database'

// Feature flag — hide the SIMILAR LOOKS / EXPLORE STYLES buttons on the
// outfit detail page until THE EDIT / OCCASIONS sections are launched.
// Flip to `true` to re-expose both buttons (all handlers + result grids
// stay in place, so nothing else needs to change).
const SHOW_BROWSE_BUTTONS = false

type SourceItemData = Item & { brand: Brand }

interface OutfitDetailClientProps {
  outfitId: string
  styleItemId?: string
  itemType?: string
  mode?: 'similar' | 'explore'
  // Admin preview overrides — public route passes none, behaviour unchanged:
  initialOutfit?: OutfitWithItems   // server-fetched (admin client) so items show despite RLS
  showBrowseButtons?: boolean       // force-enable SIMILAR / EXPLORE
  linkBase?: string                 // base path for related/result links (default public detail)
}

export default function OutfitDetailClient({
  outfitId,
  styleItemId,
  itemType,
  mode,
  initialOutfit,
  showBrowseButtons,
  linkBase = '/outfit',
}: OutfitDetailClientProps) {
  const router = useRouter()
  const showBrowse = showBrowseButtons ?? SHOW_BROWSE_BUTTONS
  const [outfit, setOutfit] = useState<OutfitWithItems | null>(initialOutfit ?? null)
  const [styleItemOutfits, setStyleItemOutfits] = useState<OutfitWithItems[]>([])
  const [relatedOutfits, setRelatedOutfits] = useState<OutfitWithItems[]>([])
  // Which related view is showing — drives the results heading (the URL `mode`
  // is only the initial value; clicking the buttons updates this).
  const [activeMode, setActiveMode] = useState<'similar' | 'explore' | null>(mode ?? null)
  const [sourcePanelOpen, setSourcePanelOpen] = useState(false)
  const [activeStyleItemId, setActiveStyleItemId] = useState<string | null>(styleItemId ?? null)
  const [activeItemType, setActiveItemType] = useState<ItemType | null>(itemType as ItemType ?? null)
  const [loading, setLoading] = useState(!initialOutfit)
  const [currentImageIndex, setCurrentImageIndex] = useState(0)

  // Ordered list of sibling outfits so the user can swipe/arrow between looks.
  const [siblingIds, setSiblingIds] = useState<string[]>([])
  const touchStartX = useRef<number | null>(null)
  const touchStartY = useRef<number | null>(null)

  // ── Fetch main outfit ─────────────────────────────────────
  useEffect(() => {
    // Admin preview supplies the outfit (with items) directly — skip the browser
    // fetch, which can't read items hidden by row-level security.
    if (initialOutfit) return
    async function load() {
      setLoading(true)
      const supabase = createClient()

      const { data, error } = await supabase
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
        .eq('outfit_id', outfitId)
        .single()

      if (!error && data) {
        setOutfit(data as OutfitWithItems)
      }
      setLoading(false)
    }

    load()
  }, [outfitId, initialOutfit])

  // ── Load sibling outfits (for swiping between looks) ──────
  useEffect(() => {
    async function loadSiblings() {
      const supabase = createClient()
      const { data } = await supabase
        .from('outfit')
        .select('outfit_id')
        .eq('status', 'live')
        .order('published_at', { ascending: false })
      if (data) setSiblingIds(data.map((o: { outfit_id: string }) => o.outfit_id))
    }
    loadSiblings()
  }, [])

  // Navigate to the previous / next look in the list.
  const goToSibling = useCallback((dir: -1 | 1) => {
    const idx = siblingIds.indexOf(outfitId)
    if (idx === -1) return
    const target = idx + dir
    if (target < 0 || target >= siblingIds.length) return
    router.push(`${linkBase}/${siblingIds[target]}`)
  }, [siblingIds, outfitId, router, linkBase])

  // Arrow keys move between looks (desktop).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'ArrowLeft') goToSibling(-1)
      else if (e.key === 'ArrowRight') goToSibling(1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [goToSibling])

  // ── Fetch style item outfits ──────────────────────────────
  const fetchStyleItemOutfits = useCallback(async (itemId: string) => {
    const supabase = createClient()

    const { data: outfitItems } = await supabase
      .from('outfit_item')
      .select('outfit_id')
      .eq('item_id', itemId)
      .neq('outfit_id', outfitId)
      .limit(6)

    if (!outfitItems?.length) return

    const ids = outfitItems.map((oi) => oi.outfit_id)

    const { data } = await supabase
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
      .in('outfit_id', ids)
      .eq('status', 'live')
      .limit(3)

    setStyleItemOutfits((data ?? []) as OutfitWithItems[])
  }, [outfitId])

  // ── Fetch similar / explore outfits ───────────────────────
  // Server action: SIMILAR = same silhouette as this outfit (long dress → long
  // dresses); EXPLORE = same occasion but a different silhouette. The two sets
  // are disjoint, so the buttons never return overlapping outfits.
  const fetchRelatedOutfits = useCallback(async (
    currentOutfit: OutfitWithItems,
    fetchMode: 'similar' | 'explore'
  ) => {
    setActiveMode(fetchMode)
    const res = await getRelatedOutfits(currentOutfit.outfit_id, fetchMode)
    setRelatedOutfits(res.outfits ?? [])
  }, [])

  // ── Effects ───────────────────────────────────────────────
  useEffect(() => {
    if (activeStyleItemId) {
      fetchStyleItemOutfits(activeStyleItemId)
    }
  }, [activeStyleItemId, fetchStyleItemOutfits])

  useEffect(() => {
    if (outfit && mode) {
      fetchRelatedOutfits(outfit, mode)
    }
  }, [outfit, mode, fetchRelatedOutfits])

  // ── Handlers ──────────────────────────────────────────────
  const handleStyleItem = (itemId: string, iType: ItemType) => {
    setActiveStyleItemId(itemId)
    setActiveItemType(iType)
    setStyleItemOutfits([])
    fetchStyleItemOutfits(itemId)
  }

  const handleSimilarLooks = () => {
    if (!outfit) return
    // Clear any active style-item view so the Similar results aren't suppressed
    // (the results section only renders when no style-item is active).
    setActiveStyleItemId(null)
    setActiveItemType(null)
    setStyleItemOutfits([])
    fetchRelatedOutfits(outfit, 'similar')
  }

  const handleExploreStyles = () => {
    if (!outfit) return
    setActiveStyleItemId(null)
    setActiveItemType(null)
    setStyleItemOutfits([])
    fetchRelatedOutfits(outfit, 'explore')
  }

  if (loading) {
    return (
      <div className="max-w-[800px] mx-auto px-10 py-12">
        <div className="aspect-[3/4] bg-[#F2F2F2] animate-pulse rounded-[2px]" />
      </div>
    )
  }

  if (!outfit) {
    return (
      <div className="text-center py-24 px-10">
        <p className="text-[11px] tracking-[0.25em] text-[#A8A8A4]">OUTFIT NOT FOUND</p>
        <button
          onClick={() => router.back()}
          className="mt-6 text-[11px] tracking-[0.20em] underline text-[#6B6B6B]"
        >
          GO BACK
        </button>
      </div>
    )
  }

  const items: SourceItemData[] = (outfit.outfit_item ?? [])
    .filter((oi) => oi.item != null)
    .map((oi) => ({
      ...oi.item,
      brand: oi.item?.brand ?? null,
    }))

  const activeItemLabel = activeItemType
    ? activeItemType.toUpperCase().replace('_', ' ')
    : null

  // Build the full image list: main image + any additional images
  const allImages: string[] = [
    outfit.image_url,
    ...(((outfit as unknown as { additional_images?: string[] }).additional_images) ?? []),
  ].filter(Boolean)
  const safeIndex = Math.min(currentImageIndex, allImages.length - 1)
  const currentImageUrl = allImages[safeIndex] ?? outfit.image_url

  // Position of this look in the list, for prev/next between outfits.
  const siblingIdx = siblingIds.indexOf(outfitId)
  const hasPrevLook = siblingIdx > 0
  const hasNextLook = siblingIdx >= 0 && siblingIdx < siblingIds.length - 1

  // Swipe between looks (horizontal swipe wins over vertical scroll).
  function onLookTouchStart(e: React.TouchEvent) {
    touchStartX.current = e.touches[0].clientX
    touchStartY.current = e.touches[0].clientY
  }
  function onLookTouchEnd(e: React.TouchEvent) {
    if (touchStartX.current === null || touchStartY.current === null) return
    const dx = e.changedTouches[0].clientX - touchStartX.current
    const dy = e.changedTouches[0].clientY - touchStartY.current
    touchStartX.current = null
    touchStartY.current = null
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      goToSibling(dx < 0 ? 1 : -1) // swipe left → next, swipe right → prev
    }
  }

  return (
    <div className="max-w-[1440px] mx-auto px-10 py-8">

      {/* ── Back + Nav ─────────────────────────────────────── */}
      <div className="flex items-center justify-between mb-8">
        <button
          onClick={() => router.back()}
          className="text-[11px] tracking-[0.20em] text-[#6B6B6B] hover:text-[#0A0A0A] transition-colors duration-300 flex items-center gap-2"
        >
          ← BACK
        </button>
        <div className="flex items-center gap-4">
          <button
            onClick={() => goToSibling(-1)}
            disabled={!hasPrevLook}
            aria-label="Previous look"
            className="text-[20px] text-[#6B6B6B] hover:text-[#0A0A0A] transition-colors duration-300 leading-none disabled:opacity-25 disabled:cursor-default"
          >
            ‹
          </button>
          <button
            onClick={() => goToSibling(1)}
            disabled={!hasNextLook}
            aria-label="Next look"
            className="text-[20px] text-[#6B6B6B] hover:text-[#0A0A0A] transition-colors duration-300 leading-none disabled:opacity-25 disabled:cursor-default"
          >
            ›
          </button>
        </div>
      </div>

      {/* ── Main outfit detail ────────────────────────────── */}
      <div className="max-w-[560px] mx-auto mb-12">
        {/* Outfit image with hotspots + carousel arrows.
            Swipe horizontally to move between looks. */}
        <div className="relative" onTouchStart={onLookTouchStart} onTouchEnd={onLookTouchEnd}>
          <ImageWithHotspots
            key={currentImageUrl}
            outfit={outfit}
            imageUrl={currentImageUrl}
            activeItemLabel={activeItemLabel}
            onStyleItem={handleStyleItem}
          />

          {allImages.length > 1 && (
            <>
              {/* Prev arrow */}
              <button
                type="button"
                onClick={() => setCurrentImageIndex((i) => (i - 1 + allImages.length) % allImages.length)}
                className="absolute left-3 top-1/2 -translate-y-1/2 w-10 h-10 flex items-center justify-center bg-white/85 hover:bg-white text-[#0A0A0A] text-[22px] leading-none rounded-full shadow-sm transition-colors duration-200 z-10"
                aria-label="Previous photo"
              >
                ‹
              </button>
              {/* Next arrow */}
              <button
                type="button"
                onClick={() => setCurrentImageIndex((i) => (i + 1) % allImages.length)}
                className="absolute right-3 top-1/2 -translate-y-1/2 w-10 h-10 flex items-center justify-center bg-white/85 hover:bg-white text-[#0A0A0A] text-[22px] leading-none rounded-full shadow-sm transition-colors duration-200 z-10"
                aria-label="Next photo"
              >
                ›
              </button>

              {/* Counter */}
              <div className="absolute top-3 right-3 bg-black/60 text-white text-[10px] tracking-[0.15em] px-2.5 py-1 rounded-full">
                {safeIndex + 1} / {allImages.length}
              </div>
            </>
          )}
        </div>

        {/* Thumbnail strip */}
        {allImages.length > 1 && (
          <div className="flex gap-2 justify-center mb-4 mt-3">
            {allImages.map((url, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => setCurrentImageIndex(idx)}
                className={`relative w-14 h-16 border overflow-hidden transition-all duration-200 ${
                  idx === safeIndex
                    ? 'border-[#0A0A0A] opacity-100'
                    : 'border-[#E2E0DB] opacity-60 hover:opacity-100'
                }`}
                aria-label={`View photo ${idx + 1}`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={url} alt={`Photo ${idx + 1}`} className="w-full h-full object-cover" />
              </button>
            ))}
          </div>
        )}


        {/* Aesthetic label */}
        <p className="text-[15px] tracking-[0.18em] text-[#0A0A0A] mb-2">
          {outfit.aesthetic_label}
        </p>

        {/* Occasion tags */}
        {outfit.occasion_tags?.length > 0 && (
          <p className="text-[11px] tracking-[0.20em] text-[#6B6B6B] mb-5">
            {outfit.occasion_tags.join(' · ')}
          </p>
        )}

        {/* Action buttons — centred.
            SIMILAR LOOKS and EXPLORE STYLES are hidden via SHOW_BROWSE_BUTTONS
            while the corresponding edit/occasions sections aren't live yet.
            Flip the flag back to `true` to re-expose them — all downstream
            code (handlers, fetch logic, result grids) is untouched. */}
        <div className="flex items-center justify-center gap-2">
          <CardButton variant="filled" onClick={() => setSourcePanelOpen(true)}>
            SOURCE ITEMS
          </CardButton>
          {showBrowse && (
            <>
              <CardButton variant="filled" onClick={handleSimilarLooks}>
                SIMILAR LOOKS
              </CardButton>
              <CardButton variant="filled" onClick={handleExploreStyles}>
                EXPLORE STYLES
              </CardButton>
            </>
          )}
        </div>
      </div>

      {/* ── Style Item results ─────────────────────────────── */}
      {activeStyleItemId && styleItemOutfits.length > 0 && (
        <div className="mt-16">
          {/* Spacer between original and results */}
          <div className="border-t border-[#E2E0DB] mb-12" />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {styleItemOutfits.map((o) => (
              <OutfitCard
                key={o.outfit_id}
                outfit={o}
                detailHref={`${linkBase}/${o.outfit_id}`}
                onSimilarLooks={() => router.push(`${linkBase}/${o.outfit_id}?mode=similar`)}
                onExploreStyles={() => router.push(`${linkBase}/${o.outfit_id}?mode=explore`)}
                onStyleItem={(itemId, iType) => handleStyleItem(itemId, iType)}
              />
            ))}
          </div>
        </div>
      )}

      {/* ── Similar / Explore results ──────────────────────── */}
      {relatedOutfits.length > 0 && !activeStyleItemId && (
        <div className="mt-16">
          <div className="border-t border-[#E2E0DB] mb-8" />
          <p className="text-[11px] tracking-[0.25em] text-[#6B6B6B] mb-8 text-center">
            {activeMode === 'explore' ? 'EXPLORE STYLES' : 'SIMILAR LOOKS'}
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {relatedOutfits.map((o) => (
              <OutfitCard
                key={o.outfit_id}
                outfit={o}
                detailHref={`${linkBase}/${o.outfit_id}`}
                onSimilarLooks={() => router.push(`${linkBase}/${o.outfit_id}?mode=similar`)}
                onExploreStyles={() => router.push(`${linkBase}/${o.outfit_id}?mode=explore`)}
                onStyleItem={(itemId, iType) => handleStyleItem(itemId, iType)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Source panel */}
      <SourcePanel
        items={items}
        isOpen={sourcePanelOpen}
        onClose={() => setSourcePanelOpen(false)}
        outfitId={outfitId}
      />
    </div>
  )
}

// ── Image with hover-reveal hotspots ─────────────────────────
function ImageWithHotspots({
  outfit,
  imageUrl,
  activeItemLabel,
  onStyleItem,
}: {
  outfit: OutfitWithItems
  imageUrl?: string
  activeItemLabel: string | null
  onStyleItem: (itemId: string, itemType: ItemType) => void
}) {
  const [imageHovered, setImageHovered] = useState(false)
  const src = imageUrl || outfit.image_url || '/placeholder-outfit.jpg'

  return (
    <div
      className="relative aspect-[3/4] w-full overflow-hidden mb-4 bg-white"
      onMouseEnter={() => setImageHovered(true)}
      onMouseLeave={() => setImageHovered(false)}
    >
      <Image
        src={src}
        alt={outfit.aesthetic_label}
        fill
        priority
        className="object-contain"
        sizes="(max-width: 768px) 100vw, 560px"
      />

      {activeItemLabel && (
        <div className="absolute top-4 left-4 bg-white border border-[#0A0A0A] rounded-full px-3 py-1.5">
          <span className="text-[10px] tracking-[0.15em] text-[#0A0A0A]">
            STYLE {activeItemLabel} ↗
          </span>
        </div>
      )}

      {(outfit.outfit_item ?? []).filter((oi) => oi.item != null).map((oi) => {
        const pos = getDetailHotspotPosition(oi.slot)
        return (
          <Hotspot
            key={oi.outfit_item_id}
            itemId={oi.item_id}
            itemType={oi.item?.item_type ?? 'coat'}
            x={pos.x}
            y={pos.y}
            variant="detail"
            imageHovered={imageHovered}
            onStyleItem={onStyleItem}
          />
        )
      })}
    </div>
  )
}

// ── Detail view hotspot positions ────────────────────────────
function getDetailHotspotPosition(slot: string): { x: number; y: number } {
  const positions: Record<string, { x: number; y: number }> = {
    outerwear: { x: 50, y: 28 },
    top: { x: 44, y: 36 },
    bottom: { x: 50, y: 60 },
    dress: { x: 50, y: 48 },
    shoe: { x: 45, y: 87 },
    bag: { x: 28, y: 63 },
    jewellery: { x: 50, y: 20 },
    belt: { x: 50, y: 47 },
    accessory: { x: 50, y: 47 },
  }
  return positions[slot] ?? { x: 50, y: 50 }
}
