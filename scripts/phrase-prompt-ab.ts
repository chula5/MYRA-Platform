// DID THE PHRASE PROMPT DESCRIBE THE GARMENT, OR THE SHOOT?
//
// The first prompt asked for a garment's style but never said to ignore what it
// was styled with. On inspection it came back with the whole outfit: a knitwear
// pullover read as "high-waisted wide-leg trousers", shorts as "white tee and
// lace-trim shorts". A phrase about the styling rather than the garment is not
// merely noise — it is a channel for brand recognition. Shops photograph their
// pieces in a consistent house style, so two garments from one label look alike
// in embedding space whether or not they look alike as clothes. That would
// score well across the whole set and collapse inside a single brand, which is
// exactly the pattern the first measurements showed.
//
// So this measures the two prompts on the SAME pieces, against the SAME
// decisions, and reports the within-brand figure separately — because that is
// the one a styling artefact would inflate.
//
//   node_modules/.bin/jiti scripts/phrase-prompt-ab.ts --n=400
//   node_modules/.bin/jiti scripts/phrase-prompt-ab.ts --n=400 --show

import fs from 'node:fs'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { describeStyle, embedPhrases, PHRASE_PROMPT, PHRASE_PROMPT_V1 } from '../src/lib/brand-watch-tag'
import { cosineSimilarity, buildLookIndex, lookSimilarityScore } from '../src/lib/brand-watch-style-fit'

const arg = (n: string): string | undefined =>
  process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=')
const flag = (n: string): boolean => process.argv.includes(`--${n}`)

const CACHE = path.join(process.cwd(), 'scripts', '.eval', 'prompt-ab.json')

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

interface Entry { v1?: string; v2?: string; e1?: number[]; e2?: number[]; brand: string; kept: boolean }

async function main() {
  const env = readEnv()
  const key = env.OPENAI_API_KEY
  if (!key) throw new Error('OPENAI_API_KEY must be in .env.local')
  // Reading the env file is not the same as the module seeing it: describeStyle
  // reads process.env at call time, so it has to be set here or every call
  // silently returns "not configured" and the run looks like a clean zero.
  process.env.OPENAI_API_KEY = key
  const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

  const tags: Record<string, any> = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'scripts', '.eval', 'tags.json'), 'utf8'))
  const ids = Object.keys(tags)
  const rows: any[] = []
  for (let i = 0; i < ids.length; i += 300) {
    const { data, error } = await db.from('brand_watch_queue')
      .select('queue_id, status, brand_id, image_url, product_name, item_type, decided_at, discovered_at')
      .in('queue_id', ids.slice(i, i + 300))
    if (error) throw new Error(error.message)
    rows.push(...(data ?? []))
  }
  const usable = rows
    .filter((r) => (r.status === 'kept' || r.status === 'skipped') && r.image_url)
    .sort((a, b) => String(a.decided_at ?? a.discovered_at).localeCompare(String(b.decided_at ?? b.discovered_at)))

  const N = Math.min(Number(arg('n') ?? 400), usable.length)
  const byBrand = new Map<string, any[]>()
  for (const r of usable) byBrand.set(r.brand_id, [...(byBrand.get(r.brand_id) ?? []), r])
  const queues = Array.from(byBrand.values())
  const sample: any[] = []
  for (let i = 0; sample.length < N; i++) {
    let took = false
    for (const q of queues) if (i < q.length && sample.length < N) { sample.push(q[i]); took = true }
    if (!took) break
  }
  console.log(`${usable.length} decided pieces; sampling ${sample.length} across ${queues.length} brands\n`)

  const store: Record<string, Entry> = fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE, 'utf8')) : {}
  const CONC = 8

  // Phase 1 — describe with both prompts, on the same images.
  const needDesc = sample.filter((r) => !store[r.queue_id]?.v1 || !store[r.queue_id]?.v2)
  if (needDesc.length) console.log(`describing ${needDesc.length} pieces with both prompts…`)
  for (let i = 0; i < needDesc.length; i += CONC) {
    const chunk = needDesc.slice(i, i + CONC)
    const done = await Promise.all(chunk.map(async (r) => {
      const [a, b] = await Promise.all([
        store[r.queue_id]?.v1 ? null : describeStyle(r.image_url, { prompt: PHRASE_PROMPT_V1 }),
        store[r.queue_id]?.v2 ? null : describeStyle(r.image_url),
      ])
      return { r, a, b }
    }))
    for (const { r, a, b } of done) {
      const prev = store[r.queue_id] ?? { brand: r.brand_id, kept: r.status === 'kept' }
      store[r.queue_id] = {
        ...prev,
        brand: r.brand_id,
        kept: r.status === 'kept',
        ...(a?.phrase ? { v1: a.phrase } : {}),
        ...(b?.phrase ? { v2: b.phrase } : {}),
      }
    }
    fs.mkdirSync(path.dirname(CACHE), { recursive: true })
    fs.writeFileSync(CACHE, JSON.stringify(store))
    process.stdout.write(`\r  ${Math.min(i + CONC, needDesc.length)}/${needDesc.length}   `)
  }
  if (needDesc.length) console.log('')
  // A silent zero is the worst possible outcome: it reads as a real result.
  // If nothing came back, say so and stop.
  const described = sample.filter((r) => store[r.queue_id]?.v1 || store[r.queue_id]?.v2).length
  if (described < sample.length * 0.5) {
    const anyErr = Object.values(store).find((e) => !e.v1 && !e.v2)
    throw new Error(`only ${described} of ${sample.length} pieces were described — check the reader before trusting anything below (${anyErr ? 'entries present but empty' : 'no entries'})`)
  }

  // Phase 2 — embed each prompt's phrases in one batch each.
  for (const [keyName, vecName, label] of [['v1', 'e1', 'old'], ['v2', 'e2', 'new']] as const) {
    const need = sample.filter((r) => store[r.queue_id]?.[keyName] && !store[r.queue_id]?.[vecName]?.length)
    if (!need.length) continue
    process.stdout.write(`  embedding ${need.length} ${label} phrases…          \r`)
    const { vectors, error } = await embedPhrases(need.map((r) => store[r.queue_id][keyName]!))
    if (error && !vectors.length) throw new Error(`embed failed: ${error}`)
    need.forEach((r, i) => { if (vectors[i]) store[r.queue_id][vecName] = vectors[i] })
    fs.writeFileSync(CACHE, JSON.stringify(store))
  }

  const usable2 = sample.filter((r) => store[r.queue_id]?.e1?.length && store[r.queue_id]?.e2?.length)
  console.log(`measuring on ${usable2.length} pieces that have both\n`)

  if (flag('show')) {
    console.log('SIDE BY SIDE (old prompt vs new)')
    for (const r of usable2.slice(0, 8)) {
      console.log(`\n  ${r.item_type} · ${r.product_name}`)
      console.log(`    old: ${store[r.queue_id].v1}`)
      console.log(`    new: ${store[r.queue_id].v2}`)
    }
    console.log('')
  }

  const cut = Math.floor(usable2.length * Number(arg('split') ?? 0.7))
  const train = usable2.slice(0, cut)
  const test = usable2.slice(cut)

  const scoreWith = (vecName: 'e1' | 'e2') => {
    const index = buildLookIndex(train.map((r) => ({ embedding: store[r.queue_id][vecName]!, kept: r.status === 'kept' })))
    return test.map((r) => [lookSimilarityScore(index, store[r.queue_id][vecName]!).score, r.status === 'kept'] as [number, boolean])
  }
  const oldScored = scoreWith('e1')
  const newScored = scoreWith('e2')

  console.log('WALK-FORWARD — same pieces, same decisions, only the prompt differs\n')
  console.log('  prompt                                       AUC    top25%')
  console.log('  ' + '-'.repeat(58))
  const prec = (l: Array<[number, boolean]>, f: number) => {
    const n = Math.max(1, Math.floor(l.length * f))
    return l.slice().sort((a, b) => b[0] - a[0]).slice(0, n).filter(([, k]) => k).length / n
  }
  for (const [name, scored] of [['old — "describe this garment\'s style"', oldScored], ['new — "ONLY the single garment, ignore styling"', newScored]] as Array<[string, Array<[number, boolean]>]>) {
    console.log('  ' + name.padEnd(44) + (auc(scored)?.toFixed(3) ?? ' n/a ').padStart(5) + '   ' + pct(prec(scored, 0.25)).padStart(6))
  }
  console.log(`\n  base rate on the test half: ${pct(test.filter((r) => r.status === 'kept').length / test.length)}`)

  // The decisive column. A prompt that describes the shoot rather than the
  // garment should look better across brands than within one.
  const groups = new Map<string, any[]>()
  for (const r of test) groups.set(r.brand_id, [...(groups.get(r.brand_id) ?? []), r])
  const big = Array.from(groups.entries()).filter(([, l]) => l.length >= 15 && l.some((r) => r.status === 'kept') && l.some((r) => r.status !== 'kept'))

  if (big.length) {
    const sum = { old: 0, new: 0, n: 0 }
    console.log('\nWITHIN ONE BRAND — where a styling artefact would show up\n')
    console.log('  brand                          n   keep%      old      new')
    console.log('  ' + '-'.repeat(58))
    for (const [b, list] of big.sort((a, c) => c[1].length - a[1].length)) {
      const rate = list.filter((r) => r.status === 'kept').length / list.length
      const aOld = auc(list.map((r) => [lookSimilarityScore(buildLookIndex(train.map((x) => ({ embedding: store[x.queue_id].e1!, kept: x.status === 'kept' }))), store[r.queue_id].e1!).score, r.status === 'kept']))
      const aNew = auc(list.map((r) => [lookSimilarityScore(buildLookIndex(train.map((x) => ({ embedding: store[x.queue_id].e2!, kept: x.status === 'kept' }))), store[r.queue_id].e2!).score, r.status === 'kept']))
      if (aOld != null && aNew != null) { sum.old += aOld * list.length; sum.new += aNew * list.length; sum.n += list.length }
      console.log(
        '  ' + String(b).slice(0, 26).padEnd(26) + String(list.length).padStart(4) + '  ' + pct(rate).padStart(5) + '   ' +
        (aOld?.toFixed(3) ?? ' n/a ').padStart(6) + '   ' + (aNew?.toFixed(3) ?? ' n/a ').padStart(6),
      )
    }
    if (sum.n) {
      console.log('  ' + '-'.repeat(58))
      console.log('  ' + 'weighted average'.padEnd(26) + String(sum.n).padStart(4) + '          ' + (sum.old / sum.n).toFixed(3).padStart(6) + '   ' + (sum.new / sum.n).toFixed(3).padStart(6))
    }
  }

  // How alike are phrases within a brand versus across brands? A prompt reading
  // the shoot makes a brand's pieces resemble each other more.
  //
  // The brand comes from the store entry, not from the row: the row carries
  // brand_id, so reading r.brand would put every piece in one undefined bucket
  // and silently report a meaningless zero.
  const sim = (vecName: 'e1' | 'e2') => {
    const byB = new Map<string, number[][]>()
    for (const r of usable2) {
      const b = store[r.queue_id].brand ?? 'unknown'
      byB.set(b, [...(byB.get(b) ?? []), store[r.queue_id][vecName]!])
    }
    const list = Array.from(byB.values()).filter((l) => l.length >= 3)
    let within = 0, wn = 0, across = 0, an = 0
    for (let i = 0; i < list.length; i++) {
      for (let a = 0; a < list[i].length; a++) {
        for (let b = a + 1; b < list[i].length; b++) { within += cosineSimilarity(list[i][a], list[i][b]); wn++ }
      }
      // Every piece of this brand against every piece of each later brand, so
      // the cross-brand figure is a mean and not one arbitrary pairing.
      for (let j = i + 1; j < list.length; j++) {
        for (const x of list[i]) for (const y of list[j]) { across += cosineSimilarity(x, y); an++ }
      }
    }
    return { within: wn ? within / wn : 0, across: an ? across / an : 0, brands: list.length, pairs: an }
  }
  const s1 = sim('e1'), s2 = sim('e2')
  console.log('\nDO A BRAND\'S PIECES ALL LOOK ALIKE? (the styling artefact, measured directly)')
  console.log(`  old prompt: within brand ${s1.within.toFixed(4)}   across brands ${s1.across.toFixed(4)}   gap ${(s1.within - s1.across).toFixed(4)}`)
  console.log(`  new prompt: within brand ${s2.within.toFixed(4)}   across brands ${s2.across.toFixed(4)}   gap ${(s2.within - s2.across).toFixed(4)}`)
  console.log('\n  a smaller gap means the phrase is describing the garment rather than the house style')
  console.log(`\n  cached in ${path.relative(process.cwd(), CACHE)}\n`)
}

main().catch((err) => { console.error('\n' + (err instanceof Error ? err.message : String(err))); process.exit(1) })
