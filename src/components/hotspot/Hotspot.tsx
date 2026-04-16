'use client'

import { useState } from 'react'
import type { ItemType } from '@/types/database'

interface HotspotProps {
  itemId: string
  itemType: ItemType
  x: number // 0–100
  y: number // 0–100
  variant?: 'feed' | 'detail'
  imageHovered?: boolean
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
  imageHovered = false,
  onStyleItem,
}: HotspotProps) {
  const [active, setActive] = useState(false)
  const label = ITEM_TYPE_LABELS[itemType] ?? itemType.toUpperCase().replace('_', ' ')

  // Determine pill direction based on position
  const pillRight = x > 60 // show pill to the left if hotspot is on the right side

  const handleClick = () => {
    setActive((v) => !v)
  }

  return (
    <div
      className="absolute"
      style={{ left: `${x}%`, top: `${y}%`, transform: 'translate(-50%, -50%)' }}
    >
      {variant === 'feed' ? (
        // ── Feed — invisible, show pill on hover ───────────────
        <div className="relative group">
          <button
            aria-label={`Style ${label}`}
            onClick={handleClick}
            className="relative z-10 block w-10 h-10 rounded-full opacity-0"
          />
          {active && (
            <div
              className={`
                absolute top-1/2 -translate-y-1/2 z-20
                ${pillRight ? 'right-full mr-2' : 'left-full ml-2'}
                flex items-center gap-1
                bg-white border border-[#0A0A0A] rounded-full
                px-2.5 py-1 whitespace-nowrap
              `}
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
        // ── Detail — dot appears when image is hovered, pill on click ──
        <div className="relative group">
          <button
            aria-label={`Style ${label}`}
            onClick={handleClick}
            className={`
              relative z-10 block w-7 h-7 rounded-full
              bg-white/40 backdrop-blur-sm border border-white/60
              transition-all duration-300 cursor-pointer
              ${imageHovered ? 'opacity-100 scale-100' : 'opacity-0 scale-75 pointer-events-none'}
              hover:bg-white/70
            `}
          />
          {/* Pill — appears on click */}
          {active && (
            <div
              className={`
                absolute top-1/2 -translate-y-1/2 z-20
                ${pillRight ? 'right-full mr-3' : 'left-full ml-3'}
                flex items-center gap-1
                bg-white border border-[#0A0A0A]
                px-3 py-1.5 rounded-full
                whitespace-nowrap
              `}
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
      )}
    </div>
  )
}
