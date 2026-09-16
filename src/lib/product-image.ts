// A product page's main image: og:image / twitter:image, else Shopify's product
// JSON. A plain server module — the admin ingest action (gated) and the email
// purchase importer (member-checked) both call it after checking who is asking.

import 'server-only'

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'

// Shopify product image straight from the store's product JSON (<url>.js). More
// reliable than og:image scraping when a brand site blocks bot fetches or renders
// client-side (e.g. Anine Bing). Returns an absolute https URL.
export async function shopifyProductImage(url: string): Promise<string | null> {
  try {
    const clean = url.split('#')[0].split('?')[0].replace(/\/$/, '')
    if (!/\/products\//.test(clean)) return null
    const res = await fetch(`${clean}.js`, { headers: { 'User-Agent': UA, Accept: 'application/json' }, redirect: 'follow' })
    if (!res.ok) return null
    const data = await res.json()
    const raw: string | null = data?.featured_image ?? (Array.isArray(data?.images) ? data.images[0] : null) ?? null
    if (!raw) return null
    return raw.startsWith('//') ? `https:${raw}` : raw
  } catch {
    return null
  }
}

export async function productPageImage(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow' })
    if (res.ok) {
      const html = await res.text()
      const og =
        html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ||
        html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i) ||
        html.match(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i)
      if (og?.[1]) return og[1]
    }
    // og:image missing or the page blocked us — try the Shopify product JSON.
    return await shopifyProductImage(url)
  } catch {
    return shopifyProductImage(url)
  }
}
