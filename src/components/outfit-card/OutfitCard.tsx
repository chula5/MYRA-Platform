'use client'

import { useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import CardButton from '@/components/ui/CardButton'
import Hotspot from '@/components/hotspot/Hotspot'
import SourcePanel from '@/components/source-panel/SourcePanel'
import type { OutfitWithItems, Item, Brand, ItemType } from '@/types/database'

type SourceItemData = Item & { brand: Brand }

interface OutfitCardProps {
  outfit: OutfitWithItems
  onSimilarLooks?: (outfit: OutfitWithItems) => void
  onExploreStyles?: (outfit: OutfitWithItems) => void
  onStyleItem?: (itemId: string, itemType: ItemType, outfit: OutfitWithItems) => void
}

export default function OutfitCard({
  outfit,
  onSimilarLooks,
  onExploreStyles,
  onStyleItem,
}: OutfitCardProps) {
  const [sourcePanelOpen, setSourcePanelOpen] = useState(false)

  const items: SourceItemData[] = (outfit.outfit_item ?? []).map((oi) => ({
    ...oi.item,
    brand: oi.item.brand,
  }))

  return (
    <article className="relative bg-white flex flex-col">
      {/* Image container — 3:4 portrait */}
      <Link href={`/outfit/${outfit.outfit_id}`} className="block relative aspect-[3/4] w-full overflow-hidden">
        <Image
          src={outfit.image_url || '/placeholder-outfit.jpg'}
          alt={outfit.aesthetic_label}
          fill
          className="object-cover transition-transform duration-500 hover:scale-[1.01]"
          sizes="(max-width: 768px) 100vw, 33vw"
        />

        {/* Hotspot dots — positioned on items */}
        {(outfit.outfit_item ?? []).map((oi) => {
          // Hotspot positions would ideally come from DB
          // Using placeholder positions for now
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
      </Link>

      {/* Card footer */}
      <div className="pt-3 pb-4 px-1">
        {/* Aesthetic label */}
        <p className="text-[13px] tracking-[0.15em] text-[#0A0A0A] mb-2">
          {outfit.aesthetic_label}
        </p>

        {/* Dot carousel indicator (static — shows 1 active) */}
        <div className="flex items-center gap-1.5 mb-3">
          <span className="w-1.5 h-1.5 rounded-full bg-[#0A0A0A]" />
          <span className="w-1.5 h-1.5 rounded-full border border-[#A8A8A4]" />
          <span className="w-1.5 h-1.5 rounded-full border border-[#A8A8A4]" />
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-2">
          <CardButton
            variant="filled"
            onClick={() => setSourcePanelOpen(true)}
            className="flex-1"
          >
            SOURCE ITEMS
          </CardButton>
          <CardButton
            variant="outlined"
            onClick={() => onSimilarLooks?.(outfit)}
            className="flex-1"
          >
            SIMILAR LOOKS
          </CardButton>
          <CardButton
            variant="outlined"
            onClick={() => onExploreStyles?.(outfit)}
            className="flex-1"
          >
            EXPLORE STYLES
          </CardButton>
        </div>
      </div>

      {/* Source panel — slides from left */}
      <SourcePanel
        items={items}
        isOpen={sourcePanelOpen}
        onClose={() => setSourcePanelOpen(false)}
      />
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
