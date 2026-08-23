'use server'

import { createAdminClient } from '@/lib/supabase-server'
import { revalidatePath } from 'next/cache'

type StockStatus = 'in_stock' | 'low_stock' | 'out_of_stock' | 'unknown'

interface StockResult {
  status: StockStatus
  signal: string
  notes: string | null
}

// Fetch the product page and infer stock status.
// Detection order: JSON-LD Product.availability -> text regex -> unknown.
async function detectStock(url: string): Promise<StockResult> {
  const res = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9',
    },
    redirect: 'follow',
  })
  if (!res.ok) {
    return { status: 'unknown', signal: `http:${res.status}`, notes: `Fetch failed: ${res.status}` }
  }
  const html = await res.text()

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

// Best-effort extraction of the IN-STOCK size labels from a product page.
// Most of the brands here run Shopify, whose product JSON (`<url>.js`) lists
// variants with an `available` flag and size in `option1`/`title`. Returns e.g.
// ['S','M','L'] or ['37','39']; empty when sizes can't be parsed (non-Shopify,
// no variants, or a fetch error) — the coarse stock_status still applies.
// True size labels only — S/M/L family, one-size, or numeric (incl. UK/US/EU
// shoe sizes). Rejects colours and other variant option values.
const SIZE_RE = /^(x{0,3}s|x{0,3}l|xl|m|o\/?s|one[\s-]?size|onesize|free[\s-]?size|\d{1,3}(\.\d)?|(uk|us|eu|it|fr)[\s-]?\d{1,3}|\d{1,3}[\s-]?(uk|us|eu|it|fr))$/i

function sizeFromVariant(v: any): string | null {
  for (const key of ['option1', 'option2', 'option3']) {
    const val = String(v?.[key] ?? '').trim()
    if (val && val.toLowerCase() !== 'default title' && SIZE_RE.test(val)) return val.toUpperCase()
  }
  return null
}

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
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
        Accept: 'application/json',
      },
      redirect: 'follow',
    })
    if (!res.ok) return null
    const data = await res.json()
    const variants: any[] = Array.isArray(data?.variants) ? data.variants : []
    if (variants.length === 0) return null

    const available = variants.filter((v: any) => v && v.available)
    // In-stock size labels (reject colours like "Luwak"; keep true sizes only).
    const sizes = Array.from(new Set<string>(
      available.map((v: any) => sizeFromVariant(v)).filter((s: string | null): s is string => !!s),
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

    // 2. Page HTML: JSON-LD offers (often carry size + availability), else text.
    const r = await detectStock(url)
    const sizes = r.status === 'unknown' ? [] : await sizesFromJsonLd(url)
    return {
      status: r.status,
      signal: r.signal,
      source: r.signal.startsWith('jsonld') ? 'jsonld' : r.signal.startsWith('http:') ? 'error' : 'regex',
      sizes,
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

/** Shopify `<url>.js`, keeping SOLD-OUT variants — a size going is the event. */
async function shopifyVariants(url: string): Promise<DetailedStock | null> {
  try {
    const clean = url.split('#')[0].split('?')[0].replace(/\/$/, '')
    if (!/\/products\//.test(clean)) return null
    const res = await fetch(`${clean}.js`, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
        Accept: 'application/json',
      },
      redirect: 'follow',
    })
    if (!res.ok) return null
    const data = await res.json()
    const variants: any[] = Array.isArray(data?.variants) ? data.variants : []
    if (variants.length === 0) return null

    const seen = new Map<string, boolean>()
    for (const v of variants) {
      const label = sizeFromVariant(v)
      if (!label) continue
      // A size can appear on more than one variant (colourways). Available in
      // any of them means available.
      seen.set(label, (seen.get(label) ?? false) || !!v.available)
    }
    const sizes = Array.from(seen.entries()).map(([label, inStock]) => ({
      label,
      inStock,
      level: (inStock ? 'in_stock' : 'sold_out') as 'in_stock' | 'sold_out',
    }))

    const available = variants.filter((v) => v?.available)
    let status: StockStatus
    if (available.length === 0) status = 'out_of_stock'
    else if (variants.length >= 4 && available.length <= 2) status = 'low_stock'
    else status = 'in_stock'

    // Down to one or two sizes: mark the survivors low, so "only a few left in
    // your size" is true of the size rather than of the product page.
    const inStockSizes = sizes.filter((s) => s.inStock)
    if (inStockSizes.length > 0 && inStockSizes.length <= 2 && sizes.length >= 4) {
      for (const s of inStockSizes) (s as any).level = 'low'
    }

    return { status, signal: `shopify:${status}`, source: 'shopify', sizes }
  } catch {
    return null
  }
}

/** JSON-LD offers sometimes name the size — pick it up where they do. */
async function sizesFromJsonLd(url: string): Promise<DetailedStock['sizes']> {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml',
      },
      redirect: 'follow',
    })
    if (!res.ok) return []
    const html = await res.text()
    const out = new Map<string, boolean>()
    const blocks = Array.from(html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi))
    for (const match of blocks) {
      try {
        collectSizedOffers(JSON.parse(match[1].trim()), out)
      } catch {
        // a malformed block is not worth failing the check over
      }
    }
    return Array.from(out.entries()).map(([label, inStock]) => ({
      label,
      inStock,
      level: (inStock ? 'in_stock' : 'sold_out') as 'in_stock' | 'sold_out',
    }))
  } catch {
    return []
  }
}

function collectSizedOffers(node: unknown, out: Map<string, boolean>): void {
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node)) { for (const n of node) collectSizedOffers(n, out); return }
  const obj = node as Record<string, any>
  const rawSize = obj.size ?? obj.sku_size ?? obj.variesBy
  const availability = typeof obj.availability === 'string' ? obj.availability.toLowerCase() : null
  if (rawSize && availability) {
    const label = String(rawSize).trim().toUpperCase()
    if (label && SIZE_RE.test(label)) {
      const inStock = /instock|onlineonly|preorder|instoreonly|limitedavailability|lowstock|presale|backorder/.test(availability)
      out.set(label, (out.get(label) ?? false) || inStock)
    }
  }
  for (const value of Object.values(obj)) {
    if (value && typeof value === 'object') collectSizedOffers(value, out)
  }
}
