'use client'

import { useState } from 'react'
import type { ItemType } from '@/types/database'

// Style-Item hotspots site-wide. Flip to `false` to hide.
const HOTSPOTS_ENABLED = true

// Thin diagonal arrow drawn as SVG so it renders identically on every platform
// (the Unicode ↗ shows as a blue emoji on iOS).
function StyleArrow() {
  return (
    <svg
      viewBox="0 0 12 12"
      className="inline-block w-2.5 h-2.5 -mt-px"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3.5 8.5 8.5 3.5M4.7 3.5h3.8v3.8" />
    </svg>
  )
}

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

  if (!HOTSPOTS_ENABLED) return null

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
        // ── Feed — see-through circle that fades in on card hover; reveals a
        //    "STYLE [item]" label on its own hover; click styles that item.
        //    stopPropagation/preventDefault so it doesn't trigger the card link.
        <div className="relative group/hot">
          <button
            type="button"
            aria-label={`Style ${label}`}
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); onStyleItem?.(itemId, itemType) }}
            className="
              relative z-10 block w-7 h-7 rounded-full
              bg-white/40 backdrop-blur-sm border border-white/70
              shadow-[0_1px_4px_rgba(0,0,0,0.15)]
              opacity-0 group-hover:opacity-100
              hover:bg-white/80 hover:scale-110
              transition-all duration-300 cursor-pointer
            "
          />
          <div
            className={`
              absolute top-1/2 -translate-y-1/2 z-20
              ${pillRight ? 'right-full mr-2' : 'left-full ml-2'}
              hidden group-hover/hot:flex items-center
              bg-[#9B9B9B]/30 backdrop-blur-md border border-white/40 rounded-full
              px-2.5 py-1 whitespace-nowrap pointer-events-none
            `}
          >
            <span className="text-[10px] tracking-[0.068em] text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.35)]">
              STYLE {label} <StyleArrow />
            </span>
          </div>
        </div>
      ) : (
        // ── Detail — dot gently beacons (appears/disappears) so it's discoverable
        //    on desktop AND mobile without a hover; pill opens on click/tap. ──
        <div className="relative group">
          {/* Expanding ring — the attention pulse */}
          <span
            aria-hidden
            className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-7 h-7 rounded-full border border-white/80 hotspot-ring pointer-events-none z-0"
            style={{ animationDelay: `${(x % 3) * 0.6}s` }}
          />
          <button
            type="button"
            aria-label={`Style ${label}`}
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleClick() }}
            style={{ animationDelay: `${(x % 3) * 0.6}s` }}
            className="
              relative z-10 block w-7 h-7 rounded-full
              bg-white/40 backdrop-blur-sm border border-white/70
              shadow-[0_1px_4px_rgba(0,0,0,0.18)]
              hotspot-beacon hover:bg-white/80 hover:scale-110
              transition-[background-color,transform] duration-300 cursor-pointer
            "
          />
          {/* Pill — appears on click */}
          {active && (
            <div
              className={`
                absolute top-1/2 -translate-y-1/2 z-20
                ${pillRight ? 'right-full mr-3' : 'left-full ml-3'}
                flex items-center gap-1
                bg-[#9B9B9B]/30 backdrop-blur-md border border-white/40
                px-3 py-1.5 rounded-full
                whitespace-nowrap
              `}
            >
              <button
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); onStyleItem?.(itemId, itemType) }}
                className="text-[10px] tracking-[0.068em] text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.35)] flex items-center gap-1"
              >
                STYLE {label} <StyleArrow />
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
