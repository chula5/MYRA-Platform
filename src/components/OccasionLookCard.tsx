'use client'

// OCCASION TILE — a contact sheet of occasions. Each tile is one occasion,
// shown through a look actually tagged with it, captioned underneath the way
// looks are numbered off on a run-of-show sheet: "1 · WEEKEND AWAY".
//
// No border, no shadow, no card chrome — the picture and its caption only.
// The caption names the OCCASION rather than the look, because tapping a tile
// selects that occasion and the label has to say what you are choosing.

import { thumbUrl } from '@/lib/image-utils'
import type { OutfitWithItems } from '@/types/database'

export default function OccasionLookCard({
  label,
  outfit,
  index,
  onClick,
}: {
  label: string
  // The look shown; null when nothing live carries this occasion yet.
  outfit: OutfitWithItems | null
  index: number
  onClick: () => void
}) {
  return (
    <button type="button" onClick={onClick} className="group block w-full text-left">
      <div className="relative w-full aspect-[2/3] overflow-hidden bg-[#E4E2DD]">
        {outfit?.image_url ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={thumbUrl(outfit.image_url, 600)}
            alt=""
            loading="lazy"
            className="w-full h-full object-cover transition-opacity duration-500 group-hover:opacity-85"
          />
        ) : null}
      </div>

      <p className="mt-2.5 text-[12px] md:text-[15px] tracking-[0.12em] text-[#111111] truncate">
        {index + 1} · {label}
      </p>
    </button>
  )
}

/**
 * One look per occasion tile, resolved in a single pass so each tile claims a
 * different outfit — doing it per tile restarts the used-set every time and
 * lets the same look land on two tiles.
 */
export function occasionLooks(
  outfits: OutfitWithItems[],
  tags: string[],
  matchTagsFor: (tag: string) => string[],
): Record<string, OutfitWithItems | null> {
  const used = new Set<string>()
  const out: Record<string, OutfitWithItems | null> = {}
  for (const tag of tags) {
    const match = matchTagsFor(tag)
    const pool = outfits.filter(
      (o) => o.image_url && (o.occasion_tags ?? []).some((t) => match.includes(t)),
    )
    const pick = pool.find((o) => !used.has(o.outfit_id)) ?? pool[0] ?? null
    if (pick) used.add(pick.outfit_id)
    out[tag] = pick
  }
  return out
}
