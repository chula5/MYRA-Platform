'use server'

import { createAdminClient } from '@/lib/supabase-server'
import {
  baselineBrand, checkWatchedBrand, onboardBrand, provisionalNameFromUrl, runBrandWatch, normaliseBaseUrl,
  type BrandCheckResult, type WatchedBrandRow,
} from '@/lib/brand-watch'
import { buildLearning, type DecidedRow } from '@/lib/brand-watch-learning'
import { discoverProductUrls } from '@/lib/brand-watch-browser'
import { revalidatePath } from 'next/cache'

export interface QueueItemRow {
  item_id: string
  product_name: string
  brand_name: string | null
  item_type: string | null
  colour_family: string | null
  material_category: string | null
  price: string | null
  currency: string | null
  image_url: string
  retailer_url: string
  discovery_score: number | null
  discovered_at: string | null
  admin_notes: string | null
  learned_delta: number
  learned_reasons: string
  predicted_skip: boolean
  adjusted: number
}

export interface QueuePage {
  queue: QueueItemRow[]
  queueTotal: number
  predictedSkipTotal: number
  decidedCount: number
  brandCounts: Record<string, number>
  error?: string
}

export interface BrandWatchData extends QueuePage {
  watched: WatchedBrandRow[]
  migrationNeeded?: boolean
}

const QUEUE_PAGE = 200
const QUEUE_FIELDS = 'queue_id, product_name, item_type, colour_family, material_category, material_primary, price, currency, price_gbp, image_url, retailer_url, shopify_product_id, shopify_handle, stock_status, stock_sizes, discovery_score, discovered_at, admin_notes, status, brand_id, brand:brand_id(name)'

// The client keys cards by item_id — for queue rows that's the queue_id.
function mapQueueRow(r: any): Omit<QueueItemRow, 'learned_delta' | 'learned_reasons' | 'predicted_skip' | 'adjusted'> {
  return {
    item_id: r.queue_id,
    product_name: r.product_name,
    brand_name: r.brand?.name ?? null,
    item_type: r.item_type,
    colour_family: r.colour_family,
    material_category: r.material_category,
    price: r.price,
    currency: r.currency,
    image_url: r.image_url,
    retailer_url: r.retailer_url,
    discovery_score: r.discovery_score != null ? Number(r.discovery_score) : null,
    discovered_at: r.discovered_at,
    admin_notes: r.admin_notes,
  }
}

// All queue rows for the given statuses (paged past PostgREST's 1,000-row cap).
async function fetchBrandWatchRows(admin: any, statuses: string[]): Promise<any[]> {
  const out: any[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin
      .from('brand_watch_queue')
      .select(QUEUE_FIELDS)
      .in('status', statuses)
      .order('queue_id')
      .range(from, from + 999)
    if (error) throw new Error(error.message)
    out.push(...(data ?? []))
    if (!data || data.length < 1000) break
  }
  return out
}

// One page of the queue, ranked by style score + learned keep/skip adjustment.
// The learning re-trains on every load from all decisions made so far, so the
// ranking sharpens each time you come back to a brand.
export async function loadQueuePage(offset: number, brandName?: string | null): Promise<QueuePage> {
  const admin = createAdminClient() as any
  let drafts: any[]
  let decidedRows: any[]
  try {
    drafts = await fetchBrandWatchRows(admin, ['queued'])
    decidedRows = await fetchBrandWatchRows(admin, ['kept', 'skipped'])
  } catch (e) {
    return { queue: [], queueTotal: 0, predictedSkipTotal: 0, decidedCount: 0, brandCounts: {}, error: e instanceof Error ? e.message : String(e) }
  }

  const decided: DecidedRow[] = decidedRows.map((r) => ({
    kept: r.status === 'kept',
    brandName: r.brand?.name ?? null,
    productName: r.product_name,
    itemType: r.item_type,
    colourFamily: r.colour_family,
    materialCategory: r.material_category,
    price: r.price,
  }))
  const learn = buildLearning(decided)

  const annotated: QueueItemRow[] = drafts.map((r) => {
    const base = mapQueueRow(r)
    const v = learn({
      brandName: base.brand_name, productName: base.product_name, itemType: base.item_type,
      colourFamily: base.colour_family, materialCategory: base.material_category, price: base.price,
    })
    return { ...base, learned_delta: v.delta, learned_reasons: v.reasons, predicted_skip: v.predictedSkip, adjusted: (base.discovery_score ?? 0) + v.delta }
  })

  const brandCounts: Record<string, number> = {}
  for (const q of annotated) {
    const b = q.brand_name ?? '?'
    brandCounts[b] = (brandCounts[b] ?? 0) + 1
  }

  const scope = brandName ? annotated.filter((q) => q.brand_name === brandName) : annotated
  scope.sort((a, b) => (b.adjusted - a.adjusted) || String(b.discovered_at ?? '').localeCompare(String(a.discovered_at ?? '')))

  return {
    queue: scope.slice(offset, offset + QUEUE_PAGE),
    queueTotal: scope.length,
    predictedSkipTotal: scope.filter((q) => q.predicted_skip).length,
    decidedCount: decided.length,
    brandCounts,
  }
}

export async function loadBrandWatch(): Promise<BrandWatchData> {
  const admin = createAdminClient()
  const { data: watched, error: werr } = await (admin as any)
    .from('watched_brand')
    .select('*')
    .order('name')
  if (werr) {
    // Table missing → migration 0031 hasn't been run yet.
    const migrationNeeded = /watched_brand/.test(werr.message) || werr.code === '42P01'
    return { watched: [], queue: [], queueTotal: 0, predictedSkipTotal: 0, decidedCount: 0, brandCounts: {}, migrationNeeded, error: werr.message }
  }

  const page = await loadQueuePage(0)
  if (page.error && (/brand_watch_queue/.test(page.error) || /42P01/.test(page.error))) {
    // Queue table missing → migration 0033 hasn't been run yet.
    return { watched: (watched ?? []) as unknown as WatchedBrandRow[], ...page, migrationNeeded: true }
  }
  return { watched: (watched ?? []) as unknown as WatchedBrandRow[], ...page }
}



// Add a brand to the watchlist. mode 'watch' queues only the last 60 days of
// on-taste pieces; mode 'full' onboards the whole catalogue (every piece at
// min_score or above, any publish date). Both mark everything seen and set up
// the Monday watching.
export async function addWatchedBrand(url: string, mode: 'watch' | 'full' = 'watch'): Promise<{ result?: BrandCheckResult; error?: string }> {
  const base = normaliseBaseUrl(url)
  if (!base) return { error: 'That doesn’t look like a URL' }
  const admin = createAdminClient()

  const { data: exists } = await (admin as any)
    .from('watched_brand').select('watched_brand_id').eq('base_url', base).limit(1)
  if ((exists ?? []).length) return { error: 'Already on the watchlist' }

  // Placeholder only — the first scan adopts the site's own name (Shopify
  // vendor / JSON-LD brand). Locale subdomains are skipped so en.munthe.com
  // starts as "Munthe", never "En".
  const provisional = provisionalNameFromUrl(base)

  const { data: created, error } = await (admin as any)
    .from('watched_brand')
    .insert([{ name: provisional, base_url: base }] as any)
    .select('*')
    .single()
  if (error || !created) return { error: error?.message ?? 'Could not create watchlist row' }
  const watched = created as unknown as WatchedBrandRow

  try {
    const result = mode === 'full' ? await onboardBrand(watched) : await baselineBrand(watched)
    revalidatePath('/admin/brand-watch')
    return { result }
  } catch (shopifyError) {
    // Not Shopify (no /products.json)? Try the browser route: sitemap
    // discovery + JSON-LD product pages. Works for Sessun and most custom
    // platforms; only sites that hard-block server fetching stay out.
    try {
      const urls = await discoverProductUrls(base)
      if (urls.length >= 10) {
        // Browser-route pages carry little scoring vocabulary (style-name
        // titles, prose descriptions) — a GOOD item routinely scores 0 here,
        // so the floor is 0: only genuinely negative signals (leopard, sequin,
        // neon…) drop a piece. Tune per brand if a site scores richer.
        await (admin as any).from('watched_brand')
          .update({ platform: 'browser', min_score: 0 }).eq('watched_brand_id', watched.watched_brand_id)
        const browserWatched = { ...watched, platform: 'browser' as const, min_score: 0 }
        const result = mode === 'full' ? await onboardBrand(browserWatched) : await baselineBrand(browserWatched)
        revalidatePath('/admin/brand-watch')
        return { result: { ...result, note: `not Shopify — switched to the browser route (sitemap + JSON-LD). ${result.note ?? ''}`.trim() } }
      }
    } catch { /* fall through to the original error */ }
    // Neither route works — remove the row again.
    await (admin as any).from('watched_brand').delete().eq('watched_brand_id', watched.watched_brand_id)
    return { error: shopifyError instanceof Error ? shopifyError.message : String(shopifyError) }
  }
}

// Full-catalogue scan for a brand already on the watchlist. Queues every
// on-taste piece at the brand's current min_score — lower the min score and
// run again to pull in the next band down.
export async function fullScanBrand(watchedBrandId: string): Promise<{ result?: BrandCheckResult; error?: string }> {
  const admin = createAdminClient()
  const { data } = await (admin as any)
    .from('watched_brand').select('*').eq('watched_brand_id', watchedBrandId).single()
  if (!data) return { error: 'Watchlist row not found' }
  try {
    const result = await onboardBrand(data as unknown as WatchedBrandRow)
    revalidatePath('/admin/brand-watch')
    return { result }
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) }
  }
}

export async function setWatchedBrandActive(watchedBrandId: string, active: boolean): Promise<void> {
  const admin = createAdminClient()
  await (admin as any).from('watched_brand').update({ active } as any).eq('watched_brand_id', watchedBrandId)
  revalidatePath('/admin/brand-watch')
}

export async function setWatchedBrandMinScore(watchedBrandId: string, minScore: number): Promise<void> {
  const admin = createAdminClient()
  const clamped = Math.max(-9, Math.min(9, Math.round(minScore)))
  await (admin as any).from('watched_brand').update({ min_score: clamped } as any).eq('watched_brand_id', watchedBrandId)
  revalidatePath('/admin/brand-watch')
}

export async function removeWatchedBrand(watchedBrandId: string): Promise<void> {
  const admin = createAdminClient()
  await (admin as any).from('watched_brand').delete().eq('watched_brand_id', watchedBrandId)
  revalidatePath('/admin/brand-watch')
}

export async function checkBrandNow(watchedBrandId: string): Promise<{ result?: BrandCheckResult; error?: string }> {
  const admin = createAdminClient()
  const { data } = await (admin as any)
    .from('watched_brand').select('*').eq('watched_brand_id', watchedBrandId).single()
  if (!data) return { error: 'Watchlist row not found' }
  try {
    const result = await checkWatchedBrand(data as unknown as WatchedBrandRow)
    revalidatePath('/admin/brand-watch')
    return { result }
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) }
  }
}

export async function checkAllBrandsNow(): Promise<{ results: BrandCheckResult[] }> {
  const results = await runBrandWatch()
  revalidatePath('/admin/brand-watch')
  return { results }
}

// Keep: the queue row becomes a real library item (ready — the scored 1–5
// dimensions still need a pass). Skip: the row stays in the queue table as a
// skipped decision — it never enters the item library and never resurfaces.
async function keepQueueRows(admin: any, queueIds: string[]): Promise<number> {
  let created = 0
  for (let i = 0; i < queueIds.length; i += 100) {
    const chunk = queueIds.slice(i, i + 100)
    const { data: rows, error } = await admin
      .from('brand_watch_queue')
      .select('*')
      .in('queue_id', chunk)
      .eq('status', 'queued')
    if (error) throw new Error(error.message)
    for (const q of rows ?? []) {
      const { data: item, error: ierr } = await admin
        .from('item')
        .insert([{
          brand_id: q.brand_id,
          item_type: q.item_type ?? 'blouse',
          product_name: q.product_name,
          retailer_url: q.retailer_url,
          image_url: q.image_url,
          price: q.price,
          currency: q.currency,
          price_gbp: q.price_gbp,
          colour_family: q.colour_family,
          material_category: q.material_category,
          material_primary: q.material_primary,
          shopify_product_id: q.shopify_product_id,
          shopify_handle: q.shopify_handle,
          stock_status: q.stock_status,
          stock_sizes: q.stock_sizes,
          stock_checked_at: new Date().toISOString(),
          available: q.stock_status !== 'out_of_stock',
          status: 'ready',
          source: 'retailer_api',
          in_inventory: false,
          discovery_source: 'brand_watch',
          discovery_score: q.discovery_score,
          discovered_at: q.discovered_at,
          admin_notes: q.admin_notes,
        }])
        .select('item_id')
        .single()
      if (ierr) throw new Error(`item insert failed: ${ierr.message}`)
      await admin
        .from('brand_watch_queue')
        .update({ status: 'kept', decided_at: new Date().toISOString(), item_id: item.item_id })
        .eq('queue_id', q.queue_id)
      created++
    }
  }
  return created
}

export async function keepItems(itemIds: string[]): Promise<{ updated: number }> {
  if (!itemIds.length) return { updated: 0 }
  const admin = createAdminClient() as any
  const updated = await keepQueueRows(admin, itemIds)
  revalidatePath('/admin/brand-watch')
  return { updated }
}

// Keep EVERY queued draft for one brand in a single stroke — the whole queue,
// not just the page loaded in the browser. Matches items via the brand table
// (same name shown on the queue's brand chips).
export async function keepAllForBrand(brandName: string): Promise<{ updated: number; error?: string }> {
  const admin = createAdminClient() as any
  const { data: brands, error: berr } = await admin.from('brand').select('brand_id').ilike('name', brandName)
  if (berr) return { updated: 0, error: berr.message }
  const ids = (brands ?? []).map((b: any) => b.brand_id)
  if (!ids.length) return { updated: 0, error: `No brand named ${brandName}` }
  const queueIds: string[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin
      .from('brand_watch_queue')
      .select('queue_id')
      .eq('status', 'queued')
      .in('brand_id', ids)
      .order('queue_id')
      .range(from, from + 999)
    if (error) return { updated: 0, error: error.message }
    queueIds.push(...(data ?? []).map((r: any) => r.queue_id))
    if (!data || data.length < 1000) break
  }
  try {
    const updated = await keepQueueRows(admin, queueIds)
    revalidatePath('/admin/brand-watch')
    return { updated }
  } catch (e) {
    return { updated: 0, error: e instanceof Error ? e.message : String(e) }
  }
}

// Undo a skip: skipped → queued again. Skips only — a kept piece has already
// been written into the library as a ready item, so unkeeping is a library
// decision, not a queue one.
export async function undoSkip(itemIds: string[]): Promise<{ restored: number }> {
  if (!itemIds.length) return { restored: 0 }
  const admin = createAdminClient()
  const { data } = await (admin as any)
    .from('brand_watch_queue')
    .update({ status: 'queued', decided_at: null } as any)
    .in('queue_id', itemIds)
    .eq('status', 'skipped')
    .select('queue_id')
  revalidatePath('/admin/brand-watch')
  return { restored: (data ?? []).length }
}

export async function skipItems(itemIds: string[]): Promise<{ updated: number }> {
  if (!itemIds.length) return { updated: 0 }
  const admin = createAdminClient()
  const { data } = await (admin as any)
    .from('brand_watch_queue')
    .update({ status: 'skipped', decided_at: new Date().toISOString() } as any)
    .in('queue_id', itemIds)
    .eq('status', 'queued')
    .select('queue_id')
  revalidatePath('/admin/brand-watch')
  return { updated: (data ?? []).length }
}
