'use client'

// OUTFIT RAIL — a single sleek line of outfit cards that scrolls sideways.
// Plain portrait images, tight gaps, no card chrome: the same editorial
// treatment as the occasion grid, just laid out as a rail. (This replaced the
// fanned card-deck version — the pile read as clutter next to the flat grid.)

import { useRouter } from 'next/navigation'
import { thumbUrl } from '@/lib/image-utils'
import type { OutfitWithItems } from '@/types/database'

const MAX_CARDS = 12

export default function OutfitDeck({
  outfits,
  title,
  hint,
  detailHrefBase = '/outfit',
  accent,
  className = '',
}: {
  outfits: OutfitWithItems[]
  title: string
  hint?: string
  detailHrefBase?: string
  // Optional glyph before the title (the heart on recommendations).
  accent?: React.ReactNode
  className?: string
}) {
  const router = useRouter()
  const cards = outfits.slice(0, MAX_CARDS)
  if (cards.length === 0) return null

  return (
    <div className={className}>
      <div className="flex items-baseline justify-between mb-4">
        <p className="myra-section-label inline-flex items-center gap-2">
          {accent}
          {title}
        </p>
        {hint && <p className="myra-section-note">{hint}</p>}
      </div>

      {/* The rail: horizontal scroll, snap per card, scrollbar hidden by the
          overflow container's own padding. data-lenis-prevent keeps the
          site-wide smooth scroller's hands off this container. */}
      <div data-lenis-prevent className="flex gap-[6px] overflow-x-auto snap-x pb-2 -mx-1 px-1">
        {cards.map((o) => (
          <button
            key={o.outfit_id}
            onClick={() => router.push(`${detailHrefBase}/${o.outfit_id}`)}
            aria-label={o.aesthetic_label ?? 'View outfit'}
            className="group shrink-0 snap-start w-[46vw] sm:w-[240px] md:w-[280px]"
          >
            <div className="relative aspect-[3/4] w-full overflow-hidden bg-[#EDEDED]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={o.image_url ? thumbUrl(o.image_url, 500) : '/placeholder-outfit.jpg'}
                alt=""
                loading="lazy"
                className="w-full h-full object-cover transition-opacity duration-500 group-hover:opacity-85"
              />
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}
