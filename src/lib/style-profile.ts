// ── CLIENT STYLE PROFILE ────────────────────────────────────────────────────
// The structured questionnaire between the brand picker and the rating swipes.
//
// Swipes show what she likes. They can't show what she won't wear, or what she
// can spend. This captures both, and the HARD/SOFT split is the whole point:
//
//   HARD  colour_never, length_no_go, heel_preference, price_comfort
//         → an item mask. Filters the feed absolutely; ratings never override.
//   SOFT  colour_loved, fit_top, fit_bottom, pattern_appetite, occasion_mix
//         → a one-time prior on the taste vector, worth ~3 swipe likes.
//           NEVER filters inventory — a soft answer must not hide stock.
//
// Skipped question = null = no constraint. Silence is never read as a "no".

import type { ColourFamily, ItemType, OutfitWithItems } from '@/types/database'
import { VECTOR_DIM, zeroVector } from '@/lib/taste-vector'

// ── shape ───────────────────────────────────────────────────────────────────

export type LengthNoGo =
  | 'mini' | 'above_knee' | 'cropped_top' | 'sleeveless' | 'low_neckline' | 'high_heel'
export type HeelPreference = 'flats_only' | 'low_heel_ok' | 'any'
export type OccasionKey =
  | 'work' | 'smart_casual_social' | 'casual_daily' | 'events_occasions' | 'travel'
export type Frequency = 'often' | 'sometimes' | 'rarely'

export interface ClientStyleProfile {
  user_id: string
  // HARD
  colour_never: ColourFamily[] | null
  length_no_go: LengthNoGo[] | null
  heel_preference: HeelPreference | null
  price_comfort: [number, number] | number[] | null
  // SOFT
  colour_loved: ColourFamily[] | null
  fit_top: number | null
  fit_bottom: number | null
  pattern_appetite: number | null
  occasion_mix: Partial<Record<OccasionKey, Frequency>> | null
  // free text
  brands_missed: string | null
  notes: string | null
  completed_at?: string | null
}

export const HARD_FIELDS = ['colour_never', 'length_no_go', 'heel_preference', 'price_comfort'] as const
export const SOFT_FIELDS = ['colour_loved', 'fit_top', 'fit_bottom', 'pattern_appetite', 'occasion_mix'] as const

// ── vocabulary ──────────────────────────────────────────────────────────────

export const PROFILE_COLOURS: { value: ColourFamily; label: string; swatch: string }[] = [
  { value: 'black', label: 'BLACK', swatch: '#0A0A0A' },
  { value: 'white', label: 'WHITE', swatch: '#FFFFFF' },
  { value: 'cream', label: 'CREAM', swatch: '#F0E9DC' },
  { value: 'grey', label: 'GREY', swatch: '#9A9A98' },
  { value: 'navy', label: 'NAVY', swatch: '#1F2A44' },
  { value: 'blue', label: 'BLUE', swatch: '#4A6FA5' },
  { value: 'brown', label: 'BROWN', swatch: '#6B4A34' },
  { value: 'camel', label: 'CAMEL', swatch: '#C4A882' },
  { value: 'green', label: 'GREEN', swatch: '#4A6B4A' },
  { value: 'burgundy', label: 'BURGUNDY', swatch: '#6B2A34' },
  { value: 'red', label: 'RED', swatch: '#B83A3A' },
  { value: 'pink', label: 'PINK', swatch: '#E5B8C4' },
  { value: 'yellow', label: 'YELLOW', swatch: '#E8C86A' },
  { value: 'orange', label: 'ORANGE', swatch: '#D08A4A' },
  { value: 'purple', label: 'PURPLE', swatch: '#7A5A8A' },
  { value: 'multicolour', label: 'PRINT / MULTI', swatch: 'linear-gradient(135deg,#B83A3A,#E8C86A,#4A6FA5)' },
]

export const LENGTH_NO_GO_OPTIONS: { value: LengthNoGo; label: string }[] = [
  { value: 'mini', label: 'MINI' },
  { value: 'above_knee', label: 'ANYTHING ABOVE THE KNEE' },
  { value: 'cropped_top', label: 'CROPPED TOPS' },
  { value: 'sleeveless', label: 'SLEEVELESS' },
  { value: 'low_neckline', label: 'LOW NECKLINES' },
  { value: 'high_heel', label: 'HIGH HEELS' },
]

export const HEEL_OPTIONS: { value: HeelPreference; label: string; hint: string }[] = [
  { value: 'flats_only', label: 'FLATS ONLY', hint: 'Nothing with a heel' },
  { value: 'low_heel_ok', label: 'A LITTLE HEIGHT', hint: 'Low and block, nothing precarious' },
  { value: 'any', label: 'ANY HEIGHT', hint: 'Heels are fair game' },
]

export const OCCASION_OPTIONS: { value: OccasionKey; label: string }[] = [
  { value: 'work', label: 'WORK' },
  { value: 'smart_casual_social', label: 'SMART CASUAL / SEEING PEOPLE' },
  { value: 'casual_daily', label: 'EVERYDAY' },
  { value: 'events_occasions', label: 'EVENTS & OCCASIONS' },
  { value: 'travel', label: 'TRAVEL' },
]

export const FREQUENCY_OPTIONS: { value: Frequency; label: string }[] = [
  { value: 'often', label: 'OFTEN' },
  { value: 'sometimes', label: 'SOMETIMES' },
  { value: 'rarely', label: 'RARELY' },
]

// Asked in pounds — a real spend on a dress or coat — and mapped to
// brand.price_tier behind the scenes. Tiers are never shown to the client.
export const PRICE_BANDS: { tier: number; label: string; hint: string }[] = [
  { tier: 1, label: 'UP TO £100', hint: 'High street' },
  { tier: 2, label: '£100 – £250', hint: 'Elevated high street' },
  { tier: 3, label: '£250 – £500', hint: 'Contemporary' },
  { tier: 4, label: '£500 – £1,000', hint: 'Premium' },
  { tier: 5, label: '£1,000 +', hint: 'Luxury' },
]

// ── HARD constraints → the item mask ────────────────────────────────────────
//
// Every rule here is enforced from scored fields, not guesswork:
//   colour_never    item.colour_family
//   price_comfort   brand.price_tier
//   mini/above_knee item_type + item.length   (1 = cropped/micro → 5 = maxi/floor)
//   cropped_top     item_type + item.length
//   sleeveless      item.sleeve               (1 = sleeveless → 5 = full long sleeve)
//   low_neckline    item.neckline             (1 = high/closed → 5 = plunging/low)
//   heels           item_type + heel keywords
//
// sleeve and neckline (migration 0042) replaced product-name matching, which
// missed most pieces. Items scored before 0042 have neither, so the name check
// stays as a fallback for exactly those — remove it once the library is
// backfilled and the rule becomes purely structural.

const DRESS_SKIRT: ItemType[] = ['mini_dress', 'midi_dress', 'maxi_dress', 'shirt_dress', 'slip_dress', 'skirt']
const TOP_TYPES: ItemType[] = ['shirt', 'blouse', 't-shirt', 'knitwear', 'corset', 'bodysuit']
const SHOE_TYPES: ItemType[] = ['heel', 'boot', 'flat', 'sneaker', 'mule', 'sandal']

const SLEEVELESS_RE = /\b(sleeveless|cami|camisole|tank|halter|strapless|vest top|bandeau|tube)\b/i
const LOW_NECK_RE = /\b(plunge|plunging|deep[- ]v|low[- ]cut|sweetheart|bustier|strapless|halter|corset)\b/i
const HIGH_HEEL_RE = /\b(stiletto|pump|court|high[- ]heel|heeled)\b/i
const LOW_HEEL_RE = /\b(kitten|block heel|low heel)\b/i

interface MaskItem {
  item_type?: ItemType | null
  colour_family?: ColourFamily | null
  length?: number | null
  neckline?: number | null
  sleeve?: number | null
  product_name?: string | null
  brand?: { price_tier?: number | null } | null
}

/** True when this single item is excluded by the profile's HARD constraints. */
export function itemBlocked(p: ClientStyleProfile | null, item: MaskItem): boolean {
  if (!p) return false
  const type = (item.item_type ?? null) as ItemType | null
  const name = item.product_name ?? ''
  const len = typeof item.length === 'number' ? item.length : null

  // colour_never — absolute
  if (p.colour_never?.length && item.colour_family && p.colour_never.includes(item.colour_family)) return true

  // price ceiling — absolute (the floor is judged per-outfit, see outfitBlocked)
  const tier = item.brand?.price_tier ?? null
  if (p.price_comfort?.length === 2 && tier != null && tier > p.price_comfort[1]) return true

  const noGo = new Set(p.length_no_go ?? [])
  const isDressSkirt = type != null && DRESS_SKIRT.includes(type)
  const isTop = type != null && TOP_TYPES.includes(type)

  if (noGo.has('mini') && (type === 'mini_dress' || (isDressSkirt && len != null && len <= 1))) return true
  if (noGo.has('above_knee') && (type === 'mini_dress' || (isDressSkirt && len != null && len <= 2))) return true
  if (noGo.has('cropped_top') && isTop && len != null && len <= 2) return true
  // Scored fields win. Only fall back to the name when the item predates 0042
  // and has no score at all — an item scored 5 for sleeve is NOT sleeveless,
  // whatever the word "cami" in its name suggests.
  const sleeve = typeof item.sleeve === 'number' ? item.sleeve : null
  const neckline = typeof item.neckline === 'number' ? item.neckline : null
  if (noGo.has('sleeveless')) {
    if (sleeve != null ? sleeve <= 1 : (SLEEVELESS_RE.test(name) || type === 'corset')) return true
  }
  if (noGo.has('low_neckline')) {
    if (neckline != null ? neckline >= 4 : (LOW_NECK_RE.test(name) || type === 'corset')) return true
  }
  if (noGo.has('high_heel') && (type === 'heel' || (type != null && SHOE_TYPES.includes(type) && HIGH_HEEL_RE.test(name)))) return true

  // heel_preference
  const isShoe = type != null && SHOE_TYPES.includes(type)
  if (isShoe && p.heel_preference === 'flats_only') {
    if (type === 'heel' || HIGH_HEEL_RE.test(name)) return true
  }
  if (isShoe && p.heel_preference === 'low_heel_ok') {
    // Stilettos and court shoes out; kitten/block heels stay.
    if (/\b(stiletto|court)\b/i.test(name)) return true
    if (type === 'heel' && !LOW_HEEL_RE.test(name)) return true
  }

  return false
}

/** True when an outfit is excluded — any blocked item disqualifies the look. */
export function outfitBlocked(p: ClientStyleProfile | null, o: OutfitWithItems): boolean {
  if (!p) return false
  const links = ((o.outfit_item ?? []) as any[]).filter((l) => l.item)
  if (links.some((l) => itemBlocked(p, l.item))) return true

  // Price FLOOR is judged on the look's average tier, not per item, so one
  // inexpensive belt can't disqualify an otherwise well-positioned outfit.
  if (p.price_comfort?.length === 2) {
    const tiers = links.map((l) => l.item?.brand?.price_tier).filter((t: any) => typeof t === 'number')
    if (tiers.length) {
      const avg = tiers.reduce((a: number, b: number) => a + b, 0) / tiers.length
      if (avg < p.price_comfort[0] - 0.5) return true
    }
  }
  return false
}

/** Apply the item mask to a feed. Returns the outfits she is allowed to see. */
export function applyItemMask<T extends OutfitWithItems>(p: ClientStyleProfile | null, outfits: T[]): T[] {
  if (!p || !hasHardConstraints(p)) return outfits
  return outfits.filter((o) => !outfitBlocked(p, o))
}

export function hasHardConstraints(p: ClientStyleProfile | null): boolean {
  if (!p) return false
  return Boolean(
    p.colour_never?.length ||
    p.length_no_go?.length ||
    (p.heel_preference && p.heel_preference !== 'any') ||
    p.price_comfort?.length === 2,
  )
}

// ── SOFT preferences → a one-time taste-vector prior ────────────────────────

// Worth ~3 swipe likes (EVENT_WEIGHTS.like = 5).
export const SOFT_PRIOR_WEIGHT = 15

// Dimension indices from buildOutfitVector, named so the mapping is auditable.
const DIM = {
  pattern: 1,
  volume: 6,
  priceTier: 9,
  neutralRatio: 14,
  black: 15,
  whiteCream: 16,
  navyBlue: 17,
  brownCamel: 18,
  green: 19,
  brights: 20,
  multicolour: 21,
} as const

const COLOUR_DIM: Partial<Record<ColourFamily, number>> = {
  black: DIM.black,
  white: DIM.whiteCream, cream: DIM.whiteCream,
  navy: DIM.navyBlue, blue: DIM.navyBlue,
  brown: DIM.brownCamel, camel: DIM.brownCamel,
  green: DIM.green,
  red: DIM.brights, burgundy: DIM.brights, orange: DIM.brights,
  pink: DIM.brights, yellow: DIM.brights, purple: DIM.brights,
  multicolour: DIM.multicolour,
}

const NEUTRAL_COLOURS: ColourFamily[] = ['white', 'cream', 'black', 'grey', 'navy', 'camel', 'brown']

/**
 * Build the pseudo-outfit vector the soft answers describe, in the same [0,1]
 * space as buildOutfitVector so `accumulate` treats it like any other signal.
 * Returns null when nothing soft was answered — no answers, no nudge.
 */
export function softPriorVector(p: ClientStyleProfile | null): number[] | null {
  if (!p) return null
  const v = zeroVector()
  let touched = false

  const loved = p.colour_loved ?? []
  if (loved.length) {
    touched = true
    for (const c of loved) {
      const d = COLOUR_DIM[c]
      if (d != null) v[d] = Math.min(1, v[d] + 1 / Math.min(loved.length, 3))
    }
    const neutralShare = loved.filter((c) => NEUTRAL_COLOURS.includes(c)).length / loved.length
    v[DIM.neutralRatio] = neutralShare
  }

  if (p.pattern_appetite != null) {
    touched = true
    v[DIM.pattern] = (p.pattern_appetite - 1) / 4
  }

  // Volume reads the looser of the two halves — an oversized top or a wide
  // trouser both make a fuller-volume look.
  const fits = [p.fit_top, p.fit_bottom].filter((x): x is number => x != null)
  if (fits.length) {
    touched = true
    v[DIM.volume] = (Math.max(...fits) - 1) / 4
  }

  // price_comfort is HARD (it masks inventory) but its midpoint also tells us
  // where she actually shops, so it seeds the brand-positioning dimension.
  if (p.price_comfort?.length === 2) {
    touched = true
    v[DIM.priceTier] = ((p.price_comfort[0] + p.price_comfort[1]) / 2 - 1) / 4
  }

  return touched ? v : null
}

/** Occasion keys she does anything more than rarely — orders the feed's rows. */
export function preferredOccasions(p: ClientStyleProfile | null): OccasionKey[] {
  if (!p?.occasion_mix) return []
  const rank: Record<Frequency, number> = { often: 0, sometimes: 1, rarely: 2 }
  return (Object.entries(p.occasion_mix) as [OccasionKey, Frequency][])
    .filter(([, f]) => f && f !== 'rarely')
    .sort((a, b) => rank[a[1]] - rank[b[1]])
    .map(([k]) => k)
}

/** Normalise a raw DB row (arrays may come back null) into the app shape. */
export function normaliseProfile(row: any): ClientStyleProfile | null {
  if (!row) return null
  const arr = (x: any) => (Array.isArray(x) && x.length ? x : null)
  return {
    user_id: row.user_id,
    colour_never: arr(row.colour_never),
    length_no_go: arr(row.length_no_go),
    heel_preference: row.heel_preference ?? null,
    price_comfort: arr(row.price_comfort),
    colour_loved: arr(row.colour_loved),
    fit_top: row.fit_top ?? null,
    fit_bottom: row.fit_bottom ?? null,
    pattern_appetite: row.pattern_appetite ?? null,
    occasion_mix: row.occasion_mix && Object.keys(row.occasion_mix).length ? row.occasion_mix : null,
    brands_missed: row.brands_missed ?? null,
    notes: row.notes ?? null,
    completed_at: row.completed_at ?? null,
  }
}

export { VECTOR_DIM }
