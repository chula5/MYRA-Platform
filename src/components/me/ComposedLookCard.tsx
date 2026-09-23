'use client'

// ONE COMPOSED OUTFIT, the way MYRA draws it.
//
// Lifted out of the dressing room so every surface that shows a freshly
// composed look — her piece styled, a piece she kept while browsing — draws
// the same card: her picture when the look has one, otherwise the pieces laid
// three across on stone, the piece it was built around ringed.

import FallbackImage from '@/components/FallbackImage'
import type { StyledLook } from '@/app/admin/private-stylist/actions'

export default function ComposedLookCard({ look, heroId }: { look: StyledLook; heroId?: string }) {
  return (
    <article className="bg-white/85 shadow-[0_2px_14px_rgba(43,43,43,0.08)] rounded-[18px] overflow-hidden">
      {look.image_url ? (
        <div className="relative aspect-[3/4] bg-[#E4E2DD] overflow-hidden rounded-[14px]">
          <FallbackImage src={look.image_url} thumbWidth={700} alt="" className="absolute inset-0 w-full h-full object-cover" />
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-[4px] p-[4px] bg-[#E4E2DD]">
          {look.items.map((it, j) => (
            <div key={j} className={`relative aspect-[3/4] bg-white overflow-hidden ${it.item_id === heroId ? 'ring-2 ring-[#2B2B2B]' : ''}`}>
              {it.image_url && <FallbackImage src={it.image_url} thumbWidth={300} alt={it.product_name} className="absolute inset-0 w-full h-full object-contain" />}
            </div>
          ))}
        </div>
      )}
      {/* The outfit speaks for itself; how many of her own pieces are in it does not. */}
      <p className="px-5 py-4 text-[19px] text-[#6E6B65]">
        {look.items.filter((it) => it.owned).length} of your own
      </p>
    </article>
  )
}
