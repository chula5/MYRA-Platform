'use server'

import { confidenceOf, confidenceTrustFor } from '@/lib/brand-watch-auto'
import { DEFAULT_CONFIDENCE, type ConfidenceTrust } from '@/lib/brand-watch-confidence'
import { houseBanOf } from '@/lib/brand-watch-bans'
import { keepQueueRows, teachStyleBrain, type KeepReport } from '@/lib/brand-watch-keep'
import {
  autoKeepForBrand, keepConfidentNow, keepTwinsNow, loadBrandTrust, trustFor, twinOfQueueRow, twinTrustFor, type BrandTrustData,
} from '@/lib/brand-watch-auto'
import type { BrandTrust } from '@/lib/brand-watch-trust'
import type { TwinTrust } from '@/lib/brand-watch-twins'

import { createAdminClient } from '@/lib/supabase-server'
import {
  baselineBrand, checkWatchedBrand, onboardBrand, provisionalNameFromUrl, runBrandWatch, normaliseBaseUrl,
  foldBrandName,
  type BrandCheckResult, type WatchedBrandRow,
} from '@/lib/brand-watch'
import { buildLearning, type DecidedRow } from '@/lib/brand-watch-learning'
import { discoverProductUrls } from '@/lib/brand-watch-browser'
import { waitUntil } from '@vercel/functions'
import { revalidatePath } from 'next/cache'
import { assertAdmin } from '@/lib/admin-audit'
import { createWatchedBrandAndScan } from '@/lib/brand-onboarding'
import { inSeason, seasonOf, type Season } from '@/lib/season'
import type { CatalogueAssessment } from '@/lib/brand-onboarding-rules'

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
  /** 0..1 — the chance she would keep it, from this brand's own decisions. */
  confidence?: number | null
  /** aw | ss | all — from the shop's codes, the kind of piece, or its material. */
  season?: Season | null
  season_code?: string | null
  learned_delta: number
  learned_reasons: string
  predicted_skip: boolean
  adjusted: number
  /** The piece Chloe kept that this is the same design as — AUTO-KEEP TWINS would keep it. */
  twin_of: string | null
}

export interface QueuePage {
  queue: QueueItemRow[]
  queueTotal: number
  predictedSkipTotal: number
  /** Pieces from the season on its way out, hidden by default. */
  outOfSeasonTotal?: number
  decidedCount: number
  brandCounts: Record<string, number>
  /** Pieces per type / colour across the WHOLE queue in scope — not just the loaded page. */
  typeCounts?: Record<string, number>
  colourCounts?: Record<string, number>
  /** Queued twins of her keeps, per brand name. */
  twinCounts?: Record<string, number>
  error?: string
}

/** Queue filters, applied server-side so they search every queued piece. */
export type QueueSort = 'rank' | 'sure_desc' | 'sure_asc'

export interface QueueFilters {
  itemType?: string
  colour?: string
  minScore?: number | null
  showPredicted?: boolean
  /** MYRA's order (style score + learning), or by how sure she is, either way. */
  sort?: QueueSort
  /** 'in' (default): the season we are heading into plus anything unplaced; 'out': the other one; 'all'. */
  season?: 'in' | 'out' | 'all'
}

export interface BrandWatchData extends QueuePage {
  watched: WatchedBrandRow[]
  /** Whether each brand's learning can be trusted to keep on its own, by watched_brand_id. */
  trust?: Record<string, BrandTrust>
  /** Whether twins of her keeps can be kept on their own, by watched_brand_id. */
  twinTrust?: Record<string, TwinTrust>
  /** How the chance-she-keeps model measured at each brand's bar, by watched_brand_id. */
  confidenceTrust?: Record<string, ConfidenceTrust>
  /** Pieces she has kept and skipped per brand — the volume behind the trust. */
  decided?: Record<string, { kept: number; skipped: number }>
  migrationNeeded?: boolean
}

const QUEUE_PAGE = 200
const QUEUE_FIELDS = 'queue_id, product_name, item_type, colour_family, material_category, material_primary, price, currency, price_gbp, image_url, retailer_url, shopify_product_id, shopify_handle, stock_status, stock_sizes, discovery_score, discovered_at, admin_notes, status, brand_id, brand:brand_id(name), season, season_code'

// The client keys cards by item_id — for queue rows that's the queue_id.
function mapQueueRow(r: any): Omit<QueueItemRow, 'learned_delta' | 'learned_reasons' | 'predicted_skip' | 'adjusted' | 'twin_of' | 'confidence'> {
  return {
    item_id: r.queue_id,
    product_name: r.product_name,
    brand_name: r.brand?.name ?? null,
    item_type: r.item_type,
    colour_family: r.colour_family,
    season: (r.season ?? null) as Season | null,
    season_code: (r.season_code ?? null) as string | null,
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

/**
 * Everything the ranking, the counts, the learning and the twin check read —
 * and nothing that is only there to be looked at.
 *
 * Selecting one brand still has to walk the WHOLE queue (the brand counts and
 * the cross-brand learning both need it), so this read is the floor on how fast
 * a brand chip can respond. image_url and retailer_url are most of a row's
 * bytes and neither is consulted until 200 rows have been picked, so they are
 * fetched afterwards, for those 200 only.
 */
const RANK_FIELDS = 'queue_id, brand_id, product_name, item_type, colour_family, material_category, material_primary, price, price_gbp, discovery_score, discovered_at, brand:brand_id(name), season, season_code'

/**
 * What buildLearning reads off a decided row. There are far more kept and
 * skipped rows than queued ones — they accumulate forever — and not one of them
 * is ever rendered, so pulling their images was the largest read on the page.
 */
const DECIDED_FIELDS = 'queue_id, status, product_name, item_type, colour_family, material_category, price, price_gbp, brand:brand_id(name)'

// All queue rows for the given statuses (paged past PostgREST's 1,000-row cap).
async function fetchBrandWatchRows(admin: any, statuses: string[], fields = QUEUE_FIELDS): Promise<any[]> {
  const out: any[] = []
  for (let from = 0; ; from += 1000) {
    let { data, error } = await admin
      .from('brand_watch_queue')
      .select(fields)
      .in('status', statuses)
      .order('queue_id')
      .range(from, from + 999)
    // Pre-0073 the season columns are not there yet: read without them.
    if (error && /season/.test(error.message) && /season/.test(fields)) {
      ;({ data, error } = await admin.from('brand_watch_queue').select(fields.replace(', season, season_code', '')).in('status', statuses).order('queue_id').range(from, from + 999))
    }
    if (error) throw new Error(error.message)
    out.push(...(data ?? []))
    if (!data || data.length < 1000) break
  }
  return out
}

/** The display fields for the rows that actually reached the page. */
async function hydrateRows(admin: any, queueIds: string[]): Promise<Map<string, any>> {
  const out = new Map<string, any>()
  if (!queueIds.length) return out
  for (let i = 0; i < queueIds.length; i += 200) {
    const { data, error } = await admin
      .from('brand_watch_queue')
      .select(QUEUE_FIELDS)
      .in('queue_id', queueIds.slice(i, i + 200))
    if (error) throw new Error(error.message)
    for (const r of data ?? []) out.set(r.queue_id, r)
  }
  return out
}

// One page of the queue, ranked by style score + learned keep/skip adjustment.
// The learning re-trains on every load from all decisions made so far, so the
// ranking sharpens each time you come back to a brand.
export async function loadQueuePage(offset: number, brandName?: string | null, filters: QueueFilters = {}): Promise<QueuePage> {
  await assertAdmin()
  return queuePage(offset, brandName, filters)
}

// trustIn lets the page load share one read of every decision with the brand cards.
async function queuePage(offset: number, brandName?: string | null, filters: QueueFilters = {}, trustIn?: BrandTrustData): Promise<QueuePage> {
  const admin = createAdminClient() as any
  let drafts: any[]
  let decidedRows: any[]
  try {
    drafts = await fetchBrandWatchRows(admin, ['queued'], RANK_FIELDS)
    decidedRows = await fetchBrandWatchRows(admin, ['kept', 'skipped'], DECIDED_FIELDS)
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
  const trustData = trustIn ?? (await loadBrandTrust(admin))

  // The learning may fold a piece away, but never one the house style rates
  // well: anything two points clear of its brand's min score stays visible.
  // Same cap as the scan-time veto — a 7-score jean was being hidden on
  // 'light' and grey learned negative from bag skips.
  const { data: wbs } = await admin.from('watched_brand').select('name, min_score')
  const minByBrand = new Map<string, number>(((wbs ?? []) as any[]).map((w) => [foldBrandName(w.name), Number(w.min_score ?? 5)]))

  // A banned piece already in the queue from before the bans is not shown.
  const live = drafts.filter((r) => !houseBanOf({ title: r.product_name, materialPrimary: r.material_primary, itemType: r.item_type }))

  // The brand chips count the whole queue, so this tally runs over all of it.
  // It is only a tally: none of the expensive per-row work below is needed to
  // say how many pieces a brand has waiting.
  const brandCounts: Record<string, number> = {}
  for (const r of live) {
    const b = r.brand?.name ?? '?'
    brandCounts[b] = (brandCounts[b] ?? 0) + 1
  }

  // Filters run over the whole queue, not the loaded page: filtering the page
  // hid the SNEAKER chip under ALL BRANDS whenever the top 200 pieces held no
  // sneakers, and a colour filter could only find what happened to be loaded.
  //
  // Scoping BEFORE the annotation, not after, is what makes a brand chip quick:
  // running the learning and the twin check over every brand's queue to then
  // throw all but one brand's away was the whole cost of the click.
  const scoped = brandName ? live.filter((r) => (r.brand?.name ?? null) === brandName) : live

  const annotated = scoped.map((r) => {
    const brand_name = r.brand?.name ?? null
    const discovery_score = r.discovery_score != null ? Number(r.discovery_score) : null
    const price_gbp = r.price_gbp != null ? Number(r.price_gbp) : null
    const v = learn({
      brandName: brand_name, productName: r.product_name, itemType: r.item_type,
      colourFamily: r.colour_family, materialCategory: r.material_category, price: r.price,
      priceGbp: price_gbp,
    })
    const brandMin = minByBrand.get(foldBrandName(brand_name)) ?? 5
    const strong = (discovery_score ?? 0) >= brandMin + 2
    return {
      queue_id: r.queue_id as string,
      brand_name,
      item_type: r.item_type as string | null,
      colour_family: r.colour_family as string | null,
      discovery_score,
      discovered_at: r.discovered_at as string | null,
      learned_delta: v.delta,
      learned_reasons: v.reasons,
      predicted_skip: v.predictedSkip && !strong,
      adjusted: (discovery_score ?? 0) + v.delta,
      season: (r.season as Season | null | undefined)
        ?? seasonOf({ title: r.product_name, itemType: r.item_type, materialCategory: r.material_category, materialPrimary: r.material_primary }).season,
      twin_of: twinOfQueueRow(trustData, r)?.product_name ?? null,
      // How sure MYRA is that Chloe would keep it — her own model for this brand.
      confidence: confidenceOf(trustData, r),
    }
  })

  // Only ever read for the selected brand, so it is counted over the scope.
  const twinCounts: Record<string, number> = {}
  for (const q of annotated) {
    if (q.twin_of) {
      const b = q.brand_name ?? '?'
      twinCounts[b] = (twinCounts[b] ?? 0) + 1
    }
  }

  const scope = annotated
  const { itemType = '', colour = '', minScore = null, showPredicted = false, sort = 'rank', season = 'in' } = filters
  const now = new Date()
  const seasonOk = (q: (typeof annotated)[number]) =>
    season === 'all' ? true : season === 'out' ? !inSeason(q.season, now) : inSeason(q.season, now)
  const passes = (q: (typeof annotated)[number], skip: 'type' | 'colour' | 'predicted' | 'season' | null) =>
    (skip === 'type' || !itemType || q.item_type === itemType) &&
    (skip === 'colour' || !colour || q.colour_family === colour) &&
    (minScore === null || (q.discovery_score ?? -99) >= minScore) &&
    (skip === 'predicted' || showPredicted || !q.predicted_skip) &&
    (skip === 'season' || seasonOk(q))

  // Each chip row counts with the OTHER filters applied, so picking a colour
  // never hides a type that exists in that colour (and vice versa).
  const typeCounts: Record<string, number> = {}
  const colourCounts: Record<string, number> = {}
  for (const q of scope) {
    if (q.item_type && passes(q, 'type')) typeCounts[q.item_type] = (typeCounts[q.item_type] ?? 0) + 1
    if (q.colour_family && passes(q, 'colour')) colourCounts[q.colour_family] = (colourCounts[q.colour_family] ?? 0) + 1
  }

  const filtered = scope.filter((q) => passes(q, null))
  // MYRA's order leads with the season we are heading into whenever both are shown.
  const seasonRank = (q: (typeof annotated)[number]) => (inSeason(q.season, now) ? 1 : 0)
  const byRank = (a: (typeof annotated)[number], b: (typeof annotated)[number]) =>
    (seasonRank(b) - seasonRank(a)) || (b.adjusted - a.adjusted) || String(b.discovered_at ?? '').localeCompare(String(a.discovered_at ?? ''))
  // Sorting by confidence puts pieces with no number last either way — a brand
  // with no model yet has nothing to say about them.
  const sure = (q: (typeof annotated)[number]) => q.confidence
  filtered.sort(
    sort === 'sure_desc' ? (a, b) => ((sure(b) ?? -1) - (sure(a) ?? -1)) || byRank(a, b)
    : sort === 'sure_asc' ? (a, b) => ((sure(a) ?? 2) - (sure(b) ?? 2)) || byRank(a, b)
    : byRank,
  )

  // Only now, with the page decided, are the display fields worth reading.
  const pageRows = filtered.slice(offset, offset + QUEUE_PAGE)
  const full = await hydrateRows(admin, pageRows.map((q) => q.queue_id))
  const queue: QueueItemRow[] = pageRows.flatMap((q) => {
    const row = full.get(q.queue_id)
    // A piece decided in another tab between the ranking and this read is gone
    // rather than half-rendered.
    if (!row) return []
    const { queue_id, ...annotation } = q
    return [{ ...mapQueueRow(row), ...annotation }]
  })

  return {
    queue,
    queueTotal: filtered.length,
    predictedSkipTotal: scope.filter((q) => q.predicted_skip && passes(q, 'predicted')).length,
    outOfSeasonTotal: scope.filter((q) => !inSeason(q.season, now) && passes(q, 'season')).length,
    decidedCount: decided.length,
    brandCounts,
    typeCounts,
    colourCounts,
    twinCounts,
  }
}

export async function loadBrandWatch(): Promise<BrandWatchData> {
  await assertAdmin()
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

  const trustData = await loadBrandTrust(admin as any)
  const page = await queuePage(0, null, {}, trustData)
  if (page.error && (/brand_watch_queue/.test(page.error) || /42P01/.test(page.error))) {
    // Queue table missing → migration 0033 hasn't been run yet.
    return { watched: (watched ?? []) as unknown as WatchedBrandRow[], ...page, migrationNeeded: true }
  }
  const rows = (watched ?? []) as unknown as WatchedBrandRow[]
  const trust = Object.fromEntries(rows.map((w) => [w.watched_brand_id, trustFor(trustData, w)]))
  const twinTrust = Object.fromEntries(rows.map((w) => [w.watched_brand_id, twinTrustFor(trustData, w)]))
  const confidenceTrust = Object.fromEntries(rows.map((w) => [w.watched_brand_id, confidenceTrustFor(trustData, w as any)]))
  // How many pieces she has kept and skipped per brand — the volume behind the trust.
  const decided: Record<string, { kept: number; skipped: number }> = {}
  for (const w of rows) {
    if (!w.brand_id) continue
    const ev = trustData.evidence.get(w.brand_id)?.decisions ?? []
    decided[w.watched_brand_id] = { kept: ev.filter((d) => d.kept).length, skipped: ev.filter((d) => !d.kept).length }
  }
  return { watched: rows, ...page, trust, twinTrust, confidenceTrust, decided }
}

/**
 * AUTO-KEEP TWINS for one brand — the narrower first level of automation.
 * Switching on requires the brand's twin trust, checked here.
 */
export async function setWatchedBrandAutoKeepTwins(watchedBrandId: string, on: boolean): Promise<{ error?: string }> {
  await assertAdmin()
  const admin = createAdminClient() as any
  const { data: w } = await admin.from('watched_brand').select('*').eq('watched_brand_id', watchedBrandId).single()
  if (!w) return { error: 'Watchlist row not found' }
  if (on) {
    const trust = twinTrustFor(await loadBrandTrust(admin), w)
    if (!trust.trusted) return { error: `NOT YET TRUSTED — ${trust.summary}` }
  }
  const { error } = await admin.from('watched_brand')
    .update({ auto_keep_twins: on, auto_keep_twins_since: on ? new Date().toISOString() : null })
    .eq('watched_brand_id', watchedBrandId)
  if (error) return { error: /auto_keep_twins/.test(error.message) ? 'RUN MIGRATION 0057_brand_watch_auto_twins.sql IN SUPABASE FIRST' : error.message }
  revalidatePath('/admin/brand-watch')
  return {}
}

/** KEEP TWINS NOW — every twin of her keeps already in this brand's queue, on her press. */
export async function keepTwinsNowForBrand(watchedBrandId: string): Promise<{ kept?: number; error?: string }> {
  await assertAdmin()
  const admin = createAdminClient() as any
  const { data: w } = await admin.from('watched_brand').select('*').eq('watched_brand_id', watchedBrandId).single()
  if (!w) return { error: 'Watchlist row not found' }
  try {
    const r = await keepTwinsNow(admin, w as WatchedBrandRow)
    revalidatePath('/admin/brand-watch')
    return r.error ? { error: r.error } : { kept: r.kept }
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * AUTOMATE for one brand. Switching on requires the brand's trust to be earned
 * — checked here, not just greyed out in the page. From now on, only pieces
 * discovered after this moment can be kept automatically.
 */
export async function setWatchedBrandAutoKeep(watchedBrandId: string, on: boolean): Promise<{ error?: string }> {
  await assertAdmin()
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



/**
 * AUTO-KEEP BY CONFIDENCE — the bar she sets, in plain odds. Switching on needs
 * the model to have measured at that bar on this brand's own one-by-one
 * decisions; the check is here, not only in the page.
 */
export async function setWatchedBrandAutoKeepConfidence(watchedBrandId: string, on: boolean): Promise<{ error?: string }> {
  await assertAdmin()
  const admin = createAdminClient() as any
  const { data: w } = await admin.from('watched_brand').select('*').eq('watched_brand_id', watchedBrandId).single()
  if (!w) return { error: 'Watchlist row not found' }
  if (on) {
    const trust = confidenceTrustFor(await loadBrandTrust(admin), w)
    if (!trust.trusted) return { error: `NOT YET — ${trust.summary}` }
  }
  const { error } = await admin.from('watched_brand')
    .update({ auto_keep_confidence: on, auto_keep_confidence_since: on ? new Date().toISOString() : null })
    .eq('watched_brand_id', watchedBrandId)
  if (error) return { error: /auto_keep_confidence/.test(error.message) ? 'RUN MIGRATION 0066_brand_watch_confidence.sql IN SUPABASE FIRST' : error.message }
  revalidatePath('/admin/brand-watch')
  return {}
}

export interface SiteRequestRow {
  request_id: string
  host: string
  url: string | null
  page_title: string | null
  reason: string
  times_asked: number
  status: string
  last_asked_at: string
  member_name?: string | null
  /** MYRA's judgement (migration 0071): accepted | review | declined | unreadable | admin. */
  verdict?: string | null
  verdict_note?: string | null
  assessed_at?: string | null
  decided_by?: string | null
  watched_brand_id?: string | null
  assessment?: Pick<CatalogueAssessment, 'total' | 'fashion' | 'onTaste' | 'medianPriceGbp' | 'route'> | null
}

/**
 * Shops asked for from the Mirror: the ones waiting on Chloe (open, or being
 * read), and what MYRA decided by itself in the last fortnight — so nothing
 * is watched or turned away unseen.
 */
export async function loadSiteRequests(): Promise<{ rows: SiteRequestRow[]; error?: string }> {
  await assertAdmin()
  const admin = createAdminClient() as any
  const cols = 'request_id, host, url, page_title, reason, times_asked, status, last_asked_at, member:member_id(name), verdict, verdict_note, assessed_at, decided_by, watched_brand_id, assessment'
  const since = new Date(Date.now() - 14 * 24 * 3600 * 1000).toISOString()
  const [waiting, decided] = await Promise.all([
    admin.from('mirror_site_request').select(cols).in('status', ['open', 'assessing']).order('last_asked_at', { ascending: false }).limit(40),
    admin.from('mirror_site_request').select(cols).eq('decided_by', 'myra').in('status', ['watching', 'declined']).gte('assessed_at', since).order('assessed_at', { ascending: false }).limit(40),
  ])
  const error = waiting.error ?? decided.error
  if (error) {
    if (/mirror_site_request/.test(error.message)) return { rows: [], error: 'RUN MIGRATION 0067_mirror_site_requests.sql IN SUPABASE FIRST' }
    if (/verdict|decided_by|assessment/.test(error.message)) return { rows: [], error: 'RUN MIGRATION 0071_brand_onboarding.sql IN SUPABASE FIRST' }
    return { rows: [], error: error.message }
  }
  const shape = (r: any): SiteRequestRow => ({
    ...r,
    member_name: r.member?.name ?? null,
    assessment: r.assessment ? {
      total: r.assessment.total, fashion: r.assessment.fashion, onTaste: r.assessment.onTaste,
      medianPriceGbp: r.assessment.medianPriceGbp ?? null, route: r.assessment.route,
    } : null,
  })
  return { rows: [...((waiting.data ?? []) as any[]).map(shape), ...((decided.data ?? []) as any[]).map(shape)] }
}

/** Put a requested shop on the watchlist, or set it aside — Chloe's word, over MYRA's. */
export async function decideSiteRequest(requestId: string, decision: 'watching' | 'declined'): Promise<{ error?: string; result?: BrandCheckResult; name?: string }> {
  await assertAdmin()
  const admin = createAdminClient() as any
  const { data: row } = await admin.from('mirror_site_request').select('*').eq('request_id', requestId).maybeSingle()
  if (!row) return { error: 'Request not found' }
  let watchedBrandId: string | null = row.watched_brand_id ?? null
  let name: string | undefined
  if (decision === 'watching') {
    // Full scan: the whole catalogue queued with its confidence, like Chloe's own adds.
    const r = await createWatchedBrandAndScan(admin, `https://${row.host}`, 'full')
    // A shop MYRA cannot scan says so plainly; the request stays as it was.
    if (r.error && !r.watchedBrandId) return { error: r.error }
    watchedBrandId = r.watchedBrandId ?? null
    name = r.name
  }
  const { error } = await admin.from('mirror_site_request')
    .update({ status: decision, decided_by: 'chloe', watched_brand_id: watchedBrandId, assessed_at: row.assessed_at ?? new Date().toISOString() })
    .eq('request_id', requestId)
  if (error) return { error: error.message }
  revalidatePath('/admin/brand-watch')
  return { name }
}

/** ADD THE BACKLOG: keep every queued piece for this brand already above her bar. */
export async function keepConfidentNowForBrand(watchedBrandId: string): Promise<{ kept?: number; error?: string }> {
  await assertAdmin()
  const admin = createAdminClient() as any
  const { data: w } = await admin.from('watched_brand').select('*').eq('watched_brand_id', watchedBrandId).single()
  if (!w) return { error: 'Watchlist row not found' }
  try {
    const r = await keepConfidentNow(admin, w as WatchedBrandRow)
    revalidatePath('/admin/brand-watch')
    return r.error ? { error: r.error } : { kept: r.kept }
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) }
  }
}

/** What MYRA added by itself lately — so nothing lands unseen. */
export async function loadAutoAdded(limit = 60): Promise<{ rows: { queue_id: string; product_name: string; brand_name: string | null; image_url: string; retailer_url: string; decided_at: string | null; item_id: string | null }[]; error?: string }> {
  await assertAdmin()
  const admin = createAdminClient() as any
  const { data, error } = await admin.from('brand_watch_queue')
    .select('queue_id, product_name, image_url, retailer_url, decided_at, item_id, brand:brand_id(name)')
    .eq('status', 'kept').eq('auto_kept', true).order('decided_at', { ascending: false }).limit(limit)
  if (error) return { rows: [], error: /auto_kept/.test(error.message) ? 'RUN MIGRATION 0056 FIRST' : error.message }
  return { rows: ((data ?? []) as any[]).map((r) => ({ ...r, brand_name: r.brand?.name ?? null })) }
}

/**
 * UNDO an auto-add: the piece leaves the library and goes back in the queue for
 * her. Recorded as her skip, so the model learns it was wrong to add it.
 */
export async function undoAutoKeep(queueId: string): Promise<{ error?: string }> {
  await assertAdmin()
  const admin = createAdminClient() as any
  const { data: row } = await admin.from('brand_watch_queue').select('queue_id, item_id, auto_kept').eq('queue_id', queueId).maybeSingle()
  if (!row) return { error: 'Not found' }
  if (!row.auto_kept) return { error: 'This one was kept by you, not by MYRA' }
  if (row.item_id) {
    const { error: iErr } = await admin.from('item').update({ status: 'archived' }).eq('item_id', row.item_id)
    if (iErr) return { error: iErr.message }
  }
  const { error } = await admin.from('brand_watch_queue')
    .update({ status: 'skipped', auto_kept: false, item_id: null, decided_at: new Date().toISOString() })
    .eq('queue_id', queueId)
  if (error) return { error: error.message }
  revalidatePath('/admin/brand-watch')
  return {}
}

/** The bar itself: auto-keep only above this chance she would keep it. */
export async function setWatchedBrandConfidenceBar(watchedBrandId: string, bar: number): Promise<{ error?: string }> {
  await assertAdmin()
  const admin = createAdminClient() as any
  const clamped = Math.max(0.5, Math.min(0.99, Number(bar) || DEFAULT_CONFIDENCE))
  const { error } = await admin.from('watched_brand').update({ confidence_bar: clamped }).eq('watched_brand_id', watchedBrandId)
  if (error) return { error: /confidence_bar/.test(error.message) ? 'RUN MIGRATION 0066_brand_watch_confidence.sql IN SUPABASE FIRST' : error.message }
  revalidatePath('/admin/brand-watch')
  return {}
}

// Add a brand to the watchlist. mode 'watch' queues only the last 60 days of
// on-taste pieces; mode 'full' onboards the whole catalogue (every piece at
// min_score or above, any publish date). Both mark everything seen and set up
// the Monday watching.
/**
 * Add a brand and scan it IN THE BACKGROUND. The row appears at once and the
 * card shows it working, so the page stays hers while a catalogue is read —
 * a first scan can take minutes and used to hold the whole page.
 */
export async function addWatchedBrandInBackground(url: string, mode: 'watch' | 'full' = 'watch'): Promise<{ watchedBrandId?: string; name?: string; error?: string }> {
  await assertAdmin()
  const r = await createWatchedBrandAndScan(createAdminClient() as any, url, mode)
  return r.error ? { error: r.error } : r
}

export async function addWatchedBrand(url: string, mode: 'watch' | 'full' = 'watch'): Promise<{ result?: BrandCheckResult; error?: string }> {
  await assertAdmin()
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
  await assertAdmin()
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

/** Start one of the scans without holding the page: it runs on, the card says so. */
async function startInBackground(watchedBrandId: string, run: (w: WatchedBrandRow) => Promise<unknown>): Promise<{ started?: true; name?: string; error?: string }> {
  const admin = createAdminClient() as any
  const { data } = await admin.from('watched_brand').select('*').eq('watched_brand_id', watchedBrandId).single()
  if (!data) return { error: 'Watchlist row not found' }
  const watched = data as unknown as WatchedBrandRow
  if ((watched.scan_state as any)?.running) return { error: `${watched.name} is already being scanned` }
  await admin.from('watched_brand')
    .update({ scan_state: { ...(watched.scan_state ?? {}), running: true, started_at: new Date().toISOString() } })
    .eq('watched_brand_id', watchedBrandId)
  const work = (async () => {
    try { await run(watched) } catch (err) {
      await admin.from('watched_brand')
        .update({ scan_state: { running: false, error: err instanceof Error ? err.message : String(err) } })
        .eq('watched_brand_id', watchedBrandId)
      return
    }
    // onboardBrand keeps its own page counters; only clear the running flag.
    const { data: after } = await admin.from('watched_brand').select('scan_state').eq('watched_brand_id', watchedBrandId).maybeSingle()
    await admin.from('watched_brand')
      .update({ scan_state: { ...((after?.scan_state as any) ?? {}), running: false } })
      .eq('watched_brand_id', watchedBrandId)
    revalidatePath('/admin/brand-watch')
  })()
  try { waitUntil(work) } catch { /* local dev: the promise simply runs */ }
  revalidatePath('/admin/brand-watch')
  return { started: true, name: watched.name }
}

/** CHECK NOW, in the background. */
export async function checkBrandNowInBackground(watchedBrandId: string) {
  await assertAdmin()
  return startInBackground(watchedBrandId, async (w) => {
    const admin = createAdminClient() as any
    await checkWatchedBrand(w)
    await autoKeepForBrand(admin, w)
  })
}

/** FULL SCAN, in the background. */
export async function fullScanBrandInBackground(watchedBrandId: string) {
  await assertAdmin()
  return startInBackground(watchedBrandId, (w) => onboardBrand(w))
}

/** RUN CHECK NOW across the watchlist, in the background. */
export async function checkAllBrandsNowInBackground(): Promise<{ started: true }> {
  await assertAdmin()
  const work = (async () => { try { await runBrandWatch() } catch { /* each brand records its own error */ } revalidatePath('/admin/brand-watch') })()
  try { waitUntil(work) } catch { /* local dev */ }
  return { started: true }
}

export async function setWatchedBrandActive(watchedBrandId: string, active: boolean): Promise<void> {
  await assertAdmin()
  const admin = createAdminClient()
  await (admin as any).from('watched_brand').update({ active } as any).eq('watched_brand_id', watchedBrandId)
  revalidatePath('/admin/brand-watch')
}

/**
 * The bar a piece must clear to queue. Lowering it starts a FULL SCAN by itself:
 * the weekly check only looks at pieces it has never seen, and everything below
 * the old bar was marked seen without queueing — Antik Batik sat at 2 in queue
 * with a whole new collection scoring 3, because the bar had come down from 5
 * and nothing re-read the catalogue.
 */
export async function setWatchedBrandMinScore(watchedBrandId: string, minScore: number): Promise<{ rescanning?: boolean }> {
  await assertAdmin()
  const admin = createAdminClient() as any
  const clamped = Math.max(-9, Math.min(9, Math.round(minScore)))
  const { data: before } = await admin.from('watched_brand').select('min_score, scan_state').eq('watched_brand_id', watchedBrandId).maybeSingle()
  await admin.from('watched_brand').update({ min_score: clamped }).eq('watched_brand_id', watchedBrandId)
  const lowered = before && clamped < Number(before.min_score ?? 5)
  let rescanning = false
  if (lowered && !(before.scan_state as any)?.running) {
    const r = await startInBackground(watchedBrandId, (w) => onboardBrand({ ...w, min_score: clamped }))
    rescanning = !!r.started
  }
  revalidatePath('/admin/brand-watch')
  return { rescanning }
}

export async function removeWatchedBrand(watchedBrandId: string): Promise<void> {
  await assertAdmin()
  const admin = createAdminClient()
  await (admin as any).from('watched_brand').delete().eq('watched_brand_id', watchedBrandId)
  revalidatePath('/admin/brand-watch')
}

export async function checkBrandNow(watchedBrandId: string): Promise<{ result?: BrandCheckResult; error?: string }> {
  await assertAdmin()
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
  await assertAdmin()
  const results = await runBrandWatch()
  revalidatePath('/admin/brand-watch')
  return { results }
}


export async function keepItems(itemIds: string[]): Promise<{ updated: number; outOfStock: string[]; lowStock: string[] }> {
  await assertAdmin()
  if (!itemIds.length) return { updated: 0, outOfStock: [], lowStock: [] }
  const admin = createAdminClient() as any
  // One-by-one and small batches check the shop live; a bulk keep-all does not
  // (hundreds of fetches inside one action) — the sentinel catches up on those.
  const report: KeepReport = { outOfStock: [], lowStock: [] }
  const updated = await keepQueueRows(admin, itemIds, { liveStock: itemIds.length <= 25, report })
  // No revalidatePath: the client hides the card optimistically and re-queries
  // fresh (with retrained learning) on the next queue load. Revalidating here
  // re-rendered the whole heavy admin page on every single click, which froze
  // rapid keep/skip.
  return { updated, outOfStock: report.outOfStock, lowStock: report.lowStock }
}

// Keep EVERY queued draft for one brand in a single stroke — the whole queue,
// not just the page loaded in the browser. Matches items via the brand table
// (same name shown on the queue's brand chips).
export async function keepAllForBrand(brandName: string, opts: { includeOutOfSeason?: boolean } = {}): Promise<{ updated: number; error?: string; leftOutOfSeason?: number }> {
  await assertAdmin()
  const admin = createAdminClient() as any
  const { data: brands, error: berr } = await admin.from('brand').select('brand_id').ilike('name', brandName)
  if (berr) return { updated: 0, error: berr.message }
  const ids = (brands ?? []).map((b: any) => b.brand_id)
  if (!ids.length) return { updated: 0, error: `No brand named ${brandName}` }
  const queueIds: string[] = []
  // The season on its way out stays in the queue unless she is looking at it.
  let leftOut = 0
  for (let from = 0; ; from += 1000) {
    let { data, error } = await admin
      .from('brand_watch_queue')
      .select('queue_id, season, product_name, item_type, material_category, material_primary')
      .eq('status', 'queued')
      .in('brand_id', ids)
      .order('queue_id')
      .range(from, from + 999)
    if (error && /season/.test(error.message)) {
      ;({ data, error } = await admin.from('brand_watch_queue').select('queue_id, product_name, item_type, material_category, material_primary').eq('status', 'queued').in('brand_id', ids).order('queue_id').range(from, from + 999))
    }
    if (error) return { updated: 0, error: error.message }
    for (const r of (data ?? []) as any[]) {
      const season = (r.season as Season | null | undefined) ?? seasonOf({ title: r.product_name, itemType: r.item_type, materialCategory: r.material_category, materialPrimary: r.material_primary }).season
      if (!opts.includeOutOfSeason && !inSeason(season)) { leftOut++; continue }
      queueIds.push(r.queue_id)
    }
    if (!data || data.length < 1000) break
  }
  try {
    const updated = await keepQueueRows(admin, queueIds)
    revalidatePath('/admin/brand-watch')
    return { updated, leftOutOfSeason: leftOut }
  } catch (e) {
    return { updated: 0, error: e instanceof Error ? e.message : String(e) }
  }
}

// Undo a skip: skipped → queued again. Skips only — a kept piece has already
// been written into the library as a ready item, so unkeeping is a library
// decision, not a queue one.
export async function undoSkip(itemIds: string[]): Promise<{ restored: number }> {
  await assertAdmin()
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
  await assertAdmin()
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
  await assertAdmin()
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
