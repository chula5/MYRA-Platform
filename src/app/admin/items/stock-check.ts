// NOT a 'use server' module, on purpose: every export of a 'use server' file is
// callable by anyone from the browser, and these run without an admin session
// (cron, src/lib pipelines, /me client actions). The admin UI calls the admin-gated
// wrappers in ./stock-check.gated.ts. Don't add 'use server' here.

import { createAdminClient } from '@/lib/supabase-server'
import { revalidatePath } from 'next/cache'
import {
  myshopifyDomainIn, normaliseSizeLabel, sizeLabelFromVariant, sizesFromPage,
} from '@/lib/retailer-sizes'

type StockStatus = 'in_stock' | 'low_stock' | 'out_of_stock' | 'unknown'

interface StockResult {
  status: StockStatus
  signal: string
  notes: string | null
}

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'

async function fetchPage(url: string): Promise<{ ok: boolean; status: number; html: string; finalUrl: string }> {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9' },
    redirect: 'follow',
  })
  return { ok: res.ok, status: res.status, html: res.ok ? await res.text() : '', finalUrl: res.url || url }
}

// Fetch the product page and infer stock status.
// Detection order: JSON-LD Product.availability -> text regex -> unknown.
async function detectStock(url: string): Promise<StockResult> {
  const page = await fetchPage(url)
  if (!page.ok) {
    return { status: 'unknown', signal: `http:${page.status}`, notes: `Fetch failed: ${page.status}` }
  }
  return stockFromHtml(page.html)
}

function stockFromHtml(html: string): StockResult {
  // 1. JSON-LD Product.availability — the gold standard. A product can have MANY
  // offers (one per size/colour) with MIXED availability (e.g. Tory Burch: size M
  // in stock, S sold out). Aggregate ALL of them: in stock if ANY variant is
  // available; only out of stock when EVERY variant is unavailable.
  const jsonLdMatches = Array.from(
    html.matchAll(
      /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
    ),
  )
  const avails: string[] = []
  for (const match of jsonLdMatches) {
    try {
      const parsed = JSON.parse(match[1].trim())
      const nodes = Array.isArray(parsed) ? parsed : [parsed]
      for (const node of nodes) collectAvailabilities(node, avails)
    } catch {
      // ignore malformed JSON-LD blocks
    }
  }
  if (avails.length) {
    const norm = avails.map((a) => a.toLowerCase())
    const inCount = norm.filter((a) => /instock|onlineonly|preorder|instoreonly|limitedavailability|lowstock|presale|backorder/.test(a)).length
    const outCount = norm.filter((a) => /outofstock|soldout|discontinued/.test(a)).length
    if (inCount > 0) {
      // Only a single variant left of many → low stock.
      const status: StockResult['status'] = inCount === 1 && norm.length >= 4 ? 'low_stock' : 'in_stock'
      return { status, signal: `jsonld:${inCount}/${norm.length} available`, notes: null }
    }
    if (outCount > 0) return { status: 'out_of_stock', signal: 'jsonld:all-out', notes: null }
  }

  // 2. Text regex fallback.
  const lowered = html.toLowerCase()
  const oosPatterns = [
    /sold\s*out/i,
    /out\s*of\s*stock/i,
    /notify\s*me\s*when\s*available/i,
    /currently\s*unavailable/i,
    /no\s*longer\s*available/i,
  ]
  for (const re of oosPatterns) {
    if (re.test(lowered)) {
      return { status: 'out_of_stock', signal: `regex:${re.source}`, notes: null }
    }
  }

  const lowStockPatterns = [
    /low\s*stock/i,
    /only\s*\d+\s*left/i,
    /few\s*remaining/i,
    /almost\s*gone/i,
    /selling\s*fast/i,
  ]
  for (const re of lowStockPatterns) {
    if (re.test(lowered)) {
      return { status: 'low_stock', signal: `regex:${re.source}`, notes: null }
    }
  }

  // 3. If the page loaded but no signal was found, assume in stock.
  return { status: 'in_stock', signal: 'fallback:no-oos-signal', notes: null }
}

// Collect EVERY `availability` string anywhere in a JSON-LD node (across all
// offers / nested nodes), so mixed per-variant availability can be aggregated.
function collectAvailabilities(node: unknown, out: string[]): void {
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node)) { for (const n of node) collectAvailabilities(n, out); return }
  const obj = node as Record<string, unknown>
  const av = obj.availability
  if (typeof av === 'string') out.push(av)
  for (const value of Object.values(obj)) {
    if (value && typeof value === 'object') collectAvailabilities(value, out)
  }
}

// Size labels come from sizeLabelFromVariant (src/lib/retailer-sizes.ts): true
// sizes only — S/M/L family incl. "XS/S", one-size, numeric, UK/US/EU shoe
// sizes, and host-annotated labels like Wyse's "1R (UK 8)". Colours rejected.

// AUTHORITATIVE stock from a Shopify store's product JSON (`<url>.js`). The
// per-variant `available` flag is the source of truth — far more reliable than
// scanning page text for "sold out" (which false-positives on related-product
// carousels or template labels, e.g. Simon Miller marking an in-stock top OOS).
// Returns null when it's not a resolvable Shopify product (caller falls back to
// the HTML heuristic).
async function shopifyStock(url: string): Promise<{ status: StockStatus; sizes: string[] } | null> {
  try {
    const clean = url.split('#')[0].split('?')[0].replace(/\/$/, '')
    if (!/\/products\//.test(clean)) return null
    const res = await fetch(`${clean}.js`, {
      headers: { 'User-Agent': UA, Accept: 'application/json' },
      redirect: 'follow',
    })
    if (!res.ok) return null
    const data = await res.json()
    const variants: any[] = Array.isArray(data?.variants) ? data.variants : []
    if (variants.length === 0) return null

    const available = variants.filter((v: any) => v && v.available)
    // In-stock size labels (reject colours like "Luwak"; keep true sizes only).
    const sizes = Array.from(new Set<string>(
      available.map((v: any) => sizeLabelFromVariant(v, url)).filter((s: string | null): s is string => !!s),
    )).slice(0, 16)

    let status: StockStatus
    if (available.length === 0) status = 'out_of_stock'
    else if (variants.length >= 4 && available.length <= 2) status = 'low_stock' // only a size or two left
    else status = 'in_stock'
    return { status, sizes }
  } catch {
    return null
  }
}

// Resolve stock: Shopify variant data first (authoritative), else the HTML
// heuristic (JSON-LD → text regex). Sizes only come from the Shopify path.
async function resolveStock(url: string): Promise<{ status: StockStatus; sizes: string[] }> {
  const shop = await shopifyStock(url)
  if (shop) return shop
  const r = await detectStock(url)
  return { status: r.status, sizes: [] }
}

// Stock check for a raw product URL (not yet an item) — used by Batch Ingest to
// flag out-of-stock / low-stock pieces before they're added.
export async function checkStockForUrl(
  url: string,
): Promise<{ status: StockStatus; sizes: string[] }> {
  try {
    if (!/^https?:\/\//i.test(url)) return { status: 'unknown', sizes: [] }
    return await resolveStock(url)
  } catch {
    return { status: 'unknown', sizes: [] }
  }
}

export async function listItemsForStockSweep(): Promise<
  { itemId: string; productName: string }[]
> {
  const supabase = createAdminClient()
  try {
    const { data, error } = await supabase
      .from('item')
      .select('item_id, product_name, retailer_url')
      .not('retailer_url', 'is', null)
      .neq('retailer_url', '')
      .order('stock_checked_at', { ascending: true, nullsFirst: true })
    if (error) throw error
    return ((data ?? []) as { item_id: string; product_name: string }[]).map((r) => ({
      itemId: r.item_id,
      productName: r.product_name,
    }))
  } catch (err) {
    console.error('[listItemsForStockSweep]', err)
    return []
  }
}

export async function checkItemStock(
  itemId: string,
): Promise<{ status?: StockStatus; signal?: string; error?: string }> {
  const supabase = createAdminClient()
  try {
    const { data: item, error: fetchErr } = await supabase
      .from('item')
      .select('retailer_url')
      .eq('item_id', itemId)
      .single()
    if (fetchErr) throw fetchErr
    const retailerUrl = (item as { retailer_url: string } | null)?.retailer_url
    if (!retailerUrl) return { error: 'Item has no retailer URL' }

    // Shopify variant data is authoritative; fall back to the HTML heuristic.
    const shop = await shopifyStock(retailerUrl)
    let status: StockStatus, sizes: string[], signal: string, notes: string | null
    if (shop) {
      status = shop.status; sizes = shop.sizes; signal = `shopify:${shop.status}`; notes = null
    } else {
      const r = await detectStock(retailerUrl)
      status = r.status; sizes = []; signal = r.signal; notes = r.notes
    }

    const { error: updateErr } = await (supabase.from('item') as any)
      .update({
        stock_status: status,
        stock_checked_at: new Date().toISOString(),
        stock_signal: signal,
        stock_notes: notes,
        stock_sizes: sizes,
      })
      .eq('item_id', itemId)
    if (updateErr) throw updateErr

    revalidatePath('/admin/items')
    revalidatePath(`/admin/items/${itemId}/edit`)
    revalidatePath('/admin/projects')
    revalidatePath('/admin')
    return { status, signal }
  } catch (err: unknown) {
    console.error('[checkItemStock]', err)
    return { error: err instanceof Error ? err.message : 'Stock check failed' }
  }
}

// ── Detailed check: per-SIZE availability + how sure we are ──────────────────
//
// The coarse status answers "can anyone buy this". Size-level availability
// answers "can SHE buy this", which is the event a shopper actually reacts to —
// her size going low, or going, or coming back.
//
// `source` matters as much as the status. A Shopify variant flag or a JSON-LD
// offer is an EXPLICIT statement; a regex hit on page text is an inference; a
// timeout is neither. Unique stock acts immediately on an explicit sold signal
// and waits for a second reading on anything ambiguous.

export interface DetailedStock {
  status: StockStatus
  signal: string
  source: 'shopify' | 'jsonld' | 'regex' | 'error'
  /** One entry per size the page lists, with its own availability. */
  sizes: { label: string; inStock: boolean; level: 'in_stock' | 'low' | 'sold_out' | 'unknown' }[]
}

export async function checkStockDetailed(url: string): Promise<DetailedStock> {
  if (!/^https?:\/\//i.test(url)) {
    return { status: 'unknown', signal: 'bad-url', source: 'error', sizes: [] }
  }
  try {
    // 1. Shopify variant data — authoritative, and the only source that gives
    // us availability per size rather than a single page-level verdict.
    const shop = await shopifyVariants(url)
    if (shop) return shop

    // 2. The page itself, fetched ONCE for everything below.
    const page = await fetchPage(url)
    if (!page.ok) {
      return { status: 'unknown', signal: `http:${page.status}`, source: 'error', sizes: [] }
    }

    // 2a. Headless Shopify (Varley): the storefront 404s `.js`, but the page
    // names the myshopify domain, which serves it.
    if (/\/products\//.test(url)) {
      const domain = myshopifyDomainIn(page.html)
      if (domain) {
        const alt = await shopifyVariants(url, domain)
        if (alt) return { ...alt, signal: `${alt.signal}:via-myshopify` }
      }
    }

    // 2b. Per-size availability the page carries in its own markup or embedded
    // data (Salesforce Commerce selectors, a Next.js variant list, the Kleep
    // widget config). Explicit per size — so the verdict comes from the sizes,
    // not from a "sold out" string somewhere in a template. Reported as a page
    // reading ('regex'), not a merchant statement: a whole-product sold verdict
    // from markup still waits for a second reading on one-of-one stock.
    const structured = sizesFromPage(page.html, page.finalUrl)
    if (structured) {
      const sizes = structured.sizes
      const status = statusFromSizes(sizes)
      markSurvivorsLow(sizes)
      return { status, signal: `page:${structured.via}:${status}`, source: 'regex', sizes }
    }

    // 2c. JSON-LD offers (often carry size + availability), else text.
    const r = stockFromHtml(page.html)
    return {
      status: r.status,
      signal: r.signal,
      source: r.signal.startsWith('jsonld') ? 'jsonld' : 'regex',
      sizes: sizesFromJsonLd(page.html, url),
    }
  } catch (err) {
    return {
      status: 'unknown',
      signal: err instanceof Error ? err.message.slice(0, 120) : 'fetch failed',
      source: 'error',
      sizes: [],
    }
  }
}

function statusFromSizes(sizes: DetailedStock['sizes']): StockStatus {
  const inStock = sizes.filter((s) => s.inStock)
  if (inStock.length === 0) return 'out_of_stock'
  if (sizes.length >= 4 && inStock.length <= 2) return 'low_stock'
  return 'in_stock'
}

/** Down to one or two sizes: the survivors are low, so "only a few left in your size" is true of the size. */
function markSurvivorsLow(sizes: DetailedStock['sizes']): void {
  const inStockSizes = sizes.filter((s) => s.inStock)
  if (inStockSizes.length > 0 && inStockSizes.length <= 2 && sizes.length >= 4) {
    for (const s of inStockSizes) s.level = 'low'
  }
}

/**
 * Shopify `<url>.js`, keeping SOLD-OUT variants — a size going is the event.
 * `domain` reads the same product path from another host (a headless store's
 * myshopify domain); labels are still read against the original URL.
 */
async function shopifyVariants(url: string, domain?: string): Promise<DetailedStock | null> {
  try {
    const clean = url.split('#')[0].split('?')[0].replace(/\/$/, '')
    if (!/\/products\//.test(clean)) return null
    const target = domain ? `https://${domain}${new URL(clean).pathname}` : clean
    const res = await fetch(`${target}.js`, {
      headers: { 'User-Agent': UA, Accept: 'application/json' },
      redirect: 'follow',
    })
    if (!res.ok) return null
    const data = await res.json()
    const variants: any[] = Array.isArray(data?.variants) ? data.variants : []
    if (variants.length === 0) return null

    const seen = new Map<string, boolean>()
    for (const v of variants) {
      const label = sizeLabelFromVariant(v, url)
      if (!label) continue
      // A size can appear on more than one variant (colourways). Available in
      // any of them means available.
      seen.set(label, (seen.get(label) ?? false) || !!v.available)
    }
    const sizes = Array.from(seen.entries()).map(([label, inStock]) => ({
      label,
      inStock,
      level: (inStock ? 'in_stock' : 'sold_out') as DetailedStock['sizes'][number]['level'],
    }))

    const available = variants.filter((v) => v?.available)
    let status: StockStatus
    if (available.length === 0) status = 'out_of_stock'
    else if (variants.length >= 4 && available.length <= 2) status = 'low_stock'
    else status = 'in_stock'

    markSurvivorsLow(sizes)
    return { status, signal: `shopify:${status}`, source: 'shopify', sizes }
  } catch {
    return null
  }
}

/** JSON-LD offers sometimes name the size — pick it up where they do. */
function sizesFromJsonLd(html: string, url: string): DetailedStock['sizes'] {
  const out = new Map<string, boolean>()
  const blocks = Array.from(html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi))
  for (const match of blocks) {
    try {
      collectSizedOffers(JSON.parse(match[1].trim()), url, out)
    } catch {
      // a malformed block is not worth failing the check over
    }
  }
  return Array.from(out.entries()).map(([label, inStock]) => ({
    label,
    inStock,
    level: (inStock ? 'in_stock' : 'sold_out') as 'in_stock' | 'sold_out',
  }))
}

function collectSizedOffers(node: unknown, url: string, out: Map<string, boolean>): void {
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node)) { for (const n of node) collectSizedOffers(n, url, out); return }
  const obj = node as Record<string, any>
  const rawSize = obj.size ?? obj.sku_size ?? obj.variesBy
  const availability = typeof obj.availability === 'string' ? obj.availability.toLowerCase() : null
  if (rawSize && availability) {
    const label = normaliseSizeLabel(String(rawSize), url)
    if (label) {
      const inStock = /instock|onlineonly|preorder|instoreonly|limitedavailability|lowstock|presale|backorder/.test(availability)
      out.set(label, (out.get(label) ?? false) || inStock)
    }
  }
  for (const value of Object.values(obj)) {
    if (value && typeof value === 'object') collectSizedOffers(value, url, out)
  }
}
