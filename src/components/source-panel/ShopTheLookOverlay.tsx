'use client'

import Image from 'next/image'
import { useState } from 'react'
import { recordItemClick } from '@/app/actions/item-click'
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
}: {
  items: SourceItem[]
  outfitId?: string
  onClose: () => void
}) {
  function shop(item: SourceItem) {
    if (!item.retailer_url) return
    recordItemClick(item.item_id, outfitId)
    window.open(item.retailer_url, '_blank', 'noopener,noreferrer')
  }

  return (
    <div className="absolute top-2.5 left-2.5 z-30 w-[clamp(118px,33%,176px)] max-h-[calc(100%-1.25rem)] overflow-y-auto pr-1">
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

      {/* Cards */}
      <div className="space-y-1.5">
        {items.map((item) => (
          <ItemCard key={item.item_id} item={item} onShop={() => shop(item)} />
        ))}
      </div>
    </div>
  )
}

function ItemCard({ item, onShop }: { item: SourceItem; onShop: () => void }) {
  const [imgFailed, setImgFailed] = useState(false)
  const brandInitial = (item.brand?.name ?? 'M').trim().charAt(0).toUpperCase()
  const price = formatPrice(item.price ?? null, item.currency ?? null)

  return (
    <div className="bg-white rounded-[14px] shadow-[0_3px_10px_rgba(0,0,0,0.14)] p-1.5 flex gap-1.5 items-stretch">
      {/* Thumbnail */}
      <div className="relative w-[28px] h-[38px] flex-shrink-0 rounded-[10px] overflow-hidden bg-[#F2F2F2]">
        {item.image_url && !imgFailed ? (
          <Image
            src={item.image_url}
            alt={item.product_name}
            fill
            className="object-cover"
            sizes="28px"
            onError={() => setImgFailed(true)}
          />
        ) : (
          <div className="w-full h-full bg-[#E2E0DB] flex items-center justify-center">
            <span className="text-[9px] text-[#6B6B6B]">{brandInitial}</span>
          </div>
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0 flex flex-col">
        <p className="text-[6px] sm:text-[7px] tracking-[0.054em] text-[#6B6B6B] uppercase truncate">
          {item.brand?.name ?? 'BRAND'}
        </p>
        <p className="text-[8px] sm:text-[9px] leading-[1.15] text-[#4A4E57] font-semibold line-clamp-2">
          {item.product_name}
        </p>
        <div className="mt-auto flex items-center justify-between gap-1 pt-0.5">
          <span className="text-[8px] sm:text-[9px] text-[#4A4E57]">{price}</span>
          {item.retailer_url && (
            <button
              onClick={onShop}
              className="bg-[#0A0A0A] text-white text-[6px] sm:text-[7px] tracking-[0.045em] px-1.5 py-0.5 rounded hover:opacity-85 transition-opacity flex-shrink-0"
            >
              SHOP
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
