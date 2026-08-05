'use client'

import { useState } from 'react'
import FallbackImage from '@/components/FallbackImage'
import ShopLink from '@/components/ShopLink'
import { formatGbp } from '@/lib/currency'
import type { Item, Brand } from '@/types/database'

type SourceItem = Item & { brand: Brand }

// "Shop the look" cards overlaid on the outfit image (top-left), replacing the
// old side drawer. Each card opens the retailer and records the click.
export default function ShopTheLookOverlay({
  items,
  outfitId,
  onClose,
  canSave = false,
  savedItemIds = [],
  onToggleItem,
  offsetTop = false,
}: {
  items: SourceItem[]
  outfitId?: string
  onClose: () => void
  canSave?: boolean
  savedItemIds?: string[]
  onToggleItem?: (itemId: string) => void
  // On the detail view the mobile header (BACK + arrows) overlays the image top,
  // so push the panel down on mobile to clear it (desktop has no such header).
  offsetTop?: boolean
}) {
  const savedSet = new Set(savedItemIds)
  // Click logging + affiliate routing is handled entirely by ShopLink
  // (redirect via /go/ for most merchants, beacon for Awin ones).

  return (
    <div className={`absolute left-2.5 z-30 w-[27%] max-w-[100px] sm:w-[34%] sm:max-w-[176px] overflow-y-auto pr-1 ${
      offsetTop
        ? 'top-12 sm:top-2.5 max-h-[calc(100%-3.75rem)] sm:max-h-[calc(100%-1.25rem)]'
        : 'top-2.5 max-h-[calc(100%-1.25rem)]'
    }`}>
      {/* Header */}
      <div className="flex items-center gap-1.5 mb-2">
        <span className="text-white text-[8px] sm:text-[9px] tracking-[0.081em] drop-shadow-[0_1px_3px_rgba(0,0,0,0.55)]">
          SHOP THE LOOK
        </span>
        <span className="bg-white/90 text-[#4A4E57] text-[8px] tracking-[0.036em] rounded-full px-1.5 py-0.5 leading-none">
          {items.length}
        </span>
        <button
          onClick={onClose}
          aria-label="Hide shop the look"
          className="ml-auto bg-white/90 text-[#4A4E57] w-4 h-4 rounded-full text-[10px] leading-none flex items-center justify-center hover:bg-white"
        >
          ×
        </button>
      </div>

      {/* Item rectangles — brand/name/price bottom-left, SHOP bottom-right (text) */}
      <div className="space-y-2">
        {items.map((item) => (
          <ItemCard
            key={item.item_id}
            item={item}
            outfitId={outfitId}
            canSave={canSave}
            saved={savedSet.has(item.item_id)}
            onToggle={() => onToggleItem?.(item.item_id)}
          />
        ))}
      </div>
    </div>
  )
}

function ItemCard({
  item,
  outfitId,
  canSave,
  saved,
  onToggle,
}: {
  item: SourceItem
  outfitId?: string
  canSave: boolean
  saved: boolean
  onToggle: () => void
}) {
  const [imgFailed, setImgFailed] = useState(false)
  const brandInitial = (item.brand?.name ?? 'M').trim().charAt(0).toUpperCase()
  // Source Items shows GBP only (no bracketed original — that's the big view).
  const price = formatGbp(item.price ?? null, item.currency ?? null)

  return (
    <div className="relative w-full aspect-[3/4] overflow-hidden bg-[#EDEDED]">
      {/* Item photo (rectangle) */}
      {item.image_url && !imgFailed ? (
        <FallbackImage
          src={item.image_url}
          thumbWidth={500}
          alt={item.product_name}
          loading="lazy"
          className="absolute inset-0 w-full h-full object-cover"
          onExhausted={() => setImgFailed(true)}
        />
      ) : (
        <div className="w-full h-full bg-[#E2E0DB] flex items-center justify-center">
          <span className="text-[16px] text-[#6B6B6B]">{brandInitial}</span>
        </div>
      )}

      {/* Save heart — top-right */}
      {canSave && (
        <button
          onClick={(e) => { e.stopPropagation(); onToggle() }}
          aria-label={saved ? 'Remove item from wardrobe' : 'Save item to wardrobe'}
          className="absolute top-1.5 right-1.5 z-10 w-5 h-5 rounded-full bg-white/85 flex items-center justify-center"
        >
          <span className={`text-[10px] leading-none ${saved ? 'text-[#C8302A]' : 'text-[#6B6B6B]'}`}>{saved ? '♥' : '♡'}</span>
        </button>
      )}

      {/* Text overlay — brand/name/price bottom-left, SHOP bottom-right */}
      <div className="absolute inset-x-0 bottom-0 z-10 pt-8 pb-1.5 px-1.5 sm:pt-10 sm:pb-2 sm:px-2 bg-gradient-to-t from-black/70 via-black/25 to-transparent">
        <div className="flex items-end justify-between gap-1.5">
          <div className="min-w-0">
            <p className="text-white/75 text-[6px] sm:text-[7px] tracking-[0.06em] uppercase truncate">{item.brand?.name ?? 'BRAND'}</p>
            <p className="text-white text-[7px] sm:text-[9px] leading-[1.15] line-clamp-2 mt-0.5">{item.product_name}</p>
            <p className="text-white/90 text-[7px] sm:text-[8px] tracking-[0.03em] mt-0.5">{price || '—'}</p>
          </div>
          {item.retailer_url && (
            <ShopLink
              item={item}
              outfitId={outfitId}
              className="flex-shrink-0 text-white text-[7px] sm:text-[8px] tracking-[0.12em] uppercase underline underline-offset-2 hover:opacity-70 transition-opacity pb-0.5"
            >
              Shop
            </ShopLink>
          )}
        </div>
      </div>
    </div>
  )
}
