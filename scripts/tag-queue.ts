// TAG QUEUED PIECES WITH THEIR STYLE DIMENSIONS.
//
// The evidence the confidence model was missing. Her ACCEPTED pieces are
// already tagged — they became library items — but a piece she SKIPPED never
// becomes an item, so nothing ever recorded what she turns down. Without both
// sides there is no way to learn what "not her taste" looks like.
//
//   node_modules/.bin/jiti scripts/tag-queue.ts --kept=400 --skipped=400
//   node_modules/.bin/jiti scripts/tag-queue.ts --brand="ME+EM" --status=queued
//   node_modules/.bin/jiti scripts/tag-queue.ts --kept=400 --skipped=400 --dry
//
// BOTH SIDES ARE TAGGED BY THE SAME READER, on purpose. The library's tags
// came from a different prompt, at a different size, sometimes by hand. Taking
// the accepted side from there and the skipped side from here would build a
// systematic difference between the two classes, and any model would then
// "learn" to tell the tagger apart rather than the clothes. So for the
// experiment both are read fresh, the same way.
//
// Resumable and cached: results land in scripts/.eval/tags.json as they are
// read, and a rerun never pays for an image twice.

import fs from 'node:fs'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'
import {
  tagPiece, isTransientError, describeStyle, embedPhrases, TAG_DIMENSIONS,
  type StyleTags,
} from '../src/lib/brand-watch-tag'

const arg = (n: string): string | undefined =>
  process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=')
const flag = (n: string): boolean => process.argv.includes(`--${n}`)

const OUT_DIR = path.join(process.cwd(), 'scripts', '.eval')
const OUT_FILE = path.join(OUT_DIR, 'tags.json')

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

interface Stored {
  tags: StyleTags
  source: string
  at: string
  /** The look, in words, and that phrase as a vector. The better signal. */
  phrase?: string
  embedding?: number[]
}

const loadStore = (): Record<string, Stored> =>
  fs.existsSync(OUT_FILE) ? JSON.parse(fs.readFileSync(OUT_FILE, 'utf8')) : {}

function saveStore(store: Record<string, Stored>) {
  fs.mkdirSync(OUT_DIR, { recursive: true })
  fs.writeFileSync(OUT_FILE, JSON.stringify(store, null, 1))
}

/**
 * Take `n` rows spread evenly across brands rather than the first n, so one
 * prolific brand cannot supply the whole sample and make the result a
 * statement about that brand instead of about her taste.
 */
function stratify<T extends { brand_id: string | null }>(rows: T[], n: number): T[] {
  if (rows.length <= n) return rows
  const byBrand = new Map<string, T[]>()
  for (const r of rows) {
    const k = r.brand_id ?? ''
    byBrand.set(k, [...(byBrand.get(k) ?? []), r])
  }
  const queues = Array.from(byBrand.values())
  // Deterministic: same sample every run, so a rerun costs nothing new.
  for (const q of queues) q.sort((a: any, b: any) => String(a.queue_id).localeCompare(String(b.queue_id)))
  const out: T[] = []
  for (let i = 0; out.length < n; i++) {
    let took = false
    for (const q of queues) {
      if (i >= q.length) continue
      out.push(q[i])
      took = true
      if (out.length === n) break
    }
    if (!took) break
  }
  return out
}

async function page(db: any, status: string[], brand?: string): Promise<any[]> {
  const out: any[] = []
  for (let from = 0; ; from += 1000) {
    let q = db.from('brand_watch_queue')
      .select('queue_id, brand_id, product_name, item_type, image_url, status, brand:brand_id(name)')
      .in('status', status)
    if (brand) q = q.ilike('brand.name', brand)
    const { data, error } = await q.order('queue_id').range(from, from + 999)
    if (error) throw new Error(error.message)
    out.push(...(data ?? []))
    if (!data || data.length < 1000) break
  }
  return out.filter((r) => r.image_url && /^https?:\/\//.test(r.image_url))
}

async function main() {
  const env = readEnv()
  if (!env.ANTHROPIC_API_KEY && !env.OPENAI_API_KEY) throw new Error('no reader configured — put OPENAI_API_KEY (or ANTHROPIC_API_KEY) in .env.local')
  // Both, when both exist: the tagger picks by provider, and the fallback has
  // to be able to run without a second edit to this file.
  if (env.OPENAI_API_KEY) process.env.OPENAI_API_KEY = env.OPENAI_API_KEY
  if (env.ANTHROPIC_API_KEY) process.env.ANTHROPIC_API_KEY = env.ANTHROPIC_API_KEY
  const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

  const wantKept = Number(arg('kept') ?? 0)
  const wantSkipped = Number(arg('skipped') ?? 0)
  const brand = arg('brand')
  const status = arg('status')

  let targets: any[] = []
  if (status || brand) {
    targets = await page(db, (status ?? 'queued').split(','), brand)
    const cap = Number(arg('limit') ?? targets.length)
    targets = stratify(targets, cap)
  } else {
    const all = await page(db, ['kept', 'skipped'])
    targets = [
      ...stratify(all.filter((r) => r.status === 'kept'), wantKept),
      ...stratify(all.filter((r) => r.status === 'skipped'), wantSkipped),
    ]
  }
  if (!targets.length) throw new Error('nothing matched — check --brand / --status')

  const store = loadStore()
  // A piece is only complete when it has BOTH the dimensions and the look, so a
  // half-read piece from an interrupted run is picked up rather than skipped.
  const wantLook = !flag('no-look')
  const complete = (s?: Stored) => !!s && Object.keys(s.tags).length > 0 && (!wantLook || !!s.embedding?.length)
  const todo = targets.filter((r) => !complete(store[r.queue_id]))
  console.log(`${targets.length} pieces in scope, ${targets.length - todo.length} already complete, ${todo.length} to read`)

  // Balanced sampling is deliberate: AUC does not care about class balance, and
  // an even split gets the most signal per pound spent.
  const keptN = targets.filter((r) => r.status === 'kept').length
  console.log(`  ${keptN} accepted / ${targets.length - keptN} skipped`)

  if (flag('dry')) {
    // Measured, not guessed: the dimensions read is $0.000078 an image and the
    // style phrase is about the same, with the embedding near free.
    const perPiece = wantLook ? 0.00016 : 0.000078
    console.log(`\ndry run — reading ${todo.length} images would cost about $${(todo.length * perPiece).toFixed(3)}`)
    return
  }

  let spent = 0, done = 0, failed = 0
  let outage: string | null = null
  const CONC = 6
  for (let i = 0; i < todo.length && !outage; i += CONC) {
    const chunk = todo.slice(i, i + CONC)
    const results = await Promise.all(chunk.map(async (r) => {
      try {
        const dims = await tagPiece({ productName: r.product_name, itemType: r.item_type, imageUrl: r.image_url })
        if (dims.transient) return { r, out: dims, look: null }
        // The look is described in the same pass. It is the signal that
        // measured better than the dimensions, so it is not optional.
        const look = wantLook && r.image_url ? await describeStyle(r.image_url) : null
        return { r, out: dims, look }
      } catch (err) {
        return {
          r,
          out: { tags: {}, source: 'vision' as const, cost: 0, error: String(err), transient: isTransientError(String(err)) },
          look: null,
        }
      }
    }))

    // Phrases are embedded in one batch after the loop body, because embedding
    // one phrase per call pays the per-request cost thousands of times over.
    for (const { r, out, look } of results) {
      spent += out.cost
      // Spent credit or a rate limit says nothing about a garment. Stop, rather
      // than write off hundreds of perfectly readable pieces as unreadable and
      // then have to pay to find out they were fine.
      if (out.transient) { outage ??= out.error ?? 'the vision API is unavailable'; continue }
      if (look?.error && isTransientError(look.error)) { outage ??= look.error; continue }
      if (!Object.keys(out.tags).length && !look?.phrase) { failed++; continue }
      const prev = store[r.queue_id]
      store[r.queue_id] = {
        tags: Object.keys(out.tags).length ? out.tags : (prev?.tags ?? {}),
        source: out.source,
        at: new Date().toISOString(),
        ...(look?.phrase ? { phrase: look.phrase } : prev?.phrase ? { phrase: prev.phrase } : {}),
        ...(prev?.embedding?.length ? { embedding: prev.embedding } : {}),
      }
      if (look?.usage) spent += ((look.usage.input_tokens / 1e6) * 0.1) + ((look.usage.output_tokens / 1e6) * 0.5)
      done++
    }
    saveStore(store)
    process.stdout.write(`\r  read ${done}/${todo.length}  failed ${failed}  spent $${spent.toFixed(3)}   `)
  }
  if (outage) {
    console.log(`\n\nSTOPPED — ${outage}`)
    console.log(`${done} pieces were tagged before it stopped and are saved. Rerunning picks up exactly where this left off, and pays nothing for what is already read.`)
    return
  }

  // Embed every new phrase in one batch rather than one call per piece.
  const needVec = Object.entries(store).filter(([, s]) => s.phrase && !s.embedding?.length)
  if (needVec.length) {
    process.stdout.write(`\r  embedding ${needVec.length} phrases…                    `)
    const { vectors, cost, error } = await embedPhrases(needVec.map(([, s]) => s.phrase!))
    if (error && !vectors.length) {
      console.log(`\n\nSTOPPED — could not embed: ${error}`)
      console.log('the phrases are saved; rerunning embeds them without re-reading a single image.')
      saveStore(store)
      return
    }
    spent += cost
    needVec.forEach(([id, s], i) => { if (vectors[i]) s.embedding = vectors[i] })
    saveStore(store)
  }

  console.log(`\n\ndone — ${done} read, ${failed} unreadable, $${spent.toFixed(3)} spent`)
  console.log(`tags in ${path.relative(process.cwd(), OUT_FILE)}`)

  // Persist: the cache keyed by image, so the same photograph is never paid for
  // twice, and the queue row itself, so the scoring pass can read it without
  // joining anything.
  const rows = targets.filter((r) => store[r.queue_id])
  let cached = 0
  try {
    const cacheRows = rows.map((r) => ({
      image_url: r.image_url,
      tags: store[r.queue_id].tags,
      model: 'gpt-6-luna',
      phrase: store[r.queue_id].phrase ?? null,
      embedding: store[r.queue_id].embedding ?? null,
    }))
    for (let i = 0; i < cacheRows.length; i += 200) {
      const { error } = await db.from('brand_watch_tag_read').upsert(cacheRows.slice(i, i + 200), { onConflict: 'image_url' })
      if (error) throw new Error(error.message)
    }
    cached = cacheRows.length
  } catch (err) {
    console.log(`could not write the read cache: ${err instanceof Error ? err.message : err}`)
  }

  let written = 0
  try {
    for (const r of rows) {
      const s = store[r.queue_id]
      const patch: Record<string, unknown> = {
        tag_source: s.source,
        tagged_at: s.at,
        ...(s.phrase ? { style_phrase: s.phrase } : {}),
        ...(s.embedding?.length ? { style_embedding: s.embedding } : {}),
      }
      for (const d of TAG_DIMENSIONS) if (s.tags[d] != null) patch[d] = s.tags[d]
      const { error } = await db.from('brand_watch_queue').update(patch).eq('queue_id', r.queue_id)
      if (error) throw new Error(error.message)
      written++
      if (written % 100 === 0) process.stdout.write(`\r  writing ${written}/${rows.length}   `)
    }
  } catch (err) {
    console.log(`\nwrote ${written} of ${rows.length} queue rows before failing: ${err instanceof Error ? err.message : err}`)
  }
  console.log(`\n  ${cached} reads cached, ${written} queue rows tagged`)
}

main().catch((err) => { console.error('\n' + (err instanceof Error ? err.message : String(err))); process.exit(1) })
