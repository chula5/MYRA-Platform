// ── Size matching against a shopper's profile ────────────────────────────────
//
// Pure: takes an item's size rows and a size profile, answers "can she buy
// this, and in which size". Shared by the server (composition gates, alerting)
// and the client (badges, sourcing panel), so both say the same thing.
//
// The asymmetry that drives everything downstream:
//
//   UNIQUE items are HARD-FILTERED. A one-of-one that doesn't match her profile
//   is never shown and never composed for her — there is no point styling a
//   size 14 vintage coat for a size 8 client, and no restock will fix it.
//
//   REPLENISHABLE items are RANKED, not filtered. Retail stock returns, and the
//   look still has styling value, so an outfit with a piece unavailable in her
//   size sorts down the feed and says so in the sourcing panel.

import {
  matchQuality, isWearable, sizeCategoryFor,
  type MatchQuality, type SizeCategory, type SizeProfile,
} from '@/lib/size-canonical'

export type StockLevel = 'in_stock' | 'low' | 'sold_out' | 'unknown'

export interface SizeRow {
  size_label: string
  size_system?: string | null
  canonical_category: SizeCategory | null
  canonical_value: number | null
  canonical_values?: number[] | null
  in_stock: boolean
  stock_level: StockLevel
}

export interface AvailabilityInput {
  item_type?: string | null
  stock_class?: string | null
  stock_status?: string | null
  status?: string | null
}

export interface ItemAvailability {
  category: SizeCategory | null
  /** Does this item carry usable size data at all? Bags and one-size pieces don't. */
  sized: boolean
  quality: MatchQuality
  /** She can buy it: exact size, or an adjacent size she listed. */
  wearable: boolean
  /** In-stock labels in the retailer's own words, for display. */
  inStockLabels: string[]
  /** The label she'd actually order, e.g. "IT 42" — null when nothing matches. */
  herSizeLabel: string | null
  herSizeLevel: StockLevel | null
  lowInHerSize: boolean
  soldOutInHerSize: boolean
  /** True when we know her size and the piece simply isn't available in it. */
  outOfHerSize: boolean
}

const valuesOf = (r: SizeRow): number[] => {
  const arr = (r.canonical_values ?? []).filter((n) => n != null)
  if (arr.length) return arr as number[]
  return r.canonical_value != null ? [r.canonical_value] : []
}

/**
 * Resolve one item's availability for one shopper.
 *
 * Missing information is never a mismatch: an item with no size rows, or a
 * category she hasn't given us a size for, comes back `quality: 'unknown'` and
 * `outOfHerSize: false`. Hiding a piece because we failed to parse its sizing
 * would be our error charged to her.
 */
export function resolveAvailability(
  item: AvailabilityInput,
  rows: SizeRow[],
  profile: SizeProfile | null | undefined,
): ItemAvailability {
  const category = sizeCategoryFor(item.item_type as any)
  const usable = rows.filter((r) => valuesOf(r).length > 0)

  const base: ItemAvailability = {
    category,
    sized: usable.length > 0,
    quality: 'unknown',
    wearable: true,
    inStockLabels: rows.filter((r) => r.in_stock).map((r) => r.size_label),
    herSizeLabel: null,
    herSizeLevel: null,
    lowInHerSize: false,
    soldOutInHerSize: false,
    outOfHerSize: false,
  }

  if (!category || usable.length === 0) return base

  // Best row for her: AVAILABILITY OUTRANKS EXACTNESS.
  //
  // If her exact size is sold out and the adjacent size she listed is in stock,
  // the adjacent one is the answer — she can buy that today. Ranking exactness
  // first would report the look as out of her size while a size she told us she
  // wears sat on the shelf.
  //
  // Only when nothing she wears is in stock do we fall back to the best-quality
  // row, so "sold out in your size" names the size she actually wanted.
  const rank = (q: MatchQuality) => (q === 'full' ? 2 : q === 'acceptable' ? 1 : 0)
  const buyable = (r: SizeRow) => r.in_stock && r.stock_level !== 'sold_out'
  let best: { row: SizeRow; q: MatchQuality } | null = null
  for (const row of usable) {
    const q = matchQuality(profile, category, valuesOf(row))
    if (q === 'unknown') return { ...base, quality: 'unknown' } // no profile for this category
    if (!isWearable(q)) continue
    if (
      !best ||
      (buyable(row) && !buyable(best.row)) ||
      (buyable(row) === buyable(best.row) && rank(q) > rank(best.q))
    ) {
      best = { row, q }
    }
  }

  if (!best) {
    // She has a size for this category and none of the item's sizes match it.
    return { ...base, quality: 'none', wearable: false, outOfHerSize: true }
  }

  const level = best.row.stock_level
  const sold = !buyable(best.row)
  return {
    ...base,
    quality: best.q,
    wearable: !sold,
    herSizeLabel: best.row.size_label,
    herSizeLevel: level,
    lowInHerSize: !sold && level === 'low',
    soldOutInHerSize: sold,
    outOfHerSize: sold,
  }
}

// ── Gates ────────────────────────────────────────────────────────────────────

/**
 * The hard gate for one-of-one stock. Returns true when the piece may be shown
 * to or composed for this shopper.
 *
 * `strict` raises replenishable items to the same bar — private-stylist
 * lookbooks use it, because every item in a lookbook must be available in the
 * client's size at build time. If the composer can't fill a slot in her size it
 * chooses a different item rather than shipping an unbuyable look.
 */
export function passesSizeGate(
  item: AvailabilityInput,
  rows: SizeRow[],
  profile: SizeProfile | null | undefined,
  opts: { strict?: boolean } = {},
): boolean {
  const unique = item.stock_class === 'unique'
  if (!unique && !opts.strict) return true
  const a = resolveAvailability(item, rows, profile)
  if (a.quality === 'unknown') return true // unknown sizing never hides a piece
  return a.wearable
}

/**
 * Feed ranking penalty for a replenishable piece she can't currently buy in her
 * size. Sorts the look down without removing it — the styling still has value.
 */
export const OUT_OF_SIZE_PENALTY = 0.35

export function sizePenalty(availabilities: ItemAvailability[]): number {
  return availabilities.some((a) => a.outOfHerSize) ? OUT_OF_SIZE_PENALTY : 0
}

/** Does any item in a look sit outside her size? Drives the feed sort + label. */
export const anyOutOfSize = (availabilities: ItemAvailability[]): boolean =>
  availabilities.some((a) => a.outOfHerSize)
