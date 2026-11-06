// IS THIS BRAND ON SALE? — the plain arithmetic behind BLACK FRIDAY.
//
// A piece is marked down when the shop itself says so: today's price at least
// 4% under its own was-price (Shopify compare_at_price). A brand is ON SALE
// when enough of its catalogue is: three pieces at the least, and either a
// twentieth of what MYRA carries from it or fifteen pieces outright — a single
// "last chance" rail is not a sale worth a note on her phone.
//
// Pure: the sweep, the picks and the tests all call it.

export const MARKDOWN_MIN = 0.04
export const SALE_MIN_PIECES = 3
export const SALE_MIN_SHARE = 0.05
export const SALE_MANY_PIECES = 15

/** The season the house calls Black Friday: some brands start two weeks early. */
export const BLACK_FRIDAY = { from: '2026-11-09', to: '2026-12-02', day: '2026-11-27' }

/** How far a piece is marked down, 0–100, or null when it is not. */
export function percentOff(now: number | null | undefined, was: number | null | undefined): number | null {
  const n = Number(now)
  const w = Number(was)
  if (!(n > 0) || !(w > 0) || n > w * (1 - MARKDOWN_MIN)) return null
  return Math.round((1 - n / w) * 100)
}

export interface SaleStats {
  onSale: number
  total: number
  maxOff: number | null
  medianOff: number | null
}

export function saleStats(pieces: { now: number | null; was: number | null }[]): SaleStats {
  const offs = pieces.map((p) => percentOff(p.now, p.was)).filter((x): x is number => x != null).sort((a, b) => a - b)
  return {
    onSale: offs.length,
    total: pieces.length,
    maxOff: offs.length ? offs[offs.length - 1] : null,
    medianOff: offs.length ? offs[Math.floor(offs.length / 2)] : null,
  }
}

export function isBrandOnSale(s: Pick<SaleStats, 'onSale' | 'total'>): boolean {
  if (s.onSale < SALE_MIN_PIECES) return false
  return s.onSale >= SALE_MANY_PIECES || (s.total > 0 && s.onSale / s.total >= SALE_MIN_SHARE)
}

/** "UP TO 30% OFF", or "ON SALE" when the depth is not known. */
export function saleLine(maxOff: number | null | undefined): string {
  return maxOff && maxOff >= 5 ? `UP TO ${maxOff}% OFF` : 'ON SALE'
}

/** Inside the Black Friday weeks (UK date)? */
export function inBlackFriday(now = new Date()): boolean {
  const d = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(now)
  return d >= BLACK_FRIDAY.from && d <= BLACK_FRIDAY.to
}
