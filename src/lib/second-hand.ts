// ── Second-hand / one-of-one inventory ───────────────────────────────────────
//
// Pure domain rules for unique stock. No database, no fetch — so the parts that
// decide whether a piece is gone forever, how often to check it, and how loudly
// to tell someone, are all testable on their own.
//
// The governing distinction:
//
//   replenishable  retail. Sells out, restocks. Rank it down, keep the look.
//   unique         one-of-one. Quantity 1. When it sells it is GONE: status
//                  'sold', never re-checked, never restored, excluded from the
//                  30-day restock watch that replenishable items get.

export type StockClass = 'replenishable' | 'unique'
export type SourceType = 'retail' | 'second_hand' | 'vintage'

export interface SourceBearing {
  stock_class?: StockClass | string | null
  status?: string | null
  merchant?: { source_type?: string | null; default_stock_class?: string | null } | null
  brand?: { source_type?: string | null } | null
}

export const isUnique = (item: SourceBearing | null | undefined): boolean =>
  item?.stock_class === 'unique'

/**
 * Where the piece comes from. The MERCHANT is authoritative — SPRL Shop is the
 * second-hand seller whatever label is in the garment — with a brand-level
 * override for own-label vintage houses that sell direct.
 */
export function sourceTypeOf(item: SourceBearing | null | undefined): SourceType {
  const merchant = item?.merchant?.source_type
  if (merchant === 'second_hand' || merchant === 'vintage') return merchant
  const brand = item?.brand?.source_type
  if (brand === 'second_hand' || brand === 'vintage') return brand
  if (merchant === 'retail') return 'retail'
  return (brand as SourceType) ?? 'retail'
}

/** Pre-loved or vintage — shown only to users who opted in. */
export const isSecondHand = (item: SourceBearing | null | undefined): boolean =>
  sourceTypeOf(item) !== 'retail'

/** Sold and gone. Distinct from out_of_stock, which can come back. */
export const isSold = (item: SourceBearing | null | undefined): boolean =>
  item?.status === 'sold'

/** The stock class a newly ingested item inherits from its merchant. */
export function defaultStockClass(
  merchant: { default_stock_class?: string | null; source_type?: string | null } | null | undefined,
): StockClass {
  if (merchant?.default_stock_class === 'unique') return 'unique'
  // A second-hand or vintage seller listing without an explicit default is
  // still selling one-of-ones — that is what second-hand means.
  if (merchant?.source_type === 'second_hand' || merchant?.source_type === 'vintage') return 'unique'
  return 'replenishable'
}

// ── Risk-tiered polling ──────────────────────────────────────────────────────
//
// A uniform cadence is either too slow for the pieces that matter or a burst on
// a retailer that doesn't deserve it. Tier by how much a stale answer would
// cost: someone waiting on a piece in her size is the expensive case.

export type PollTier = 'A' | 'B' | 'C'

export const POLL_INTERVAL_MS: Record<PollTier, number> = {
  A: 30 * 60_000,      // every 30 min
  B: 3 * 60 * 60_000,  // every 3 hours
  C: 24 * 60 * 60_000, // daily
}

export interface RiskInputs {
  /** Users who saved it AND wear its size — the expensive case. */
  saversInSize: number
  /** Users who saved it whose size doesn't match (or isn't known). */
  saversOtherSize: number
  clickOuts48h: number
  clickOuts24h: number
  daysLive: number
  inLiveOutfit: boolean
  stockClass: StockClass
}

/**
 * Tier assignment, straight from the rules — deliberately not derived from the
 * continuous score, so "saved by someone in her size" can never be outvoted by
 * arithmetic.
 */
export function pollTier(r: RiskInputs): PollTier {
  if (r.saversInSize >= 1 || r.clickOuts24h > 0) return 'A'
  if (r.inLiveOutfit) return 'B'
  return 'C'
}

/**
 * Continuous 0-1 risk, used to ORDER work inside a tier and to decide whether a
 * low-stock alert is urgent enough to break the daily batch. A unique piece
 * carries a floor, because for it every check is the last chance.
 */
export function riskScore(r: RiskInputs): number {
  const saves = r.saversInSize * 1 + r.saversOtherSize * 0.25
  const parts = [
    Math.min(1, saves / 3) * 0.4,
    Math.min(1, r.clickOuts48h / 6) * 0.3,
    (r.inLiveOutfit ? 1 : 0) * 0.15,
    // Freshly live pieces move fastest; the signal fades over a fortnight.
    Math.max(0, 1 - r.daysLive / 14) * 0.15,
  ]
  const base = parts.reduce((a, b) => a + b, 0)
  return Math.min(1, r.stockClass === 'unique' ? Math.max(base, 0.35) : base)
}

/** Items above this are "fast-moving" — their low-stock alerts skip the batch. */
export const FAST_MOVING_RISK = 0.5

export function isFastMoving(r: RiskInputs): boolean {
  return riskScore(r) >= FAST_MOVING_RISK
}

/**
 * Alert priority. Low stock on a unique or fast-moving piece sends within the
 * hour — by tomorrow it would be an apology, not an alert. Everything else
 * waits for the daily digest.
 */
export function alertPriority(
  kind: 'low_in_size' | 'sold_out_in_size' | 'back_in_size' | 'unique_sold' | 'restyled',
  opts: { stockClass: StockClass; fastMoving?: boolean },
): 'urgent' | 'batch' {
  if (kind === 'unique_sold') return 'urgent'
  if (kind === 'low_in_size' && (opts.stockClass === 'unique' || opts.fastMoving)) return 'urgent'
  return 'batch'
}

/** When the next poll is due, given the tier and when we last looked. */
export function nextCheckAt(tier: PollTier, from: number): Date {
  return new Date(from + POLL_INTERVAL_MS[tier])
}

// ── Confirmation rules ───────────────────────────────────────────────────────
//
// The sentinel normally requires two consecutive out-of-stock readings before
// acting, because a scrape is a guess. An EXPLICIT sold signal is not a guess:
// a webhook, a feed row marked sold, or a page that says so in structured data.
// For a unique item, waiting 12 more hours on an explicit signal means leaving a
// look live that nobody can buy.

export type StockSignalKind = 'explicit_sold' | 'inferred_oos' | 'ambiguous'

export type SignalSource = 'webhook' | 'feed' | 'shopify' | 'jsonld' | 'regex' | 'error'

export function classifySignal(source: SignalSource): StockSignalKind {
  // A merchant's own words (webhook, feed), a Shopify variant flag, or a
  // structured JSON-LD offer are all EXPLICIT statements of availability.
  if (source === 'webhook' || source === 'feed' || source === 'shopify' || source === 'jsonld') {
    return 'explicit_sold'
  }
  // A fetch that failed tells us nothing about the garment.
  if (source === 'error') return 'ambiguous'
  // "Sold out" matched in page text: usually right, occasionally a related
  // -products carousel. One more reading before retiring a look over it.
  return 'inferred_oos'
}

/** Act now, or bank a strike and confirm next run? */
export function actImmediately(stockClass: StockClass, signal: StockSignalKind): boolean {
  return stockClass === 'unique' && signal === 'explicit_sold'
}

// ── Merchandising ────────────────────────────────────────────────────────────

/** A unique piece live this long with no click-outs is a pricing/styling signal. */
export const STALE_UNIQUE_DAYS = 14

export function isStaleUnique(item: { stockClass: StockClass; daysLive: number; clickOutsTotal: number }): boolean {
  return item.stockClass === 'unique' && item.daysLive > STALE_UNIQUE_DAYS && item.clickOutsTotal === 0
}

/** Social proof, only where it's honest — a handful of saves is not a crowd. */
export const MIN_SAVES_FOR_PROOF = 3

export function savedByLabel(saves: number): string | null {
  return saves >= MIN_SAVES_FOR_PROOF ? `SAVED BY ${saves} PEOPLE` : null
}

export const ONE_OF_ONE_BADGE = 'ONE OF ONE'
export const SOLD_BADGE = 'ONE OF ONE · NOW SOLD'
export const LOW_IN_SIZE_BADGE = 'LOW STOCK IN YOUR SIZE'
export const NOT_IN_SIZE_LABEL = 'NOT CURRENTLY IN YOUR SIZE'
