'use client'

// OCCASION LOOK CARD — the run-of-show board on the landing page. Each card is
// one occasion, shown through a look actually tagged with it, written up the
// way a stylist writes up a rail: printed labels, handwritten values.
//
// Tapping the card still selects the occasion — that behaviour is unchanged.
// The save control rings the look itself and stops the tap from propagating.

import { thumbUrl } from '@/lib/image-utils'
import MarkerSave from '@/components/outfit-card/MarkerSave'
import { lookHouse, lookColour, lookName, lookNumber } from '@/lib/look-spec'
import type { OutfitWithItems } from '@/types/database'

export default function OccasionLookCard({
  label,
  outfit,
  index,
  onClick,
  canSave = false,
  initialSaved = false,
  lockedSave = false,
}: {
  // The occasion this card stands for — printed in the OCCASION row.
  label: string
  // The look shown; null when nothing live carries this occasion yet.
  outfit: OutfitWithItems | null
  index: number
  onClick: () => void
  canSave?: boolean
  initialSaved?: boolean
  lockedSave?: boolean
}) {
  // Occasion labels arrive uppercase; the handwritten column is sentence case.
  const occasion = label.charAt(0) + label.slice(1).toLowerCase()

  return (
    <div className="group/look">
      {/* Look number and name, printed above the card. */}
      <p className="text-[7.5px] tracking-[0.1em] text-[#111111] mb-1 truncate">
        {lookNumber(index)} · {outfit ? lookName(outfit) : label}
      </p>

      <div className="border border-[#111111] bg-[#FCFCFA]">
        <button
          type="button"
          onClick={onClick}
          aria-label={label}
          className="relative block w-full aspect-[2/3] overflow-hidden bg-[#E9E9E5]"
        >
          {outfit?.image_url ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={thumbUrl(outfit.image_url, 600)}
              alt=""
              loading="lazy"
              className="w-full h-full object-cover"
            />
          ) : null}

          {outfit && (canSave || lockedSave) && (
            <MarkerSave
              outfitId={outfit.outfit_id}
              initialSaved={initialSaved}
              locked={!canSave && lockedSave}
              className="myra-look-actions absolute bottom-1.5 right-2 z-40 text-[8px] tracking-[0.12em] uppercase text-white [text-shadow:0_1px_3px_rgba(0,0,0,0.7)] hover:opacity-70 transition-opacity"
            />
          )}
        </button>

        {/* The spec block: printed labels, handwritten values. */}
        <dl className="text-[#111111]">
          {([
            ['OCCASION', occasion],
            ['HOUSE', outfit ? lookHouse(outfit) : '—'],
            ['COLOUR', outfit ? lookColour(outfit) : '—'],
          ] as const).map(([rowLabel, value]) => (
            <div key={rowLabel} className="flex items-stretch border-t border-[#111111]">
              <dt className="shrink-0 w-[58px] border-r border-[#111111] flex items-center px-1.5 py-1.5">
                <span className="text-[8.5px] tracking-[0.16em] uppercase leading-none">{rowLabel}</span>
              </dt>
              <dd className="flex-1 min-w-0 flex items-center px-2 py-0.5">
                <span className="myra-hand text-[19px] leading-[1.15] text-[#1a1a1a] truncate">{value}</span>
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
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
