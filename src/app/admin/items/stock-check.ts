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

  // 1. JSON-LD Product.availability — the gold standard.
  const jsonLdMatches = Array.from(
    html.matchAll(
      /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
    ),
  )
  for (const match of jsonLdMatches) {
    try {
      const parsed = JSON.parse(match[1].trim())
      const nodes = Array.isArray(parsed) ? parsed : [parsed]
      for (const node of nodes) {
        const availability = findAvailability(node)
        if (availability) {
          const normalised = availability.toLowerCase()
          if (normalised.includes('outofstock') || normalised.includes('soldout') || normalised.includes('discontinued')) {
            return { status: 'out_of_stock', signal: `jsonld:${availability}`, notes: null }
          }
          if (normalised.includes('limitedavailability') || normalised.includes('lowstock') || normalised.includes('presale')) {
            return { status: 'low_stock', signal: `jsonld:${availability}`, notes: null }
          }
          if (normalised.includes('instock') || normalised.includes('onlineonly') || normalised.includes('preorder')) {
            return { status: 'in_stock', signal: `jsonld:${availability}`, notes: null }
          }
        }
      }
    } catch {
      // ignore malformed JSON-LD blocks
    }
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

function findAvailability(node: unknown): string | null {
  if (!node || typeof node !== 'object') return null
  const obj = node as Record<string, unknown>

  // Direct hit on a Product node
  if (obj['@type'] === 'Product' || (Array.isArray(obj['@type']) && (obj['@type'] as string[]).includes('Product'))) {
    const offers = obj.offers
    if (offers) {
      const offerNodes = Array.isArray(offers) ? offers : [offers]
      for (const offer of offerNodes) {
        if (offer && typeof offer === 'object') {
          const av = (offer as Record<string, unknown>).availability
          if (typeof av === 'string') return av
        }
      }
    }
  }

  // Recurse into children
  for (const value of Object.values(obj)) {
    if (value && typeof value === 'object') {
      const found = findAvailability(value)
      if (found) return found
    }
  }
  return null
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

async function extractSizes(url: string): Promise<string[]> {
  try {
    const clean = url.split('#')[0].split('?')[0].replace(/\/$/, '')
    if (!/\/products\//.test(clean)) return []
    const res = await fetch(`${clean}.js`, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
        Accept: 'application/json',
      },
      redirect: 'follow',
    })
    if (!res.ok) return []
    const data = await res.json()
    const variants: any[] = Array.isArray(data?.variants) ? data.variants : []

    // A variant's options can be colour, size, or both in any order (e.g.
    // option1="Luwak" colour, option2="M"). Only keep values that actually LOOK
    // like a size, so we never mislabel a colour ("Luwak") as a size.
    const sizes: string[] = variants
      .filter((v: any) => v && v.available)
      .map((v: any) => sizeFromVariant(v))
      .filter((s: string | null): s is string => !!s)
    return Array.from(new Set<string>(sizes)).slice(0, 16)
  } catch {
    return []
  }
}

// Stock check for a raw product URL (not yet an item) — used by Batch Ingest to
// flag out-of-stock / low-stock pieces before they're added.
export async function checkStockForUrl(
  url: string,
): Promise<{ status: StockStatus; sizes: string[] }> {
  try {
    if (!/^https?:\/\//i.test(url)) return { status: 'unknown', sizes: [] }
    const [result, sizes] = await Promise.all([detectStock(url), extractSizes(url)])
    return { status: result.status, sizes }
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

    const [result, sizes] = await Promise.all([detectStock(retailerUrl), extractSizes(retailerUrl)])

    const { error: updateErr } = await (supabase.from('item') as any)
      .update({
        stock_status: result.status,
        stock_checked_at: new Date().toISOString(),
        stock_signal: result.signal,
        stock_notes: result.notes,
        stock_sizes: sizes,
      })
      .eq('item_id', itemId)
    if (updateErr) throw updateErr

    revalidatePath('/admin/items')
    revalidatePath(`/admin/items/${itemId}/edit`)
    revalidatePath('/admin/projects')
    revalidatePath('/admin')
    return { status: result.status, signal: result.signal }
  } catch (err: unknown) {
    console.error('[checkItemStock]', err)
    return { error: err instanceof Error ? err.message : 'Stock check failed' }
  }
}
