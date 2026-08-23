'use client'

import { useState } from 'react'
import { findSomethingSimilar, pickAlternative } from './stock-actions'
import { SOLD_BADGE } from '@/lib/second-hand'
import { formatGbp } from '@/lib/currency'
import ShopLink from '@/components/ShopLink'
import type { SavedOutfitRescue, AlternativeCard } from '@/lib/rescue'

export interface RescueOutfit {
  outfit_id: string
  image_url: string | null
  aesthetic_label: string | null
  soldItem: { item_id: string; product_name: string; brand_name: string | null; image_url: string | null } | null
}

/**
 * A saved look whose one-of-one piece has sold.
 *
 * What this card deliberately does NOT do: grey the hero out, or quietly drop
 * the look from her wardrobe. She saved it; it stays, in full colour, with the
 * sold piece struck through and everything else still shoppable.
 *
 * The restyled hero shown here is the CANONICAL restyle — one render, shared by
 * everyone who saved this look. Tapping "find me something similar" is what
 * unlocks the personal layer: 2-4 alternatives in her size, as item cards with
 * their own product photography. No render happens for those unless she keeps
 * one, and then it's cached for the next person who picks the same piece.
 */
export default function RescueCard({
  outfit,
  rescue,
  onOpen,
}: {
  outfit: RescueOutfit
  rescue: SavedOutfitRescue
  onOpen?: () => void
}) {
  const [alternatives, setAlternatives] = useState<AlternativeCard[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [chosen, setChosen] = useState<string | null>(rescue.chosen_alternative_id)

  const hero = rescue.chosen_image_url ?? rescue.restyled_image_url ?? outfit.image_url
  const isRestyled = Boolean(rescue.chosen_image_url ?? rescue.restyled_image_url)

  async function engage() {
    if (alternatives) { setAlternatives(null); return }
    setLoading(true)
    setAlternatives(await findSomethingSimilar(rescue.rescue_id))
    setLoading(false)
  }

  async function keep(alt: AlternativeCard) {
    setChosen(alt.alternative_id)
    await pickAlternative(rescue.rescue_id, alt.alternative_id)
  }

  return (
    <div className="bg-white rounded-[12px] border border-[#E2E0DB] overflow-hidden">
      <div className="relative">
        <button onClick={onOpen} className="block w-full aspect-[3/4] bg-[#EDEDED]">
          {/* Full colour, never dimmed — the look she saved is still the look. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={hero || '/placeholder-outfit.jpg'} alt="" className="w-full h-full object-cover" />
        </button>
        <span className="absolute top-2.5 left-2.5 bg-[#2B2B2B] text-white text-[10px] tracking-[0.12em] rounded-full px-2.5 py-1 leading-none">
          {SOLD_BADGE}
        </span>
        {isRestyled && (
          <span className="absolute bottom-2.5 left-2.5 bg-white/92 text-[#0A0A0A] text-[10px] tracking-[0.1em] rounded-full px-2.5 py-1 leading-none">
            RESTYLED WITH AN AVAILABLE PIECE
          </span>
        )}
      </div>

      <div className="px-3.5 py-3">
        {outfit.aesthetic_label && (
          <p className="text-[14px] tracking-[0.04em] text-[#4A4E57] mb-2">{outfit.aesthetic_label}</p>
        )}

        {/* The sold piece: struck through, still named. Pretending it was never
            there would make the look she saved unrecognisable. */}
        {outfit.soldItem && (
          <div className="flex items-center gap-2.5 mb-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={outfit.soldItem.image_url || '/placeholder-outfit.jpg'}
              alt=""
              className="w-[34px] h-[45px] object-cover rounded-[6px] bg-[#F2F2F2]"
            />
            <div className="min-w-0">
              <p className="text-[12px] tracking-[0.06em] text-[#A8A8A4] uppercase truncate">
                {outfit.soldItem.brand_name ?? 'BRAND'}
              </p>
              <p className="text-[13px] text-[#6B6B6B] line-through truncate">{outfit.soldItem.product_name}</p>
              <p className="text-[12px] text-[#A8A8A4]">No longer available</p>
            </div>
          </div>
        )}

        {rescue.state === 'queued_for_review' || rescue.state === 'failed' ? (
          <p className="text-[13px] text-[#6B6B6B] leading-relaxed">
            We&rsquo;ll restyle this when we find the right replacement.
          </p>
        ) : !isRestyled && rescue.state !== 'ready' ? (
          <p className="text-[13px] text-[#6B6B6B] leading-relaxed">Restyling this look now.</p>
        ) : null}

        <button
          onClick={engage}
          disabled={loading}
          className="mt-2 text-[13px] tracking-[0.08em] text-[#0A0A0A] underline underline-offset-4 hover:opacity-70 transition-opacity disabled:opacity-40"
        >
          {loading ? 'LOOKING…' : alternatives ? 'HIDE OPTIONS' : 'FIND ME SOMETHING SIMILAR'}
        </button>

        {alternatives && alternatives.length === 0 && (
          <p className="text-[13px] text-[#A8A8A4] mt-2">Nothing in your size yet — we&rsquo;ll keep looking.</p>
        )}

        {alternatives && alternatives.length > 0 && (
          <div className="mt-3 grid grid-cols-2 gap-2">
            {alternatives.map((alt) => (
              <div key={alt.alternative_id} className="border border-[#E2E0DB] rounded-[10px] overflow-hidden bg-white">
                <div className="aspect-[3/4] bg-[#F2F2F2]">
                  {/* Its own product photography — no render was paid for here. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={alt.rendered_image_url || alt.image_url || '/placeholder-outfit.jpg'} alt="" className="w-full h-full object-cover" />
                </div>
                <div className="px-2 py-1.5">
                  <p className="text-[11px] tracking-[0.06em] text-[#A8A8A4] uppercase truncate">{alt.brand_name ?? 'BRAND'}</p>
                  <p className="text-[12px] leading-[1.25] text-[#4A4E57] line-clamp-2">{alt.product_name}</p>
                  <p className="text-[12px] text-[#4A4E57] mt-0.5">{formatGbp(alt.price, alt.currency) || '—'}</p>
                  <div className="flex items-center justify-between gap-2 mt-1.5">
                    <button
                      onClick={() => keep(alt)}
                      className={`text-[11px] tracking-[0.08em] underline underline-offset-2 ${
                        chosen === alt.alternative_id ? 'text-[#3A6B3A]' : 'text-[#0A0A0A] hover:opacity-70'
                      }`}
                    >
                      {chosen === alt.alternative_id ? 'KEPT' : 'KEEP THIS'}
                    </button>
                    {alt.retailer_url && (
                      <ShopLink
                        item={{
                          item_id: alt.item_id,
                          retailer_url: alt.retailer_url,
                          product_name: alt.product_name,
                          brand: { name: alt.brand_name },
                        }}
                        outfitId={rescue.outfit_id}
                        className="text-[11px] tracking-[0.08em] text-[#0A0A0A] underline underline-offset-2 hover:opacity-70"
                      >
                        SHOP
                      </ShopLink>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
