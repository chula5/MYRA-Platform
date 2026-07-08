'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import Hotspot from '@/components/hotspot/Hotspot'
import ShopTheLookOverlay from '@/components/source-panel/ShopTheLookOverlay'
import OutfitCard from '@/components/outfit-card/OutfitCard'
import SaveHeartButton from '@/components/outfit-card/SaveHeartButton'
import CardButton from '@/components/ui/CardButton'
import { createClient } from '@/lib/supabase'
import { getRelatedOutfits, getStyleItemOutfits } from './related-actions'
import { trackEngagement } from '@/lib/track'
import { toggleSaveItem } from '@/app/edit/save-actions'
import type { OutfitWithItems, Item, Brand, ItemType } from '@/types/database'

// Feature flag — hide the SIMILAR LOOKS / EXPLORE STYLES buttons on the
// outfit detail page until THE EDIT / OCCASIONS sections are launched.
// Flip to `true` to re-expose both buttons (all handlers + result grids
// stay in place, so nothing else needs to change).
const SHOW_BROWSE_BUTTONS = true

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
  canSave?: boolean                 // show the SAVE toggle (signed-in users)
  initialSaved?: boolean
  savedItemIds?: string[]           // item ids already in the user's wardrobe
}

export default function OutfitDetailClient({
  outfitId,
  styleItemId,
  itemType,
  mode,
  initialOutfit,
  showBrowseButtons,
  linkBase = '/outfit',
  canSave = false,
  initialSaved = false,
  savedItemIds = [],
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
  // The Source Items panel overlays the hero image; keep a ref so opening it
  // always scrolls the hero into view (it can be off-screen after scrolling
  // down to the styled results).
  const heroRef = useRef<HTMLDivElement>(null)
  const openSourcePanel = () => {
    const next = !sourcePanelOpen
    setSourcePanelOpen(next)
    if (next) requestAnimationFrame(() => heroRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }))
  }

  // Saved items live here (lifted) so the Shop-the-look hearts and the image
  // hover heart stay in sync. Optimistic; reverts on error.
  const [savedItemSet, setSavedItemSet] = useState<Set<string>>(() => new Set(savedItemIds))
  function toggleItem(itemId: string) {
    const willSave = !savedItemSet.has(itemId)
    setSavedItemSet((prev) => {
      const next = new Set(prev)
      if (willSave) next.add(itemId)
      else next.delete(itemId)
      return next
    })
    toggleSaveItem(itemId, outfitId).then((res) => {
      if (res?.error) {
        setSavedItemSet((prev) => {
          const next = new Set(prev)
          if (willSave) next.delete(itemId)
          else next.add(itemId)
          return next
        })
      }
    })
  }
  const [activeStyleItemId, setActiveStyleItemId] = useState<string | null>(styleItemId ?? null)
  const [activeItemType, setActiveItemType] = useState<ItemType | null>(itemType as ItemType ?? null)
  const [loading, setLoading] = useState(!initialOutfit)
  const [currentImageIndex, setCurrentImageIndex] = useState(0)

  // Ordered list of sibling outfits so the user can swipe/arrow between looks.
  const [siblings, setSiblings] = useState<{ id: string; image: string }[]>([])
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
        .select('outfit_id, image_url, outfit_item(item_id, slot)')
        .eq('status', 'live')
        .order('published_at', { ascending: false })
      if (!data) return

      // Hero garment of an outfit (dress → top → bottom → outerwear → first).
      const anchorOf = (oi: { item_id: string; slot: string }[]): string | null => {
        const bySlot = (s: string) => oi.find((x) => x.slot === s)?.item_id
        return bySlot('dress') || bySlot('top') || bySlot('bottom') || bySlot('outerwear') || oi[0]?.item_id || null
      }

      // One look per anchor garment so adjacent looks aren't the same piece
      // styled twice. Keep the FIRST per anchor, but make sure THIS outfit is
      // the one kept for its own anchor (so nav/peek stays anchored on it).
      const seen = new Map<string, number>()
      const out: { id: string; image: string }[] = []
      for (const o of data as { outfit_id: string; image_url: string; outfit_item: { item_id: string; slot: string }[] }[]) {
        const anchor = anchorOf(o.outfit_item ?? [])
        if (anchor && seen.has(anchor)) {
          if (o.outfit_id === outfitId) out[seen.get(anchor)!] = { id: o.outfit_id, image: o.image_url }
          continue
        }
        if (anchor) seen.set(anchor, out.length)
        out.push({ id: o.outfit_id, image: o.image_url })
      }
      setSiblings(out)
    }
    loadSiblings()
  }, [outfitId])

  // Navigate to a specific look (by absolute index) or by direction.
  const goToIndex = useCallback((target: number) => {
    if (target < 0 || target >= siblings.length) return
    router.push(`${linkBase}/${siblings[target].id}`)
  }, [siblings, router, linkBase])

  const goToSibling = useCallback((dir: -1 | 1) => {
    const idx = siblings.findIndex((s) => s.id === outfitId)
    if (idx === -1) return
    goToIndex(idx + dir)
  }, [siblings, outfitId, goToIndex])

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
  // Server action (admin client) so each result card carries its full items —
  // the anon client drops them under RLS, which broke the cards' SOURCE ITEMS.
  const fetchStyleItemOutfits = useCallback(async (itemId: string) => {
    const res = await getStyleItemOutfits(outfitId, itemId)
    setStyleItemOutfits(res.outfits ?? [])
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
    trackEngagement('style_item', itemId)
    setActiveStyleItemId(itemId)
    setActiveItemType(iType)
    setStyleItemOutfits([])
    fetchStyleItemOutfits(itemId)
  }

  const handleSimilarLooks = () => {
    if (!outfit) return
    trackEngagement('similar_looks', outfit.outfit_id)
    // Clear any active style-item view so the Similar results aren't suppressed
    // (the results section only renders when no style-item is active).
    setActiveStyleItemId(null)
    setActiveItemType(null)
    setStyleItemOutfits([])
    fetchRelatedOutfits(outfit, 'similar')
  }

  const handleExploreStyles = () => {
    if (!outfit) return
    trackEngagement('explore_styles', outfit.outfit_id)
    setActiveStyleItemId(null)
    setActiveItemType(null)
    setStyleItemOutfits([])
    fetchRelatedOutfits(outfit, 'explore')
  }

  if (loading) {
    return (
      <div className="max-w-[800px] mx-auto px-10 py-12">
        <div className="aspect-[3/4] bg-[#F2F2F2] animate-pulse rounded-[10px]" />
      </div>
    )
  }

  if (!outfit) {
    return (
      <div className="text-center py-24 px-10">
        <p className="text-[11px] tracking-[0.113em] text-[#A8A8A4]">OUTFIT NOT FOUND</p>
        <button
          onClick={() => router.back()}
          className="mt-6 text-[11px] tracking-[0.09em] underline text-[#6B6B6B]"
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

  // Build the full image list so the user can scroll through every piece:
  // the outfit shot, any additional shots, then each item's product photo.
  const allImages: string[] = Array.from(
    new Set(
      [
        outfit.image_url,
        ...(((outfit as unknown as { additional_images?: string[] }).additional_images) ?? []),
        ...items.map((it) => it.image_url),
      ].filter(Boolean) as string[],
    ),
  )
  const safeIndex = Math.min(currentImageIndex, allImages.length - 1)
  const currentImageUrl = allImages[safeIndex] ?? outfit.image_url

  // Which item (if any) the currently-shown photo belongs to — so we can offer
  // to save that specific piece when the user hovers its image.
  const imageItemMap = new Map(items.filter((it) => it.image_url).map((it) => [it.image_url as string, it]))
  const currentItem = imageItemMap.get(currentImageUrl)

  // Position of this look in the list, for prev/next between outfits.
  const siblingIdx = siblings.findIndex((s) => s.id === outfitId)
  const hasPrevLook = siblingIdx > 0
  const hasNextLook = siblingIdx >= 0 && siblingIdx < siblings.length - 1
  const prevImage = hasPrevLook ? siblings[siblingIdx - 1].image : null
  const nextImage = hasNextLook ? siblings[siblingIdx + 1].image : null

  // Windowed dots (the list can be long — show up to 7 around the current look).
  const DOTS = 7
  const dotStart = siblings.length <= DOTS
    ? 0
    : Math.max(0, Math.min(siblingIdx - Math.floor(DOTS / 2), siblings.length - DOTS))
  const dotIndices = Array.from(
    { length: Math.min(DOTS, siblings.length) },
    (_, k) => dotStart + k,
  )

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
          className="text-[11px] tracking-[0.09em] text-[#6B6B6B] hover:text-[#4A4E57] transition-colors duration-300 flex items-center gap-2"
        >
          ← BACK
        </button>
        <div className="flex items-center gap-4">
          <button
            onClick={() => goToSibling(-1)}
            disabled={!hasPrevLook}
            aria-label="Previous look"
            className="text-[20px] text-[#6B6B6B] hover:text-[#4A4E57] transition-colors duration-300 leading-none disabled:opacity-25 disabled:cursor-default"
          >
            ‹
          </button>
          <button
            onClick={() => goToSibling(1)}
            disabled={!hasNextLook}
            aria-label="Next look"
            className="text-[20px] text-[#6B6B6B] hover:text-[#4A4E57] transition-colors duration-300 leading-none disabled:opacity-25 disabled:cursor-default"
          >
            ›
          </button>
        </div>
      </div>

      {/* ── Main outfit detail ────────────────────────────── */}
      <div className="mb-12">
        {/* Look carousel — current look sharp & centred, neighbours peek behind.
            Swipe horizontally (or use the arrows / dots) to move between looks. */}
        <div className="relative overflow-hidden">
          <div
            className="relative mx-auto max-w-[440px]"
            onTouchStart={onLookTouchStart}
            onTouchEnd={onLookTouchEnd}
          >
            {/* Previous look — peeking, blurred */}
            {prevImage && (
              <button
                type="button"
                onClick={() => goToSibling(-1)}
                aria-label="Previous look"
                className="absolute top-1/2 right-full w-full z-0 hidden sm:block cursor-pointer"
                style={{ transform: 'translateY(-50%) translateX(56%) scale(0.9)' }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={prevImage}
                  alt=""
                  className="w-full aspect-[3/4] object-cover rounded-[10px]"
                  style={{ filter: 'blur(1px)', opacity: 0.7 }}
                />
              </button>
            )}
            {/* Next look — peeking, blurred */}
            {nextImage && (
              <button
                type="button"
                onClick={() => goToSibling(1)}
                aria-label="Next look"
                className="absolute top-1/2 left-full w-full z-0 hidden sm:block cursor-pointer"
                style={{ transform: 'translateY(-50%) translateX(-56%) scale(0.9)' }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={nextImage}
                  alt=""
                  className="w-full aspect-[3/4] object-cover rounded-[10px]"
                  style={{ filter: 'blur(1px)', opacity: 0.7 }}
                />
              </button>
            )}

            {/* Current look */}
            <div ref={heroRef} className="relative z-10 bg-white rounded-[16px] overflow-hidden group scroll-mt-20">
              <ImageWithHotspots
                key={currentImageUrl}
                outfit={outfit}
                imageUrl={currentImageUrl}
                activeItemLabel={safeIndex === 0 ? activeItemLabel : null}
                onStyleItem={handleStyleItem}
                showHotspots={safeIndex === 0}
              />

              {/* Save heart on an ITEM photo — appears on hover, top-right */}
              {canSave && currentItem && !sourcePanelOpen && (
                <button
                  onClick={() => toggleItem(currentItem.item_id)}
                  aria-label={savedItemSet.has(currentItem.item_id) ? 'Remove item from wardrobe' : 'Save item to wardrobe'}
                  className="absolute top-3 right-3 z-30 w-9 h-9 rounded-full bg-white/90 hover:bg-white shadow-sm flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <span className={`text-[16px] leading-none ${savedItemSet.has(currentItem.item_id) ? 'text-[#C8302A]' : 'text-[#6B6B6B]'}`}>
                    {savedItemSet.has(currentItem.item_id) ? '♥' : '♡'}
                  </span>
                </button>
              )}

              {/* Shop-the-look cards overlaid on the image (toggled by SOURCE ITEMS) */}
              {sourcePanelOpen && items.length > 0 && (
                <ShopTheLookOverlay
                  items={items}
                  outfitId={outfitId}
                  onClose={() => setSourcePanelOpen(false)}
                  canSave={canSave}
                  savedItemIds={[...savedItemSet]}
                  onToggleItem={toggleItem}
                />
              )}

              {allImages.length > 1 && (
                <>
                  {/* Prev photo */}
                  <button
                    type="button"
                    onClick={() => setCurrentImageIndex((i) => (i - 1 + allImages.length) % allImages.length)}
                    className="absolute left-3 top-1/2 -translate-y-1/2 w-10 h-10 flex items-center justify-center bg-white/85 hover:bg-white text-[#4A4E57] text-[22px] leading-none rounded-full shadow-sm transition-colors duration-200 z-20"
                    aria-label="Previous photo"
                  >
                    ‹
                  </button>
                  {/* Next photo */}
                  <button
                    type="button"
                    onClick={() => setCurrentImageIndex((i) => (i + 1) % allImages.length)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 w-10 h-10 flex items-center justify-center bg-white/85 hover:bg-white text-[#4A4E57] text-[22px] leading-none rounded-full shadow-sm transition-colors duration-200 z-20"
                    aria-label="Next photo"
                  >
                    ›
                  </button>

                  {/* Counter */}
                  <div className="absolute top-3 right-3 bg-black/60 text-white text-[10px] tracking-[0.068em] px-2.5 py-1 rounded-full z-20">
                    {safeIndex + 1} / {allImages.length}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Look position dots */}
        {siblings.length > 1 && (
          <div className="flex items-center justify-center gap-1.5 mt-5 mb-1">
            {dotIndices.map((di) => (
              <button
                key={di}
                type="button"
                onClick={() => goToIndex(di)}
                aria-label={`Go to look ${di + 1}`}
                className={`h-1.5 rounded-full transition-all duration-300 ${
                  di === siblingIdx ? 'w-5 bg-[#0A0A0A]' : 'w-1.5 bg-[#D8D6D1] hover:bg-[#A8A8A4]'
                }`}
              />
            ))}
          </div>
        )}

        <div className="max-w-[560px] mx-auto mt-6">
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


        {/* Occasion tags */}
        {outfit.occasion_tags?.length > 0 && (
          <p className="text-[11px] tracking-[0.09em] text-[#6B6B6B] mb-5">
            {outfit.occasion_tags.join(' · ')}
          </p>
        )}

        {/* Action buttons — centred.
            SIMILAR LOOKS and EXPLORE STYLES are hidden via SHOW_BROWSE_BUTTONS
            while the corresponding edit/occasions sections aren't live yet.
            Flip the flag back to `true` to re-expose them — all downstream
            code (handlers, fetch logic, result grids) is untouched. */}
        <div className="flex flex-wrap items-center justify-center gap-2">
          {canSave && <SaveHeartButton outfitId={outfitId} initialSaved={initialSaved} variant="detail" />}
          <CardButton variant="filled" onClick={openSourcePanel}>
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
      </div>

      {/* ── Style Item results ─────────────────────────────── */}
      {activeStyleItemId && styleItemOutfits.length > 0 && (
        <div className="mt-8">
          {/* Spacer between original and results */}
          <div className="border-t border-[#E2E0DB] mb-6" />
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
        <div className="mt-8">
          <div className="border-t border-[#E2E0DB] mb-6" />
          <p className="text-[11px] tracking-[0.113em] text-[#6B6B6B] mb-8 text-center">
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
    </div>
  )
}

// ── Image with hover-reveal hotspots ─────────────────────────
function ImageWithHotspots({
  outfit,
  imageUrl,
  activeItemLabel,
  onStyleItem,
  showHotspots = true,
}: {
  outfit: OutfitWithItems
  imageUrl?: string
  activeItemLabel: string | null
  onStyleItem: (itemId: string, itemType: ItemType) => void
  showHotspots?: boolean
}) {
  const [imageHovered, setImageHovered] = useState(false)
  const src = imageUrl || outfit.image_url || '/placeholder-outfit.jpg'

  return (
    <div
      className="relative aspect-[3/4] w-full overflow-hidden bg-white"
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

      {showHotspots && (outfit.outfit_item ?? []).filter((oi) => oi.item != null).map((oi) => {
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
