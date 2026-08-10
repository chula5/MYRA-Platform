// Currency → GBP display conversion.
//
// Items are stored in their native currency (EUR, USD, …). UK visitors want to
// see £, so we convert for display. Rates below are a snapshot of the ECB
// mid-market rate (frankfurter.dev) on 2026-07-30 — refresh periodically, or
// wire the live frankfurter.dev API if we want them to auto-update.
//
// Rounding follows the gbp-price-converter skill (round to the NEAREST clean
// figure per band, never a fake .99). Converted prices are estimates and can
// differ from a retailer's own UK checkout price — so on the big item view we
// also show the original in brackets, e.g. "£335 (€390)".

// GBP per 1 unit of the source currency.
const GBP_PER: Record<string, number> = {
  GBP: 1,
  EUR: 0.857,
  USD: 0.747,
  AUD: 0.521,
  CAD: 0.532,
  JPY: 0.00458,
  CHF: 0.92,
}

const SYMBOL: Record<string, string> = {
  GBP: '£', USD: '$', EUR: '€', AUD: 'A$', CAD: 'C$', JPY: '¥', CHF: 'CHF ',
}

function parseAmount(price: string | number | null | undefined): number | null {
  if (price == null) return null
  const n = typeof price === 'number' ? price : parseFloat(String(price).replace(/[^0-9.]/g, ''))
  return Number.isFinite(n) ? n : null
}

// Clean price rounding (nearest), matching the currency skill's bands.
function roundGbp(v: number): number {
  if (v < 100) return Math.round(v)
  if (v < 500) return Math.round(v / 5) * 5
  if (v < 2000) return Math.round(v / 10) * 10
  return Math.round(v / 50) * 50
}

// The price exactly as stored, in its native symbol — e.g. "€390", "$519".
export function formatNative(price: string | number | null | undefined, currency: string | null | undefined): string {
  const n = parseAmount(price)
  if (n == null) return ''
  const cur = (currency || 'GBP').toUpperCase()
  const sym = SYMBOL[cur]
  const clean = n.toLocaleString('en-GB')
  return sym ? `${sym}${clean}` : `${clean} ${cur}`
}

// A price shown in GBP. Non-GBP is converted + rounded; GBP (or a currency we
// can't convert) is shown as-is. Pass showOriginal to append the native price
// in brackets, e.g. "£335 (€390)".
export function formatGbp(
  price: string | number | null | undefined,
  currency: string | null | undefined,
  opts: { showOriginal?: boolean } = {},
): string {
  const n = parseAmount(price)
  if (n == null) return ''
  const cur = (currency || 'GBP').toUpperCase()

  // Already GBP, or an unknown currency we can't safely convert — show as £.
  if (cur === 'GBP' || !(cur in GBP_PER)) {
    return `£${n.toLocaleString('en-GB')}`
  }

  const gbp = roundGbp(n * GBP_PER[cur])
  const out = `£${gbp.toLocaleString('en-GB')}`
  return opts.showOriginal ? `${out} (${formatNative(n, cur)})` : out
}

// The unrounded GBP value, for LEDGER use — commission maths must not inherit
// the display rounding above, which would drift by pounds across a month.
// An unknown currency returns the amount untouched rather than guessing.
export function toGbp(price: string | number | null | undefined, currency: string | null | undefined): number {
  const n = parseAmount(price)
  if (n == null) return 0
  const cur = (currency || 'GBP').toUpperCase()
  if (cur === 'GBP' || !(cur in GBP_PER)) return n
  return n * GBP_PER[cur]
}
