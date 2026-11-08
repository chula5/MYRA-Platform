// WHAT IT COSTS TODAY — the price read off a shop's own product data, for
// WAIT FOR SALE (lib/price-watch). Read in the same fetch the stock sentinel
// already makes for sizes (app/admin/items/stock-check), never a second one.
//
// Shopify's `.js` product carries the price and the struck-through
// compare_at_price in minor units; everyone else's JSON-LD carries
// offers.price (the lowest across offers is the one she would pay). A page
// that says nothing readable returns null — no price is never a drop.

export interface PriceReading {
  amount: number
  /** The shop's own "was" price, when it shows one. */
  was: number | null
  /** ISO code where the data names it; Shopify `.js` does not. */
  currency: string | null
}

const n = (v: unknown): number | null => {
  const x = typeof v === 'string' ? Number(v.replace(/[^0-9.]/g, '')) : typeof v === 'number' ? v : NaN
  return Number.isFinite(x) && x > 0 ? x : null
}

/** Shopify `/products/<handle>.js`: prices are in pence/cents. */
export function priceFromShopifyJs(data: any): PriceReading | null {
  const variants: any[] = Array.isArray(data?.variants) ? data.variants : []
  const live = variants.filter((v) => v?.available)
  const pick = (live.length ? live : variants).map((v) => ({ p: n(v?.price), was: n(v?.compare_at_price) })).filter((v) => v.p != null)
  const cheapest = pick.sort((a, b) => a.p! - b.p!)[0]
  const amount = cheapest?.p ?? n(data?.price)
  if (amount == null) return null
  const was = cheapest?.was ?? n(data?.compare_at_price)
  return { amount: amount / 100, was: was != null && was > amount ? was / 100 : null, currency: null }
}

function offersOf(node: any, out: any[]): void {
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node)) { for (const x of node) offersOf(x, out); return }
  const type = ([] as string[]).concat(node['@type'] ?? []).map(String)
  if (type.includes('Offer') || type.includes('AggregateOffer')) out.push(node)
  for (const k of ['@graph', 'offers', 'hasVariant', 'mainEntity']) if (node[k]) offersOf(node[k], out)
}

/** JSON-LD offers on the page: the lowest live offer, with its currency. */
export function priceFromJsonLd(html: string): PriceReading | null {
  const offers: any[] = []
  for (const m of Array.from(html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi))) {
    try { offersOf(JSON.parse(m[1].trim()), offers) } catch { /* a malformed block is skipped */ }
  }
  const priced = offers
    .map((o) => ({
      p: n(o.price ?? o.lowPrice ?? o.priceSpecification?.price),
      cur: (o.priceCurrency ?? o.priceSpecification?.priceCurrency ?? null) as string | null,
      live: !/OutOfStock|SoldOut|Discontinued/i.test(String(o.availability ?? '')),
    }))
    .filter((o) => o.p != null)
  if (!priced.length) return null
  const pool = priced.some((o) => o.live) ? priced.filter((o) => o.live) : priced
  const best = pool.sort((a, b) => a.p! - b.p!)[0]
  return { amount: best.p!, was: null, currency: best.cur ? String(best.cur).toUpperCase() : null }
}
