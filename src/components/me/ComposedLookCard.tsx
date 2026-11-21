'use client'

// ONE COMPOSED OUTFIT, the way MYRA draws it.
//
// Lifted out of the dressing room so every surface that shows a freshly
// composed look — her piece styled, a piece she kept while browsing — draws
// the same card: her picture when the look has one, otherwise the pieces laid
// three across on stone, the piece it was built around ringed.

import { useState } from 'react'
import FallbackImage from '@/components/FallbackImage'
import SaveOutfit from '@/components/me/SaveOutfit'
import SavePieceHeart from '@/components/me/SavePieceHeart'
import StudioLookSheet from '@/components/me/StudioLookSheet'
import WaysToWear from '@/components/me/WaysToWear'
import type { WaysPiece } from '@/app/me/ways/actions'
import type { StyledLook } from '@/app/admin/private-stylist/actions'

type CardLook = StyledLook & { styled_way_id?: string; saved_look_id?: string | null; outfit_id?: string }

export default function ComposedLookCard({ look, heroId, saveable, testMemberId }: {
  look: CardLook
  heroId?: string
  /** A kept way: offer SAVE LOOK, which keeps it among her looks and has MYRA make its picture. */
  saveable?: boolean
  testMemberId?: string
}) {
  // A studio outfit opens: its pieces, each a way into more outfits (StudioLookSheet).
  const studio = !!look.outfit_id
  const [open, setOpen] = useState(false)
  // A piece tapped in an outfit MYRA made opens in the mirror — its pictures,
  // its outfits, VIEW ON SITE — as it does from Browse and the sale. These
  // tiles used to be pictures only: a member liked the trousers in an outfit
  // on For You and had no way to them (2026-11-21).
  const [piece, setPiece] = useState<WaysPiece | null>(null)
  const canOpen = (it: CardLook['items'][number]) => !studio && !!it.item_id && !it.owned && it.item_id !== heroId
  const picture = (
    <>
      {look.image_url ? (
        <div className="relative aspect-[3/4] bg-[#E4E2DD] overflow-hidden rounded-[14px]">
          <FallbackImage src={look.image_url} thumbWidth={700} alt="" className="absolute inset-0 w-full h-full object-cover" />
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-[4px] p-[4px] bg-[#E4E2DD]">
          {look.items.map((it, j) => (
            <div key={j} className={`relative aspect-[3/4] bg-white overflow-hidden ${it.item_id === heroId ? 'ring-2 ring-[#2B2B2B]' : ''}`}>
              {it.image_url && <FallbackImage src={it.image_url} thumbWidth={300} alt={it.product_name} className="absolute inset-0 w-full h-full object-contain" />}
              {canOpen(it) && (
                <button
                  type="button"
                  onClick={() => setPiece({ item_id: it.item_id as string, product_name: it.product_name, brand: it.brand ?? null, image_url: it.image_url ?? null, url: it.url ?? null, price_gbp: it.price_gbp ?? null })}
                  className="absolute inset-0 w-full h-full"
                  aria-label={`Open ${it.brand ?? ''} ${it.product_name}`.replace(/\s+/g, ' ')}
                />
              )}
              {!it.owned && it.item_id && <SavePieceHeart itemId={it.item_id} className="absolute top-1.5 right-1.5" />}
            </div>
          ))}
        </div>
      )}
    </>
  )
  return (
    <article className="bg-white/85 shadow-[0_2px_14px_rgba(43,43,43,0.08)] rounded-[18px] overflow-hidden">
      {/* A studio outfit, or one drawn as a single picture, opens on its pieces;
          one laid out piece by piece is already open — each tile is its own way in. */}
      {studio || look.image_url ? (
        <button type="button" onClick={() => setOpen(true)} className="block w-full text-left" aria-label="Open this outfit and its pieces">
          {picture}
        </button>
      ) : picture}
      {/* The outfit speaks for itself; how many of her own pieces are in it does not. */}
      <div className="px-5 py-4">
        {look.occasion_label && (
          <p className="myra-section-note mb-1">{look.occasion_label.toUpperCase()}</p>
        )}
        {studio ? (
          <button type="button" onClick={() => setOpen(true)} className="text-[21px] xl:text-[24px] text-[#2B2B2B] underline underline-offset-4 text-left">
            {look.items.length} pieces — see them
          </button>
        ) : (
          <>
            <p className="text-[21px] xl:text-[24px] text-[#6E6B65]">
              {look.items.filter((it) => it.owned).length} of your own
            </p>
            {look.image_url ? (
              <button type="button" onClick={() => setOpen(true)} className="mt-1 text-[19px] xl:text-[22px] text-[#2B2B2B] underline underline-offset-4 text-left">
                {look.items.length} pieces — see them
              </button>
            ) : look.items.some(canOpen) && (
              <p className="mt-1 text-[15px] xl:text-[17px] tracking-[0.1em] text-[#7C838B]">TAP A PIECE TO OPEN IT</p>
            )}
          </>
        )}
        {saveable && look.styled_way_id && (
          <div className="mt-4">
            <SaveOutfit
              items={look.items}
              why={look.why}
              occasion={look.occasion_id ?? null}
              testMemberId={testMemberId}
              label="Save look"
              styledWayId={look.styled_way_id}
              pictureUrl={look.image_url}
              initialLookId={look.saved_look_id ?? null}
            />
          </div>
        )}
      </div>
      {open && <StudioLookSheet look={look} heroId={heroId} testMemberId={testMemberId} heading={studio ? undefined : 'THE OUTFIT'} save={studio} onClose={() => setOpen(false)} />}
      {piece && (
        <WaysToWear itemId={piece.item_id} piece={piece} testMemberId={testMemberId} autoStart={false} startLabel="Build outfits with it" onClose={() => setPiece(null)} />
      )}
    </article>
  )
}
