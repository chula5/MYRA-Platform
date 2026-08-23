// ── Canonical sizing ─────────────────────────────────────────────────────────
//
// One conversion table for the whole app. A retailer's size string ("UK 10",
// "IT 42", "EU 38", "M", "39") is normalised onto a CANONICAL LADDER per
// category, so those first three all resolve to the same value and can be
// matched against a shopper's profile without re-parsing strings everywhere.
//
// The canonical value IS the UK number (UK 10 → 10, shoe UK 5 → 5) rather than
// an opaque index: it reads correctly straight out of the database, and the
// ladder step (2 for clothing, 1 for shoes) makes "adjacent size" arithmetic.
//
// TWO VALUES ARE ALWAYS KEPT: the retailer's original label, which is what she
// is shown ("IT 42" — the number printed in the garment), and the canonical
// value, which is what we match on. Displaying the canonical number back to her
// would be a small lie about a garment we didn't manufacture.
//
// MATCHING IS DELIBERATELY STRICT here, unlike the lenient feed-side filter in
// sizing.ts. This drives the HARD filter on one-of-one pieces, where a wrong
// answer means styling a size 14 vintage coat for a size 8 client — so only an
// exact canonical match, or an adjacent size SHE listed herself, counts.

import type { ItemType } from '@/types/database'

export type SizeCategory = 'tops' | 'bottoms' | 'outerwear' | 'shoes'

export type SizeSystem =
  | 'UK' | 'EU' | 'US' | 'IT' | 'FR' | 'AU' | 'alpha'
  | 'shoe_UK' | 'shoe_EU' | 'shoe_US'
  | 'waist' | 'one_size' | 'unknown'

export const SIZE_CATEGORIES: SizeCategory[] = ['tops', 'bottoms', 'outerwear', 'shoes']

export const CATEGORY_LABEL: Record<SizeCategory, string> = {
  tops: 'TOPS & DRESSES',
  bottoms: 'BOTTOMS',
  outerwear: 'OUTERWEAR',
  shoes: 'SHOES',
}

// ── Ladders ──────────────────────────────────────────────────────────────────
// Womenswear UK ladder, step 2. Shoes UK ladder, step 1.
export const CLOTHING_LADDER = [4, 6, 8, 10, 12, 14, 16, 18, 20, 22] as const
export const SHOE_LADDER = [2, 3, 4, 5, 6, 7, 8, 9] as const

export const CLOTHING_STEP = 2
export const SHOE_STEP = 1

export const stepFor = (c: SizeCategory): number => (c === 'shoes' ? SHOE_STEP : CLOTHING_STEP)
export const ladderFor = (c: SizeCategory): readonly number[] =>
  c === 'shoes' ? SHOE_LADDER : CLOTHING_LADDER

// Equivalences, index-aligned with CLOTHING_LADDER.
//   IT = EU + 4  (IT 42 = EU 38 = UK 10)
//   FR = EU + 2  (FR 40 = EU 38 = UK 10)  ← FR is NOT the same as EU/DE
const CLOTHING_US = [0, 2, 4, 6, 8, 10, 12, 14, 16, 18]
const CLOTHING_EU = [32, 34, 36, 38, 40, 42, 44, 46, 48, 50]
const CLOTHING_ALPHA: string[][] = [
  ['XXS'], ['XS'], ['S'], ['S', 'M'], ['M'], ['L'], ['XL'], ['XL', 'XXL'], ['XXL'], ['XXL', '3XL'],
]

// Shoes, index-aligned with SHOE_LADDER. US ≈ UK + 2, EU ≈ UK + 33.
const SHOE_US = [4, 5, 6, 7, 8, 9, 10, 11]
const SHOE_EU = [35, 36, 37, 38, 39, 40, 41, 42]

// Alpha sizes are brand-dependent and span more than one numeric size. The
// FIRST entry is the representative canonical; the rest widen an alpha item's
// availability so a "M" garment counts as available to both a 10 and a 12.
const ALPHA_TO_UK: Record<string, number[]> = {
  XXS: [4], XS: [6], S: [8, 10], M: [10, 12], L: [14], XL: [16, 18], XXL: [18, 20], '3XL': [22],
  'XS/S': [6, 8], 'S/M': [8, 10, 12], 'M/L': [12, 14], 'L/XL': [14, 16],
}

const ONE_SIZE_RE = /^(o\/?s|one[\s-]?size|onesize|free[\s-]?size|uni|tu|u|n\/?a|no[\s-]?size|single|taille\s*unique)$/i

// ── Item type → size category ────────────────────────────────────────────────
// Anything not listed (bags, jewellery, belts, scarves, hats, sunglasses) has
// no meaningful size and is never size-gated.
const TOPS = new Set<ItemType>([
  'shirt', 'blouse', 't-shirt', 'knitwear', 'corset', 'bodysuit',
  'mini_dress', 'midi_dress', 'maxi_dress', 'shirt_dress', 'slip_dress',
])
const BOTTOMS = new Set<ItemType>(['trousers', 'jeans', 'shorts', 'skirt'])
const OUTERWEAR = new Set<ItemType>(['coat', 'trench', 'jacket', 'blazer', 'gilet', 'cape'])
const SHOES = new Set<ItemType>(['boot', 'heel', 'flat', 'sneaker', 'mule', 'sandal'])

export function sizeCategoryFor(itemType: ItemType | string | null | undefined): SizeCategory | null {
  const t = itemType as ItemType
  if (TOPS.has(t)) return 'tops'
  if (BOTTOMS.has(t)) return 'bottoms'
  if (OUTERWEAR.has(t)) return 'outerwear'
  if (SHOES.has(t)) return 'shoes'
  return null
}

// ── Parsing ──────────────────────────────────────────────────────────────────

/** Snap a number onto a ladder, within half a step. Returns null if it's miles off. */
function snap(ladder: readonly number[], values: number[], n: number): number | null {
  let best: number | null = null
  let bestD = Infinity
  values.forEach((v, i) => {
    const d = Math.abs(v - n)
    if (d < bestD) { bestD = d; best = ladder[i] }
  })
  const tolerance = ladder === SHOE_LADDER ? 0.75 : 1.5
  return bestD <= tolerance ? best : null
}

export interface ParsedSize {
  system: SizeSystem
  /** Canonical UK-ladder value(s). More than one for alpha sizes that span two. */
  values: number[]
}

/**
 * Parse a raw retailer size label for a given category.
 *
 * Returns `null` when the label carries no size information we can act on
 * (one-size, jeans waist, unparseable). Null is never a mismatch — it means
 * "unknown", and unknown never hides a piece.
 */
export function parseSizeLabel(raw: string, category: SizeCategory): ParsedSize | null {
  const s = String(raw ?? '').trim().toUpperCase().replace(/\s+/g, ' ')
  if (!s) return null
  if (ONE_SIZE_RE.test(s)) return { system: 'one_size', values: [] }

  const shoes = category === 'shoes'
  const ladder = ladderFor(category)
  const num = (m: RegExpMatchArray) => parseFloat(m[1])
  let m: RegExpMatchArray | null

  if ((m = s.match(/UK\s*(\d+(?:\.\d+)?)/))) {
    const v = snap(ladder, [...ladder], num(m))
    return v == null ? null : { system: shoes ? 'shoe_UK' : 'UK', values: [v] }
  }
  if ((m = s.match(/US\s*(\d+(?:\.\d+)?)/))) {
    const v = snap(ladder, shoes ? SHOE_US : CLOTHING_US, num(m))
    return v == null ? null : { system: shoes ? 'shoe_US' : 'US', values: [v] }
  }
  if ((m = s.match(/IT\s*(\d+(?:\.\d+)?)/))) {
    // IT = EU + 4 for clothing; Italian shoe sizes are just EU.
    const v = snap(ladder, shoes ? SHOE_EU : CLOTHING_EU, shoes ? num(m) : num(m) - 4)
    return v == null ? null : { system: 'IT', values: [v] }
  }
  if ((m = s.match(/FR\s*(\d+(?:\.\d+)?)/))) {
    // FR = EU + 2 for clothing; French shoe sizes are EU.
    const v = snap(ladder, shoes ? SHOE_EU : CLOTHING_EU, shoes ? num(m) : num(m) - 2)
    return v == null ? null : { system: 'FR', values: [v] }
  }
  if ((m = s.match(/(?:EU|DE)\s*(\d+(?:\.\d+)?)/))) {
    const v = snap(ladder, shoes ? SHOE_EU : CLOTHING_EU, num(m))
    return v == null ? null : { system: shoes ? 'shoe_EU' : 'EU', values: [v] }
  }
  if ((m = s.match(/AU\s*(\d+(?:\.\d+)?)/))) {
    // AU womenswear follows UK; AU shoe sizing follows US.
    const v = snap(ladder, shoes ? SHOE_US : [...ladder], num(m))
    return v == null ? null : { system: 'AU', values: [v] }
  }

  if (!shoes && ALPHA_TO_UK[s]) return { system: 'alpha', values: [...ALPHA_TO_UK[s]] }

  // A bare number. Which system it is depends on the magnitude, which is
  // unambiguous in practice — nobody sells a UK 38 dress or an EU 10 shoe.
  if ((m = s.match(/^(\d+(?:\.\d+)?)$/))) {
    const n = num(m)
    if (shoes) {
      if (n >= 34 && n <= 46) { const v = snap(ladder, SHOE_EU, n); return v == null ? null : { system: 'shoe_EU', values: [v] } }
      if (n >= 1 && n <= 13)  { const v = snap(ladder, [...ladder], n); return v == null ? null : { system: 'shoe_UK', values: [v] } }
      return null
    }
    if (n >= 30 && n <= 52) { const v = snap(ladder, CLOTHING_EU, n); return v == null ? null : { system: 'EU', values: [v] } }
    if (n >= 22 && n < 30)  return { system: 'waist', values: [] } // jeans waist — no reliable UK mapping
    if (n >= 0 && n <= 20)  { const v = snap(ladder, CLOTHING_US, n); return v == null ? null : { system: 'US', values: [v] } }
    return null
  }

  return null
}

// ── Brand offsets ────────────────────────────────────────────────────────────
// Steps to ADD to the labelled canonical to reach the size it actually fits:
//   -1  runs small — a labelled UK 10 fits like a UK 8
//    0  true to size
//   +1  runs large — a labelled UK 10 fits like a UK 12
export type BrandSizeOffsets = Partial<Record<SizeCategory | 'default', number>>

export function offsetFor(offsets: BrandSizeOffsets | null | undefined, category: SizeCategory): number {
  if (!offsets) return 0
  const v = offsets[category] ?? offsets.default ?? 0
  return Number.isFinite(v as number) ? Math.round(v as number) : 0
}

/** Move a canonical value `steps` positions along its ladder, clamped to the ends. */
export function shiftCanonical(value: number, category: SizeCategory, steps: number): number {
  const ladder = ladderFor(category)
  const i = ladder.indexOf(value)
  if (i < 0) return value
  return ladder[Math.min(ladder.length - 1, Math.max(0, i + steps))]
}

export interface CanonicalSize {
  label: string          // the retailer's own string, verbatim — this is what she sees
  system: SizeSystem
  category: SizeCategory | null
  value: number | null   // canonical, brand offset applied
  /** Every canonical value this label covers (alpha sizes span two). */
  values: number[]
}

/**
 * Normalise one retailer size label into its canonical form, applying the
 * brand's known offset. `category` null (bags, jewellery) short-circuits: those
 * have no size to match on.
 */
export function canonicalise(
  label: string,
  category: SizeCategory | null,
  brandOffsets?: BrandSizeOffsets | null,
): CanonicalSize {
  if (!category) return { label, system: 'one_size', category: null, value: null, values: [] }
  const parsed = parseSizeLabel(label, category)
  if (!parsed || parsed.values.length === 0) {
    return { label, system: parsed?.system ?? 'unknown', category, value: null, values: [] }
  }
  const steps = offsetFor(brandOffsets, category)
  const values = Array.from(new Set(parsed.values.map((v) => shiftCanonical(v, category, steps))))
  return { label, system: parsed.system, category, value: values[0], values }
}

// ── Matching ─────────────────────────────────────────────────────────────────

export type MatchQuality = 'full' | 'acceptable' | 'none' | 'unknown'

export interface CategorySizes {
  /** Her canonical size in this category. */
  value: number | null
  /** The adjacent size SHE listed ("I'm a 10 or a 12"). Not inferred. */
  adjacent: number | null
}

export type SizeProfile = Partial<Record<SizeCategory, CategorySizes>>

/**
 * How well a set of canonical values (one item size, or every in-stock size on
 * an item) matches her profile for that category.
 *
 *   full        exact canonical match
 *   acceptable  an adjacent size she listed herself
 *   none        anything else
 *   unknown     we can't tell — no profile for the category, or the item's
 *               sizing didn't parse. Never treated as a mismatch.
 */
export function matchQuality(
  profile: SizeProfile | null | undefined,
  category: SizeCategory | null,
  values: number[],
): MatchQuality {
  if (!category) return 'unknown'
  const mine = profile?.[category]
  if (!mine || mine.value == null) return 'unknown'
  if (!values.length) return 'unknown'
  if (values.includes(mine.value)) return 'full'
  if (mine.adjacent != null && values.includes(mine.adjacent)) return 'acceptable'
  return 'none'
}

/** A match she can actually buy: exact, or an adjacent size she listed. */
export const isWearable = (q: MatchQuality): boolean => q === 'full' || q === 'acceptable'

/** Every canonical value she'd accept in a category — for query filters. */
export function acceptedValues(profile: SizeProfile | null | undefined, category: SizeCategory): number[] {
  const mine = profile?.[category]
  if (!mine || mine.value == null) return []
  return mine.adjacent != null && mine.adjacent !== mine.value ? [mine.value, mine.adjacent] : [mine.value]
}

/** True when she has told us nothing at all — every gate falls back to lenient. */
export function profileIsEmpty(profile: SizeProfile | null | undefined): boolean {
  if (!profile) return true
  return SIZE_CATEGORIES.every((c) => profile[c]?.value == null)
}

// ── Display ──────────────────────────────────────────────────────────────────

/** "UK 10 · US 6 · EU 38 · IT 42 · S/M" — every system, so she recognises hers. */
export function canonicalLabel(value: number, category: SizeCategory): string {
  const ladder = ladderFor(category)
  const i = ladder.indexOf(value)
  if (i < 0) return String(value)
  if (category === 'shoes') return `UK ${value} · US ${SHOE_US[i]} · EU ${SHOE_EU[i]}`
  return `UK ${value} · US ${CLOTHING_US[i]} · EU ${CLOTHING_EU[i]} · IT ${CLOTHING_EU[i] + 4} · ${CLOTHING_ALPHA[i].join('/')}`
}

/** Short form for chips and badges: "UK 10". */
export const shortSizeLabel = (value: number): string => `UK ${value}`
