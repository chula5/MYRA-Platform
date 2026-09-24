// AUTOMATE — a trusted brand's new pieces flow into the library by themselves.
//
// Two levels, each switched on per brand by Chloe once earned:
//
//  AUTO-KEEP TWINS (brand-watch-twins) — only a new piece from the same design
//    line as one she kept herself, and not a twin of anything she skipped.
//    Narrow, and the more reliable of the two (94% on her history).
//  AUTOMATE (brand-watch-trust) — anything the keep/skip learning would keep.
//
// After each scan, the brand's NEWLY discovered queued pieces that qualify go
// straight to the library as ready — the same keep as her KEEP button, marked
// auto-kept. Everything else stays in the queue for her.
//
// Guard rails:
//  · scheduled keeps only take pieces discovered after the switch went on;
//    the backlog is only ever kept by her explicit KEEP TWINS NOW
//  · trust is re-measured at every scan; if it has slipped, nothing is kept and
//    the scan says so
//  · house bans and untyped pieces are never kept (keepQueueRows)
//  · at most AUTO_KEEP_PER_SCAN pieces a scan, so a drop can't flood the library

import { buildLearning, type DecidedRow } from './brand-watch-learning'
import { measureBrandTrust, summariseTrust, wouldAutoKeep, type BrandTrust, type TrustDecision } from './brand-watch-trust'
import { carefulFlags, keptTwinOf, measureTwinTrust, summariseTwinTrust, type TwinDecision, type TwinTrust } from './brand-watch-twins'
import {
  confidenceFor, dampByKind, fitBrandModel, measureBoth, summariseConfidence, DEFAULT_CONFIDENCE,
  type BrandModel, type ConfidenceDecision, type ConfidenceTrust,
} from './brand-watch-confidence'
import { houseBanOf } from './brand-watch-bans'
import { keepQueueRows } from './brand-watch-keep'
import type { WatchedBrandRow } from './brand-watch'

const AUTO_KEEP_PER_SCAN = 40
/** Most twins one KEEP TWINS NOW press keeps. */
const TWINS_NOW_CAP = 200

export interface BrandTrustData {
  /** Learned-keep trust per brand_id. */
  byBrandId: Map<string, BrandTrust>
  /** Twin trust per brand_id. */
  twinsByBrandId: Map<string, TwinTrust>
  /** Her decisions per brand_id, oldest first, with which were careful — twin evidence. */
  evidence: Map<string, { decisions: TwinDecision[]; careful: boolean[] }>
  /** The learning, trained on every decision Chloe made herself. */
  learn: ReturnType<typeof buildLearning>
  /** The chance-she-keeps model per brand_id. */
  confidence: ConfidenceModels
  /** How that model measured, walk-forward, keyed `${brand_id}|${bar}`. */
  confidenceTrust: Map<string, ConfidenceTrust>
}

const DECIDED_BASE = 'queue_id, status, decided_at, discovered_at, discovery_score, product_name, item_type, colour_family, material_category, price, price_gbp, watched_brand_id, brand_id'

/** Every keep/skip decision, paged. auto_kept and skip_reason arrive with migrations 0056/0055. */
export async function loadDecisions(admin: any): Promise<any[]> {
  const read = async (cols: string) => {
    const out: any[] = []
    for (let from = 0; ; from += 1000) {
      const { data, error } = await admin.from('brand_watch_queue')
        .select(cols).in('status', ['kept', 'skipped']).order('queue_id').range(from, from + 999)
      if (error) return null
      out.push(...(data ?? []))
      if (!data || data.length < 1000) break
    }
    return out
  }
  return (await read(`${DECIDED_BASE}, auto_kept, skip_reason`))
    ?? (await read(`${DECIDED_BASE}, skip_reason`))
    ?? (await read(DECIDED_BASE))
    ?? []
}

const toDecided = (r: any): DecidedRow => ({
  kept: r.status === 'kept',
  // Keyed by brand_id: the same key at training and at prediction.
  brandName: r.brand_id ?? null,
  productName: r.product_name,
  itemType: r.item_type,
  colourFamily: r.colour_family,
  materialCategory: r.material_category,
  price: r.price,
  priceGbp: r.price_gbp != null ? Number(r.price_gbp) : null,
  skipReason: r.skip_reason ?? null,
})

/** A queue row as a twin candidate — brand keyed by brand_id, like the evidence. */
export const asTwinCandidate = (r: any) => ({
  item_id: r.queue_id,
  brand_name: r.brand_id ?? null,
  product_name: r.product_name,
  item_type: r.item_type,
  colour_family: r.colour_family,
  material_category: r.material_category,
  price: r.price,
})

export async function loadBrandTrust(admin: any): Promise<BrandTrustData> {
  // confidence_bar arrives with migration 0066; until it is run, read without it.
  const readWatched = async () => {
    const withBar = await admin.from('watched_brand').select('watched_brand_id, brand_id, min_score, confidence_bar')
    if (!withBar.error) return withBar.data ?? []
    const plain = await admin.from('watched_brand').select('watched_brand_id, brand_id, min_score')
    return plain.data ?? []
  }
  const [rows, wbs] = await Promise.all([loadDecisions(admin), readWatched()])
  const minBy = new Map<string, number>((wbs as any[]).map((w) => [w.watched_brand_id, Number(w.min_score ?? 5)]))
  const decisions: TrustDecision[] = rows.map((r) => ({
    ...toDecided(r),
    at: String(r.decided_at ?? r.discovered_at),
    score: Number(r.discovery_score ?? 0),
    minScore: minBy.get(r.watched_brand_id) ?? 5,
    autoKept: !!r.auto_kept,
  }))

  const twinDecisions: TwinDecision[] = rows
    .map((r) => ({ ...asTwinCandidate(r), kept: r.status === 'kept', at: String(r.decided_at ?? r.discovered_at), autoKept: !!r.auto_kept }))
    .sort((a, b) => a.at.localeCompare(b.at))
  const grouped = new Map<string, TwinDecision[]>()
  for (const d of twinDecisions) grouped.set(d.brand_name ?? '', [...(grouped.get(d.brand_name ?? '') ?? []), d])
  const evidence = new Map<string, { decisions: TwinDecision[]; careful: boolean[] }>()
  grouped.forEach((list, brand) => evidence.set(brand, { decisions: list, careful: carefulFlags(list) }))

  const learn = buildLearning(decisions.filter((d) => !d.autoKept))
  const confDecisions: ConfidenceDecision[] = decisions.map((d) => ({ ...d, at: d.at, score: d.score, autoKept: d.autoKept }))
  const confidence = confidenceModels(confDecisions, learn)
  // Measured at each brand's own bar, and at the default, so the page can show
  // what switching it on would have done.
  const barBy = new Map<string, number>((wbs as any[]).map((w) => [w.brand_id, Number(w.confidence_bar ?? DEFAULT_CONFIDENCE)]))
  const confidenceTrust = new Map<string, ConfidenceTrust>()
  const perBrand = new Map<string, ConfidenceDecision[]>()
  for (const d of confDecisions) if (d.brandName) perBrand.set(d.brandName, [...(perBrand.get(d.brandName) ?? []), d])
  perBrand.forEach((list, brand) => {
    for (const bar of Array.from(new Set([barBy.get(brand) ?? DEFAULT_CONFIDENCE, DEFAULT_CONFIDENCE]))) {
      const both = measureBoth(list, bar)
      confidenceTrust.set(`${brand}|${bar}`, { ...both.all, trusted: both.trusted, summary: both.summary, careful: both.careful.careful })
    }
  })

  return {
    byBrandId: measureBrandTrust(decisions),
    twinsByBrandId: measureTwinTrust(twinDecisions),
    evidence,
    learn,
    confidence,
    confidenceTrust,
  }
}

export const trustFor = (data: BrandTrustData, watched: Pick<WatchedBrandRow, 'brand_id'>): BrandTrust =>
  (watched.brand_id && data.byBrandId.get(watched.brand_id)) || summariseTrust(0, 0, 0)

export const twinTrustFor = (data: BrandTrustData, watched: Pick<WatchedBrandRow, 'brand_id'>): TwinTrust =>
  (watched.brand_id && data.twinsByBrandId.get(watched.brand_id)) || summariseTwinTrust(0, 0)

/** The piece she kept that a queue row is a twin of, or null. */
export function twinOfQueueRow(data: BrandTrustData, row: any): TwinDecision | null {
  const ev = row.brand_id ? data.evidence.get(row.brand_id) : undefined
  return ev ? keptTwinOf(asTwinCandidate(row), ev.decisions, ev.careful) : null
}

// ── Confidence: the chance she would keep a piece, per brand ────────────────

export interface ConfidenceModels {
  /** Fitted on one brand's own careful decisions. */
  byBrand: Map<string, BrandModel>
  /** Fitted on every brand's careful decisions — the house's taste so far. */
  house: BrandModel | null
}

/**
 * A model per brand, and one for the house.
 *
 * A brand she has never decided on has no history of its own, but the library
 * does: thousands of keeps and skips across every other brand. That pooled
 * model is what a new brand starts from, so its first piece carries a number
 * rather than nothing. As she keeps and skips from the brand itself, its own
 * model takes over (see `confidenceOf`).
 */
export function confidenceModels(decisions: ConfidenceDecision[], learn: ReturnType<typeof buildLearning>): ConfidenceModels {
  const byBrand = new Map<string, ConfidenceDecision[]>()
  const careful: ConfidenceDecision[] = []
  for (const d of decisions) {
    if (d.autoKept) continue
    careful.push(d)
    if (!d.brandName) continue
    byBrand.set(d.brandName, [...(byBrand.get(d.brandName) ?? []), d])
  }
  const sample = (d: ConfidenceDecision) => ({ kept: d.kept, delta: learn(d).delta, score: d.score })
  const models = new Map<string, BrandModel>()
  byBrand.forEach((list, brand) => { models.set(brand, fitBrandModel(list.map(sample))) })
  return { byBrand: models, house: careful.length >= 8 ? fitBrandModel(careful.map(sample)) : null }
}

/**
 * How much of its own evidence a brand needs before its model outweighs the
 * house's. At 12 decisions a brand speaks for half of the answer.
 */
export const BRAND_EVIDENCE_K = 12

export const confidenceOf = (data: BrandTrustData, row: any): number | null => {
  const brand = row.brand_id ? data.confidence.byBrand.get(row.brand_id) : undefined
  const house = data.confidence.house
  if (!brand && !house) return null
  const v = data.learn(toDecided(row))
  const score = Number(row.discovery_score ?? 0)
  const pBrand = brand ? confidenceFor(brand, v.delta, score) : null
  const pHouse = house ? confidenceFor(house, v.delta, score) : null
  // A new brand is read by the house; a brand with its own history speaks for
  // itself, in proportion to how much of it there is.
  const w = pBrand == null ? 0 : pHouse == null ? 1 : (brand!.n) / (brand!.n + BRAND_EVIDENCE_K)
  const p = (pBrand ?? 0) * w + (pHouse ?? 0) * (1 - w)
  // Never sure about a kind of piece she has never kept.
  return dampByKind(p, v)
}

/** Where a piece's number came from — for the label under it. */
export const confidenceSourceOf = (data: BrandTrustData, brandId: string | null | undefined): 'brand' | 'house' | 'blend' | null => {
  const n = (brandId ? data.confidence.byBrand.get(brandId)?.n : 0) ?? 0
  if (!data.confidence.house) return n ? 'brand' : null
  if (!n) return 'house'
  return n >= BRAND_EVIDENCE_K * 3 ? 'brand' : 'blend'
}

export const confidenceTrustFor = (data: BrandTrustData, watched: { brand_id?: string | null; confidence_bar?: number | null }): ConfidenceTrust =>
  (watched.brand_id && data.confidenceTrust.get(`${watched.brand_id}|${Number(watched.confidence_bar ?? DEFAULT_CONFIDENCE)}`))
    || summariseConfidence(0, 0, 0, Number(watched.confidence_bar ?? DEFAULT_CONFIDENCE))

export interface AutoKeepResult {
  autoKept: number
  note: string | null
}

const QUEUED_COLS = 'queue_id, brand_id, product_name, item_type, colour_family, material_category, material_primary, price, price_gbp, discovery_score'
const keepable = (q: any) => q.item_type && !houseBanOf({ title: q.product_name, materialPrimary: q.material_primary, itemType: q.item_type })

async function queuedFor(admin: any, brandId: string, since: string | null): Promise<any[]> {
  let query = admin.from('brand_watch_queue').select(QUEUED_COLS).eq('status', 'queued').eq('brand_id', brandId)
  if (since) query = query.gte('discovered_at', since)
  const { data, error } = await query.limit(1000)
  if (error) throw new Error(error.message)
  return (data ?? []) as any[]
}

/** After a scan: keep the brand's new pieces that qualify under whichever levels are on and still earned. */
export async function autoKeepForBrand(admin: any, watched: WatchedBrandRow, trustData?: BrandTrustData): Promise<AutoKeepResult | null> {
  if ((!watched.auto_keep && !watched.auto_keep_twins) || !watched.brand_id) return null
  const data = trustData ?? (await loadBrandTrust(admin))
  const notes: string[] = []
  const picks = new Map<string, number>() // queue_id → rank

  try {
    if (watched.auto_keep_twins) {
      const trust = twinTrustFor(data, watched)
      if (!trust.trusted) notes.push(`AUTO-KEEP TWINS PAUSED — ${trust.summary}`)
      else {
        const since = watched.auto_keep_twins_since ?? new Date().toISOString()
        for (const q of await queuedFor(admin, watched.brand_id, since)) {
          if (keepable(q) && twinOfQueueRow(data, q)) picks.set(q.queue_id, 100 + Number(q.discovery_score ?? 0))
        }
      }
    }
    // BY CONFIDENCE — only above her bar, and only while the model measures at
  // that bar on this brand's own one-by-one decisions.
  if ((watched as any).auto_keep_confidence) {
    const bar = Number((watched as any).confidence_bar ?? DEFAULT_CONFIDENCE)
    const trust = confidenceTrustFor(data, watched as any)
    if (!trust.trusted) notes.push(`AUTO-KEEP BY CONFIDENCE PAUSED — ${trust.summary}`)
    else {
      const since = (watched as any).auto_keep_confidence_since ?? new Date().toISOString()
      for (const q of await queuedFor(admin, watched.brand_id, since)) {
        if (!keepable(q)) continue
        const p = confidenceOf(data, { ...q, brand_id: watched.brand_id })
        if (p != null && p >= bar) picks.set(q.queue_id, 200 + p)
      }
    }
  }

  if (watched.auto_keep) {
      const trust = trustFor(data, watched)
      if (!trust.trusted) notes.push(`AUTOMATE PAUSED — ${trust.summary}`)
      else {
        const since = watched.auto_keep_since ?? new Date().toISOString()
        for (const q of await queuedFor(admin, watched.brand_id, since)) {
          if (!keepable(q) || picks.has(q.queue_id)) continue
          const delta = data.learn(toDecided({ ...q, brand_id: watched.brand_id })).delta
          const score = Number(q.discovery_score ?? 0)
          if (wouldAutoKeep(delta, score, watched.min_score)) picks.set(q.queue_id, score + delta)
        }
      }
    }
  } catch (err) {
    return { autoKept: 0, note: `AUTOMATE FAILED — ${err instanceof Error ? err.message : String(err)}` }
  }

  const ids = Array.from(picks.entries()).sort((a, b) => b[1] - a[1]).slice(0, AUTO_KEEP_PER_SCAN).map(([id]) => id)
  const autoKept = ids.length ? await keepQueueRows(admin, ids, { auto: true }) : 0
  return { autoKept, note: notes.length ? notes.join(' · ') : null }
}

/** KEEP TWINS NOW: every twin of her keeps already in this brand's queue — her explicit press, backlog included. */
/**
 * ADD THE BACKLOG — every queued piece for this brand already above her bar,
 * on her press. Automation itself only ever takes pieces found after it was
 * switched on; this is how the queue that built up before it catches up.
 */
export async function keepConfidentNow(admin: any, watched: WatchedBrandRow, cap = TWINS_NOW_CAP): Promise<{ kept: number; error?: string }> {
  if (!watched.brand_id) return { kept: 0, error: 'This brand has no pieces yet' }
  const data = await loadBrandTrust(admin)
  const trust = confidenceTrustFor(data, watched as any)
  if (!trust.trusted) return { kept: 0, error: `NOT YET — ${trust.summary}` }
  const bar = Number((watched as any).confidence_bar ?? DEFAULT_CONFIDENCE)
  const ids = (await queuedFor(admin, watched.brand_id, null))
    .filter((q) => {
      if (!keepable(q)) return false
      const p = confidenceOf(data, { ...q, brand_id: watched.brand_id })
      return p != null && p >= bar
    })
    .slice(0, cap)
    .map((q) => q.queue_id)
  return { kept: ids.length ? await keepQueueRows(admin, ids, { auto: true }) : 0 }
}

export async function keepTwinsNow(admin: any, watched: WatchedBrandRow): Promise<{ kept: number; error?: string }> {
  if (!watched.brand_id) return { kept: 0, error: 'This brand has no pieces yet' }
  const data = await loadBrandTrust(admin)
  const trust = twinTrustFor(data, watched)
  if (!trust.trusted) return { kept: 0, error: `NOT YET TRUSTED — ${trust.summary}` }
  const ids = (await queuedFor(admin, watched.brand_id, null))
    .filter((q) => keepable(q) && twinOfQueueRow(data, q))
    .slice(0, TWINS_NOW_CAP)
    .map((q) => q.queue_id)
  return { kept: ids.length ? await keepQueueRows(admin, ids, { auto: true }) : 0 }
}
