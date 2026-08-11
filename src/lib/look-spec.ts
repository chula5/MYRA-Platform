// The three values printed on a run-of-show card: what it's for, whose it is,
// and what colour it reads as. All derived from what the outfit already
// carries — nothing new is stored.

import type { OutfitWithItems } from '@/types/database'

/** Sentence case, because the handwritten column is never uppercase. */
function sentence(s: string): string {
  const t = s.trim().toLowerCase()
  return t ? t[0].toUpperCase() + t.slice(1) : ''
}

/** Proper nouns keep their own capitalisation — brands are written as they brand themselves. */
function houseName(s: string): string {
  const t = s.trim()
  // ALL-CAPS rows in the brand table would shout in handwriting; title-case
  // those, but leave mixed-case names (McQueen, DÔEN) exactly as entered.
  if (t === t.toUpperCase()) {
    return t.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase())
  }
  return t
}

export function lookOccasion(o: OutfitWithItems): string {
  const tag = (o.occasion_tags ?? [])[0]
  return tag ? sentence(tag) : '—'
}

/** The house of the hero garment, falling back to whichever brand is present. */
export function lookHouse(o: OutfitWithItems): string {
  const items = (o.outfit_item ?? []).filter((oi) => oi.item)
  const bySlot = (slot: string) => items.find((oi) => oi.slot === slot)
  const hero = bySlot('dress') ?? bySlot('top') ?? bySlot('bottom') ?? bySlot('outerwear') ?? items[0]
  const name = hero?.item?.brand?.name
  return name ? houseName(name) : '—'
}

/** The colour the look reads as: the most common family across its pieces. */
export function lookColour(o: OutfitWithItems): string {
  const counts = new Map<string, number>()
  for (const oi of o.outfit_item ?? []) {
    const c = oi.item?.colour_family
    if (c) counts.set(c, (counts.get(c) ?? 0) + 1)
  }
  let best: string | null = null
  let bestN = 0
  for (const [c, n] of counts) {
    if (n > bestN) { best = c; bestN = n }
  }
  return best ? sentence(best.replace(/_/g, ' ')) : '—'
}

// Words that open a garment name without naming it — if the style name starts
// with one of these, take a second word so the look isn't called "COTTON".
const GENERIC = new Set([
  'COTTON', 'SILK', 'LINEN', 'WOOL', 'DENIM', 'LEATHER', 'SATIN', 'SHEER',
  'CARVED', 'WOODEN', 'BRUSHED', 'TWO-TONE', 'RIBBED', 'PLEATED', 'CROPPED',
  'EMBROIDERED', 'STRIPED', 'FLORAL', 'PRINTED', 'KNITTED', 'QUILTED',
  'BLACK', 'WHITE', 'CREAM', 'NAVY', 'BROWN', 'GREEN', 'RED', 'BLUE', 'THE',
])

/**
 * The look's name, printed above the card beside its number.
 *
 * Labels are stored as "COMPOSED · MARCIELLE MAXI DRESS" — the part before the
 * dot is how the look was built, which is studio provenance, not a name. Take
 * the garment name after it and keep only its opening word, which in this
 * catalogue is the style name (MARCIELLE, LISEL, HARLAN).
 */
export function lookName(o: OutfitWithItems): string {
  const label = (o.aesthetic_label ?? '').trim()
  if (!label) {
    const house = lookHouse(o)
    return house === '—' ? 'UNTITLED' : house.toUpperCase()
  }
  const garment = label.split('·').pop()!.trim().toUpperCase()
  const words = garment.split(/\s+/).filter(Boolean)
  if (words.length === 0) return 'UNTITLED'
  return GENERIC.has(words[0]) && words[1] ? `${words[0]} ${words[1]}` : words[0]
}

/** Sequential look number, zero-padded: 1 → "01". */
export function lookNumber(index: number): string {
  return String(index + 1).padStart(2, '0')
}
