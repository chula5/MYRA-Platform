'use client'

// ONE STUDIO OUTFIT, OPENED — its picture, then every piece in it.
//
// A studio outfit (the outfit table, what the feed shows) used to be a closed
// picture wherever it appeared under a piece. Now it opens: the pieces are laid
// out under the picture, each with its heart, and tapping a piece opens the
// WAYS TO WEAR IT sheet for that piece — the other studio outfits it is in,
// then MYRA's own ways for her. Chloe, 2026-11-08: "click on the outfit and
// click on say the skirt and then see the other outfits associated with the
// skirt underneath. All clickable, all saveable."
//
// Nothing is composed or judged here: the pieces are the outfit's own rows.

import { useState } from 'react'
import FallbackImage from '@/components/FallbackImage'
import SaveOutfit from '@/components/me/SaveOutfit'
import SavePieceHeart from '@/components/me/SavePieceHeart'
import WaysToWear from '@/components/me/WaysToWear'
import type { LookItem } from '@/lib/pilot-stylist'
import type { WaysPiece } from '@/app/me/ways/actions'

const T = 'text-[19px] xl:text-[22px] 2xl:text-[26px]'
const T_SMALL = 'text-[17px] xl:text-[20px] 2xl:text-[23px]'

export interface SheetLook {
  image_url?: string | null
  items: LookItem[]
  why?: string
  occasion_id?: string | null
  occasion_label?: string | null
}

export default function StudioLookSheet({ look, heroId, testMemberId, onClose }: {
  look: SheetLook
  /** The piece this outfit was reached from, ringed among the pieces. */
  heroId?: string
  testMemberId?: string
  onClose: () => void
}) {
  // The piece she tapped: its own WAYS TO WEAR IT sheet opens over this one.
  const [waysFor, setWaysFor] = useState<WaysPiece | null>(null)
  const pieces = look.items.filter((it) => it.item_id)

  return (
    // Stops above the phone's tab bar, so every room is still a tap away.
    <div data-lenis-prevent className="fixed inset-x-0 top-0 bottom-[calc(68px+env(safe-area-inset-bottom))] sm:bottom-0 z-[130] overflow-y-auto myra-pearl" role="dialog" aria-label="Outfit from the studio">
      <div className="w-full px-6 sm:px-10 pt-[calc(40px+env(safe-area-inset-top,0px))] pb-10 max-w-[1700px] mx-auto space-y-8">
        <div className="flex items-start justify-between gap-5">
          <div>
            <p className={`${T_SMALL} tracking-[0.12em] text-[#6E6B65]`}>FROM THE STUDIO</p>
            {look.occasion_label && <p className={`${T} text-[#2B2B2B] leading-tight`}>{look.occasion_label}</p>}
          </div>
          <button type="button" onClick={onClose} className={`${T_SMALL} text-[#6E6B65] underline underline-offset-4 flex-none`}>← Back</button>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,520px)_1fr] gap-8 xl:gap-12 items-start">
          {look.image_url && (
            <div className="relative aspect-[3/4] bg-[#E4E2DD] rounded-[14px] overflow-hidden">
              <FallbackImage src={look.image_url} thumbWidth={1100} alt="" className="absolute inset-0 w-full h-full object-cover" />
            </div>
          )}

          <div className="space-y-5">
            <p className={`${T_SMALL} tracking-[0.12em] text-[#6E6B65]`}>THE PIECES · {pieces.length}</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              {pieces.map((it) => {
                const id = it.item_id as string
                return (
                  <div key={id} className={`relative bg-white rounded-[14px] overflow-hidden shadow-[0_1px_8px_rgba(43,43,43,0.06)] ${id === heroId ? 'ring-2 ring-[#2B2B2B]' : ''}`}>
                    <button
                      type="button"
                      onClick={() => setWaysFor({ item_id: id, product_name: it.product_name, brand: it.brand ?? null, image_url: it.image_url ?? null })}
                      className="block w-full text-left"
                      aria-label={`${it.brand} ${it.product_name} — see it in other outfits`}
                    >
                      <div className="relative aspect-[3/4] bg-white">
                        {it.image_url && <FallbackImage src={it.image_url} thumbWidth={500} alt={it.product_name} className="absolute inset-0 w-full h-full object-contain" />}
                      </div>
                      <div className="px-3 pt-3 pb-4">
                        <p className="text-[15px] xl:text-[17px] tracking-[0.1em] text-[#6E6B65] uppercase line-clamp-1">{it.brand}</p>
                        <p className={`${T_SMALL} text-[#2B2B2B] leading-tight line-clamp-2`}>{it.product_name}</p>
                        {typeof it.price_gbp === 'number' && !it.owned && <p className="text-[15px] xl:text-[17px] text-[#6E6B65] mt-1">£{Math.round(it.price_gbp)}</p>}
                        <p className="text-[15px] xl:text-[17px] tracking-[0.1em] text-[#6E6B65] mt-2">MORE WAYS TO WEAR IT →</p>
                      </div>
                    </button>
                    {!it.owned && <SavePieceHeart itemId={id} className="absolute top-2 right-2" />}
                  </div>
                )
              })}
            </div>

            <SaveOutfit
              items={look.items}
              why={look.why ?? 'From the studio'}
              occasion={look.occasion_id ?? null}
              testMemberId={testMemberId}
              label="Save look"
              pictureUrl={look.image_url ?? null}
            />
          </div>
        </div>
      </div>

      {waysFor && (
        <WaysToWear itemId={waysFor.item_id} piece={waysFor} testMemberId={testMemberId} onClose={() => setWaysFor(null)} />
      )}
    </div>
  )
}
