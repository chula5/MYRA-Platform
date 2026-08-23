// ── Feed-first availability for second-hand stock ────────────────────────────
//
// Scraping a product page is a guess. A feed row is a statement. For one-of-one
// stock that difference is the whole ballgame: a scrape that misses a sell-out
// leaves a look live that nobody can buy, and by the time the second
// confirmation lands, twelve hours have passed.
//
// So: WEBHOOK > FEED > POLL.
//
//   webhook   instant sold-signal, acted on immediately (no second confirmation)
//   feed      pulled every 30 min, same authority as a webhook
//   poll      the risk-tiered fallback in stock-sentinel.ts, for merchants who
//             give us neither
//
// Ask a second-hand partner for SIZE-LEVEL availability in the feed. Item-level
// availability tells you a piece is gone; size-level tells you the moment HER
// size went, which is the event a shopper actually cares about.

import 'server-only'
import { createAdminClient } from '@/lib/supabase-server'
import { upsertSizeAvailability, loadBrandOffsets, type SizeEntry } from '@/lib/size-availability'
import { markUniqueSold } from '@/lib/rescue'
import { raiseSizeAlerts } from '@/lib/stock-alerts'
import { writeAudit } from './audit'
import type { StockClass } from '@/lib/second-hand'

export type FeedFormat = 'shopify_json' | 'google_rss' | 'custom_json'

export interface FeedProduct {
  externalId: string | null
  url: string | null
  title: string | null
  /** Item-level availability. False = gone. */
  available: boolean
  /** Size-level availability, where the feed carries it. */
  sizes: SizeEntry[]
}

export interface FeedMerchant {
  merchant_id: string
  name: string
  feed_url: string | null
  feed_format: FeedFormat | null
  source_type: string
  default_stock_class: string
}

// ── Parsing ──────────────────────────────────────────────────────────────────

/** Shopify's public `/products.json`, which carries per-variant availability. */
function parseShopifyJson(data: any, baseUrl: string): FeedProduct[] {
  const products: any[] = Array.isArray(data?.products) ? data.products : []
  const origin = (() => { try { return new URL(baseUrl).origin } catch { return '' } })()
  return products.map((p) => {
    const variants: any[] = Array.isArray(p.variants) ? p.variants : []
    const sizes: SizeEntry[] = variants
      .map((v) => {
        const label = [v.option1, v.option2, v.option3]
          .map((o) => String(o ?? '').trim())
          .find((o) => o && o.toLowerCase() !== 'default title')
        if (!label) return null
        // Shopify's products.json omits `available` on some themes; treat a
        // present-but-zero inventory as sold out and a missing flag as in stock.
        const available = v.available !== false
        return { label, inStock: available, level: available ? 'in_stock' : 'sold_out' } as SizeEntry
      })
      .filter((s): s is SizeEntry => s != null)
    return {
      externalId: p.id != null ? String(p.id) : null,
      url: p.handle ? `${origin}/products/${p.handle}` : null,
      title: p.title ?? null,
      available: sizes.length ? sizes.some((s) => s.inStock) : true,
      sizes,
    }
  })
}

/** Google Merchant / RSS 2.0 product feed — the common denominator format. */
function parseGoogleRss(xml: string): FeedProduct[] {
  const items = Array.from(xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)).map((m) => m[1])
  const tag = (block: string, name: string): string | null => {
    const m = block.match(new RegExp(`<(?:g:)?${name}[^>]*>([\\s\\S]*?)</(?:g:)?${name}>`, 'i'))
    if (!m) return null
    return m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim()
  }
  // One row per size is the norm in Google feeds: item_group_id ties the
  // variants of one garment together, so group by it and read `size`.
  const byGroup = new Map<string, FeedProduct>()
  for (const block of items) {
    const group = tag(block, 'item_group_id') ?? tag(block, 'id') ?? ''
    const availability = (tag(block, 'availability') ?? '').toLowerCase()
    const inStock = /in[\s_]?stock|available|preorder|backorder/.test(availability)
    const size = tag(block, 'size')
    const existing = byGroup.get(group)
    const product: FeedProduct = existing ?? {
      externalId: group || null,
      url: tag(block, 'link'),
      title: tag(block, 'title'),
      available: false,
      sizes: [],
    }
    if (size) product.sizes.push({ label: size, inStock, level: inStock ? 'in_stock' : 'sold_out' })
    product.available = product.available || inStock
    byGroup.set(group, product)
  }
  return Array.from(byGroup.values())
}

/** A partner's own JSON: `[{ id, url, title, available, sizes:[{label,available}] }]`. */
function parseCustomJson(data: any): FeedProduct[] {
  const rows: any[] = Array.isArray(data) ? data : Array.isArray(data?.products) ? data.products : []
  return rows.map((r) => {
    const sizes: SizeEntry[] = (Array.isArray(r.sizes) ? r.sizes : []).map((s: any) => {
      const inStock = s.available !== false && s.in_stock !== false
      return {
        label: String(s.label ?? s.size ?? '').trim(),
        inStock,
        level: (s.level ?? (inStock ? (s.low ? 'low' : 'in_stock') : 'sold_out')) as SizeEntry['level'],
      }
    }).filter((s: SizeEntry) => s.label.length > 0)
    return {
      externalId: r.id != null ? String(r.id) : null,
      url: r.url ?? r.link ?? null,
      title: r.title ?? r.name ?? null,
      available: r.available !== false && (sizes.length === 0 || sizes.some((s) => s.inStock)),
      sizes,
    }
  })
}

export function parseFeed(format: FeedFormat, body: string, feedUrl: string): FeedProduct[] {
  if (format === 'google_rss') return parseGoogleRss(body)
  const data = JSON.parse(body)
  return format === 'shopify_json' ? parseShopifyJson(data, feedUrl) : parseCustomJson(data)
}

// ── Ingestion ────────────────────────────────────────────────────────────────

export interface FeedRunReport {
  merchant: string
  fetched: number
  matched: number
  sold: number
  sizeChanges: number
  error?: string
}

/** Every merchant with a feed configured. */
export async function feedMerchants(): Promise<FeedMerchant[]> {
  const admin = createAdminClient()
  const { data } = await admin
    .from('merchant' as any)
    .select('merchant_id, name, feed_url, feed_format, source_type, default_stock_class')
    .eq('status', 'active')
    .not('feed_url', 'is', null)
    .neq('feed_url', '')
  return (data ?? []) as unknown as FeedMerchant[]
}

/**
 * Pull one merchant's feed and reconcile it against our items.
 *
 * A feed statement is EXPLICIT, so a unique item the feed says is gone is acted
 * on at once — no second confirmation, no strikes. That's the difference the
 * feed buys us.
 *
 * A product simply MISSING from the feed is treated as gone only for unique
 * stock: second-hand listings are removed when they sell, whereas a retail feed
 * routinely drops and re-adds rows for reasons that have nothing to do with
 * stock, and retiring looks on that would be wrong.
 */
export async function runFeed(merchant: FeedMerchant): Promise<FeedRunReport> {
  const admin = createAdminClient()
  const report: FeedRunReport = { merchant: merchant.name, fetched: 0, matched: 0, sold: 0, sizeChanges: 0 }
  if (!merchant.feed_url) return report

  let products: FeedProduct[]
  try {
    const res = await fetch(merchant.feed_url, {
      headers: { 'User-Agent': 'MYRA/1.0 (+https://myraassistant.co.uk)', Accept: 'application/json, application/xml;q=0.9, */*;q=0.8' },
      redirect: 'follow',
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    products = parseFeed(merchant.feed_format ?? 'custom_json', await res.text(), merchant.feed_url)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'feed fetch failed'
    report.error = msg
    await (admin.from('merchant') as any)
      .update({ feed_error: msg, feed_checked_at: new Date().toISOString() })
      .eq('merchant_id', merchant.merchant_id)
    return report
  }
  report.fetched = products.length

  const { data: itemRows } = await admin
    .from('item' as any)
    .select('item_id, item_type, retailer_url, external_id, stock_class, status, brand_id')
    .eq('merchant_id', merchant.merchant_id)
    .not('status', 'in', '("archived","sold")')
  const items = (itemRows ?? []) as any[]
  const offsets = await loadBrandOffsets(items.map((i) => i.brand_id).filter(Boolean))

  const byExternal = new Map<string, FeedProduct>()
  const byUrl = new Map<string, FeedProduct>()
  for (const p of products) {
    if (p.externalId) byExternal.set(p.externalId, p)
    if (p.url) byUrl.set(normaliseUrl(p.url), p)
  }

  for (const item of items) {
    const match =
      (item.external_id && byExternal.get(String(item.external_id))) ||
      (item.retailer_url && byUrl.get(normaliseUrl(item.retailer_url))) ||
      null

    const stockClass: StockClass = item.stock_class === 'unique' ? 'unique' : 'replenishable'

    if (!match) {
      // Gone from the feed. Only conclusive for one-of-one stock.
      if (stockClass === 'unique') {
        await markUniqueSold(item.item_id, 'feed')
        report.sold++
      }
      continue
    }
    report.matched++

    // Remember the merchant's id so the next run matches on it, not the handle.
    if (match.externalId && item.external_id !== match.externalId) {
      await (admin.from('item') as any)
        .update({ external_id: match.externalId })
        .eq('item_id', item.item_id)
    }

    if (match.sizes.length) {
      const { previous, changed } = await upsertSizeAvailability(item.item_id, match.sizes, {
        itemType: item.item_type,
        brandOffsets: offsets.get(item.brand_id) ?? null,
      })
      const raised = await raiseSizeAlerts({
        itemId: item.item_id, before: previous, after: changed, stockClass,
      })
      report.sizeChanges += raised
    }

    if (!match.available) {
      if (stockClass === 'unique') {
        await markUniqueSold(item.item_id, 'feed')
        report.sold++
      } else {
        // Explicit, so no strike accounting — but replenishable stock returns,
        // so it goes out_of_stock (the sentinel's restock watch), not sold.
        await (admin.from('item') as any)
          .update({
            status: 'out_of_stock',
            status_before_oos: item.status,
            oos_since: new Date().toISOString(),
            stock_status: 'out_of_stock',
            stock_checked_at: new Date().toISOString(),
            stock_signal: 'feed:unavailable',
            oos_strikes: 2,
          })
          .eq('item_id', item.item_id)
          .neq('status', 'out_of_stock')
        await writeAudit({
          action: 'oos_detected', entity: 'item', entityId: item.item_id,
          trigger: 'feed', before: { status: item.status }, after: { status: 'out_of_stock', source: 'feed' },
        })
      }
    }
  }

  await (admin.from('merchant') as any)
    .update({ feed_checked_at: new Date().toISOString(), feed_error: null })
    .eq('merchant_id', merchant.merchant_id)
  return report
}

export async function runAllFeeds(): Promise<FeedRunReport[]> {
  const merchants = await feedMerchants()
  const out: FeedRunReport[] = []
  for (const m of merchants) out.push(await runFeed(m))
  return out
}

function normaliseUrl(url: string): string {
  try {
    const u = new URL(url)
    return `${u.host}${u.pathname.replace(/\/$/, '')}`.toLowerCase()
  } catch {
    return String(url).split('?')[0].replace(/\/$/, '').toLowerCase()
  }
}

// ── Webhook ──────────────────────────────────────────────────────────────────

export interface WebhookPayload {
  /** The merchant's product id, or our item_id, or the product URL. */
  external_id?: string
  item_id?: string
  url?: string
  sold?: boolean
  available?: boolean
  sizes?: { label: string; available?: boolean; level?: SizeEntry['level'] }[]
}

/**
 * Act on a merchant's push. A webhook is the fastest sold-signal there is, and
 * for a one-of-one it is acted on immediately — this is the case the whole
 * feed-first design exists for.
 */
export async function handleSecondHandWebhook(
  merchantId: string,
  payload: WebhookPayload,
): Promise<{ handled: boolean; itemId?: string; action?: string; error?: string }> {
  const admin = createAdminClient()
  try {
    let query = admin
      .from('item' as any)
      .select('item_id, item_type, stock_class, status, brand_id, retailer_url, external_id')
      .eq('merchant_id', merchantId)
      .limit(1)

    if (payload.item_id) query = query.eq('item_id', payload.item_id)
    else if (payload.external_id) query = query.eq('external_id', String(payload.external_id))
    else if (payload.url) query = query.eq('retailer_url', payload.url)
    else return { handled: false, error: 'Payload identified no product' }

    const { data } = await query.maybeSingle()
    const item = data as any
    if (!item) return { handled: false, error: 'No matching item' }

    const stockClass: StockClass = item.stock_class === 'unique' ? 'unique' : 'replenishable'

    if (payload.sizes?.length) {
      const offsets = await loadBrandOffsets([item.brand_id].filter(Boolean))
      const entries: SizeEntry[] = payload.sizes.map((s) => ({
        label: String(s.label),
        inStock: s.available !== false,
        level: s.level ?? (s.available !== false ? 'in_stock' : 'sold_out'),
      }))
      const { previous, changed } = await upsertSizeAvailability(item.item_id, entries, {
        itemType: item.item_type,
        brandOffsets: offsets.get(item.brand_id) ?? null,
      })
      await raiseSizeAlerts({ itemId: item.item_id, before: previous, after: changed, stockClass })
    }

    const gone = payload.sold === true || payload.available === false
    if (gone && stockClass === 'unique') {
      await markUniqueSold(item.item_id, 'webhook')
      return { handled: true, itemId: item.item_id, action: 'sold' }
    }
    if (gone) {
      await (admin.from('item') as any)
        .update({
          status: 'out_of_stock',
          status_before_oos: item.status,
          oos_since: new Date().toISOString(),
          stock_status: 'out_of_stock',
          stock_checked_at: new Date().toISOString(),
          stock_signal: 'webhook:unavailable',
          oos_strikes: 2,
        })
        .eq('item_id', item.item_id)
        .neq('status', 'out_of_stock')
      return { handled: true, itemId: item.item_id, action: 'out_of_stock' }
    }

    return { handled: true, itemId: item.item_id, action: 'sizes_updated' }
  } catch (err) {
    return { handled: false, error: err instanceof Error ? err.message : 'webhook failed' }
  }
}
