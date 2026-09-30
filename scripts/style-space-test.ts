// IS MY FEATURE SET THE BOTTLENECK, OR YOUR TASTE?
//
// The construction dimensions scored 0.550 — barely above a coin flip. Chloe's
// answer to that was direct: her skips are "mainly because I do not like the
// style of the item". If that is true, then a style model SHOULD be able to
// predict them, and the failure lies in the seventeen dimensions rather than in
// the idea. Those dimensions describe how a garment is MADE — rise, shoulder,
// leg opening, sleeve. "Style", as she means it, is about how a garment LOOKS.
//
// So this tests a different representation. Instead of asking the model to rate
// seventeen fixed axes, it is asked to describe the piece's look in its own
// words, and those words are then turned into an embedding. A piece's nearest
// neighbours in that space are the pieces it most resembles, and the question
// becomes whether resemblance predicts her decision.
//
// This is a fair test of the hypothesis and not a foregone one. If the
// embedding space also lands near 0.5, then at this granularity her decisions
// are not separable by the look of a garment, and the honest answer is that the
// signal is elsewhere — in season, in the brand, or in something not on the
// product page at all.
//
//   node_modules/.bin/jiti scripts/style-space-test.ts --n=1200
//   node_modules/.bin/jiti scripts/style-space-test.ts --n=1200 --concurrency=8

import fs from 'node:fs'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { fitStyleModel, styleVector, buildStyleIndex, neighbourStyleScore } from '../src/lib/brand-watch-style-fit'
import { PHRASE_PROMPT, describeStyle, embedPhrases } from '../src/lib/brand-watch-tag'
import type { StyleTags } from '../src/lib/brand-watch-tag'
import { buildLearning, type DecidedRow } from '../src/lib/brand-watch-learning'
import { confidenceModels, confidenceFromModels } from '../src/lib/brand-watch-confidence'

const arg = (n: string): string | undefined =>
  process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=')
const flag = (n: string): boolean => process.argv.includes(`--${n}`)

const TAGS_FILE = path.join(process.cwd(), 'scripts', '.eval', 'tags.json')
// Versioned, because the prompt changed: phrases written by the old wording
// described the shoot rather than the garment and must never be mixed with the
// new ones, or a measurement would silently blend the two.
const OUT_FILE = path.join(process.cwd(), 'scripts', '.eval', 'style-phrases-v2.json')

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

/**
 * The prompt asks for how it LOOKS and explicitly not what it is made of, which
 * is the distinction the construction dimensions collapsed. Brand names are
 * excluded because a descriptor containing "Mos Mosh" would let the embedding
 * recognise the label, and the point is to test the garment.
 *
 * The prompt and the readers come from brand-watch-tag rather than being
 * restated here: an evaluator that paraphrases production drifts from it, and
 * this one already had — it was still sending the old wording, which described
 * the shoot instead of the garment, long after the module was fixed.
 */

interface PhraseResult { phrase: string; ok: boolean; error?: string }

/** One description, through the same reader production uses. */
async function phraseFor(_key: string, imageUrl: string): Promise<PhraseResult> {
  const out = await describeStyle(imageUrl)
  return out.phrase ? { phrase: out.phrase, ok: true } : { phrase: '', ok: false, error: out.error }
}

/** Batched through the same embedder production uses. */
async function embed(_key: string, texts: string[]): Promise<number[][]> {
  const { vectors, error } = await embedPhrases(texts)
  if (error && vectors.length !== texts.length) throw new Error(`embeddings failed: ${error}`)
  return vectors
}

const cosine = (a: number[], b: number[]) => {
  let dot = 0, na = 0, nb = 0
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i] }
  return na && nb ? dot / Math.sqrt(na * nb) : 0
}

/** Rank-based AUC, ties handled. Same method as every other evaluator here. */
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

const pct = (v: number | null) => (v == null ? ' n/a ' : `${(v * 100).toFixed(1)}%`)

async function main() {
  const env = readEnv()
  const key = env.OPENAI_API_KEY
  if (!key) throw new Error('OPENAI_API_KEY must be in .env.local')
  // The readers read process.env at call time, so reading the file is not
  // enough. Without this every call returns "not configured" and the run
  // reports a clean zero, which is the worst kind of wrong answer.
  process.env.OPENAI_API_KEY = key
  const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

  const tags: Record<string, { tags: StyleTags; source: string }> = JSON.parse(fs.readFileSync(TAGS_FILE, 'utf8'))
  const ids = Object.keys(tags)

  // The rows behind the tags already bought, so this experiment adds only the
  // phrase and the embedding — it re-buys nothing that has been paid for.
  const rows: any[] = []
  for (let i = 0; i < ids.length; i += 300) {
    const { data, error } = await db.from('brand_watch_queue')
      .select('queue_id, status, brand_id, image_url, item_type, product_name, decided_at, discovered_at, colour_family, material_category, price, price_gbp, skip_reason, discovery_score, auto_kept')
      .in('queue_id', ids.slice(i, i + 300))
    if (error) throw new Error(error.message)
    rows.push(...(data ?? []))
  }

  const usable = rows
    .filter((r) => r.status === 'kept' || r.status === 'skipped')
    .filter((r) => r.image_url)
    .sort((a, b) => String(a.decided_at ?? a.discovered_at).localeCompare(String(b.decided_at ?? b.discovered_at)))

  const N = Math.min(Number(arg('n') ?? 1200), usable.length)
  // Stratified by brand, so one prolific label cannot dominate the result.
  const byBrand = new Map<string, any[]>()
  for (const r of usable) byBrand.set(r.brand_id, [...(byBrand.get(r.brand_id) ?? []), r])
  const queues = Array.from(byBrand.values())
  const sample: any[] = []
  for (let i = 0; sample.length < N; i++) {
    let took = false
    for (const q of queues) { if (i < q.length && sample.length < N) { sample.push(q[i]); took = true } }
    if (!took) break
  }
  const keptN = sample.filter((r) => r.status === 'kept').length
  console.log(`${usable.length} decided pieces available; sampling ${sample.length} (${keptN} kept / ${sample.length - keptN} skipped)\n`)

  interface StoredPhrase { phrase: string; brand_id: string; kept: boolean; embedding?: number[] }
  const store: Record<string, StoredPhrase> = fs.existsSync(OUT_FILE) ? JSON.parse(fs.readFileSync(OUT_FILE, 'utf8')) : {}
  const todo = sample.filter((r) => !store[r.queue_id])
  const CONC = Number(arg('concurrency') ?? 8)
  if (todo.length) console.log(`writing style phrases for ${todo.length} pieces (${sample.length - todo.length} cached)…`)
  let failed = 0
  for (let i = 0; i < todo.length; i += CONC) {
    const chunk = todo.slice(i, i + CONC)
    const done = await Promise.all(chunk.map(async (r) => ({ r, out: await phraseFor(key, r.image_url) })))
    for (const { r, out } of done) {
      if (!out.ok) { failed++; continue }
      store[r.queue_id] = { phrase: out.phrase, brand_id: r.brand_id, kept: r.status === 'kept' }
    }
    fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true })
    fs.writeFileSync(OUT_FILE, JSON.stringify(store))
    process.stdout.write(`\r  ${Math.min(i + CONC, todo.length)}/${todo.length}   `)
  }
  if (todo.length) console.log(`\n  ${failed} could not be described\n`)

  const withPhrase = sample.filter((r) => store[r.queue_id]?.phrase)
  if (withPhrase.length < 100) throw new Error(`only ${withPhrase.length} phrases — too few to measure`)
  console.log(`measuring on ${withPhrase.length} pieces with a style phrase\n`)

  console.log('  example phrases:')
  for (const r of withPhrase.slice(0, 4)) console.log(`    · ${store[r.queue_id].phrase}`)

  // Embedded once and kept, so a rerun of the analysis costs nothing at all.
  const needVec = withPhrase.filter((r) => !store[r.queue_id].embedding?.length)
  if (needVec.length) {
    process.stdout.write(`  embedding ${needVec.length} phrases…              \r`)
    const vectors = await embed(key, needVec.map((r) => store[r.queue_id].phrase))
    if (vectors.length !== needVec.length) throw new Error(`embedded ${vectors.length} of ${needVec.length}`)
    needVec.forEach((r, i) => { store[r.queue_id].embedding = vectors[i] })
    fs.writeFileSync(OUT_FILE, JSON.stringify(store))
  }
  const vecOfAll = new Map(withPhrase.map((r) => [r.queue_id, store[r.queue_id].embedding as number[]]))

  if (flag('phrases')) {
    console.log('\n  random sample:')
    for (let i = 0; i < withPhrase.length; i += Math.max(1, Math.floor(withPhrase.length / 15))) {
      console.log(`    [${withPhrase[i].status.padEnd(7)}] ${store[withPhrase[i].queue_id].phrase}`)
    }
  }

  // Chronological split, matching every other evaluator: learn from the past,
  // predict what came after.
  const cut = Math.floor(withPhrase.length * Number(arg('split') ?? 0.7))
  const train = withPhrase.slice(0, cut)
  const test = withPhrase.slice(cut)
  const vecOf = vecOfAll

  // ---- scorer 1: construction dimensions, the existing representation
  const dimModel = fitStyleModel(train.map((r) => ({ tags: tags[r.queue_id].tags, kept: r.status === 'kept' })))
  const dimIndex = buildStyleIndex(dimModel, train.map((r) => ({ tags: tags[r.queue_id].tags, kept: r.status === 'kept' })))
  const byDims = test.map((r) => [
    neighbourStyleScore(dimIndex, styleVector(dimModel, tags[r.queue_id].tags)).score,
    r.status === 'kept',
  ] as [number, boolean])

  // ---- scorer 2: the phrase embeddings, the holistic look
  const embIndex = train.map((r) => ({ vec: vecOf.get(r.queue_id)!, kept: r.status === 'kept' }))
  const byPhrase = test.map((r) => {
    const q = vecOf.get(r.queue_id)!
    const nearest = embIndex
      .map((e) => ({ sim: cosine(q, e.vec), kept: e.kept }))
      .sort((a, b) => b.sim - a.sim)
      .slice(0, 20)
    let w = 0, kept = 0
    for (const n of nearest) {
      // Same shape of vote as the dimension scorer, so the two are comparable.
      const weight = Math.max(0, n.sim) ** 4
      w += weight
      if (n.kept) kept += weight
    }
    return [w ? kept / w : 0.5, r.status === 'kept'] as [number, boolean]
  })

  // ---- scorer 3: both together
  const byBoth = test.map((r, i) => [
    byDims[i][0] * 0.4 + byPhrase[i][0] * 0.6,
    r.status === 'kept',
  ] as [number, boolean])

  console.log('\nWALK-FORWARD — the look of the garment against her decision\n')
  console.log('  representation                            AUC    top25%   top40%')
  console.log('  ' + '-'.repeat(64))
  const prec = (l: Array<[number, boolean]>, f: number) => {
    const n = Math.max(1, Math.floor(l.length * f))
    return l.slice().sort((a, b) => b[0] - a[0]).slice(0, n).filter(([, k]) => k).length / n
  }
  for (const [name, scored] of [
    ['17 construction dimensions', byDims],
    ['style phrase embeddings', byPhrase],
    ['both', byBoth],
  ] as Array<[string, Array<[number, boolean]>]>) {
    console.log(
      '  ' + name.padEnd(42) + (auc(scored)?.toFixed(3) ?? ' n/a ').padStart(5) + '   ' +
      pct(prec(scored, 0.25)).padStart(6) + '   ' + pct(prec(scored, 0.4)).padStart(6),
    )
  }
  const baseRate = test.filter((r) => r.status === 'kept').length / test.length
  console.log(`\n  base rate on the test half: ${pct(baseRate)}  (a scorer must beat this, not 0.5)`)

  // ------------------------------------------------------------------
  // THE HEAD-TO-HEAD, AND THE CONFOUND
  //
  // A style description is not neutral about brand. A label with a consistent
  // aesthetic produces similar phrases for all its pieces, so in embedding
  // space a brand's pieces cluster together — and a piece from a brand she
  // likes then sits near pieces from that brand, which she also kept. That
  // would make the embedding score partly brand recognition wearing a style
  // costume, and it would flatter the result without the garment mattering.
  //
  // Within a single brand the brand is held constant, so whatever separates her
  // kept pieces from her skipped ones there is a property of the items and
  // nothing else. This is also the setting that matters when a new brand
  // arrives, because that is precisely when there is no brand habit to lean on.
  // ------------------------------------------------------------------
  const toDecided = (r: any): DecidedRow => ({
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
  const learn = buildLearning(train.map(toDecided))
  const conf = confidenceModels(train.map((r) => ({ ...toDecided(r), score: Number(r.discovery_score ?? 0) })), learn)
  const existingOf = (r: any) => confidenceFromModels(conf, learn, toDecided(r), Number(r.discovery_score ?? 0)) ?? 0.5
  const byExisting = test.map((r) => [existingOf(r), r.status === 'kept'] as [number, boolean])

  console.log('\nAGAINST THE EXISTING CONFIDENCE MODEL — same held-out pieces\n')
  console.log('  scorer                                    AUC    top25%   top40%')
  console.log('  ' + '-'.repeat(64))
  for (const [name, scored] of [
    ['existing confidence model', byExisting],
    ['style phrase embeddings', byPhrase],
    ['existing + phrase embeddings', byBoth],
  ] as Array<[string, Array<[number, boolean]>]>) {
    console.log(
      '  ' + name.padEnd(40) + (auc(scored)?.toFixed(3) ?? ' n/a ').padStart(5) + '   ' +
      pct(prec(scored, 0.25)).padStart(6) + '   ' + pct(prec(scored, 0.4)).padStart(6),
    )
  }

  // The confound check, and the only comparison that is immune to it.
  const groups = new Map<string, any[]>()
  for (const r of test) groups.set(r.brand_id ?? '?', [...(groups.get(r.brand_id ?? '?') ?? []), r])
  const brandGroups = Array.from(groups.entries()).filter(([, l]) =>
    l.length >= 20 && l.some((r) => r.status === 'kept') && l.some((r) => r.status !== 'kept'))

  if (brandGroups.length) {
    const sum = { existing: 0, dims: 0, phrase: 0, n: 0 }
    console.log('\nWITHIN ONE BRAND — brand held constant, so only the garment can separate\n')
    console.log('  brand                          n   keep%  existing    dims   phrase')
    console.log('  ' + '-'.repeat(66))
    for (const [b, list] of brandGroups.sort((a, c) => c[1].length - a[1].length)) {
      const rate = list.filter((r) => r.status === 'kept').length / list.length
      const embedKnn = (r: any, k = 20) => {
        const q = vecOf.get(r.queue_id)!
        const nearest = embIndex.map((e) => ({ sim: cosine(q, e.vec), kept: e.kept })).sort((a, c) => c.sim - a.sim).slice(0, k)
        let w = 0, kept = 0
        for (const nb of nearest) { const wt = Math.max(0, nb.sim) ** 4; w += wt; if (nb.kept) kept += wt }
        return w ? kept / w : 0.5
      }
      const aE = auc(list.map((r) => [existingOf(r), r.status === 'kept']))
      const aD = auc(list.map((r) => [neighbourStyleScore(dimIndex, styleVector(dimModel, tags[r.queue_id].tags)).score, r.status === 'kept']))
      const aP = auc(list.map((r) => [embedKnn(r), r.status === 'kept']))
      if (aE != null && aD != null && aP != null) {
        sum.existing += aE * list.length; sum.dims += aD * list.length; sum.phrase += aP * list.length; sum.n += list.length
      }
      console.log(
        '  ' + String(b).slice(0, 26).padEnd(26) + String(list.length).padStart(4) + '  ' + pct(rate).padStart(5) + '   ' +
        (aE?.toFixed(3) ?? ' n/a ').padStart(5) + '  ' + (aD?.toFixed(3) ?? ' n/a ').padStart(5) + '  ' + (aP?.toFixed(3) ?? ' n/a ').padStart(6),
      )
    }
    if (sum.n) {
      console.log('  ' + '-'.repeat(66))
      console.log(
        '  ' + 'weighted average'.padEnd(26) + String(sum.n).padStart(4) + '         ' +
        (sum.existing / sum.n).toFixed(3).padStart(5) + '  ' + (sum.dims / sum.n).toFixed(3).padStart(5) + '  ' + (sum.phrase / sum.n).toFixed(3).padStart(6),
      )
    }
  }

  // Stability: a single split can flatter a scorer by luck.
  if (flag('splits')) {
    console.log('\nSPLIT STABILITY')
    console.log('  split   existing    dims   phrase')
    for (const s of [0.5, 0.6, 0.7, 0.8]) {
      const c = Math.floor(withPhrase.length * s)
      const tr = withPhrase.slice(0, c)
      const te = withPhrase.slice(c)
      if (te.length < 30) continue
      const dm = fitStyleModel(tr.map((r) => ({ tags: tags[r.queue_id].tags, kept: r.status === 'kept' })))
      const di = buildStyleIndex(dm, tr.map((r) => ({ tags: tags[r.queue_id].tags, kept: r.status === 'kept' })))
      const ei = tr.map((r) => ({ vec: vecOf.get(r.queue_id)!, kept: r.status === 'kept' }))
      const knnOf = (r: any, k = 20) => {
        const q = vecOf.get(r.queue_id)!
        const nearest = ei.map((e) => ({ sim: cosine(q, e.vec), kept: e.kept })).sort((a, b) => b.sim - a.sim).slice(0, k)
        let w = 0, kept = 0
        for (const nb of nearest) { const wt = Math.max(0, nb.sim) ** 4; w += wt; if (nb.kept) kept += wt }
        return w ? kept / w : 0.5
      }
      const l2 = buildLearning(tr.map(toDecided))
      const mc = confidenceModels(tr.map((r) => ({ ...toDecided(r), score: Number(r.discovery_score ?? 0) })), l2)
      const exOf = (r: any) => confidenceFromModels(mc, l2, toDecided(r), Number(r.discovery_score ?? 0)) ?? 0.5
      console.log(
        '  ' + String(s).padEnd(7) +
        (auc(te.map((r) => [exOf(r), r.status === 'kept']))?.toFixed(3) ?? ' n/a ').padStart(7) + '  ' +
        (auc(te.map((r) => [neighbourStyleScore(di, styleVector(dm, tags[r.queue_id].tags)).score, r.status === 'kept']))?.toFixed(3) ?? ' n/a ').padStart(6) + '  ' +
        (auc(te.map((r) => [knnOf(r), r.status === 'kept']))?.toFixed(3) ?? ' n/a ').padStart(7),
      )
    }
  }

  console.log(`\n  phrases cached in ${path.relative(process.cwd(), OUT_FILE)}`)
  console.log('')
}

main().catch((err) => { console.error('\n' + (err instanceof Error ? err.message : String(err))); process.exit(1) })
