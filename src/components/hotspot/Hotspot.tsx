'use client'

import { useState } from 'react'
import type { ItemType } from '@/types/database'

interface HotspotProps {
  itemId: string
  itemType: ItemType
  // Position as percentage of image dimensions
  x: number // 0–100
  y: number // 0–100
  variant?: 'feed' | 'detail'
  onStyleItem?: (itemId: string, itemType: ItemType) => void
}

const ITEM_TYPE_LABELS: Partial<Record<ItemType, string>> = {
  coat: 'COAT',
  trench: 'TRENCH',
  jacket: 'JACKET',
  blazer: 'BLAZER',
  shirt: 'SHIRT',
  blouse: 'BLOUSE',
  't-shirt': 'TOP',
  knitwear: 'KNIT',
  trousers: 'TROUSERS',
  jeans: 'JEANS',
  skirt: 'SKIRT',
  mini_dress: 'DRESS',
  midi_dress: 'DRESS',
  maxi_dress: 'DRESS',
  shirt_dress: 'DRESS',
  slip_dress: 'DRESS',
  boot: 'BOOT',
  heel: 'HEEL',
  flat: 'FLAT',
  sneaker: 'SNEAKER',
  mule: 'MULE',
  sandal: 'SANDAL',
  tote: 'BAG',
  shoulder_bag: 'BAG',
  clutch: 'CLUTCH',
  crossbody: 'BAG',
  structured_bag: 'BAG',
  belt: 'BELT',
  scarf: 'SCARF',
  necklace: 'NECKLACE',
  earrings: 'EARRINGS',
  bracelet: 'BRACELET',
  hat: 'HAT',
  sunglasses: 'SUNGLASSES',
}

export default function Hotspot({
  itemId,
  itemType,
  x,
  y,
  variant = 'feed',
  onStyleItem,
}: HotspotProps) {
  const [active, setActive] = useState(false)
  const label = ITEM_TYPE_LABELS[itemType] ?? itemType.toUpperCase().replace('_', ' ')

  // Determine pill direction based on position
  const pillRight = x > 60 // show pill to the left if hotspot is on the right side

  const handleClick = () => {
    if (variant === 'feed') {
      setActive((v) => !v)
    } else {
      // Detail view: clicking triggers style item directly
      onStyleItem?.(itemId, itemType)
    }
  }

  return (
    <div
      className="absolute"
      style={{ left: `${x}%`, top: `${y}%`, transform: 'translate(-50%, -50%)' }}
    >
      {variant === 'feed' ? (
        // ── Feed dot — small solid circle ──────────────────────
        <div className="relative">
          <button
            aria-label={`Style ${label}`}
            onClick={handleClick}
            className="
              relative z-10 block
              w-2 h-2 rounded-full bg-[#0A0A0A]
              hotspot-pulse
              transition-all duration-300
              hover:scale-125
            "
          />
          {/* Active pill — shows on click */}
          {active && (
            <div
              className={`
                absolute top-1/2 -translate-y-1/2 z-20
                ${pillRight ? 'right-full mr-2' : 'left-full ml-2'}
                flex items-center gap-1
                bg-white border border-[#0A0A0A] rounded-full
                px-2.5 py-1
                whitespace-nowrap
                animate-[fadeIn_200ms_ease_forwards]
              `}
              style={{ animation: 'fadeIn 200ms ease forwards' }}
            >
              <button
                onClick={() => onStyleItem?.(itemId, itemType)}
                className="text-[10px] tracking-[0.15em] text-[#0A0A0A] flex items-center gap-1"
              >
                STYLE {label} <span className="text-sm">↗</span>
              </button>
            </div>
          )}
        </div>
      ) : (
        // ── Detail dot — larger white ring ──────────────────────
        <div className="relative group">
          <button
            aria-label={`Style ${label}`}
            onClick={handleClick}
            className="
              relative z-10 block
              w-5 h-5 rounded-full
              bg-white border-2 border-[#0A0A0A]
              transition-all duration-300
              hover:scale-110 hover:bg-[#0A0A0A]
            "
          />
          {/* Hover pill — appears on hover in detail view */}
          <div
            className={`
              absolute top-1/2 -translate-y-1/2 z-20
              ${pillRight ? 'right-full mr-3' : 'left-full ml-3'}
              opacity-0 group-hover:opacity-100
              transition-opacity duration-300
              flex items-center gap-1
              bg-white border border-[#0A0A0A]
              px-3 py-1.5 rounded-full
              whitespace-nowrap pointer-events-none group-hover:pointer-events-auto
            `}
          >
            <span className="text-[10px] tracking-[0.15em] text-[#0A0A0A] flex items-center gap-1">
              STYLE {label} <span className="text-sm">↗</span>
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
