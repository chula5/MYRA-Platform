'use server'

import { createAdminClient } from '@/lib/supabase-server'
import {
  baselineBrand, checkWatchedBrand, onboardBrand, runBrandWatch, normaliseBaseUrl,
  type BrandCheckResult, type WatchedBrandRow,
} from '@/lib/brand-watch'
import { buildLearning, type DecidedRow } from '@/lib/brand-watch-learning'
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
const QUEUE_FIELDS = 'item_id, product_name, item_type, colour_family, material_category, price, currency, image_url, retailer_url, discovery_score, discovered_at, admin_notes, status, brand:brand_id(name)'

function mapQueueRow(r: any): Omit<QueueItemRow, 'learned_delta' | 'learned_reasons' | 'predicted_skip' | 'adjusted'> {
  return {
    item_id: r.item_id,
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

// All brand-watch rows for the given statuses (paged past PostgREST's 1,000-row cap).
async function fetchBrandWatchRows(admin: any, statuses: string[]): Promise<any[]> {
  const out: any[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin
      .from('item')
      .select(QUEUE_FIELDS)
      .eq('discovery_source', 'brand_watch')
      .in('status', statuses)
      .order('item_id')
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
    drafts = await fetchBrandWatchRows(admin, ['draft'])
    decidedRows = await fetchBrandWatchRows(admin, ['ready', 'archived'])
  } catch (e) {
    return { queue: [], queueTotal: 0, predictedSkipTotal: 0, decidedCount: 0, brandCounts: {}, error: e instanceof Error ? e.message : String(e) }
  }

  const decided: DecidedRow[] = decidedRows.map((r) => ({
    kept: r.status === 'ready',
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

  // Name from the domain until the first scan tells us the vendor name.
  const host = new URL(base).hostname.replace(/^www\./, '')
  const provisional = host.split('.')[0].replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())

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
  } catch (e) {
    // Scan failed (not Shopify / blocked) — remove the row again.
    await (admin as any).from('watched_brand').delete().eq('watched_brand_id', watched.watched_brand_id)
    return { error: e instanceof Error ? e.message : String(e) }
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

// Keep: draft → ready (the scored 1–5 dimensions still need a pass, but the
// piece is accepted into the library). Skip: draft → archived, never resurfaces.
export async function keepItems(itemIds: string[]): Promise<{ updated: number }> {
  if (!itemIds.length) return { updated: 0 }
  const admin = createAdminClient()
  const { data } = await (admin as any)
    .from('item')
    .update({ status: 'ready' } as any)
    .in('item_id', itemIds)
    .eq('discovery_source', 'brand_watch')
    .eq('status', 'draft')
    .select('item_id')
  revalidatePath('/admin/brand-watch')
  return { updated: (data ?? []).length }
}

export async function skipItems(itemIds: string[]): Promise<{ updated: number }> {
  if (!itemIds.length) return { updated: 0 }
  const admin = createAdminClient()
  const { data } = await (admin as any)
    .from('item')
    .update({ status: 'archived' } as any)
    .in('item_id', itemIds)
    .eq('discovery_source', 'brand_watch')
    .eq('status', 'draft')
    .select('item_id')
  revalidatePath('/admin/brand-watch')
  return { updated: (data ?? []).length }
}
