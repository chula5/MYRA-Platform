'use client'

import { useRef, useState } from 'react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import Hotspot from '@/components/hotspot/Hotspot'
import ShopTheLookOverlay from '@/components/source-panel/ShopTheLookOverlay'
import SaveHeartButton from '@/components/outfit-card/SaveHeartButton'
import { trackEngagement } from '@/lib/track'
import type { OutfitWithItems, Item, Brand, ItemType } from '@/types/database'

type SourceItemData = Item & { brand: Brand }

interface Slide {
  src: string
  alt: string
}

interface OutfitCardProps {
  outfit: OutfitWithItems
  onSimilarLooks?: (outfit: OutfitWithItems) => void
  onExploreStyles?: (outfit: OutfitWithItems) => void
  onStyleItem?: (itemId: string, itemType: ItemType, outfit: OutfitWithItems) => void
  detailHref?: string
  // Save (heart) — only shown for signed-in early-access users.
  canSave?: boolean
  initialSaved?: boolean
  // Signed-out: show a greyed heart that nudges sign-in instead.
  lockedSave?: boolean
}

export default function OutfitCard({
  outfit,
  onSimilarLooks,
  onExploreStyles,
  onStyleItem,
  detailHref,
  canSave = false,
  initialSaved = false,
  lockedSave = false,
}: OutfitCardProps) {
  const router = useRouter()
  const [sourcePanelOpen, setSourcePanelOpen] = useState(false)
  const [slideIdx, setSlideIdx] = useState(0)
  const touchStartX = useRef<number | null>(null)
  const didSwipe = useRef(false)

  const items: SourceItemData[] = (outfit.outfit_item ?? [])
    .filter((oi) => oi.item)
    .map((oi) => ({
      ...oi.item,
      brand: oi.item.brand,
    }))

  // Build slide list: outfit hero first, then item product images
  const slides: Slide[] = [
    ...(outfit.image_url ? [{ src: outfit.image_url, alt: outfit.aesthetic_label ?? 'Outfit' }] : []),
    ...items
      .filter((it) => it.image_url)
      .map((it) => ({ src: it.image_url!, alt: it.product_name ?? 'Item' })),
  ]

  const total = slides.length
  const current = total > 0 ? slideIdx % total : 0

  function prev() {
    setSlideIdx((i) => (i - 1 + total) % total)
  }
  function next() {
    setSlideIdx((i) => (i + 1) % total)
  }

  function onTouchStart(e: React.TouchEvent) {
    touchStartX.current = e.touches[0].clientX
    didSwipe.current = false
  }

  function onTouchEnd(e: React.TouchEvent) {
    if (touchStartX.current === null) return
    const delta = e.changedTouches[0].clientX - touchStartX.current
    touchStartX.current = null
    if (Math.abs(delta) > 38) {
      didSwipe.current = true
      delta < 0 ? next() : prev()
    }
  }

  function handleTap() {
    if (didSwipe.current) return
    trackEngagement('outfit_view', outfit.outfit_id)
    router.push(detailHref ?? `/outfit/${outfit.outfit_id}`)
  }

  const actionClass = 'pointer-events-auto text-white text-[8px] tracking-[0.12em] uppercase font-light hover:opacity-70 transition-opacity'

  return (
    <article className="relative flex flex-col">
      {/* Full-bleed image carousel — 3:4 portrait, actions overlaid */}
      <div
        className="relative aspect-[3/4] w-full overflow-hidden cursor-pointer"
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
        onClick={handleTap}
      >
        {slides.length === 0 ? (
          <Image
            src="/placeholder-outfit.jpg"
            alt="Outfit"
            fill
            className="object-cover"
            sizes="(max-width: 768px) 50vw, 33vw"
          />
        ) : (
          slides.map((slide, i) => (
            <Image
              key={i}
              src={slide.src}
              alt={slide.alt}
              fill
              className={`object-cover transition-opacity duration-300 ${i === current ? 'opacity-100' : 'opacity-0'}`}
              sizes="(max-width: 768px) 50vw, 33vw"
              priority={i === 0}
            />
          ))
        )}

        {/* Save heart (signed-in users) */}
        {canSave ? (
          <SaveHeartButton outfitId={outfit.outfit_id} initialSaved={initialSaved} />
        ) : lockedSave ? (
          <SaveHeartButton outfitId={outfit.outfit_id} locked />
        ) : null}

        {/* Right-side tap zone flicks to the next image; tapping anywhere else
            opens the outfit detail (handleTap). Left/centre fall through. */}
        {total > 1 && (
          <button
            aria-label="Next image"
            className="absolute right-0 top-0 h-full w-1/3 z-10"
            onClick={(e) => { e.stopPropagation(); next() }}
          />
        )}

        {/* Hotspots — only on slide 0 (the outfit hero) */}
        {current === 0 && (outfit.outfit_item ?? []).filter((oi) => oi.item).map((oi) => {
          const pos = getPlaceholderPosition(oi.slot)
          return (
            <Hotspot
              key={oi.outfit_item_id}
              itemId={oi.item_id}
              itemType={oi.item.item_type}
              x={pos.x}
              y={pos.y}
              variant="feed"
              onStyleItem={(itemId, itemType) => {
                trackEngagement('style_item', itemId)
                onStyleItem?.(itemId, itemType, outfit)
              }}
            />
          )
        })}

        {/* Shop-the-look cards overlaid on the photo (toggled by SOURCE ITEMS) */}
        {sourcePanelOpen && items.length > 0 && (
          <div
            className="absolute inset-0 z-30"
            onClick={(e) => e.stopPropagation()}
            onTouchStart={(e) => e.stopPropagation()}
            onTouchEnd={(e) => e.stopPropagation()}
          >
            <ShopTheLookOverlay
              items={items}
              outfitId={outfit.outfit_id}
              onClose={() => setSourcePanelOpen(false)}
            />
          </div>
        )}

        {/* Actions — white text overlaid on the photo (editorial). Source Items +
            Similar Looks on one row, Explore Styles centred underneath. */}
        {!sourcePanelOpen && (
          <div className="absolute inset-x-0 bottom-0 z-20 pt-10 pb-3 px-3 bg-gradient-to-t from-black/55 via-black/20 to-transparent pointer-events-none">
            <div className="flex items-center justify-center gap-5">
              <button onClick={(e) => { e.stopPropagation(); setSourcePanelOpen(true) }} className={actionClass}>Source Items</button>
              <button onClick={(e) => { e.stopPropagation(); trackEngagement('similar_looks', outfit.outfit_id); onSimilarLooks?.(outfit) }} className={actionClass}>Similar Looks</button>
            </div>
            <div className="flex justify-center mt-1.5">
              <button onClick={(e) => { e.stopPropagation(); trackEngagement('explore_styles', outfit.outfit_id); onExploreStyles?.(outfit) }} className={actionClass}>Explore Styles</button>
            </div>
          </div>
        )}
      </div>
    </article>
  )
}

// ── Placeholder slot positions (until hotspot coords come from DB) ──
function getPlaceholderPosition(slot: string): { x: number; y: number } {
  const positions: Record<string, { x: number; y: number }> = {
    outerwear: { x: 50, y: 30 },
    top: { x: 45, y: 38 },
    bottom: { x: 50, y: 62 },
    dress: { x: 50, y: 50 },
    shoe: { x: 45, y: 88 },
    bag: { x: 70, y: 60 },
    jewellery: { x: 50, y: 22 },
    accessory: { x: 55, y: 20 },
  }
  return positions[slot] ?? { x: 50, y: 50 }
}
