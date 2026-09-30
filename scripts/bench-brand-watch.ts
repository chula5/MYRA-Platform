// BENCHMARK THE BRAND WATCH BRAND-CLICK PATH — where the seconds go.
//
// Mirrors what a selected-brand click runs: actions.ts queuePage over
// brand-watch-auto loadQueueTrust, composed from the same pure modules so
// every piece can be timed on its own. The DB-shaped wrapper itself is
// deliberately not imported — it reaches the server-only keep path.
//
// The connection is warmed first: in the server the pool is already open, and
// timing a cold TLS handshake into the first read makes every number a second
// too slow. Reads are timed ALONE as well as together, because eight
// concurrent pages contend for the same pipe.
//
//   node_modules/.bin/jiti scripts/bench-brand-watch.ts [brand name]

import fs from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { buildLearning } from '../src/lib/brand-watch-learning'
import { confidenceModels, confidenceFromModels, measureBoth, DEFAULT_CONFIDENCE, type ConfidenceDecision } from '../src/lib/brand-watch-confidence'
import { measureBrandTrust } from '../src/lib/brand-watch-trust'
import { carefulFlags, keptTwinOf, measureTwinTrust, type TwinDecision } from '../src/lib/brand-watch-twins'
import { houseBanOf } from '../src/lib/brand-watch-bans'

const env: Record<string, string> = {}
for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
}

const RANK_FIELDS = 'queue_id, brand_id, product_name, item_type, colour_family, material_category, material_primary, price, price_gbp, discovery_score, discovered_at, brand:brand_id(name), season, season_code, new_in'
const LIGHT_FIELDS = 'brand:brand_id(name), product_name, item_type, material_primary'
/** The same tally without the join — brand_id resolves through one small read of the brand table. */
const LIGHTER_FIELDS = 'brand_id, product_name, item_type, material_primary'
const QUEUE_FIELDS = 'queue_id, product_name, item_type, colour_family, material_category, material_primary, price, currency, price_gbp, image_url, retailer_url, shopify_product_id, shopify_handle, stock_status, stock_sizes, discovery_score, discovered_at, admin_notes, status, brand_id, brand:brand_id(name), season, season_code, new_in'
const DECIDED_COLS = 'queue_id, status, decided_at, discovered_at, discovery_score, product_name, item_type, colour_family, material_category, price, price_gbp, watched_brand_id, brand_id, auto_kept, skip_reason'

const WAVE = 8
const BRAND = process.argv[2] ?? 'Antik Batik'

const secs = (ms: number) => `${(ms / 1000).toFixed(2)}s`

async function timed<T>(label: string, fn: () => T | Promise<T>): Promise<T> {
  const s = performance.now()
  const r = await fn()
  console.log(`  ${label.padEnd(54)} ${secs(performance.now() - s)}`)
  return r
}

// The concurrent-wave paging actions.ts and brand-watch-auto now use.
async function paged(db: any, cols: string, statuses: string[], extra?: (q: any) => any): Promise<any[]> {
  const page = async (from: number) => {
    let q = db.from('brand_watch_queue').select(cols).in('status', statuses)
    if (extra) q = extra(q)
    const { data, error } = await q.order('queue_id').range(from, from + 999)
    if (error) throw new Error(error.message)
    return (data ?? []) as any[]
  }
  const first = await page(0)
  if (first.length < 1000) return first
  const out = [...first]
  for (let from = 1000; ; from += WAVE * 1000) {
    let short = false
    for (const rows of await Promise.all(Array.from({ length: WAVE }, (_, i) => page(from + i * 1000)))) {
      out.push(...rows)
      if (rows.length < 1000) short = true
    }
    if (short) return out
  }
}

// One page after another, as the queue read ran before this pass.
async function sequential(db: any, cols: string, statuses: string[]): Promise<any[]> {
  const out: any[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from('brand_watch_queue').select(cols).in('status', statuses).order('queue_id').range(from, from + 999)
    if (error) throw new Error(error.message)
    out.push(...(data ?? []))
    if (!data || data.length < 1000) break
  }
  return out
}

const toDecided = (r: any) => ({
  kept: r.status === 'kept',
  brandName: r.brand_id ?? null,
  productName: r.product_name,
  itemType: r.item_type,
  colourFamily: r.colour_family,
  materialCategory: r.material_category,
  price: r.price,
  priceGbp: r.price_gbp != null ? Number(r.price_gbp) : null,
  skipReason: r.skip_reason ?? null,
})

const banned = (r: any) => !houseBanOf({ title: r.product_name, materialPrimary: r.material_primary, itemType: r.item_type })

function decisionsFrom(decided: any[], wbs: any[]) {
  const minBy = new Map<string, number>((wbs ?? []).map((w: any) => [w.watched_brand_id, Number(w.min_score ?? 5)]))
  return decided.map((r: any) => ({
    ...toDecided(r),
    at: String(r.decided_at ?? r.discovered_at),
    score: Number(r.discovery_score ?? 0),
    minScore: minBy.get(r.watched_brand_id) ?? 5,
    autoKept: !!r.auto_kept,
  }))
}

function twinsFrom(decided: any[]): TwinDecision[] {
  return decided
    .map((r: any) => ({
      item_id: r.queue_id, brand_name: r.brand_id ?? null, product_name: r.product_name,
      item_type: r.item_type, colour_family: r.colour_family, material_category: r.material_category,
      price: r.price, kept: r.status === 'kept', at: String(r.decided_at ?? r.discovered_at), autoKept: !!r.auto_kept,
    }))
    .sort((a, b) => a.at.localeCompare(b.at))
}

function evidenceFrom(twinDecisions: TwinDecision[]) {
  const grouped = new Map<string, TwinDecision[]>()
  for (const d of twinDecisions) grouped.set(d.brand_name ?? '', [...(grouped.get(d.brand_name ?? '') ?? []), d])
  const evidence = new Map<string, { decisions: TwinDecision[]; careful: boolean[] }>()
  grouped.forEach((list, brand) => evidence.set(brand, { decisions: list, careful: carefulFlags(list) }))
  return evidence
}

/** Everything queuePage does to a row it is going to rank. */
function annotate(rows: any[], learn: any, learnOwn: any, confidence: any, evidence: Map<string, { decisions: TwinDecision[]; careful: boolean[] }>) {
  for (const r of rows) {
    learn({
      brandName: (r.brand_id as string | null) ?? null,
      productName: r.product_name, itemType: r.item_type,
      colourFamily: r.colour_family, materialCategory: r.material_category, price: r.price,
      priceGbp: r.price_gbp != null ? Number(r.price_gbp) : null,
    })
    const ev = r.brand_id ? evidence.get(r.brand_id) : undefined
    if (ev) {
      keptTwinOf({
        item_id: r.queue_id, brand_name: r.brand_id ?? null, product_name: r.product_name,
        item_type: r.item_type, colour_family: r.colour_family, material_category: r.material_category, price: r.price,
      }, ev.decisions, ev.careful)
    }
    confidenceFromModels(confidence, learnOwn, toDecided(r), Number(r.discovery_score ?? 0))
  }
}

async function main() {
  const db: any = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

  console.log(`brand-click benchmark — ${BRAND}\n`)
  // The server's pool is already open; this makes the numbers below comparable to it.
  await db.from('watched_brand').select('watched_brand_id').limit(1)

  const ids: string[] = (((await db.from('brand').select('brand_id').eq('name', BRAND)).data ?? []) as any[]).map((b) => b.brand_id)
  if (!ids.length) throw new Error(`no brand named ${BRAND}`)

  console.log('EACH READ ON ITS OWN, warm and uncontended')
  const decided = await timed('decided read, waves', () => paged(db, DECIDED_COLS, ['kept', 'skipped']))
  await timed('decided read, one page after another', () => sequential(db, DECIDED_COLS, ['kept', 'skipped']))
  const fullRank = await timed('whole queue RANK_FIELDS, waves (the old read)', () => paged(db, RANK_FIELDS, ['queued']))
  await timed('whole queue RANK_FIELDS, one page after another', () => sequential(db, RANK_FIELDS, ['queued']))
  const chipRows = await timed('chip tally LIGHT_FIELDS (joined), waves', () => paged(db, LIGHT_FIELDS, ['queued']))
  const lighter = await timed('chip tally LIGHTER_FIELDS (no join), waves', () => paged(db, LIGHTER_FIELDS, ['queued']))
  const scoped = await timed(`scoped RANK_FIELDS, ${BRAND}`, () => paged(db, RANK_FIELDS, ['queued'], (q) => q.in('brand_id', ids)))
  const wbs = await timed('watched_brand read', async () => ((await db.from('watched_brand').select('watched_brand_id, brand_id, min_score, confidence_bar')).data ?? []) as any[])
  await timed('hydrate top 200 display fields', async () => {
    await db.from('brand_watch_queue').select(QUEUE_FIELDS).in('queue_id', scoped.slice(0, 200).map((r: any) => r.queue_id))
  })
  await timed('brand table, id → name', async () => ((await db.from('brand').select('brand_id, name')).data ?? []) as any[])

  console.log('\nTHE CPU BEHIND A CLICK')
  const decisions = decisionsFrom(decided, wbs)
  const twinDecisions = twinsFrom(decided)
  const learn = await timed('buildLearning, every decision', () => buildLearning(decisions))
  const learnOwn = await timed('buildLearning, her own decisions only', () => buildLearning(decisions.filter((d) => !d.autoKept)))
  const confidence = await timed('confidenceModels', () => confidenceModels(decisions as ConfidenceDecision[], learnOwn))
  const evidence = await timed('twin evidence + careful flags', () => evidenceFrom(twinDecisions))
  await timed('trust measurement — ONLY the brand cards need this', () => {
    measureBrandTrust(decisions)
    measureTwinTrust(twinDecisions)
    const perBrand = new Map<string, ConfidenceDecision[]>()
    for (const d of decisions as ConfidenceDecision[]) if (d.brandName) perBrand.set(d.brandName, [...(perBrand.get(d.brandName) ?? []), d])
    perBrand.forEach((list) => measureBoth(list, DEFAULT_CONFIDENCE))
  })
  await timed(`annotate ${scoped.length} scoped rows`, () => annotate(scoped, learn, learnOwn, confidence, evidence))
  await timed(`annotate ${fullRank.length} whole-queue rows (the old click)`, () => annotate(fullRank, learn, learnOwn, confidence, evidence))

  console.log('\nEND TO END')
  await timed('OLD click: whole queue + decided + trust + annotate all', async () => {
    const [all, dec] = [await sequential(db, RANK_FIELDS, ['queued']), await sequential(db, DECIDED_COLS, ['kept', 'skipped'])]
    const wb = ((await db.from('watched_brand').select('watched_brand_id, brand_id, min_score, confidence_bar')).data ?? []) as any[]
    const ds = decisionsFrom(dec, wb)
    const td = twinsFrom(dec)
    const lrn = buildLearning(ds.filter((d) => !d.autoKept))
    const cm = confidenceModels(ds as ConfidenceDecision[], lrn)
    const ev = evidenceFrom(td)
    measureBrandTrust(ds)
    measureTwinTrust(td)
    const perBrand = new Map<string, ConfidenceDecision[]>()
    for (const d of ds as ConfidenceDecision[]) if (d.brandName) perBrand.set(d.brandName, [...(perBrand.get(d.brandName) ?? []), d])
    perBrand.forEach((list) => measureBoth(list, DEFAULT_CONFIDENCE))
    annotate(all.filter(banned), lrn, lrn, cm, ev)
    await db.from('brand_watch_queue').select(QUEUE_FIELDS).in('queue_id', all.slice(0, 200).map((r: any) => r.queue_id))
  })

  await timed('NEW click: trust + chip tally + scoped rows, in parallel', async () => {
    const [dec, chips, rows, wb] = await Promise.all([
      paged(db, DECIDED_COLS, ['kept', 'skipped']),
      paged(db, LIGHT_FIELDS, ['queued']),
      paged(db, RANK_FIELDS, ['queued'], (q) => q.in('brand_id', ids)),
      db.from('watched_brand').select('watched_brand_id, brand_id, min_score, confidence_bar'),
    ])
    const ds = decisionsFrom(dec, (wb.data ?? []) as any[])
    const td = twinsFrom(dec)
    const lrn = buildLearning(ds)
    const own = buildLearning(ds.filter((d) => !d.autoKept))
    const cm = confidenceModels(ds as ConfidenceDecision[], own)
    const ev = evidenceFrom(td)
    const counts: Record<string, number> = {}
    for (const r of chips.filter(banned)) counts[r.brand?.name ?? '?'] = (counts[r.brand?.name ?? '?'] ?? 0) + 1
    const live = rows.filter(banned)
    annotate(live, lrn, own, cm, ev)
    await db.from('brand_watch_queue').select(QUEUE_FIELDS).in('queue_id', live.slice(0, 200).map((r: any) => r.queue_id))
  })

  await timed('NEW click with the models already in hand', async () => {
    const [chips, rows] = await Promise.all([
      paged(db, LIGHT_FIELDS, ['queued']),
      paged(db, RANK_FIELDS, ['queued'], (q) => q.in('brand_id', ids)),
    ])
    const counts: Record<string, number> = {}
    for (const r of chips.filter(banned)) counts[r.brand?.name ?? '?'] = (counts[r.brand?.name ?? '?'] ?? 0) + 1
    const live = rows.filter(banned)
    annotate(live, learn, learnOwn, confidence, evidence)
    await db.from('brand_watch_queue').select(QUEUE_FIELDS).in('queue_id', live.slice(0, 200).map((r: any) => r.queue_id))
  })

  const chipCount = chipRows.filter(banned).filter((r: any) => (r.brand?.name ?? '?') === BRAND).length
  console.log(`\nchips ${BRAND}: ${chipCount}; scoped read: ${scoped.filter(banned).length} ${chipCount === scoped.filter(banned).length ? '(match)' : '(MISMATCH)'}`)
  console.log(`queued ${fullRank.length} · lighter tally ${lighter.length} · decisions ${decided.length}`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
