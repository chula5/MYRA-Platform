'use client'

import { useState } from 'react'
import FallbackImage from '@/components/FallbackImage'
import ShopLink from '@/components/ShopLink'
import { formatGbp } from '@/lib/currency'
import { watchForRestock } from '@/app/edit/stock-actions'
import { ONE_OF_ONE_BADGE, LOW_IN_SIZE_BADGE, NOT_IN_SIZE_LABEL, savedByLabel } from '@/lib/second-hand'
import type { ItemSizeInfo } from '@/lib/outfit-size'
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
  sizeInfo,
  soldItemId,
  onFindSimilar,
}: {
  items: SourceItem[]
  outfitId?: string
  onClose: () => void
  canSave?: boolean
  savedItemIds?: string[]
  onToggleItem?: (itemId: string) => void
  /** Per-item size verdicts for the signed-in shopper (see outfit-size.ts). */
  sizeInfo?: Record<string, ItemSizeInfo>
  /** A one-of-one in this look that has sold — struck through, still listed. */
  soldItemId?: string | null
  /** "Find me something similar" on the struck-through item. */
  onFindSimilar?: (itemId: string) => void
  // On the detail view the mobile header (BACK + arrows) overlays the image top,
  // so push the panel down on mobile to clear it (desktop has no such header).
  offsetTop?: boolean
}) {
  const savedSet = new Set(savedItemIds)
  // Click logging + affiliate routing is handled entirely by ShopLink
  // (redirect via /go/ for most merchants, beacon for Awin ones).

  return (
    <div data-lenis-prevent className={`absolute left-2.5 z-30 w-[27%] max-w-[100px] sm:w-[34%] sm:max-w-[176px] overflow-y-auto pr-1 ${
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
            size={sizeInfo?.[item.item_id]}
            sold={item.item_id === soldItemId || (item as any).status === 'sold'}
            onFindSimilar={onFindSimilar ? () => onFindSimilar(item.item_id) : undefined}
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
  size,
  sold = false,
  onFindSimilar,
}: {
  item: SourceItem
  outfitId?: string
  canSave: boolean
  saved: boolean
  onToggle: () => void
  size?: ItemSizeInfo
  sold?: boolean
  onFindSimilar?: () => void
}) {
  const [imgFailed, setImgFailed] = useState(false)
  const [watching, setWatching] = useState(false)
  const brandInitial = (item.brand?.name ?? 'M').trim().charAt(0).toUpperCase()
  // Source Items shows GBP only (no bracketed original — that's the big view).
  const price = formatGbp(item.price ?? null, item.currency ?? null)

  // A sold one-of-one is struck through and stays in the list. Every other
  // piece in the look is still linked and shoppable — she saved the whole
  // outfit, and most of it is still buyable.
  const proof = size?.unique ? savedByLabel(size.saves ?? 0) : null
  const badge = sold
    ? 'NO LONGER AVAILABLE'
    : size?.lowInHerSize
      ? LOW_IN_SIZE_BADGE
      : size?.unique
        ? ONE_OF_ONE_BADGE
        : null

  async function watch(e: React.MouseEvent) {
    e.stopPropagation()
    setWatching(true)
    const res = await watchForRestock(item.item_id, item.item_type ?? null)
    if (res.error) setWatching(false)
  }

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

      {/* Scarcity + size badges — top-left, over the photo */}
      {badge && (
        <span
          className={`absolute top-1.5 left-1.5 z-10 rounded-full px-1.5 py-0.5 text-[6px] sm:text-[7px] tracking-[0.09em] leading-none ${
            sold
              ? 'bg-[#4A4E57] text-white'
              : size?.lowInHerSize
                ? 'bg-[#B8842A] text-white'
                : 'bg-white/92 text-[#0A0A0A]'
          }`}
        >
          {badge}
        </span>
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
            <p className={`text-white text-[7px] sm:text-[9px] leading-[1.15] line-clamp-2 mt-0.5 ${sold ? 'line-through opacity-70' : ''}`}>
              {item.product_name}
            </p>
            <p className="text-white/90 text-[7px] sm:text-[8px] tracking-[0.03em] mt-0.5">{price || '—'}</p>
            {size?.herSizeLabel && !sold && !size.outOfHerSize && (
              <p className="text-white/70 text-[6px] sm:text-[7px] tracking-[0.06em] mt-0.5">
                YOUR SIZE · {size.herSizeLabel.toUpperCase()}
              </p>
            )}
            {size?.outOfHerSize && !sold && (
              <button
                onClick={watch}
                disabled={watching}
                className="text-left text-white/85 text-[6px] sm:text-[7px] tracking-[0.06em] mt-0.5 underline underline-offset-2 disabled:no-underline"
              >
                {watching ? 'WE’LL TELL YOU WHEN IT’S BACK' : `${NOT_IN_SIZE_LABEL} · NOTIFY ME`}
              </button>
            )}
            {size?.overrideNote && (
              <p className="text-white/70 text-[6px] sm:text-[7px] tracking-[0.05em] mt-0.5 italic">{size.overrideNote}</p>
            )}
            {proof && !sold && (
              <p className="text-white/60 text-[6px] sm:text-[7px] tracking-[0.06em] mt-0.5">{proof}</p>
            )}
          </div>
          {sold ? (
            onFindSimilar && (
              <button
                onClick={(e) => { e.stopPropagation(); onFindSimilar() }}
                className="flex-shrink-0 text-white text-[7px] sm:text-[8px] tracking-[0.1em] uppercase underline underline-offset-2 hover:opacity-70 transition-opacity pb-0.5"
              >
                Find similar
              </button>
            )
          ) : item.retailer_url ? (
            <ShopLink
              item={item}
              outfitId={outfitId}
              className="flex-shrink-0 text-white text-[7px] sm:text-[8px] tracking-[0.12em] uppercase underline underline-offset-2 hover:opacity-70 transition-opacity pb-0.5"
            >
              Shop
            </ShopLink>
          ) : null}
        </div>
      </div>
    </div>
  )
}
