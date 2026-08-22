// Brand Watch browser route — for stores that aren't on Shopify (Sessun,
// most French houses on custom platforms). Instead of /products.json:
//   1. discover product URLs from the site's sitemap (robots.txt → sitemap.xml,
//      recursing into sub-sitemaps, preferring EN/GB locales)
//   2. fetch each product page and read its JSON-LD Product structured data
//      (name, price, currency, images, availability — published for SEO by
//      nearly every fashion site), falling back to og: meta tags
// Runs fully server-side in resumable chunks: pages already evaluated are in
// brand_watch_seen, so a re-run continues where the last one stopped, and
// progress is written to watched_brand.scan_state as the scan walks — closing
// the admin page never cancels anything.

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
const HEADERS = {
  'User-Agent': UA,
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-GB,en;q=0.9',
}

export const BROWSER_SCAN_PAGE_BUDGET = 350 // pages per run; re-run continues

/**
 * One key per PRODUCT, not per URL. Big brands publish the same piece under
 * every country and language — By Malene Birger lists one coat at /at/en/,
 * /be/en/, /be/fr/, /bg/en/ and thirty more — and deduping on the raw URL let
 * every locale through as a separate item: 331 queue rows that were a few dozen
 * real products.
 *
 * Strips the leading locale segments, then prefers the trailing product code
 * (…/dalimas-wool-coat/10150912L.html), which survives translation — the French
 * URL has a different slug but the same code.
 */
export function canonicalProductKey(url: string): string {
  let path: string
  try { path = new URL(url).pathname } catch { return url }
  const segs = path.split('/').filter(Boolean)
  // /at/en/… , /en-gb/… , /uk/…
  while (segs.length && /^([a-z]{2}([-_][a-z]{2})?)$/i.test(segs[0])) segs.shift()
  const last = segs[segs.length - 1] ?? ''
  const code = last.replace(/\.(html?|php|aspx)$/i, '')
  // A product code is mostly digits and short — a slug is words and hyphens.
  if (/^[0-9][0-9a-z_-]{3,}$/i.test(code) && (code.match(/\d/g) ?? []).length >= 4) return code.toLowerCase()
  return segs.join('/').toLowerCase()
}

// Stable id for a product (fills the shopify_product_id slot for dedupe and the
// seen table). Hashes the CANONICAL key, so the same piece in any locale gets
// the same id. Two fnv1a passes → 16 hex chars.
export function urlHash(rawUrl: string): string {
  const url = canonicalProductKey(rawUrl)
  const fnv = (seed: number) => {
    let h = seed >>> 0
    for (let i = 0; i < url.length; i++) {
      h ^= url.charCodeAt(i)
      h = Math.imul(h, 0x01000193) >>> 0
    }
    return h.toString(16).padStart(8, '0')
  }
  return 'u' + fnv(0x811c9dc5) + fnv(0x9747b28c)
}

async function fetchText(url: string, timeoutMs = 20000): Promise<string | null> {
  try {
    const res = await fetch(url, { headers: HEADERS, cache: 'no-store', signal: AbortSignal.timeout(timeoutMs) })
    if (!res.ok) return null
    return await res.text()
  } catch { return null }
}

function locs(xml: string): string[] {
  return Array.from(xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)).map((m) => m[1])
}

const PRODUCT_PATH = /\/(product|products|produit|produits|catalogue|item|shop-item|p)\//i
const NON_PRODUCT_PATH = /\/(collection|collections|category|categories|blog|journal|stories|store|stores|locations|page|pages|about|legal|care|faq|search|account|cart|lookbook|edito)\b/i
const LOCALE_SITEMAP = /(-|_|\/)(en|gb|uk|en-gb|en-en)[-._]/i

// Walk robots.txt + sitemap(.xml|index) and return product-page URLs.
export async function discoverProductUrls(baseUrl: string): Promise<string[]> {
  const origin = new URL(baseUrl).origin
  const sitemapUrls = new Set<string>()
  const robots = await fetchText(origin + '/robots.txt', 10000)
  for (const m of Array.from((robots ?? '').matchAll(/sitemap\s*:\s*(\S+)/gi))) sitemapUrls.add(m[1])
  if (!sitemapUrls.size) sitemapUrls.add(origin + '/sitemap.xml')
  sitemapUrls.add(origin + '/sitemap_index.xml')

  const pageUrls = new Set<string>()
  const queue = Array.from(sitemapUrls)
  const visited = new Set<string>()
  // The URL bound must survive locale multiplication: By Malene Birger's
  // sitemaps carry ~36k URLs that collapse to ~900 real products, and a 12k cap
  // stopped the walk after three sub-sitemaps — the newest drops live in the
  // later ones, so exactly the pieces worth queueing were the ones never seen.
  while (queue.length && visited.size < 30 && pageUrls.size < 120000) {
    const sm = queue.shift()!
    if (visited.has(sm)) continue
    visited.add(sm)
    const xml = await fetchText(sm, 25000)
    if (!xml) continue
    if (/<sitemapindex/i.test(xml)) {
      const subs = locs(xml)
      // prefer EN/GB locale sub-sitemaps and anything mentioning products
      const preferred = subs.filter((u) => LOCALE_SITEMAP.test(u) || /product/i.test(u))
      for (const u of (preferred.length ? preferred : subs).slice(0, 10)) queue.push(u)
    } else {
      for (const u of locs(xml)) pageUrls.add(u)
    }
  }

  const sameHost = Array.from(pageUrls).filter((u) => { try { return new URL(u).origin === origin } catch { return false } })
  let products = sameHost.filter((u) => PRODUCT_PATH.test(new URL(u).pathname))
  if (products.length < 10) {
    // fallback: deep, non-obviously-navigational pages
    products = sameHost.filter((u) => {
      const path = new URL(u).pathname
      return path.split('/').filter(Boolean).length >= 2 && !NON_PRODUCT_PATH.test(path)
    })
  }
  // One URL per product. Prefer an English (and ideally GB) locale so the
  // scraped title, description and price are the ones we want.
  const byProduct = new Map<string, string>()
  const localeRank = (u: string): number => {
    const p = u.toLowerCase()
    if (/\/(gb|uk)\/en|\/en-(gb|uk)\//.test(p)) return 0
    if (/\/en(\/|-)/.test(p)) return 1
    return 2
  }
  for (const u of products) {
    const key = canonicalProductKey(u)
    const cur = byProduct.get(key)
    if (!cur || localeRank(u) < localeRank(cur)) byProduct.set(key, u)
  }
  return Array.from(byProduct.values()).slice(0, 6000)
}

export interface ParsedProduct {
  url: string
  title: string
  description: string
  category: string
  brand?: string | null // what the site calls itself: JSON-LD brand, else og:site_name
  price: number | null
  currency: string | null
  images: string[]
  available: boolean
}

function firstOffer(offers: any): any {
  if (!offers) return {}
  if (Array.isArray(offers)) return offers[0] ?? {}
  if (Array.isArray(offers.offers)) return offers.offers[0] ?? {} // AggregateOffer
  return offers
}

// JSON-LD Product (handles arrays, @graph, list types), og: fallback.
/**
 * Product pages carry HTML entities in their metadata — "Adolfo Dom&iacute;nguez",
 * "Agn&egrave;s b." — and storing them raw put the entity on screen and into the
 * brand name. Decodes the named and numeric entities that appear in titles.
 */
export function decodeEntities(text: string): string {
  const NAMED: Record<string, string> = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
    aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú',
    agrave: 'à', egrave: 'è', igrave: 'ì', ograve: 'ò', ugrave: 'ù',
    acirc: 'â', ecirc: 'ê', icirc: 'î', ocirc: 'ô', ucirc: 'û',
    auml: 'ä', euml: 'ë', iuml: 'ï', ouml: 'ö', uuml: 'ü', yuml: 'ÿ',
    ntilde: 'ñ', atilde: 'ã', otilde: 'õ', ccedil: 'ç', aring: 'å',
    oslash: 'ø', aelig: 'æ', szlig: 'ß', reg: '®', copy: '©', trade: '™',
    hellip: '…', mdash: '—', ndash: '–', rsquo: '’', lsquo: '‘',
    rdquo: '”', ldquo: '“', deg: '°', middot: '·', eur: '€', pound: '£',
  }
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&([a-z][a-z0-9]*);/gi, (m, n) => NAMED[String(n).toLowerCase()] ?? m)
}

export function parseProductPage(html: string, url: string): ParsedProduct | null {
  const nodes: any[] = []
  for (const m of Array.from(html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi))) {
    try {
      const d = JSON.parse(m[1].trim())
      for (const item of Array.isArray(d) ? d : [d]) {
        nodes.push(item)
        if (Array.isArray(item?.['@graph'])) nodes.push(...item['@graph'])
      }
    } catch { /* invalid JSON-LD block — skip */ }
  }
  const product = nodes.find((n) => {
    const t = n?.['@type']
    return t === 'Product' || (Array.isArray(t) && t.includes('Product'))
  })
  const siteName = html.match(/<meta[^>]+property="og:site_name"[^>]+content="([^"]*)"/i)?.[1]?.trim() || null
  const ogMeta = (prop: string) =>
    html.match(new RegExp(`<meta[^>]+property="og:${prop}"[^>]+content="([^"]*)"`, 'i'))?.[1] ?? ''
  if (product) {
    const offer = firstOffer(product.offers)
    const price = parseFloat(String(offer.price ?? offer.lowPrice ?? ''))
    // Resolve to real URLs FIRST, then fall back. Adolfo Domínguez publishes
    // "image": [null, null] — a non-empty array that yields nothing — so a
    // plain length check passed and every card rendered blank.
    const rawImgs = Array.isArray(product.image) ? product.image : product.image ? [product.image] : []
    let imgs: string[] = rawImgs
      .map((i: any) => (typeof i === 'string' ? i : i?.url))
      .filter((u: any): u is string => typeof u === 'string' && /^https?:\/\//.test(u))
    if (!imgs.length && ogMeta('image')) imgs = [ogMeta('image')]
    const brandNode = product.brand
    const brand = (typeof brandNode === 'string' ? brandNode : brandNode?.name) || siteName
    return {
      url,
      brand: brand ? decodeEntities(String(brand)).trim() : null,
      title: decodeEntities(String(product.name ?? '')).trim(),
      description: decodeEntities(String(product.description ?? '')).slice(0, 400),
      category: String(product.category ?? ''),
      price: isNaN(price) ? null : price,
      currency: offer.priceCurrency ? String(offer.priceCurrency) : null,
      images: imgs.slice(0, 6),
      available: !/OutOfStock|SoldOut|Discontinued/i.test(String(offer.availability ?? 'InStock')),
    }
  }
  // og: fallback — enough to review, no availability signal (assume in stock)
  const og = (p: string) => html.match(new RegExp(`<meta[^>]+property="og:${p}"[^>]+content="([^"]*)"`, 'i'))?.[1] ?? ''
  const title = og('title')
  if (!title) return null
  const price = parseFloat(og('price:amount') || html.match(/<meta[^>]+property="product:price:amount"[^>]+content="([^"]*)"/i)?.[1] || '')
  return {
    url, brand: siteName ? decodeEntities(siteName) : null, title: decodeEntities(title).trim(),
    description: decodeEntities(og('description')).slice(0, 400), category: '',
    price: isNaN(price) ? null : price,
    currency: og('price:currency') || html.match(/<meta[^>]+property="product:price:currency"[^>]+content="([^"]*)"/i)?.[1] || null,
    images: [og('image')].filter(Boolean),
    available: true,
  }
}

export interface BrowserFetchResult {
  parsed: ParsedProduct[]
  failed: number
  discovered: number
  processedUrls: string[] // urls actually fetched this run (parsed or failed)
  remaining: number
}

// Fetch + parse the unseen product pages, a budgeted chunk at a time.
export async function fetchNewProductPages(
  baseUrl: string,
  seenHashes: Set<string>,
  opts: { maxPages?: number; onProgress?: (done: number, total: number) => Promise<void> } = {},
): Promise<BrowserFetchResult> {
  const all = await discoverProductUrls(baseUrl)
  if (!all.length) throw new Error(`${baseUrl}: no product URLs found in the sitemap — this site needs a manual browser scan`)
  const fresh = all.filter((u) => !seenHashes.has(urlHash(u)))
  const batch = fresh.slice(0, opts.maxPages ?? BROWSER_SCAN_PAGE_BUDGET)

  const parsed: ParsedProduct[] = []
  const processedUrls: string[] = []
  let failed = 0
  let done = 0
  const CONCURRENCY = 4
  for (let i = 0; i < batch.length; i += CONCURRENCY) {
    const chunk = batch.slice(i, i + CONCURRENCY)
    const results = await Promise.all(chunk.map(async (u) => ({ u, html: await fetchText(u) })))
    for (const { u, html } of results) {
      processedUrls.push(u)
      const p = html ? parseProductPage(html, u) : null
      if (p && p.title) parsed.push(p)
      else failed++
    }
    done += chunk.length
    if (opts.onProgress && (done % 24 === 0 || done === batch.length)) await opts.onProgress(done, batch.length)
  }
  return { parsed, failed, discovered: all.length, processedUrls, remaining: fresh.length - batch.length }
}
