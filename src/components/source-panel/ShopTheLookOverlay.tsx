'use client'

import Image from 'next/image'
import { useState } from 'react'
import { recordItemClick } from '@/app/actions/item-click'
import { getStoredRef } from '@/lib/ref'
import type { Item, Brand } from '@/types/database'

type SourceItem = Item & { brand: Brand }

function formatPrice(price: string | null, currency: string | null): string {
  if (!price) return ''
  const sym: Record<string, string> = { GBP: '£', USD: '$', EUR: '€', AUD: 'A$', CAD: 'C$', JPY: '¥' }
  const symbol = sym[currency ?? 'GBP'] ?? ''
  const clean = String(price).replace(/\.00$/, '')
  return symbol ? `${symbol}${clean}` : clean
}

// "Shop the look" cards overlaid on the outfit image (top-left), replacing the
// old side drawer. Each card opens the retailer and records the click.
export default function ShopTheLookOverlay({
  items,
  outfitId,
  onClose,
  canSave = false,
  savedItemIds = [],
  onToggleItem,
}: {
  items: SourceItem[]
  outfitId?: string
  onClose: () => void
  canSave?: boolean
  savedItemIds?: string[]
  onToggleItem?: (itemId: string) => void
}) {
  const savedSet = new Set(savedItemIds)
  // Just record the click — navigation is handled by the real <a> link so
  // Skimlinks can rewrite it to an affiliate-tracked URL.
  function shop(item: SourceItem) {
    const label = [item.brand?.name, item.product_name].filter(Boolean).join(' — ')
    recordItemClick(item.item_id, outfitId, getStoredRef(), label)
  }

  return (
    <div className="absolute top-2.5 left-2.5 z-30 w-[clamp(140px,40%,208px)] max-h-[calc(100%-1.25rem)] overflow-y-auto pr-1">
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
            onShop={() => shop(item)}
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
  onShop,
  canSave,
  saved,
  onToggle,
}: {
  item: SourceItem
  onShop: () => void
  canSave: boolean
  saved: boolean
  onToggle: () => void
}) {
  const [imgFailed, setImgFailed] = useState(false)
  const brandInitial = (item.brand?.name ?? 'M').trim().charAt(0).toUpperCase()
  const price = formatPrice(item.price ?? null, item.currency ?? null)

  return (
    <div className="relative w-full aspect-[3/4] overflow-hidden bg-[#EDEDED]">
      {/* Item photo (rectangle) */}
      {item.image_url && !imgFailed ? (
        <Image
          src={item.image_url}
          alt={item.product_name}
          fill
          className="object-cover"
          sizes="208px"
          onError={() => setImgFailed(true)}
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
      <div className="absolute inset-x-0 bottom-0 z-10 pt-10 pb-2 px-2 bg-gradient-to-t from-black/70 via-black/25 to-transparent">
        <div className="flex items-end justify-between gap-2">
          <div className="min-w-0">
            <p className="text-white/75 text-[7px] tracking-[0.08em] uppercase truncate">{item.brand?.name ?? 'BRAND'}</p>
            <p className="text-white text-[9px] leading-[1.15] line-clamp-2 mt-0.5">{item.product_name}</p>
            {price && <p className="text-white/90 text-[8px] tracking-[0.03em] mt-0.5">{price}</p>}
          </div>
          {item.retailer_url && (
            <a
              href={item.retailer_url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => { e.stopPropagation(); onShop() }}
              className="flex-shrink-0 text-white text-[8px] tracking-[0.14em] uppercase underline underline-offset-2 hover:opacity-70 transition-opacity pb-0.5"
            >
              Shop
            </a>
          )}
        </div>
      </div>
    </div>
  )
}
