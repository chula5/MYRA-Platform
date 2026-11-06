// THE SALE SWEEP — today's price and the shop's own was-price, for every
// piece MYRA carries from a watched Shopify brand.
//
// One read of the brand's /products.json gives every product's price and
// compare_at_price at once, so a whole brand costs a few requests, not one per
// piece. What changed is written (item.price_gbp / was_price_gbp, a history
// row each), members waiting on a piece that dropped are told
// (lib/price-watch), and the brand's sale row is kept (lib/sales/detect).
//
// Shops that are not Shopify are read piece by piece by the stock sentinel,
// which records prices too; their was-price is only known where the page says.

import 'server-only'
import { detectStoreCurrency } from '@/lib/brand-watch'
import { toGbpAmount } from '@/lib/currency'
import { raisePriceDrops } from '@/lib/price-watch'
import { isBrandOnSale, saleStats } from './detect'

const SHOWABLE = ['ready', 'live', 'draft']
const UA = 'Mozilla/5.0 (Macintosh) MYRA-BrandWatch/1.0'
const MAX_PAGES = 20

export interface SweepBrand { brand_id: string; name: string; base_url: string }

export interface SweepResult {
  brand: string
  read: number
  matched: number
  changed: number
  onSale: number
  active: boolean
  started?: boolean
  ended?: boolean
  told: number
  error?: string
}

interface ShopPrice { price: number; was: number | null }

/** Every product's lowest buyable price, and that variant's was-price. */
async function fetchPrices(baseUrl: string): Promise<Map<string, ShopPrice>> {
  const out = new Map<string, ShopPrice>()
  for (let page = 1; page <= MAX_PAGES; page++) {
    const res = await fetch(`${baseUrl}/products.json?limit=250&page=${page}`, {
      headers: { 'User-Agent': UA, Accept: 'application/json' }, cache: 'no-store', signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) { if (page === 1) throw new Error(`HTTP ${res.status}`); break }
    const batch: any[] = (await res.json())?.products ?? []
    for (const p of batch) {
      const variants: any[] = p.variants ?? []
      const live = variants.filter((v) => v?.available !== false)
      let best: ShopPrice | null = null
      for (const v of (live.length ? live : variants)) {
        const price = parseFloat(v?.price)
        if (!(price > 0)) continue
        const was = parseFloat(v?.compare_at_price)
        if (!best || price < best.price) best = { price, was: was > price ? was : null }
      }
      if (best && p?.id != null) out.set(String(p.id), best)
    }
    if (batch.length < 250) break
  }
  return out
}

const round = (x: number | null) => (x == null ? null : Math.round(x * 100) / 100)

export async function sweepBrand(admin: any, b: SweepBrand): Promise<SweepResult> {
  const result: SweepResult = { brand: b.name, read: 0, matched: 0, changed: 0, onSale: 0, active: false, told: 0 }
  let prices: Map<string, ShopPrice>
  let currency: string | null
  try {
    ;[prices, currency] = await Promise.all([fetchPrices(b.base_url), detectStoreCurrency(b.base_url)])
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err)
    await admin.from('brand_sale').upsert({ brand_id: b.brand_id, last_swept_at: new Date().toISOString(), updated_at: new Date().toISOString() }, { onConflict: 'brand_id' })
    return result
  }
  result.read = prices.size
  // A store that will not say its currency is never turned into pounds: unpriced rather than wrong.
  if (!currency) { result.error = 'store currency unknown'; return result }

  const { data: rows } = await admin.from('item')
    .select('item_id, product_name, shopify_product_id, price_gbp, was_price_gbp, stock_status, ownership, brand:brand_id(name)')
    .eq('brand_id', b.brand_id).in('status', SHOWABLE).not('shopify_product_id', 'is', null).limit(5000)

  const now = new Date().toISOString()
  const history: any[] = []
  const stats: { now: number | null; was: number | null }[] = []
  const dropped: { item: any; now: number }[] = []
  for (const it of (rows ?? []) as any[]) {
    if (it.ownership === 'owned') continue
    const shop = prices.get(String(it.shopify_product_id))
    if (!shop) continue
    result.matched++
    const gbp = round(toGbpAmount(shop.price, currency))
    const wasGbp = round(shop.was != null ? toGbpAmount(shop.was, currency) : null)
    if (gbp == null) continue
    if (it.stock_status !== 'out_of_stock') stats.push({ now: gbp, was: wasGbp })
    const before = it.price_gbp != null ? Number(it.price_gbp) : null
    const beforeWas = it.was_price_gbp != null ? Number(it.was_price_gbp) : null
    if (before != null && Math.abs(before - gbp) < 0.01 && beforeWas === wasGbp) continue
    result.changed++
    history.push({ item_id: it.item_id, price_gbp: gbp, was_price_gbp: wasGbp, source: 'sale-sweep', seen_at: now })
    await admin.from('item').update({ price_gbp: gbp, was_price_gbp: wasGbp, price: String(shop.price), currency }).eq('item_id', it.item_id)
    if (before == null || gbp < before) dropped.push({ item: it, now: gbp })
  }
  for (let i = 0; i < history.length; i += 500) await admin.from('item_price_history').insert(history.slice(i, i + 500))

  // Pieces someone is waiting on: told the moment they drop.
  if (dropped.length) {
    const { data: watched } = await admin.from('member_saved_item').select('item_id')
      .in('item_id', dropped.map((d) => d.item.item_id)).eq('price_watch', true)
    const ids = new Set(((watched ?? []) as any[]).map((w) => w.item_id))
    for (const d of dropped) if (ids.has(d.item.item_id)) result.told += await raisePriceDrops(admin, d.item, d.now)
  }

  // The brand's sale: on, off, or carrying on.
  const s = saleStats(stats)
  result.onSale = s.onSale
  result.active = isBrandOnSale(s)
  const { data: prev } = await admin.from('brand_sale').select('active, started_at').eq('brand_id', b.brand_id).maybeSingle()
  const was = !!prev?.active
  result.started = result.active && !was
  result.ended = !result.active && was
  await admin.from('brand_sale').upsert({
    brand_id: b.brand_id,
    active: result.active,
    started_at: result.started ? now : prev?.started_at ?? null,
    ...(result.ended ? { ended_at: now } : result.started ? { ended_at: null } : {}),
    last_swept_at: now,
    on_sale_count: s.onSale,
    total_count: s.total,
    max_off_pct: s.maxOff,
    median_off_pct: s.medianOff,
    updated_at: now,
  }, { onConflict: 'brand_id' })
  return result
}

/** The watched Shopify brands, the longest unswept first. */
export async function brandsToSweep(admin: any, onlyBrandId?: string | null): Promise<SweepBrand[]> {
  let q = admin.from('watched_brand').select('brand_id, name, base_url').eq('active', true).eq('platform', 'shopify').not('brand_id', 'is', null)
  if (onlyBrandId) q = q.eq('brand_id', onlyBrandId)
  const { data: watched } = await q
  const list = ((watched ?? []) as any[]).filter((w) => w.base_url)
  const { data: swept } = await admin.from('brand_sale').select('brand_id, last_swept_at').in('brand_id', list.map((w) => w.brand_id))
  const at = new Map(((swept ?? []) as any[]).map((r) => [r.brand_id, r.last_swept_at ? Date.parse(r.last_swept_at) : 0]))
  const seen = new Set<string>()
  return list
    .filter((w) => (seen.has(w.brand_id) ? false : (seen.add(w.brand_id), true)))
    .sort((a, b) => (at.get(a.brand_id) ?? 0) - (at.get(b.brand_id) ?? 0))
    .map((w) => ({ brand_id: w.brand_id, name: w.name, base_url: String(w.base_url).replace(/\/$/, '') }))
}
