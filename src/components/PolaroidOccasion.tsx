'use client'

// POLAROID OCCASION — each occasion as an instant print: a white frame with a
// deep lip at the foot carrying the caption. The picture is a real look already
// tagged with that occasion, so the tile shows what it is actually offering.

import { thumbUrl } from '@/lib/image-utils'
import type { OutfitWithItems } from '@/types/database'

export default function PolaroidOccasion({
  label,
  image,
  onClick,
  tilt = 0,
}: {
  label: string
  image?: string | null
  onClick: () => void
  tilt?: number
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group block w-full bg-[#FCFCFA] p-[9px] pb-0 shadow-[0_10px_28px_rgba(0,0,0,0.16)] transition-transform duration-300 hover:-translate-y-1 hover:rotate-0"
      style={tilt ? { transform: `rotate(${tilt}deg)` } : undefined}
    >
      <div className="relative w-full aspect-square overflow-hidden bg-[#E9E9E5]">
        {image ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={thumbUrl(image, 500)}
            alt=""
            loading="lazy"
            className="w-full h-full object-cover transition-transform duration-[600ms] group-hover:scale-[1.03]"
          />
        ) : null}
      </div>
      {/* The lip: taller than the other three sides, the way a polaroid is. */}
      <div className="flex items-center justify-center h-[64px] md:h-[76px] px-2">
        <span className="text-[15px] md:text-[19px] tracking-[0.18em] text-[#4A4E57] text-center leading-snug">
          {label}
        </span>
      </div>
    </button>
  )
}

/**
 * One picture per occasion tile. Outfits usually carry several occasion tags,
 * so picking "the first match" independently per tile lands the same look on
 * two tiles; this claims each outfit as it goes so every tile is distinct.
 * Falls back to re-use only if the catalogue genuinely can't cover them all.
 */
export function occasionImages(
  outfits: OutfitWithItems[],
  tags: string[],
  matchTagsFor: (tag: string) => string[],
): Record<string, string | null> {
  const used = new Set<string>()
  const out: Record<string, string | null> = {}
  for (const tag of tags) {
    const match = matchTagsFor(tag)
    const pool = outfits.filter(
      (o) => o.image_url && (o.occasion_tags ?? []).some((t) => match.includes(t)),
    )
    const fresh = pool.find((o) => !used.has(o.outfit_id))
    const pick = fresh ?? pool[0]
    if (pick) used.add(pick.outfit_id)
    out[tag] = pick?.image_url ?? null
  }
  return out
}
