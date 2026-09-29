// IS THE CHEAP MODEL ACCURATE ENOUGH TO TEACH HER TASTE?
//
// The tagger was built around Anthropic. Then the Anthropic key ran out of
// credit, and the OpenAI key turned out to read a garment for about
// $0.00005 an image instead of $0.0033 — sixty times cheaper. Cheap enough
// that the price stops being the question, which leaves the only question that
// matters: is it right?
//
// Ground truth is real. A kept Brand Watch piece became a library item, and the
// library carries 1-5 style tags on it. So every reading a candidate model
// produces can be checked against a tag a human or a production pass already
// agreed with.
//
// This measures three things, because a model can fail in three ways:
//
//   agreement     does it read the garment the way the library read it
//   consistency   does it say the same thing twice about one photograph
//   coverage      does it fill a dimension at all, or hedge everything to x
//
// Consistency is the one that matters most here and is least obvious: a model
// that disagrees with itself is not teaching a taste, it is teaching noise, and
// a noisy teacher is worse the more cheaply it can be run.
//
//   node_modules/.bin/jiti scripts/tag-model-compare.ts --n=40
//   node_modules/.bin/jiti scripts/tag-model-compare.ts --n=40 --concurrency=6

import fs from 'node:fs'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { TAG_FORMAT, TAG_DIMENSIONS, type StyleTags } from '../src/lib/brand-watch-tag'

const arg = (n: string): string | undefined =>
  process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=')
const flag = (n: string): boolean => process.argv.includes(`--${n}`)

const OUT_FILE = path.join(process.cwd(), 'scripts', '.eval', 'model-compare.json')

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

/** Dollars per million tokens, input and output, from OpenAI's published table. */
const PRICE: Record<string, [number, number]> = {
  'gpt-6-luna': [0.1, 0.5],
  'gpt-6.1-sol': [2.0, 10.0],
  'gpt-6-sol': [2.0, 10.0],
  'gpt-5.6-luna': [0.2, 1.2],
  'gpt-5.4-nano': [0.05, 0.4],
}

interface Variant { label: string; model: string; detail: 'low' | 'high'; effort?: string }

/** The cheap ones first: each is a real candidate, not a straw man. */
const VARIANTS: Variant[] = [
  { label: 'luna  low  none', model: 'gpt-6-luna', detail: 'low', effort: 'none' },
  { label: 'luna  low  low', model: 'gpt-6-luna', detail: 'low', effort: 'low' },
  { label: 'luna  high none', model: 'gpt-6-luna', detail: 'high', effort: 'none' },
  { label: '5.6luna low none', model: 'gpt-5.6-luna', detail: 'low', effort: 'none' },
  // Not a candidate — too dear for the volume. Here to answer whether the cheap
  // tiers are losing anything a bigger model would catch.
  { label: 'sol   low  low', model: 'gpt-6.1-sol', detail: 'low', effort: 'low' },
]

interface Reading { tags: StyleTags; usd: number; inTok: number; outTok: number; error?: string }

async function readOne(key: string, v: Variant, imageUrl: string): Promise<Reading> {
  const body: any = {
    model: v.model,
    max_completion_tokens: 900,
    messages: [{
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: imageUrl, detail: v.detail } },
        { type: 'text', text: `Judge the single garment or accessory being sold in this product photo. Ignore the background, the model, and anything else styled with it.\n\n${TAG_FORMAT}` },
      ],
    }],
  }
  if (v.effort) body.reasoning_effort = v.effort
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const j: any = await res.json().catch(() => ({}))
    if (!res.ok) return { tags: {}, usd: 0, inTok: 0, outTok: 0, error: `HTTP ${res.status}: ${(j?.error?.message ?? '').slice(0, 90)}` }
    const u = j.usage ?? {}
    const [pi, po] = PRICE[v.model] ?? [0.1, 0.5]
    const raw = String(j.choices?.[0]?.message?.content ?? '').trim()
    return {
      tags: parseLine(raw),
      usd: ((u.prompt_tokens ?? 0) * pi + (u.completion_tokens ?? 0) * po) / 1e6,
      inTok: u.prompt_tokens ?? 0,
      outTok: u.completion_tokens ?? 0,
    }
    // Same contract as the tagger: a reply that does not match is a failed
    // read, not a reading with some missing fields.
  } catch (err) {
    return { tags: {}, usd: 0, inTok: 0, outTok: 0, error: err instanceof Error ? err.message : 'fetch failed' }
  }
}

/** Mirrors parseTagLine in brand-watch-tag.ts — same contract, same clamp. */
function parseLine(reply: string): StyleTags {
  const line = reply.split('\n').map((l) => l.trim()).filter(Boolean).pop()
  if (!line) return {}
  const parts = line.split(',').map((p) => p.trim().toLowerCase())
  if (parts.length !== TAG_DIMENSIONS.length) return {}
  const out: StyleTags = {}
  parts.forEach((p, i) => {
    if (p === 'x' || p === 'null' || p === '') return
    const n = Number(p)
    if (!Number.isInteger(n) || n < 1 || n > 5) return
    out[TAG_DIMENSIONS[i]] = n
  })
  return out
}

async function main() {
  const env = readEnv()
  const key = env.OPENAI_API_KEY
  if (!key) throw new Error('OPENAI_API_KEY must be in .env.local')
  const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

  const N = Number(arg('n') ?? 40)
  const CONC = Number(arg('concurrency') ?? 6)

  // Ground truth only exists where the library actually recorded a tag. A piece
  // with an untagged item teaches nothing about whether a model reads correctly,
  // so it is not allowed in the sample.
  const { data: rows } = await db
    .from('brand_watch_queue')
    .select('queue_id, product_name, item_type, image_url, item_id')
    .eq('status', 'kept')
    .not('item_id', 'is', null)
    .not('image_url', 'is', null)
    .order('queue_id')
    .range(0, 4000)
  const candidates = (rows ?? []) as any[]

  const truth = new Map<string, StyleTags>()
  const cols = ['item_id', ...TAG_DIMENSIONS].join(', ')
  const ids = candidates.map((r) => r.item_id)
  for (let i = 0; i < ids.length; i += 400) {
    const { data } = await db.from('item').select(cols).in('item_id', ids.slice(i, i + 400))
    for (const it of (data ?? []) as any[]) {
      const t: StyleTags = {}
      for (const d of TAG_DIMENSIONS) if (it[d] != null) t[d] = Number(it[d])
      if (Object.keys(t).length >= 4) truth.set(it.item_id, t)
    }
  }

  const sample = candidates.filter((r) => truth.get(r.item_id)).slice(0, N)
  if (!sample.length) throw new Error('no tagged kept pieces found — nothing to measure against')
  console.log(`${candidates.length} kept pieces with an item; ${truth.size} of those items carry 4+ real tags`)
  console.log(`measuring ${sample.length} pieces, ${VARIANTS.length} model configs each\n`)

  interface Tally { n: number; exact: number; near: number; read: number; absent: number; usd: number; errors: number; vary: number }
  const tallies = new Map<string, Tally>()
  for (const v of VARIANTS) tallies.set(v.label, { n: 0, exact: 0, near: 0, read: 0, absent: 0, usd: 0, errors: 0, vary: 0 })
  /** Recorded so a rerun of the cheap winner costs nothing. */
  const store: Record<string, Record<string, Reading>> = fs.existsSync(OUT_FILE) ? JSON.parse(fs.readFileSync(OUT_FILE, 'utf8')) : {}

  for (let i = 0; i < sample.length; i += CONC) {
    const chunk = sample.slice(i, i + CONC)
    await Promise.all(chunk.map(async (r) => {
      const t = truth.get(r.item_id)!
      const key2 = r.queue_id
      store[key2] ??= {}
      for (const v of VARIANTS) {
        // Always re-run 'luna low none' twice: once as the candidate, once as
        // the consistency check. A model that disagrees with itself would
        // otherwise look as accurate as its luckiest run.
        const reading = await readOne(key, v, r.image_url)
        store[key2][v.label] = reading
        const s = tallies.get(v.label)!
        s.n++
        s.usd += reading.usd
        if (reading.error) { s.errors++; continue }
        for (const d of TAG_DIMENSIONS) {
          if (reading.tags[d] == null) { s.absent++; continue }
          s.read++
          if (t[d] == null) continue
          const diff = Math.abs((reading.tags[d] as number) - (t[d] as number))
          if (diff === 0) s.exact++
          else if (diff === 1) s.near++
        }
      }
    }))
    fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true })
    fs.writeFileSync(OUT_FILE, JSON.stringify(store))
    process.stdout.write(`\r  ${Math.min(i + CONC, sample.length)}/${sample.length} pieces read   `)
  }

  // Consistency: run the cheapest config a second time on every piece and ask
  // how often the two readings of the SAME photograph agree.
  console.log('\n\n  consistency check — reading each photograph twice with the cheapest config…')
  const twice = new Map<string, { same: number; dims: number; both: number }>()
  const V0 = VARIANTS[0]
  for (let i = 0; i < sample.length; i += CONC) {
    const chunk = sample.slice(i, i + CONC)
    await Promise.all(chunk.map(async (r) => {
      const again = await readOne(key, V0, r.image_url)
      const first = store[r.queue_id][V0.label]
      const t = twice.get(V0.label) ?? { same: 0, dims: 0, both: 0 }
      for (const d of TAG_DIMENSIONS) {
        if (first.tags[d] == null || again.tags[d] == null) continue
        t.dims++
        if (first.tags[d] === again.tags[d]) t.same++
      }
      t.both++
      twice.set(V0.label, t)
    }))
    process.stdout.write(`\r  ${Math.min(i + CONC, sample.length)}/${sample.length} re-read   `)
  }

  const pct = (n: number, d: number) => (d ? `${((100 * n) / d).toFixed(1)}%` : '—')
  console.log('\n\nACCURACY AGAINST THE LIBRARY\'S OWN TAGS\n')
  console.log('  config                exact   ±1   dims read/pc  hedged  errors   $/piece   $/16k')
  for (const v of VARIANTS) {
    const s = tallies.get(v.label)!
    const compared = s.exact + s.near
    console.log(
      `  ${v.label.padEnd(20)} ${pct(s.exact, compared).padStart(6)} ${pct(s.exact + s.near, compared).padStart(6)}   ` +
      `${(s.read / Math.max(1, s.n)).toFixed(1).padStart(10)}   ${pct(s.absent, s.absent + s.read).padStart(6)}  ${String(s.errors).padStart(6)}   ` +
      `${('$' + (s.usd / Math.max(1, s.n)).toFixed(6)).padStart(9)}  ${('$' + (s.usd / Math.max(1, s.n) * 15939).toFixed(2)).padStart(6)}`,
    )
  }

  const t = twice.get(V0.label)
  if (t) console.log(`\n  consistency (${V0.label}, same photo twice): ${pct(t.same, t.dims)} of ${t.dims} dimension readings agreed exactly`)

  if (flag('verbose')) {
    console.log('\nPER PIECE')
    for (const r of sample.slice(0, 8)) {
      const t2 = truth.get(r.item_id)!
      console.log(`\n  ${r.item_type} | ${r.product_name}`)
      console.log(`     library ${JSON.stringify(t2)}`)
      for (const v of VARIANTS) {
        const rd = store[r.queue_id][v.label]
        console.log(`     ${v.label.padEnd(20)} ${rd.error ? 'ERR ' + rd.error : JSON.stringify(rd.tags)}`)
      }
    }
  }

  console.log(`\n  readings cached in ${path.relative(process.cwd(), OUT_FILE)}`)
}

main().catch((err) => { console.error('\n' + (err instanceof Error ? err.message : String(err))); process.exit(1) })
