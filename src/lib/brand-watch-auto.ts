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
import { typeFromStoredRow } from './brand-watch'
import { automationOn, manualOverride, measureBrandTrust, summariseTrust, trustForAutomation, wouldAutoKeep, type BrandTrust, type TrustDecision } from './brand-watch-trust'
import { carefulFlags, keptTwinOf, measureTwinTrust, summariseTwinTrust, type TwinDecision, type TwinTrust } from './brand-watch-twins'
import {
  confidenceModels, confidenceFromModels, confidenceSource, measureBoth, summariseConfidence,
  wouldAutoKeepByConfidence, BRAND_EVIDENCE_K, DEFAULT_CONFIDENCE,
  type ConfidenceDecision, type ConfidenceModels, type ConfidenceTrust,
} from './brand-watch-confidence'
import { houseBanOf } from './brand-watch-bans'
import { seasonOf, inCurrentSeason, type Season } from './season'
import { keepQueueRows } from './brand-watch-keep'
import type { WatchedBrandRow } from './brand-watch'

const AUTO_KEEP_PER_SCAN = 40
/** Most twins one KEEP TWINS NOW press keeps. */
const TWINS_NOW_CAP = 200

/**
 * What the QUEUE needs from her decisions: the learning that ranks it, the
 * confidence models behind each piece's number, the twin evidence, and the
 * decision count. Deliberately without the walk-forward trust measurements —
 * those are seconds of CPU, only the brand cards read them, and selecting a
 * brand never renders a brand card.
 */
export interface QueueTrustData {
  /** Her decisions per brand_id, oldest first, with which were careful — twin evidence. */
  evidence: Map<string, { decisions: TwinDecision[]; careful: boolean[] }>
  /** The learning over EVERY decision — what ranks the queue. */
  learn: ReturnType<typeof buildLearning>
  /** The learning over the decisions Chloe made herself — automation and the confidence models must not learn from their own auto-keeps. */
  learnOwn: ReturnType<typeof buildLearning>
  /** The chance-she-keeps model per brand_id. */
  confidence: ConfidenceModels
  /** Number of kept/skipped decisions used to train the models. */
  decidedCount: number
}

/** Everything above plus the walk-forward trust measurements — the brand cards and the automation gates. */
export interface BrandTrustData extends QueueTrustData {
  /** Learned-keep trust per brand_id. */
  byBrandId: Map<string, BrandTrust>
  /** Twin trust per brand_id. */
  twinsByBrandId: Map<string, TwinTrust>
  /** How the confidence model measured, walk-forward, keyed `${brand_id}|${bar}`. */
  confidenceTrust: Map<string, ConfidenceTrust>
}

const DECIDED_BASE = 'queue_id, status, decided_at, discovered_at, discovery_score, product_name, item_type, colour_family, material_category, price, price_gbp, watched_brand_id, brand_id'

/** Pages fetched per concurrent wave — a 1,000-row page is one round trip, and reading eleven of them one after another was a second of pure waiting. */
const WAVE = 8

/** Every keep/skip decision, paged in concurrent waves. auto_kept and skip_reason arrive with migrations 0056/0055. */
export async function loadDecisions(admin: any): Promise<any[]> {
  const page = async (from: number, cols: string) => {
    const { data, error } = await admin.from('brand_watch_queue')
      .select(cols).in('status', ['kept', 'skipped']).order('queue_id').range(from, from + 999)
    if (error) throw new Error(error.message)
    return (data ?? []) as any[]
  }
  // Newest schema first; an old one without the newest columns reads the next set.
  for (const cols of [`${DECIDED_BASE}, auto_kept, skip_reason`, `${DECIDED_BASE}, skip_reason`, DECIDED_BASE]) {
    try {
      const first = await page(0, cols)
      if (first.length < 1000) return first
      const out = [...first]
      for (let from = 1000; ; from += WAVE * 1000) {
        let short = false
        for (const rows of await Promise.all(Array.from({ length: WAVE }, (_, i) => page(from + i * 1000, cols)))) {
          out.push(...rows)
          if (rows.length < 1000) short = true
        }
        if (short) return out
      }
    } catch {
      // A failed read falls through to the older set of columns, and to no
      // decisions at all once every set has been tried — exactly what the
      // sequential read did.
    }
  }
  return []
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

// confidence_bar arrives with migration 0066; until it is run, read without it.
async function readWatchedBrands(admin: any): Promise<any[]> {
  const withBar = await admin.from('watched_brand').select('watched_brand_id, brand_id, min_score, confidence_bar')
  if (!withBar.error) return withBar.data ?? []
  const plain = await admin.from('watched_brand').select('watched_brand_id, brand_id, min_score')
  return plain.data ?? []
}

/** buildQueueTrust's working set — the extra lists the trust measurements walk. */
interface QueueTrustInternals extends QueueTrustData {
  decisions: TrustDecision[]
  twinDecisions: TwinDecision[]
  barBy: Map<string, number>
}

function buildQueueTrust(rows: any[], wbs: any[]): QueueTrustInternals {
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

  // The queue ranks on every decision; the confidence models and automation
  // train only on the decisions Chloe made herself — a model that learns from
  // its own auto-keeps is grading its own homework.
  const learn = buildLearning(decisions)
  const learnOwn = buildLearning(decisions.filter((d) => !d.autoKept))
  const confDecisions: ConfidenceDecision[] = decisions.map((d) => ({ ...d, at: d.at, score: d.score, autoKept: d.autoKept }))
  const confidence = confidenceModels(confDecisions, learnOwn)
  const barBy = new Map<string, number>((wbs as any[]).map((w) => [w.brand_id, Number(w.confidence_bar ?? DEFAULT_CONFIDENCE)]))
  return { decisions, twinDecisions, barBy, evidence, learn, learnOwn, confidence, decidedCount: decisions.length }
}

/**
 * What the queue itself needs — the learning that ranks it, the confidence
 * models behind each piece's number, twin evidence. Without the walk-forward
 * trust measurements, which are seconds of CPU and only the brand cards read.
 */
export async function loadQueueTrust(admin: any): Promise<QueueTrustData> {
  const [rows, wbs] = await Promise.all([loadDecisions(admin), readWatchedBrands(admin)])
  return buildQueueTrust(rows, wbs)
}

export async function loadBrandTrust(admin: any): Promise<BrandTrustData> {
  const [rows, wbs] = await Promise.all([loadDecisions(admin), readWatchedBrands(admin)])
  const t = buildQueueTrust(rows, wbs)
  // Measured at each brand's own bar, and at the default, so the page can show
  // what switching it on would have done.
  const confidenceTrust = new Map<string, ConfidenceTrust>()
  const perBrand = new Map<string, ConfidenceDecision[]>()
  for (const d of t.decisions) if (d.brandName) perBrand.set(d.brandName, [...(perBrand.get(d.brandName) ?? []), d])
  perBrand.forEach((list, brand) => {
    for (const bar of Array.from(new Set([t.barBy.get(brand) ?? DEFAULT_CONFIDENCE, DEFAULT_CONFIDENCE]))) {
      const both = measureBoth(list, bar)
      confidenceTrust.set(`${brand}|${bar}`, { ...both.all, trusted: both.trusted, summary: both.summary, careful: both.careful.careful })
    }
  })

  return {
    ...t,
    byBrandId: measureBrandTrust(t.decisions),
    twinsByBrandId: measureTwinTrust(t.twinDecisions),
    confidenceTrust,
  }
}

export const trustFor = (data: BrandTrustData, watched: Pick<WatchedBrandRow, 'brand_id' | 'name'>): BrandTrust =>
  trustForAutomation(
    (watched.brand_id && data.byBrandId.get(watched.brand_id)) || summariseTrust(0, 0, 0),
    watched.name,
  )

export const twinTrustFor = (data: BrandTrustData, watched: Pick<WatchedBrandRow, 'brand_id'>): TwinTrust =>
  (watched.brand_id && data.twinsByBrandId.get(watched.brand_id)) || summariseTwinTrust(0, 0)

/** The piece she kept that a queue row is a twin of, or null. */
export function twinOfQueueRow(data: QueueTrustData, row: any): TwinDecision | null {
  const ev = row.brand_id ? data.evidence.get(row.brand_id) : undefined
  return ev ? keptTwinOf(asTwinCandidate(row), ev.decisions, ev.careful) : null
}

// ── Confidence: the chance she would keep a piece, per brand ────────────────
// The models and the blend are pure, and live in brand-watch-confidence so the
// offline evaluator can measure the very same code. These are the DB-shaped
// wrappers the queue and AUTOMATE call.

export { confidenceModels, BRAND_EVIDENCE_K, type ConfidenceModels }

export const confidenceOf = (data: QueueTrustData, row: any): number | null =>
  confidenceFromModels(data.confidence, data.learnOwn, toDecided(row), Number(row.discovery_score ?? 0))

/** Where a piece's number came from — for the label under it. */
export const confidenceSourceOf = (data: BrandTrustData, brandId: string | null | undefined): 'brand' | 'house' | 'blend' | null =>
  confidenceSource(data.confidence, brandId)

export const confidenceTrustFor = (data: BrandTrustData, watched: { brand_id?: string | null; confidence_bar?: number | null }): ConfidenceTrust =>
  (watched.brand_id && data.confidenceTrust.get(`${watched.brand_id}|${Number(watched.confidence_bar ?? DEFAULT_CONFIDENCE)}`))
    || summariseConfidence(0, 0, 0, Number(watched.confidence_bar ?? DEFAULT_CONFIDENCE))

export interface AutoKeepResult {
  autoKept: number
  note: string | null
}

const QUEUED_COLS = 'queue_id, brand_id, product_name, item_type, colour_family, material_category, material_primary, price, price_gbp, discovery_score, retailer_url, currency, image_url, stock_status, season, season_code'
/**
 * The row with the type it is actually going to be kept as: what the scan read,
 * or what the piece's own name gives when the shop stated nothing — AFLALO
 * sends product_type as the literal string "undefined". Without this, every
 * piece from such a feed is invisible to automation for ever.
 */
const typedRow = (q: any) => (q.item_type ? q : { ...q, item_type: typeFromStoredRow(q) })
const keepable = (q: any) => { const r = typedRow(q); return r.item_type && !houseBanOf({ title: r.product_name, materialPrimary: r.material_primary, itemType: r.item_type }) }

async function queuedFor(admin: any, brandId: string, since: string | null): Promise<any[]> {
  let query = admin.from('brand_watch_queue').select(QUEUED_COLS).eq('status', 'queued').eq('brand_id', brandId)
  if (since) query = query.gte('discovered_at', since)
  const { data, error } = await query.limit(1000)
  if (error) throw new Error(error.message)
  return (data ?? []) as any[]
}

/** After a scan: keep the brand's new pieces that qualify under whichever levels are on and still earned. */
export async function autoKeepForBrand(admin: any, watched: WatchedBrandRow, trustData?: BrandTrustData): Promise<AutoKeepResult | null> {
  if (!automationOn(watched) || !watched.brand_id) return null
  const data = trustData ?? (await loadBrandTrust(admin))
  const notes: string[] = []
  const picks = new Map<string, number>() // queue_id → rank
  // She switched a level on before it earned the gate. The measurement is
  // unchanged and still reported; it simply no longer blocks what she asked for.
  const overridden = manualOverride(watched)

  try {
    // KEEP EVERYTHING — the point of this level is that the brand's taste does
    // not need predicting at all. The season rule still applies, so outgoing
    // summer stock is left in the queue rather than added.
    if (watched.auto_keep_all) {
      const since = watched.auto_keep_all_since ?? new Date().toISOString()
      for (const q of await queuedFor(admin, watched.brand_id, since)) {
        const row = typedRow(q)
        if (!keepable(row)) continue
        const season = (q.season as Season | null | undefined)
          ?? seasonOf({ title: row.product_name, itemType: row.item_type, materialCategory: q.material_category, materialPrimary: q.material_primary }).season
        if (!inCurrentSeason(season, q.season_code)) continue
        picks.set(q.queue_id, 300)
      }
    }
    if (watched.auto_keep_twins) {
      const trust = twinTrustFor(data, watched)
      if (!trust.trusted && !overridden) notes.push(`AUTO-KEEP TWINS PAUSED — ${trust.summary}`)
      else {
        const since = watched.auto_keep_twins_since ?? new Date().toISOString()
        for (const q of await queuedFor(admin, watched.brand_id, since)) {
          const row = typedRow(q)
          if (row.item_type && keepable(row) && twinOfQueueRow(data, row)) picks.set(q.queue_id, 100 + Number(q.discovery_score ?? 0))
        }
      }
    }
    // BY CONFIDENCE — only above her bar, and only while the model measures at
    // that bar on this brand's own one-by-one decisions.
    if (watched.auto_keep_confidence) {
      const bar = Number(watched.confidence_bar ?? DEFAULT_CONFIDENCE)
      const trust = confidenceTrustFor(data, watched)
      if (!trust.trusted && !overridden) notes.push(`AUTO-KEEP BY CONFIDENCE PAUSED — ${trust.summary}`)
      else {
        const since = watched.auto_keep_confidence_since ?? new Date().toISOString()
        for (const q of await queuedFor(admin, watched.brand_id, since)) {
          if (!keepable(q)) continue
          const row = { ...typedRow(q), brand_id: watched.brand_id }
          const p = confidenceOf(data, row)
          // The same gate the trust measure was taken through — a kind she has
          // never kept is shown a number but is never taken unsupervised.
          if (wouldAutoKeepByConfidence(p, data.learnOwn(toDecided(row)), bar)) picks.set(q.queue_id, 200 + p!)
        }
      }
    }

    if (watched.auto_keep) {
      const trust = trustFor(data, watched)
      if (!trust.trusted && !overridden) notes.push(`AUTOMATE PAUSED — ${trust.summary}`)
      else {
        const since = watched.auto_keep_since ?? new Date().toISOString()
        for (const q of await queuedFor(admin, watched.brand_id, since)) {
          if (!keepable(q) || picks.has(q.queue_id)) continue
          const delta = data.learnOwn(toDecided({ ...typedRow(q), brand_id: watched.brand_id })).delta
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
  const bar = Number(watched.confidence_bar ?? DEFAULT_CONFIDENCE)
  const ids = (await queuedFor(admin, watched.brand_id, null))
    .filter((q) => {
      if (!keepable(q)) return false
      const row = { ...typedRow(q), brand_id: watched.brand_id }
      return wouldAutoKeepByConfidence(confidenceOf(data, row), data.learnOwn(toDecided(row)), bar)
    })
    .slice(0, cap)
    .map((q) => q.queue_id)
  return { kept: ids.length ? await keepQueueRows(admin, ids, { auto: true }) : 0 }
}

/** KEEP TWINS NOW: every twin of her keeps already in this brand's queue — her explicit press, backlog included. */
export async function keepTwinsNow(admin: any, watched: WatchedBrandRow): Promise<{ kept: number; error?: string }> {
  if (!watched.brand_id) return { kept: 0, error: 'This brand has no pieces yet' }
  const data = await loadBrandTrust(admin)
  const trust = twinTrustFor(data, watched)
  if (!trust.trusted) return { kept: 0, error: `NOT YET TRUSTED — ${trust.summary}` }
  const ids = (await queuedFor(admin, watched.brand_id, null))
    .filter((q) => { const r = typedRow(q); return keepable(r) && twinOfQueueRow(data, r) })
    .slice(0, TWINS_NOW_CAP)
    .map((q) => q.queue_id)
  return { kept: ids.length ? await keepQueueRows(admin, ids, { auto: true }) : 0 }
}
