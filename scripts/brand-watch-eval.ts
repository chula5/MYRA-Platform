// DOES THE CONFIDENCE NUMBER MEAN ANYTHING?
//
// Every change to Brand Watch scoring is judged here before it is trusted. The
// test is the honest one: train on the decisions Chloe had already made, then
// predict the ones she made AFTER them. A model that looks brilliant on the
// decisions it was fitted on tells you nothing.
//
// It imports the real modules — not a copy of the maths — so what this reports
// is what the queue actually shows.
//
//   node_modules/.bin/jiti scripts/brand-watch-eval.ts
//   node_modules/.bin/jiti scripts/brand-watch-eval.ts --save=baseline
//   node_modules/.bin/jiti scripts/brand-watch-eval.ts --compare=baseline
//
// Read AUC first: 0.5 is a coin flip, and precision at the top slice is what
// auto-accept would actually have been right about.

import fs from 'node:fs'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { buildLearning, type DecidedRow } from '../src/lib/brand-watch-learning'
import { confidenceModels, confidenceFromModels, carefulTraining } from '../src/lib/brand-watch-confidence'

// ---------------------------------------------------------------- setup

function readEnv(): Record<string, string> {
  const out: Record<string, string> = {}
  const file = path.join(process.cwd(), '.env.local')
  if (!fs.existsSync(file)) return out
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
  }
  return out
}

const arg = (name: string): string | undefined =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=')

const SNAPSHOT_DIR = path.join(process.cwd(), 'scripts', '.eval')

// ---------------------------------------------------------------- stats

/**
 * Area under the ROC curve, by ranks so ties are handled properly — which
 * matters more than usual here, because the scorer this replaced put half the
 * queue on one number and ties silently flatter a model that cannot separate.
 */
export function auc(scored: Array<[number, boolean]>): number | null {
  const pos = scored.filter(([, k]) => k).length
  const neg = scored.length - pos
  if (!pos || !neg) return null
  const sorted = [...scored].sort((a, b) => a[0] - b[0])
  const rank = new Map<number, number>()
  for (let i = 0; i < sorted.length;) {
    let j = i
    while (j + 1 < sorted.length && sorted[j + 1][0] === sorted[i][0]) j++
    const avg = (i + j) / 2 + 1 // 1-based, averaged across the tie
    rank.set(sorted[i][0], avg)
    i = j + 1
  }
  const sumPos = scored.filter(([, k]) => k).reduce((a, [v]) => a + (rank.get(v) ?? 0), 0)
  return (sumPos - (pos * (pos + 1)) / 2) / (pos * neg)
}

/** Precision over the top slice — what auto-accepting that fraction would have got right. */
function precisionAtTop(scored: Array<[number, boolean]>, frac: number): { precision: number; n: number } {
  const n = Math.max(1, Math.floor(scored.length * frac))
  const top = [...scored].sort((a, b) => b[0] - a[0]).slice(0, n)
  return { precision: top.filter(([, k]) => k).length / top.length, n }
}

/** The largest group of pieces sharing one score — the model's blind spot. */
function biggestTie(scored: Array<[number, boolean]>): { size: number; value: number } {
  const counts = new Map<number, number>()
  for (const [v] of scored) counts.set(v, (counts.get(v) ?? 0) + 1)
  let size = 0, value = 0
  counts.forEach((n, v) => { if (n > size) { size = n; value = v } })
  return { size, value }
}

/** When it says 80%, is it right 80% of the time? Only meaningful for 0..1 scorers. */
function calibration(scored: Array<[number, boolean]>): Array<{ band: string; n: number; said: number; was: number }> {
  const buckets = new Map<number, Array<[number, boolean]>>()
  for (const s of scored) {
    const b = Math.min(9, Math.floor(s[0] * 10))
    buckets.set(b, [...(buckets.get(b) ?? []), s])
  }
  return Array.from(buckets.keys()).sort((a, b) => a - b).map((b) => {
    const list = buckets.get(b)!
    return {
      band: `${b * 10}-${b * 10 + 9}%`,
      n: list.length,
      said: list.reduce((a, [v]) => a + v, 0) / list.length,
      was: list.filter(([, k]) => k).length / list.length,
    }
  })
}

const pct = (v: number | null | undefined, dp = 1) => (v == null ? '   n/a' : (v * 100).toFixed(dp) + '%')

/**
 * The lowest bar that still hits `target` precision, and how much of the queue
 * it would take. This is how AUTO_KEEP_DELTA and the confidence bar get set —
 * from her decisions, rather than from a number that felt about right.
 *
 * Walks candidate thresholds from the top down, so it finds the most generous
 * bar that holds, not merely the first one that does.
 */
function barFor(
  scored: Array<[number, boolean]>,
  target: number,
  minTaken = 25,
): { bar: number; precision: number; taken: number; coverage: number } | null {
  const desc = [...scored].sort((a, b) => b[0] - a[0])
  let right = 0
  let best: { bar: number; precision: number; taken: number; coverage: number } | null = null
  for (let i = 0; i < desc.length; i++) {
    if (desc[i][1]) right++
    const taken = i + 1
    // Only judge at a boundary between distinct scores — a bar inside a tie
    // group cannot actually be applied.
    if (i + 1 < desc.length && desc[i + 1][0] === desc[i][0]) continue
    if (taken < minTaken) continue
    const precision = right / taken
    if (precision >= target) best = { bar: desc[i][0], precision, taken, coverage: taken / scored.length }
  }
  return best
}

// ---------------------------------------------------------------- data

interface Row {
  queue_id: string
  status: string
  discovery_score: number | null
  product_name: string | null
  item_type: string | null
  colour_family: string | null
  material_category: string | null
  price: string | null
  price_gbp: number | null
  brand_id: string | null
  skip_reason: string | null
  decided_at: string | null
  discovered_at: string | null
}

const COLS = 'queue_id, status, discovery_score, product_name, item_type, colour_family, material_category, price, price_gbp, brand_id, skip_reason, decided_at, discovered_at, auto_kept'

// `any` on purpose: the generated Supabase types resolve every table to `never`
// in a plain script context, which is the same noise check-types.mjs exists to
// ignore. This is a read-only evaluator, not shipped code.
async function loadDecided(db: any): Promise<Array<Row & { auto_kept?: boolean }>> {
  const out: any[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from('brand_watch_queue')
      .select(COLS)
      .in('status', ['kept', 'skipped'])
      .order('queue_id')
      .range(from, from + 999)
    if (error) throw new Error(error.message)
    out.push(...(data ?? []))
    if (!data || data.length < 1000) break
  }
  return out
}

/** The learning's view of a decided row. Brand is keyed by id, exactly as production does. */
const toDecided = (r: Row): DecidedRow => ({
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

// ---------------------------------------------------------------- report

interface ScorerReport {
  name: string
  auc: number | null
  distinct: number
  tieSize: number
  top10: number
  top25: number
  top40: number
}

interface Snapshot {
  at: string
  train: number
  test: number
  baseRate: number
  scorers: ScorerReport[]
  /** The same scorers, judged only on decisions she made one at a time. */
  scorersCareful?: ScorerReport[]
  /** Decision-weighted mean of the per-brand AUC, on careful decisions. */
  brandAuc?: number | null
  carefulTest?: number
}

/**
 * More decisions than this inside one second is a bulk action — KEEP ALL, or a
 * season retirement — not a judgement about any one piece. A model cannot be
 * judged on predicting a button press, so the careful readings below are
 * scored only on these. What the models are FITTED on is carefulTraining,
 * imported rather than copied, so the evaluator trains exactly as the queue
 * does: bulk skips dropped, bulk keeps kept.
 */
const BULK_PER_SECOND = 3
function carefulOnly<T extends { decided_at: string | null; discovered_at: string | null }>(rows: T[]): T[] {
  const at = (r: T) => String(r.decided_at ?? r.discovered_at ?? '').slice(0, 19)
  const perSecond = new Map<string, number>()
  for (const r of rows) perSecond.set(at(r), (perSecond.get(at(r)) ?? 0) + 1)
  return rows.filter((r) => (perSecond.get(at(r)) ?? 0) <= BULK_PER_SECOND)
}

/**
 * Mean per-brand AUC, weighted by how many decisions each brand contributed.
 * The headline AUC pools every brand together, which judges a per-brand
 * calibrated model on a question it never answers: it is asked "would she keep
 * THIS, at THIS brand", never "is this Róhe piece better than that RIXO one".
 */
function brandWeightedAuc(byBrand: Map<string, Array<[number, boolean]>>, minN = 20): { auc: number | null; brands: number; n: number } {
  let weighted = 0, n = 0, brands = 0
  byBrand.forEach((list) => {
    if (list.length < minN) return
    const a = auc(list)
    if (a == null) return // one-sided: nothing to separate
    weighted += a * list.length; n += list.length; brands++
  })
  return { auc: n ? weighted / n : null, brands, n }
}

function evaluate(name: string, scored: Array<[number, boolean]>): ScorerReport {
  return {
    name,
    auc: auc(scored),
    distinct: new Set(scored.map(([v]) => v)).size,
    tieSize: biggestTie(scored).size,
    top10: precisionAtTop(scored, 0.1).precision,
    top25: precisionAtTop(scored, 0.25).precision,
    top40: precisionAtTop(scored, 0.4).precision,
  }
}

async function main() {
  const env = readEnv()
  const url = env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be in .env.local')
  const db = createClient(url, key, { auth: { persistSession: false } })

  const splitAt = Number(arg('split') ?? 0.7)
  const rows = (await loadDecided(db))
    .filter((r) => r.decided_at || r.discovered_at)
    // The machine's own keeps are never evidence: a model proving itself right
    // proves nothing.
    .filter((r) => !r.auto_kept)
    .sort((a, b) =>
      String(a.decided_at ?? a.discovered_at).localeCompare(String(b.decided_at ?? b.discovered_at)))

  const cut = Math.floor(rows.length * splitAt)
  const train = rows.slice(0, cut)
  const test = rows.slice(cut)
  if (!train.length || !test.length) throw new Error('not enough decisions to split')

  const baseRate = test.filter((r) => r.status === 'kept').length / test.length

  // Fitted on the past only, and exactly as loadQueueTrust fits the live
  // models — carefulTraining, imported rather than copied, so this measures
  // the models the queue actually shows. A bulk skip is dropped; a bulk KEEP
  // stays, because it is still her saying yes.
  const trainFitted = carefulTraining(train.map((r) => ({
    ...r,
    at: String(r.decided_at ?? r.discovered_at ?? ''),
    autoKept: !!r.auto_kept,
    kept: r.status === 'kept',
  })))
  const learn = buildLearning(trainFitted.map(toDecided))
  const models = confidenceModels(
    trainFitted.map((r) => ({ ...toDecided(r), score: Number(r.discovery_score ?? 0) })),
    learn,
  )

  // The same models with the house-style score held at zero, so its feature has
  // no variance and contributes nothing. This is how we tell whether the
  // 7-point keyword score is earning its place or just adding noise, without
  // guessing at it.
  const blindModels = confidenceModels(trainFitted.map((r) => ({ ...toDecided(r), score: 0 })), learn)

  const kept = (r: Row) => r.status === 'kept'
  const score = (r: Row) => Number(r.discovery_score ?? 0)
  /** Every scorer's reading of one set of decisions. */
  const readingsOf = (list: Row[]) => ({
    byScore: list.map((r) => [score(r), kept(r)] as [number, boolean]),
    byDelta: list.map((r) => [learn(toDecided(r)).delta, kept(r)] as [number, boolean]),
    byConfidence: list.map((r) => [confidenceFromModels(models, learn, toDecided(r), score(r)) ?? 0, kept(r)] as [number, boolean]),
    byConfidenceNoScore: list.map((r) => [confidenceFromModels(blindModels, learn, toDecided(r), 0) ?? 0, kept(r)] as [number, boolean]),
  })
  const all = readingsOf(test)
  const { byScore, byDelta, byConfidence, byConfidenceNoScore } = all

  const testCareful = carefulOnly(test)
  const careful = readingsOf(testCareful)
  const scorersOf = (r: ReturnType<typeof readingsOf>) => [
    evaluate('house-style score', r.byScore),
    evaluate('learned delta', r.byDelta),
    evaluate('confidence (shown on the card)', r.byConfidence),
    evaluate('confidence, no house score', r.byConfidenceNoScore),
  ]

  // Per brand, on her one-at-a-time decisions — the question the model is
  // actually asked, and the one the pooled AUC cannot see.
  const perBrandCareful = new Map<string, Array<[number, boolean]>>()
  testCareful.forEach((r, i) => {
    if (!r.brand_id) return
    perBrandCareful.set(r.brand_id, [...(perBrandCareful.get(r.brand_id) ?? []), careful.byConfidence[i]])
  })
  const brandAuc = brandWeightedAuc(perBrandCareful)

  const snapshot: Snapshot = {
    at: new Date().toISOString(),
    train: train.length,
    test: test.length,
    baseRate,
    scorers: scorersOf(all),
    scorersCareful: scorersOf(careful),
    brandAuc: brandAuc.auc,
    carefulTest: testCareful.length,
  }

  // ---- print
  console.log(`\nBRAND WATCH SCORING — trained on ${trainFitted.length} of ${train.length} decisions (bulk skips dropped), tested on the ${test.length} that came after`)
  console.log(`accepting at random would be right ${pct(baseRate)} of the time\n`)
  console.log('  scorer                            AUC    top10%   top25%   top40%   distinct  biggest tie')
  console.log('  ' + '-'.repeat(92))
  for (const s of snapshot.scorers) {
    console.log(
      '  ' + s.name.padEnd(32) +
      (s.auc == null ? '  n/a' : s.auc.toFixed(3)).padStart(5) + '   ' +
      pct(s.top10).padStart(6) + '   ' + pct(s.top25).padStart(6) + '   ' + pct(s.top40).padStart(6) + '   ' +
      String(s.distinct).padStart(8) + '   ' + String(s.tieSize).padStart(11),
    )
  }
  console.log('\n  AUC 0.5 = coin flip. top10% = precision if auto-accept took the best tenth.')
  console.log(`  Anything at or below ${pct(baseRate)} is no better than accepting blindly.`)

  const carefulRate = testCareful.filter(kept).length / (testCareful.length || 1)
  console.log(`\nHER ONE-AT-A-TIME DECISIONS ONLY — ${testCareful.length} of ${test.length}, kept ${pct(carefulRate)}`)
  console.log('  (KEEP ALL and season retirements removed: a model cannot be judged on predicting a button press)\n')
  console.log('  scorer                            AUC    top10%   top25%   top40%   distinct  biggest tie')
  console.log('  ' + '-'.repeat(92))
  for (const s of snapshot.scorersCareful ?? []) {
    console.log(
      '  ' + s.name.padEnd(32) +
      (s.auc == null ? '  n/a' : s.auc.toFixed(3)).padStart(5) + '   ' +
      pct(s.top10).padStart(6) + '   ' + pct(s.top25).padStart(6) + '   ' + pct(s.top40).padStart(6) + '   ' +
      String(s.distinct).padStart(8) + '   ' + String(s.tieSize).padStart(11),
    )
  }
  console.log(`\n  WITHIN A BRAND, confidence AUC ${brandAuc.auc == null ? 'n/a' : brandAuc.auc.toFixed(3)}` +
    ` — ${brandAuc.brands} brands, ${brandAuc.n} careful decisions, weighted by size.`)
  console.log('  This is the question the queue actually asks, so judge a change on this line first.')

  console.log('\nWHERE AUTO-ACCEPT COULD SAFELY SIT')
  console.log('  scorer                          target    bar     precision   would take')
  console.log('  ' + '-'.repeat(72))
  for (const [name, scored] of [
    ['learned delta', byDelta],
    ['confidence', byConfidence],
  ] as Array<[string, Array<[number, boolean]>]>) {
    for (const target of [0.9, 0.95]) {
      const b = barFor(scored, target)
      console.log(
        '  ' + name.padEnd(30) + pct(target, 0).padStart(6) + '   ' +
        (b ? b.bar.toFixed(3).padStart(6) : '  none') + '   ' +
        (b ? pct(b.precision).padStart(8) : '     n/a') + '   ' +
        (b ? `${b.taken} pieces, ${pct(b.coverage, 0)} of the queue` : 'nothing clears it'),
      )
    }
  }

  console.log('\nCALIBRATION — when it says this, how often was it right?')
  console.log('  band        pieces    it said    it was')
  console.log('  ' + '-'.repeat(44))
  for (const c of calibration(byConfidence)) {
    console.log('  ' + c.band.padEnd(10) + String(c.n).padStart(6) + '    ' + pct(c.said).padStart(7) + '   ' + pct(c.was).padStart(7))
  }

  // Per brand, where there is enough of a test set to say anything.
  const perBrand = new Map<string, Array<[number, boolean]>>()
  test.forEach((r, i) => {
    if (!r.brand_id) return
    perBrand.set(r.brand_id, [...(perBrand.get(r.brand_id) ?? []), byConfidence[i]])
  })
  const brands = Array.from(perBrand.entries()).filter(([, l]) => l.length >= 40)
  if (brands.length) {
    const { data: names } = await db.from('brand').select('brand_id, name').in('brand_id', brands.map(([b]) => b))
    const nameOf = new Map((names ?? []).map((b: any) => [b.brand_id, b.name]))
    console.log('\nPER BRAND (40+ test decisions)')
    console.log('  brand                        n     keep%     AUC   top25%')
    console.log('  ' + '-'.repeat(58))
    for (const [id, list] of brands.sort((a, b) => b[1].length - a[1].length)) {
      const rate = list.filter(([, k]) => k).length / list.length
      const a = auc(list)
      console.log(
        '  ' + String(nameOf.get(id) ?? id).slice(0, 26).padEnd(26) +
        String(list.length).padStart(5) + '   ' + pct(rate).padStart(6) + '   ' +
        (a == null ? '  n/a' : a.toFixed(3)).padStart(5) + '   ' + pct(precisionAtTop(list, 0.25).precision).padStart(6),
      )
    }
  }

  // ---- save / compare
  const save = arg('save')
  if (save) {
    fs.mkdirSync(SNAPSHOT_DIR, { recursive: true })
    fs.writeFileSync(path.join(SNAPSHOT_DIR, `${save}.json`), JSON.stringify(snapshot, null, 2))
    console.log(`\nsaved as "${save}"`)
  }
  const compare = arg('compare')
  if (compare) {
    const file = path.join(SNAPSHOT_DIR, `${compare}.json`)
    if (!fs.existsSync(file)) {
      console.log(`\nno snapshot called "${compare}" to compare against`)
    } else {
      const before: Snapshot = JSON.parse(fs.readFileSync(file, 'utf8'))
      console.log(`\nAGAINST "${compare}" (${before.at.slice(0, 16).replace('T', ' ')})`)
      console.log('  scorer                              AUC                    top10%                  top25%')
      console.log('  ' + '-'.repeat(92))
      /** "0.601 → 0.654  +0.053", padded to one column. */
      const shift = (now: number | null, was: number | null, isPct: boolean): string => {
        const fmt = (v: number | null) => (v == null ? 'n/a' : isPct ? (v * 100).toFixed(1) + '%' : v.toFixed(3))
        if (now == null || was == null) return `${fmt(was)} → ${fmt(now)}`.padEnd(23)
        const diff = isPct ? (now - was) * 100 : now - was
        const sign = diff >= 0 ? '+' : ''
        return `${fmt(was)} → ${fmt(now)}`.padEnd(17) + `${sign}${diff.toFixed(isPct ? 1 : 3)}${isPct ? 'pp' : ''}`.padEnd(6)
      }
      for (const now of snapshot.scorers) {
        const was = before.scorers.find((s) => s.name === now.name)
        if (!was) continue
        console.log('  ' + now.name.padEnd(32) +
          shift(now.auc, was.auc, false) + '  ' +
          shift(now.top10, was.top10, true) + '  ' +
          shift(now.top25, was.top25, true))
      }
      if (before.scorersCareful && snapshot.scorersCareful) {
        console.log('\n  ON HER ONE-AT-A-TIME DECISIONS')
        console.log('  ' + '-'.repeat(92))
        for (const now of snapshot.scorersCareful) {
          const was = before.scorersCareful.find((s) => s.name === now.name)
          if (!was) continue
          console.log('  ' + now.name.padEnd(32) +
            shift(now.auc, was.auc, false) + '  ' +
            shift(now.top10, was.top10, true) + '  ' +
            shift(now.top25, was.top25, true))
        }
      }
      if (before.brandAuc != null || snapshot.brandAuc != null) {
        console.log('\n  ' + 'WITHIN A BRAND (the line that matters)'.padEnd(32) + shift(snapshot.brandAuc ?? null, before.brandAuc ?? null, false))
      }
    }
  }
  console.log('')
}

main().catch((err) => { console.error(err instanceof Error ? err.message : err); process.exit(1) })
