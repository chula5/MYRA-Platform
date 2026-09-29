// DOES HER TASTE IN CLOTHES BEAT HER HISTORY WITH BRANDS?
//
// The whole argument behind re-scoring Brand Watch, put to a measurement rather
// than settled by opinion. Three scorers, the same pieces, the same walk-forward
// split:
//
//   brand history   what the existing model knows — how she has treated this
//                   brand, its colour families and price band before
//   style tags      what the garment actually looks like, against the style
//                   model learned from the pieces she kept and turned down
//   combined        both, blended by a fitted weight rather than a guess
//
// Reading the labels is not the point; the AUC column is. 0.5 is a coin flip.
// Base rate is printed underneath every table, because a scorer that only
// matches "she keeps about 62% of things" is worthless however tidy its number.
//
// This is the decision gate. If style tags on their own do not beat brand
// history, the tagging work stops here and the money was small. If they do, the
// size of the gap is how much the rest of the plan is worth building.
//
//   node_modules/.bin/jiti scripts/brand-watch-fit-eval.ts
//   node_modules/.bin/jiti scripts/brand-watch-fit-eval.ts --split=0.6 --dims

import fs from 'node:fs'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { buildLearning, type DecidedRow } from '../src/lib/brand-watch-learning'
import { confidenceModels, confidenceFromModels } from '../src/lib/brand-watch-confidence'
import {
  fitStyleModel, scoreStyle, styleVector, buildStyleIndex, neighbourStyleScore,
} from '../src/lib/brand-watch-style-fit'
import type { StyleTags } from '../src/lib/brand-watch-tag'

const arg = (n: string): string | undefined =>
  process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=')
const flag = (n: string): boolean => process.argv.includes(`--${n}`)

const TAGS_FILE = path.join(process.cwd(), 'scripts', '.eval', 'tags.json')

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

// ------------------------------------------------------------------ stats

/** Rank-based so ties are handled, same method as the main evaluator. */
function auc(scored: Array<[number, boolean]>): number | null {
  const pos = scored.filter(([, k]) => k).length
  const neg = scored.length - pos
  if (!pos || !neg) return null
  const sorted = [...scored].sort((a, b) => a[0] - b[0])
  const rank = new Map<number, number>()
  for (let i = 0; i < sorted.length;) {
    let j = i
    while (j + 1 < sorted.length && sorted[j + 1][0] === sorted[i][0]) j++
    rank.set(sorted[i][0], (i + j) / 2 + 1)
    i = j + 1
  }
  const sumPos = scored.filter(([, k]) => k).reduce((a, [v]) => a + (rank.get(v) ?? 0), 0)
  return (sumPos - (pos * (pos + 1)) / 2) / (pos * neg)
}

function precisionAtTop(scored: Array<[number, boolean]>, frac: number): number {
  const n = Math.max(1, Math.floor(scored.length * frac))
  const top = [...scored].sort((a, b) => b[0] - a[0]).slice(0, n)
  return top.filter(([, k]) => k).length / top.length
}

const pct = (v: number | null) => (v == null ? ' n/a ' : `${(v * 100).toFixed(1)}%`)

/** Confidence is 0..1; the blend needs it on an unbounded scale. */
const logit = (p: number) => Math.log(Math.max(1e-6, Math.min(1 - 1e-6, p)) / (1 - Math.max(1e-6, Math.min(1 - 1e-6, p))))

/**
 * Two-feature logistic regression, fitted by gradient descent.
 *
 * Deliberately small. With a few hundred pieces a larger model would fit the
 * sample rather than her taste, and the number reported here would stop meaning
 * anything on the next brand. Three parameters can be checked by eye.
 */
function fitBlend(rows: Array<{ brandLogit: number; style: number; kept: boolean }>) {
  let w0 = 0, w1 = 0, w2 = 0
  const lr = 0.5
  for (let step = 0; step < 3000; step++) {
    let g0 = 0, g1 = 0, g2 = 0
    for (const r of rows) {
      const z = w0 + w1 * r.brandLogit + w2 * r.style
      const p = 1 / (1 + Math.exp(-z))
      const err = p - (r.kept ? 1 : 0)
      g0 += err
      g1 += err * r.brandLogit
      g2 += err * r.style
    }
    const n = Math.max(1, rows.length)
    w0 -= (lr * g0) / n
    w1 -= (lr * g1) / n
    w2 -= (lr * g2) / n
  }
  return { w0, w1, w2, apply: (brandLogit: number, style: number) => w0 + w1 * brandLogit + w2 * style }
}

// ------------------------------------------------------------------ data

interface QueueRow {
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
  auto_kept: boolean | null
}

const COLS = 'queue_id, status, discovery_score, product_name, item_type, colour_family, material_category, price, price_gbp, brand_id, skip_reason, decided_at, discovered_at, auto_kept'

const toDecided = (r: QueueRow): DecidedRow => ({
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

async function main() {
  const env = readEnv()
  const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
  if (!fs.existsSync(TAGS_FILE)) throw new Error('no tags — run scripts/tag-queue.ts first')
  const tags: Record<string, { tags: StyleTags; source: string }> = JSON.parse(fs.readFileSync(TAGS_FILE, 'utf8'))
  const ids = Object.keys(tags)
  console.log(`style tags read for ${ids.length} pieces\n`)

  const rows: QueueRow[] = []
  for (let i = 0; i < ids.length; i += 300) {
    const { data, error } = await db.from('brand_watch_queue').select(COLS).in('queue_id', ids.slice(i, i + 300))
    if (error) throw new Error(error.message)
    rows.push(...((data ?? []) as QueueRow[]))
  }

  const usable = rows
    .filter((r) => r.status === 'kept' || r.status === 'skipped')
    .filter((r) => !r.auto_kept)
    .filter((r) => tags[r.queue_id])
    .sort((a, b) => String(a.decided_at ?? a.discovered_at).localeCompare(String(b.decided_at ?? b.discovered_at)))

  if (usable.length < 40) throw new Error(`only ${usable.length} decided pieces are tagged — not enough to split and measure`)
  const splitAt = Number(arg('split') ?? 0.7)
  const cut = Math.floor(usable.length * splitAt)
  const train = usable.slice(0, cut)
  const test = usable.slice(cut)
  if (!train.length || !test.length) throw new Error('not enough decisions to split')

  const keptRate = (l: QueueRow[]) => l.filter((r) => r.status === 'kept').length / l.length
  console.log(`trained on ${train.length} decisions, tested on the ${test.length} after them`)
  console.log(`accepting at random: ${pct(keptRate(train))} on the training half, ${pct(keptRate(test))} on the test half`)

  // ---- the three scorers, all fitted on the past only
  const model = fitStyleModel(train.map((r) => ({ tags: tags[r.queue_id].tags, kept: r.status === 'kept' })))
  const learn = buildLearning(train.map(toDecided))
  const conf = confidenceModels(
    train.map((r) => ({ ...toDecided(r), score: Number(r.discovery_score ?? 0) })),
    learn,
  )

  const brandLogitOf = (r: QueueRow) =>
    logit(confidenceFromModels(conf, learn, toDecided(r), Number(r.discovery_score ?? 0)) ?? 0.5)

  const blend = fitBlend(train.map((r) => ({
    brandLogit: brandLogitOf(r),
    style: scoreStyle(model, tags[r.queue_id].tags).score,
    kept: r.status === 'kept',
  })))

  // The neighbour vote is built from the past too, and only from the past.
  const trainIndex = buildStyleIndex(model, train.map((r) => ({ tags: tags[r.queue_id].tags, kept: r.status === 'kept' })))

  const byBrand: Array<[number, boolean]> = []
  const byStyle: Array<[number, boolean]> = []
  const byKnn: Array<[number, boolean]> = []
  const byBlend: Array<[number, boolean]> = []
  for (const r of test) {
    const k = r.status === 'kept'
    const b = brandLogitOf(r)
    const s = scoreStyle(model, tags[r.queue_id].tags).score
    const kn = neighbourStyleScore(trainIndex, styleVector(model, tags[r.queue_id].tags)).score
    byBrand.push([b, k])
    byStyle.push([s, k])
    byKnn.push([kn, k])
    byBlend.push([blend.apply(b, s), k])
  }

  console.log('\nWALK-FORWARD — scorers on the same held-out decisions\n')
  console.log('  scorer                          AUC    top10%   top25%   top40%   distinct')
  console.log('  ' + '-'.repeat(80))
  for (const [name, scored] of [
    ['existing confidence model', byBrand],
    ['style tags — linear', byStyle],
    ['style tags — neighbour vote', byKnn],
    ['combined (existing + style)', byBlend],
  ] as Array<[string, Array<[number, boolean]>]>) {
    console.log(
      '  ' + name.padEnd(30) +
      (auc(scored)?.toFixed(3) ?? ' n/a ').padStart(5) + '   ' +
      pct(precisionAtTop(scored, 0.1)).padStart(6) + '   ' +
      pct(precisionAtTop(scored, 0.25)).padStart(6) + '   ' +
      pct(precisionAtTop(scored, 0.4)).padStart(6) + '   ' +
      String(new Set(scored.map(([v]) => v)).size).padStart(8),
    )
  }
  console.log('\n  AUC 0.5 = coin flip. Fitted blend weights: ' +
    `brand ${blend.w1.toFixed(3)}, style ${blend.w2.toFixed(3)} ` +
    `(style is ${blend.w2 === 0 ? '—' : (blend.w2 / Math.max(1e-9, Math.abs(blend.w1) + Math.abs(blend.w2)) * 100).toFixed(0)}% of the fitted signal)`)

  // ------------------------------------------------------------------
  // THE MEASUREMENT THAT MATTERS FOR A NEW BRAND
  //
  // Brand history scores 0.647 and style scores 0.508 on the whole test set.
  // That comparison is misleading, and in the direction that flatters brand
  // history. Most of that 0.647 is not insight about a garment — it is the
  // model recognising WHICH BRAND a piece came from and recalling that she
  // tends to like that brand. A brand-level constant cannot rank two pieces
  // from the same brand against each other, and it says nothing at all about a
  // brand that has never been scanned before.
  //
  // So the decisive question is the one asked within a brand: handed forty
  // pieces from one label, can the scorer tell which ones she took? That is
  // exactly the job when a new brand arrives, and it is the only setting where
  // the garment's own looks can possibly help.
  // ------------------------------------------------------------------
  const groups = new Map<string, QueueRow[]>()
  for (const r of test) {
    const b = r.brand_id ?? 'unknown'
    groups.set(b, [...(groups.get(b) ?? []), r])
  }
  const bigEnough = Array.from(groups.entries()).filter(([, l]) => l.length >= 10 && l.some((r) => r.status === 'kept') && l.some((r) => r.status === 'skipped'))

  if (bigEnough.length) {
    const { data: names } = await db.from('brand').select('brand_id, name').in('brand_id', bigEnough.map(([b]) => b))
    const nameOf = new Map((names ?? []).map((b: any) => [b.brand_id, b.name]))

    console.log('\nWITHIN ONE BRAND — which of these did she take? (10+ test pieces, both outcomes present)')
    console.log('  brand                          n   keep%  existing   style  styleKNN')
    console.log('  ' + '-'.repeat(70))
    const sums = { brand: 0, style: 0, knn: 0, weight: 0 }
    for (const [b, list] of bigEnough.sort((a, b2) => b2[1].length - a[1].length)) {
      const rate = list.filter((r) => r.status === 'kept').length / list.length
      const aB = auc(list.map((r) => [brandLogitOf(r), r.status === 'kept']))
      const aS = auc(list.map((r) => [scoreStyle(model, tags[r.queue_id].tags).score, r.status === 'kept']))
      const aK = auc(list.map((r) => [neighbourStyleScore(trainIndex, styleVector(model, tags[r.queue_id].tags)).score, r.status === 'kept']))
      if (aB != null && aS != null && aK != null) {
        sums.brand += aB * list.length
        sums.style += aS * list.length
        sums.knn += aK * list.length
        sums.weight += list.length
      }
      console.log(
        '  ' + String(nameOf.get(b) ?? b).slice(0, 26).padEnd(26) + String(list.length).padStart(4) + '  ' +
        pct(rate).padStart(5) + '   ' +
        (aB?.toFixed(3) ?? ' n/a ').padStart(5) + '   ' + (aS?.toFixed(3) ?? ' n/a ').padStart(5) + '   ' + (aK?.toFixed(3) ?? ' n/a ').padStart(7),
      )
    }
    if (sums.weight) {
      console.log('  ' + '-'.repeat(70))
      console.log(
        '  ' + 'weighted average'.padEnd(26) + String(sums.weight).padStart(4) + '        ' +
        (sums.brand / sums.weight).toFixed(3).padStart(5) + '   ' +
        (sums.style / sums.weight).toFixed(3).padStart(5) + '   ' +
        (sums.knn / sums.weight).toFixed(3).padStart(7),
      )
      console.log('\n  Read the brand column here and compare it with 0.647 above: whatever it')
      console.log('  loses is the part of its power that was only ever brand recognition.')
    }
  }

  // Positive means: high values of this dimension make her more likely to keep.
  console.log('\nWHAT THE MODEL THINKS HER TASTE IS')
  console.log('  dimension            keeps avg   skips avg     pull')
  console.log('  ' + '-'.repeat(54))
  for (const d of model.ranked.slice(0, 20)) {
    const dir = d.weight > 0 ? 'higher = kept' : 'lower  = kept'
    console.log(
      '  ' + d.dimension.padEnd(20) + String(d.keptMean).padStart(9) + String(d.skippedMean).padStart(12) +
      String(d.weight).padStart(9) + '   ' + dir,
    )
  }
  console.log(`  (${model.ranked.length} of ${model.dims.length} dimensions carried signal; the rest looked the same either way)`)

  if (flag('dims')) {
    console.log('\nEVERY DIMENSION')
    for (const d of [...model.dims].sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight))) {
      console.log(
        '  ' + d.dimension.padEnd(20) + String(d.keptMean).padStart(9) + String(d.skippedMean).padStart(12) +
        String(d.weight).padStart(9) + `   keep n=${d.keptN} skip n=${d.skippedN}`,
      )
    }
  }

  if (flag('curve')) {
    // Is more tagging worth buying? Train the style scorer on ever-larger
    // slices of the past and watch the held-out number. If it is still rising
    // at the end, the model is short of examples and more tags will help. If it
    // has gone flat, it has learned what there is to learn from this signal and
    // further tagging is money for nothing.
    //
    // Free to run: reads the tags already bought, calls nothing.
    console.log('\nLEARNING CURVE — does more tagged data keep helping?\n')
    console.log('  train pieces   style linear   style neighbour vote')
    console.log('  ' + '-'.repeat(50))
    for (const frac of [0.25, 0.5, 0.75, 1]) {
      const n = Math.max(30, Math.floor(train.length * frac))
      const sub = train.slice(0, n)
      const m = fitStyleModel(sub.map((r) => ({ tags: tags[r.queue_id].tags, kept: r.status === 'kept' })))
      const vecs = buildStyleIndex(m, sub.map((r) => ({ tags: tags[r.queue_id].tags, kept: r.status === 'kept' })))
      const lin = auc(test.map((r) => [scoreStyle(m, tags[r.queue_id].tags).score, r.status === 'kept']))
      const knn = auc(test.map((r) => [neighbourStyleScore(vecs, styleVector(m, tags[r.queue_id].tags)).score, r.status === 'kept']))
      console.log(
        '  ' + String(n).padStart(12) + '   ' + (lin?.toFixed(3) ?? ' n/a ').padStart(12) + '   ' + (knn?.toFixed(3) ?? ' n/a ').padStart(19),
      )
    }
    console.log(`\n  test set is all ${test.length} pieces every time, so the columns are comparable.`)
  }

  if (flag('cold')) {
    // ------------------------------------------------------------------
    // THE COLD-BRAND CASE — the reason any of this is being built
    //
    // The headline table flatters brand history, because most test pieces come
    // from brands she has already judged dozens of times: the model recognises
    // the label and recalls her habit. That is worth nothing when a NEW brand is
    // added, which is exactly the scenario she wants scoring to help with.
    //
    // So: take only the test pieces whose brand had little or no history to
    // learn from, and score those again. Here brand history is mostly falling
    // back on its prior, and whatever the garment's own looks can contribute
    // has to carry the number.
    // ------------------------------------------------------------------
    const historyOf = new Map<string, number>()
    for (const r of train) historyOf.set(r.brand_id ?? '?', (historyOf.get(r.brand_id ?? '?') ?? 0) + 1)

    for (const cap of [0, 3, 10]) {
      const cold = test.filter((r) => (historyOf.get(r.brand_id ?? '?') ?? 0) <= cap)
      if (cold.length < 30) { console.log(`\nCOLD BRANDS (<= ${cap} prior decisions): only ${cold.length} test pieces — too few to measure`); continue }
      const rate = cold.filter((r) => r.status === 'kept').length / cold.length
      const aB = auc(cold.map((r) => [brandLogitOf(r), r.status === 'kept']))
      const aS = auc(cold.map((r) => [scoreStyle(model, tags[r.queue_id].tags).score, r.status === 'kept']))
      const aK = auc(cold.map((r) => [neighbourStyleScore(trainIndex, styleVector(model, tags[r.queue_id].tags)).score, r.status === 'kept']))
      console.log(`\nCOLD BRANDS (<= ${cap} prior decisions) — ${cold.length} test pieces, she kept ${pct(rate)}`)
      console.log(`  existing model ${(aB?.toFixed(3) ?? ' n/a ').padStart(5)}    style linear ${(aS?.toFixed(3) ?? ' n/a ').padStart(5)}    style neighbour vote ${(aK?.toFixed(3) ?? ' n/a ').padStart(5)}`)
    }

    // Precision matters more than AUC for automation: what would auto-accepting
    // the best slice of a cold brand actually have been right about?
    const coldAll = test.filter((r) => (historyOf.get(r.brand_id ?? '?') ?? 0) === 0)
    if (coldAll.length >= 30) {
      console.log('\nIF AUTO-ACCEPT RAN ON A BRAND WITH NO HISTORY')
      for (const [name, fn] of [
        ['existing model', (r: QueueRow) => brandLogitOf(r)],
        ['style neighbour vote', (r: QueueRow) => neighbourStyleScore(trainIndex, styleVector(model, tags[r.queue_id].tags)).score],
      ] as Array<[string, (r: QueueRow) => number]>) {
        const scored = coldAll.map((r) => [fn(r), r.status === 'kept'] as [number, boolean])
        console.log(
          `  ${name.padEnd(22)} top10% ${pct(precisionAtTop(scored, 0.1)).padStart(6)}   top25% ${pct(precisionAtTop(scored, 0.25)).padStart(6)}   (taking none is ${pct(coldAll.filter((r) => r.status === 'kept').length / coldAll.length)})`,
        )
      }
    }
  }

  console.log('')
}

main().catch((err) => { console.error('\n' + (err instanceof Error ? err.message : String(err))); process.exit(1) })
