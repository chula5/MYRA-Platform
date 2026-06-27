'use client'

import { useRef, useState } from 'react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import CardButton from '@/components/ui/CardButton'
import Hotspot from '@/components/hotspot/Hotspot'
import ShopTheLookOverlay from '@/components/source-panel/ShopTheLookOverlay'
import SaveHeartButton from '@/components/outfit-card/SaveHeartButton'
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

const MAX_DOTS = 7

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
    router.push(detailHref ?? `/outfit/${outfit.outfit_id}`)
  }

  // Dots — cap display at MAX_DOTS
  const dotsCount = Math.min(total, MAX_DOTS)
  const dotOffset = total > MAX_DOTS ? Math.max(0, Math.min(current - Math.floor(MAX_DOTS / 2), total - MAX_DOTS)) : 0

  return (
    <article className="relative flex flex-col">
      {/* Image carousel — 3:4 portrait */}
      <div
        className="relative aspect-[3/4] w-full overflow-hidden cursor-pointer rounded-[16px]"
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
            sizes="(max-width: 768px) 100vw, 33vw"
          />
        ) : (
          slides.map((slide, i) => (
            <Image
              key={i}
              src={slide.src}
              alt={slide.alt}
              fill
              className={`object-cover transition-opacity duration-300 ${i === current ? 'opacity-100' : 'opacity-0'}`}
              sizes="(max-width: 768px) 100vw, 33vw"
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

        {/* Desktop prev/next tap zones */}
        {total > 1 && (
          <>
            <button
              aria-label="Previous"
              className="absolute left-0 top-0 h-full w-1/3 z-10"
              onClick={(e) => { e.stopPropagation(); prev() }}
            />
            <button
              aria-label="Next"
              className="absolute right-0 top-0 h-full w-1/3 z-10"
              onClick={(e) => { e.stopPropagation(); next() }}
            />
          </>
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
              onStyleItem={(itemId, itemType) =>
                onStyleItem?.(itemId, itemType, outfit)
              }
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
      </div>

      {/* Card footer */}
      <div className="pt-3 pb-4 px-1">
        {/* Carousel dots */}
        {total > 1 && (
          <div className="flex items-center gap-1.5 mb-3">
            {Array.from({ length: dotsCount }).map((_, di) => {
              const slideI = dotOffset + di
              return (
                <button
                  key={di}
                  aria-label={`Go to slide ${slideI + 1}`}
                  onClick={() => setSlideIdx(slideI)}
                  className={`w-1.5 h-1.5 rounded-full transition-colors ${
                    slideI === current
                      ? 'bg-[#0A0A0A]'
                      : 'border border-[#A8A8A4]'
                  }`}
                />
              )
            })}
          </div>
        )}
        {total <= 1 && (
          <div className="flex items-center gap-1.5 mb-3">
            <span className="w-1.5 h-1.5 rounded-full bg-[#0A0A0A]" />
          </div>
        )}

        {/* Action buttons */}
        <div className="flex flex-wrap items-center justify-center gap-2">
          <CardButton
            variant="filled"
            onClick={() => setSourcePanelOpen((v) => !v)}
            className="flex-1"
          >
            SOURCE ITEMS
          </CardButton>
          <CardButton
            variant="filled"
            onClick={() => onSimilarLooks?.(outfit)}
            className="flex-1"
          >
            SIMILAR LOOKS
          </CardButton>
          <CardButton
            variant="filled"
            onClick={() => onExploreStyles?.(outfit)}
            className="flex-1"
          >
            EXPLORE STYLES
          </CardButton>
        </div>
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
