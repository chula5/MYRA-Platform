// SELLABLE — the one question every recommendation has to answer first.
//
// A piece is recommended only when MYRA can vouch that it can be bought.
// out_of_stock cannot. unknown cannot either: it means the sentinel could not
// read the product page — a retailer that blocks the check, a page that has
// quietly gone — and a client sent to it is sent to a dead link as surely as
// to a sold-out one. Never checked (null) is fine: the piece is new and the
// sentinel has not reached it yet.
//
// The sentinel keeps the same standard over time (see unknownStrike): a piece
// that stays unverifiable for a week retires exactly as one that is out of
// stock, and the 30-day archive follows.

export type StockStatus = 'in_stock' | 'low_stock' | 'out_of_stock' | 'unknown'

export function sellable(item: { stock_status?: string | null }): boolean {
  const s = item.stock_status
  return s !== 'out_of_stock' && s !== 'unknown'
}

/** Unreadable readings, at least a day apart, before a piece is treated as unsellable — then dead. */
export const UNKNOWN_UNSELLABLE_STRIKES = 2
export const UNKNOWN_STRIKES_REQUIRED = 7
/** Two readings closer than this count once: a retailer's bad afternoon is not a day. */
export const UNKNOWN_STRIKE_GAP_HOURS = 20

/**
 * The sentinel's decision on an unreadable page. Strikes accrue one per day
 * (any successful reading resets them, in handleBackUp). A single failure
 * changes nothing — a retailer's outage must not empty the feed — two make
 * the piece unsellable, and seven retire it as an out-of-stock piece is.
 */
export function unknownStrike(
  item: { oos_strikes?: number | null; stock_checked_at?: string | null },
  now: Date = new Date(),
): { strikes: number; unsellable: boolean; dead: boolean } {
  const prior = item.oos_strikes ?? 0
  const last = item.stock_checked_at ? Date.parse(item.stock_checked_at) : NaN
  const gapOk = Number.isNaN(last) || now.getTime() - last >= UNKNOWN_STRIKE_GAP_HOURS * 3_600_000
  const strikes = gapOk ? prior + 1 : prior
  return { strikes, unsellable: strikes >= UNKNOWN_UNSELLABLE_STRIKES, dead: strikes >= UNKNOWN_STRIKES_REQUIRED }
}
