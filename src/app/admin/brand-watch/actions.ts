'use server'

import { houseBanOf } from '@/lib/brand-watch-bans'
import { keepQueueRows, teachStyleBrain } from '@/lib/brand-watch-keep'
import { autoKeepForBrand, loadBrandTrust, trustFor } from '@/lib/brand-watch-auto'
import type { BrandTrust } from '@/lib/brand-watch-trust'

import { createAdminClient } from '@/lib/supabase-server'
import {
  baselineBrand, checkWatchedBrand, onboardBrand, provisionalNameFromUrl, runBrandWatch, normaliseBaseUrl,
  foldBrandName,
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
  price_gbp: number | null
  image_url: string
  retailer_url: string
  stock_status: string | null
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
  /** Pieces per type / colour across the WHOLE queue in scope — not just the loaded page. */
  typeCounts?: Record<string, number>
  colourCounts?: Record<string, number>
  error?: string
}

/** Queue filters, applied server-side so they search every queued piece. */
export interface QueueFilters {
  itemType?: string
  colour?: string
  minScore?: number | null
  showPredicted?: boolean
}

export interface BrandWatchData extends QueuePage {
  watched: WatchedBrandRow[]
  /** Whether each brand's learning can be trusted to keep on its own, by watched_brand_id. */
  trust?: Record<string, BrandTrust>
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
    price_gbp: r.price_gbp != null ? Number(r.price_gbp) : null,
    image_url: r.image_url,
    retailer_url: r.retailer_url,
    stock_status: r.stock_status ?? null,
    discovery_score: r.discovery_score != null ? Number(r.discovery_score) : null,
    discovered_at: r.discovered_at,
    admin_notes: r.admin_notes,
  }
}

/** Skip reasons by queue id (migration 0055). Empty until the column exists. */
async function fetchSkipReasons(admin: any): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin.from('brand_watch_queue')
      .select('queue_id, skip_reason').eq('status', 'skipped').not('skip_reason', 'is', null)
      .order('queue_id').range(from, from + 999)
    if (error) return out
    for (const r of data ?? []) out.set(r.queue_id, r.skip_reason)
    if (!data || data.length < 1000) break
  }
  return out
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
export async function loadQueuePage(offset: number, brandName?: string | null, filters: QueueFilters = {}): Promise<QueuePage> {
  const admin = createAdminClient() as any
  let drafts: any[]
  let decidedRows: any[]
  try {
    drafts = await fetchBrandWatchRows(admin, ['queued'])
    decidedRows = await fetchBrandWatchRows(admin, ['kept', 'skipped'])
  } catch (e) {
    return { queue: [], queueTotal: 0, predictedSkipTotal: 0, decidedCount: 0, brandCounts: {}, error: e instanceof Error ? e.message : String(e) }
  }

  const reasons = await fetchSkipReasons(admin)
  const decided: DecidedRow[] = decidedRows.map((r) => ({
    kept: r.status === 'kept',
    brandName: r.brand?.name ?? null,
    productName: r.product_name,
    itemType: r.item_type,
    colourFamily: r.colour_family,
    materialCategory: r.material_category,
    price: r.price,
    priceGbp: r.price_gbp != null ? Number(r.price_gbp) : null,
    skipReason: reasons.get(r.queue_id) ?? null,
  }))
  const learn = buildLearning(decided)

  // The learning may fold a piece away, but never one the house style rates
  // well: anything two points clear of its brand's min score stays visible.
  // Same cap as the scan-time veto — a 7-score jean was being hidden on
  // 'light' and grey learned negative from bag skips.
  const { data: wbs } = await admin.from('watched_brand').select('name, min_score')
  const minByBrand = new Map<string, number>(((wbs ?? []) as any[]).map((w) => [foldBrandName(w.name), Number(w.min_score ?? 5)]))

  // A banned piece already in the queue from before the bans is not shown.
  const annotated: QueueItemRow[] = drafts.filter((r) => !houseBanOf({ title: r.product_name, materialPrimary: r.material_primary, itemType: r.item_type })).map((r) => {
    const base = mapQueueRow(r)
    const v = learn({
      brandName: base.brand_name, productName: base.product_name, itemType: base.item_type,
      colourFamily: base.colour_family, materialCategory: base.material_category, price: base.price,
      priceGbp: base.price_gbp,
    })
    const minScore = minByBrand.get(foldBrandName(base.brand_name)) ?? 5
    const strong = (base.discovery_score ?? 0) >= minScore + 2
    return { ...base, learned_delta: v.delta, learned_reasons: v.reasons, predicted_skip: v.predictedSkip && !strong, adjusted: (base.discovery_score ?? 0) + v.delta }
  })

  const brandCounts: Record<string, number> = {}
  for (const q of annotated) {
    const b = q.brand_name ?? '?'
    brandCounts[b] = (brandCounts[b] ?? 0) + 1
  }

  // Filters run over the whole queue, not the loaded page: filtering the page
  // hid the SNEAKER chip under ALL BRANDS whenever the top 200 pieces held no
  // sneakers, and a colour filter could only find what happened to be loaded.
  const scope = brandName ? annotated.filter((q) => q.brand_name === brandName) : annotated
  const { itemType = '', colour = '', minScore = null, showPredicted = false } = filters
  const passes = (q: QueueItemRow, skip: 'type' | 'colour' | 'predicted' | null) =>
    (skip === 'type' || !itemType || q.item_type === itemType) &&
    (skip === 'colour' || !colour || q.colour_family === colour) &&
    (minScore === null || (q.discovery_score ?? -99) >= minScore) &&
    (skip === 'predicted' || showPredicted || !q.predicted_skip)

  // Each chip row counts with the OTHER filters applied, so picking a colour
  // never hides a type that exists in that colour (and vice versa).
  const typeCounts: Record<string, number> = {}
  const colourCounts: Record<string, number> = {}
  for (const q of scope) {
    if (q.item_type && passes(q, 'type')) typeCounts[q.item_type] = (typeCounts[q.item_type] ?? 0) + 1
    if (q.colour_family && passes(q, 'colour')) colourCounts[q.colour_family] = (colourCounts[q.colour_family] ?? 0) + 1
  }

  const filtered = scope.filter((q) => passes(q, null))
  filtered.sort((a, b) => (b.adjusted - a.adjusted) || String(b.discovered_at ?? '').localeCompare(String(a.discovered_at ?? '')))

  return {
    queue: filtered.slice(offset, offset + QUEUE_PAGE),
    queueTotal: filtered.length,
    predictedSkipTotal: scope.filter((q) => q.predicted_skip && passes(q, 'predicted')).length,
    decidedCount: decided.length,
    brandCounts,
    typeCounts,
    colourCounts,
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

  const [page, trustData] = await Promise.all([loadQueuePage(0), loadBrandTrust(admin as any)])
  if (page.error && (/brand_watch_queue/.test(page.error) || /42P01/.test(page.error))) {
    // Queue table missing → migration 0033 hasn't been run yet.
    return { watched: (watched ?? []) as unknown as WatchedBrandRow[], ...page, migrationNeeded: true }
  }
  const rows = (watched ?? []) as unknown as WatchedBrandRow[]
  const trust = Object.fromEntries(rows.map((w) => [w.watched_brand_id, trustFor(trustData, w)]))
  return { watched: rows, ...page, trust }
}

/**
 * AUTOMATE for one brand. Switching on requires the brand's trust to be earned
 * — checked here, not just greyed out in the page. From now on, only pieces
 * discovered after this moment can be kept automatically.
 */
export async function setWatchedBrandAutoKeep(watchedBrandId: string, on: boolean): Promise<{ error?: string }> {
  const admin = createAdminClient() as any
  const { data: w } = await admin.from('watched_brand').select('*').eq('watched_brand_id', watchedBrandId).single()
  if (!w) return { error: 'Watchlist row not found' }
  if (on) {
    const trust = trustFor(await loadBrandTrust(admin), w)
    if (!trust.trusted) return { error: `NOT YET TRUSTED — ${trust.summary}` }
  }
  const { error } = await admin.from('watched_brand')
    .update({ auto_keep: on, auto_keep_since: on ? new Date().toISOString() : null })
    .eq('watched_brand_id', watchedBrandId)
  if (error) return { error: /auto_keep/.test(error.message) ? 'RUN MIGRATION 0056_brand_watch_automate.sql IN SUPABASE FIRST' : error.message }
  revalidatePath('/admin/brand-watch')
  return {}
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
    const auto = await autoKeepForBrand(admin as any, data as unknown as WatchedBrandRow)
    if (auto) { result.autoKept = auto.autoKept; result.autoNote = auto.note }
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


export async function keepItems(itemIds: string[]): Promise<{ updated: number }> {
  if (!itemIds.length) return { updated: 0 }
  const admin = createAdminClient() as any
  const updated = await keepQueueRows(admin, itemIds)
  // No revalidatePath: the client hides the card optimistically and re-queries
  // fresh (with retrained learning) on the next queue load. Revalidating here
  // re-rendered the whole heavy admin page on every single click, which froze
  // rapid keep/skip.
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

const SKIP_REASONS = new Set(['not_style', 'colour', 'type', 'too_young', 'price'])

/** Why these pieces were skipped — the learning weighs that feature double. */
export async function setSkipReason(itemIds: string[], reason: string): Promise<{ updated: number; error?: string }> {
  if (!itemIds.length || !SKIP_REASONS.has(reason)) return { updated: 0, error: 'Unknown reason' }
  const admin = createAdminClient() as any
  const { data, error } = await admin.from('brand_watch_queue')
    .update({ skip_reason: reason }).in('queue_id', itemIds).eq('status', 'skipped').select('queue_id')
  if (error) {
    return { updated: 0, error: /skip_reason/.test(error.message) ? 'Run migration 0055 in Supabase to save skip reasons' : error.message }
  }
  return { updated: (data ?? []).length }
}

/** One Brand Watch decision into Chloe's Style Brain. Never throws. */

export async function skipItems(itemIds: string[]): Promise<{ updated: number }> {
  if (!itemIds.length) return { updated: 0 }
  const admin = createAdminClient()
  const { data } = await (admin as any)
    .from('brand_watch_queue')
    .update({ status: 'skipped', decided_at: new Date().toISOString() } as any)
    .in('queue_id', itemIds)
    .eq('status', 'queued')
    .select('queue_id, item_type, colour_family, brand:brand_id(name)')
  for (const q of (data ?? []) as any[]) await teachStyleBrain(q, 'skip')
  // No revalidatePath — see keepItems. The optimistic hide + next-load re-query
  // keep the queue correct without re-rendering the whole page on every skip.
  return { updated: (data ?? []).length }
}
