// Part 6 auto-qualification: on application, probe the store URL and attach
// facts to the application — is it Shopify, how many products, price range,
// currencies. Obvious non-fits are auto-rejected; everything else awaits
// Chloe's judgement (MYRA is curated; the approval gate is human, always).

export interface Qualification {
  isShopify: boolean
  reachable: boolean
  productCount: number | null
  priceMin: number | null
  priceMax: number | null
  currencies: string[]
  note: string
}

// Pure: derive qualification facts from a /products.json payload.
export function qualifyFromProductsJson(json: any): Omit<Qualification, 'reachable'> {
  const products: any[] = Array.isArray(json?.products) ? json.products : []
  if (!products.length) {
    return { isShopify: false, productCount: 0, priceMin: null, priceMax: null, currencies: [], note: 'No products visible' }
  }
  let min = Infinity
  let max = -Infinity
  for (const p of products) {
    for (const v of p?.variants ?? []) {
      const n = parseFloat(String(v?.price ?? ''))
      if (Number.isFinite(n) && n > 0) { min = Math.min(min, n); max = Math.max(max, n) }
    }
  }
  return {
    isShopify: true,
    productCount: products.length,
    priceMin: Number.isFinite(min) ? min : null,
    priceMax: Number.isFinite(max) && max >= 0 ? max : null,
    currencies: [], // shop currency isn't in products.json; captured at install
    note: products.length >= 250 ? '250+ products (page cap)' : `${products.length} products`,
  }
}

// Auto-reject only the unambiguous non-fits. Borderline cases go to review.
export function autoRejectReason(q: Qualification): string | null {
  if (!q.reachable) return 'Store URL unreachable'
  if (!q.isShopify) return 'Not a Shopify store — MYRA partner onboarding is Shopify-only for now'
  if ((q.productCount ?? 0) === 0) return 'No visible products'
  return null
}

export async function probeStore(storeUrl: string): Promise<Qualification> {
  const base = storeUrl.trim().replace(/\/+$/, '')
  const url = /^https?:\/\//i.test(base) ? base : `https://${base}`
  try {
    const res = await fetch(`${url}/products.json?limit=250`, {
      headers: { 'User-Agent': 'MYRA-partner-qualification/1.0' },
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) {
      return { isShopify: false, reachable: true, productCount: null, priceMin: null, priceMax: null, currencies: [], note: `products.json → ${res.status}` }
    }
    const json = await res.json()
    return { reachable: true, ...qualifyFromProductsJson(json) }
  } catch {
    return { isShopify: false, reachable: false, productCount: null, priceMin: null, priceMax: null, currencies: [], note: 'Fetch failed' }
  }
}
