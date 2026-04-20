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

    const result = await detectStock(retailerUrl)

    const { error: updateErr } = await supabase
      .from('item')
      .update({
        stock_status: result.status,
        stock_checked_at: new Date().toISOString(),
        stock_signal: result.signal,
        stock_notes: result.notes,
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
