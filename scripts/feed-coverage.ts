// CAN WE GET THE SHOP'S OWN COPY, FOR FREE, FOR EVERY BRAND SHE WATCHES?
//
// The tagging experiment keeps running into the same wall: the queue stores a
// name like "FEZZA - BLACK" and nothing else, so there is nothing to read. The
// shop's copy would fix that and costs nothing to fetch — but only if the shop
// serves /products.json at all, and only if the copy is in a language a reader
// can actually handle.
//
// This measures both, per brand, before anything is built on top of it.
//
//   node_modules/.bin/jiti scripts/feed-coverage.ts
//   node_modules/.bin/jiti scripts/feed-coverage.ts --concurrency=8

import fs from 'node:fs'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'

const arg = (n: string): string | undefined =>
  process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=')
const flag = (n: string): boolean => process.argv.includes(`--${n}`)

const CACHE = path.join(process.cwd(), 'scripts', '.eval', 'feed-coverage.json')

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
 * A shop's copy is written in the shop's own language, and the language follows
 * the shop, not the brand: Antik Batik is French, Brora is English, OpéraSPORT
 * is Danish. Nothing downstream can assume English, so the reader has to be a
 * model rather than a word list — this is the measurement that decides that.
 */
const LANGS: Array<[string, RegExp]> = [
  ['fr', /\b(?:et|avec|pour|une|le|la|les|des|sans|sur|taille|coton|laine|jupe|robe|veste|manteau|manches?|longue?|doublure|poitrine)\b/gi],
  ['es', /\b(?:y|con|para|una|el|los|las|de|sin|sobre|talla|algodón|lana|falda|vestido|chaqueta|abrigo|mangas?|largo|forro)\b/gi],
  ['it', /\b(?:e|con|per|una|il|lo|gli|le|dei|senza|su|taglia|cotone|lana|gonna|vestito|giacca|cappotto|maniche?|lungo|fodera)\b/gi],
  ['da', /\b(?:og|med|for|en|et|den|det|uden|på|størrelse|bomuld|uld|nederdel|kjole|jakke|frakke|ærmer|længde|foer)\b/gi],
  ['de', /\b(?:und|mit|für|eine|der|die|das|ohne|auf|größe|baumwolle|wolle|rock|kleid|jacke|mantel|ärmel|länge|futter)\b/gi],
  ['en', /\b(?:and|with|for|a|the|without|on|size|cotton|wool|skirt|dress|jacket|coat|sleeves?|long|length|lining|shoulder|neckline)\b/gi],
]
const ENGLISH_HINTS = /\b(?:and|with|the|for|this|made|fit|size|cotton|wool|silk|shoulder|neckline|sleeve|hem|waist|length|lined|oversized|relaxed)\b/i

function smellLanguage(text: string): string {
  if (ENGLISH_HINTS.test(text)) return 'en'
  let best = 'en'
  let bestN = 0
  for (const [code, re] of LANGS) {
    if (code === 'en') continue
    const n = (text.match(re) ?? []).length
    if (n > bestN) { bestN = n; best = code }
  }
  return bestN >= 4 ? best : 'en?'
}

interface FeedInfo {
  ok: boolean
  products: number
  withCopy: number
  avgCopy: number
  lang: string
  note?: string
}

async function probe(baseUrl: string): Promise<FeedInfo> {
  const empty: FeedInfo = { ok: false, products: 0, withCopy: 0, avgCopy: 0, lang: '—' }
  let products: any[] = []
  try {
    for (let page = 1; page <= 3; page++) {
      const res = await fetch(`${baseUrl.replace(/\/$/, '')}/products.json?limit=250&page=${page}`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh) MYRA-BrandWatch/1.0', Accept: 'application/json' },
        signal: AbortSignal.timeout(20000),
      })
      if (!res.ok) return { ...empty, note: `HTTP ${res.status}` }
      const batch = ((await res.json()) as any)?.products ?? []
      products.push(...batch)
      if (batch.length < 250) break
    }
  } catch (err) {
    return { ...empty, note: err instanceof Error ? err.name : 'fetch failed' }
  }
  if (!products.length) return { ...empty, note: 'no products' }
  const copies = products.map((p) => String(p.body_html ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim())
  const usable = copies.filter((c) => c.length > 80)
  return {
    ok: true,
    products: products.length,
    withCopy: usable.length,
    avgCopy: usable.length ? Math.round(usable.reduce((a, c) => a + c.length, 0) / usable.length) : 0,
    lang: usable.length ? smellLanguage(usable.slice(0, 40).join(' ')) : '—',
  }
}

async function main() {
  const env = readEnv()
  const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
  const CONC = Number(arg('concurrency') ?? 6)

  const { data: watches } = await db
    .from('watched_brand')
    .select('watched_brand_id, brand_id, name, base_url, active, auto_keep')
  const queue: any[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from('brand_watch_queue').select('watched_brand_id, status').order('queue_id').range(from, from + 999)
    if (error) throw new Error(error.message)
    queue.push(...(data ?? []))
    if (!data || data.length < 1000) break
  }
  const counts = new Map<string, { n: number; queued: number }>()
  for (const r of queue) {
    const c = counts.get(r.watched_brand_id) ?? { n: 0, queued: 0 }
    c.n++
    if (r.status === 'queued') c.queued++
    counts.set(r.watched_brand_id, c)
  }

  console.log(`watched brands: ${watches?.length ?? 0}   queue rows: ${queue.length}   rows spanning ${counts.size} brands\n`)

  const store: Record<string, FeedInfo> = fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE, 'utf8')) : {}
  const rows = (watches ?? []).filter((w: any) => w.base_url && counts.get(w.watched_brand_id))
  const todo = rows.filter((w: any) => !store[w.watched_brand_id])
  if (todo.length) console.log(`probing ${todo.length} feeds (${rows.length - todo.length} cached)…\n`)

  for (let i = 0; i < todo.length; i += CONC) {
    const chunk = todo.slice(i, i + CONC)
    const done = await Promise.all(chunk.map(async (w: any) => [w.watched_brand_id, await probe(String(w.base_url))] as const))
    for (const [id, info] of done) store[id] = info
    fs.mkdirSync(path.dirname(CACHE), { recursive: true })
    fs.writeFileSync(CACHE, JSON.stringify(store, null, 1))
  }

  const noUrl = (watches ?? []).filter((w: any) => !w.base_url && counts.get(w.watched_brand_id))
  let okN = 0, okRows = 0, okQueued = 0
  let langCount = new Map<string, number>()
  const report: Array<{ name: string; rows: number; queued: number; info: FeedInfo }> = []
  for (const w of rows) {
    const c = counts.get(w.watched_brand_id)!
    const info = store[w.watched_brand_id]
    if (info?.ok && info.withCopy > 0) {
      okN++; okRows += c.n; okQueued += c.queued
      langCount.set(info.lang, (langCount.get(info.lang) ?? 0) + 1)
    }
    report.push({ name: w.name, rows: c.n, queued: c.queued, info })
  }

  console.log('BRANDS, BY QUEUE VOLUME')
  console.log('  brand                          rows  queued   feed  products   copy  avg   lang')
  for (const r of report.sort((a, b) => b.rows - a.rows)) {
    if (!flag('all') && r.rows < 20) continue
    const i = r.info
    console.log(
      `  ${r.name.slice(0, 28).padEnd(28)} ${String(r.rows).padStart(5)} ${String(r.queued).padStart(7)}   ` +
      (i?.ok && i.withCopy
        ? `ok   ${String(i.products).padStart(8)}   ${String(i.withCopy).padStart(4)}  ${String(i.avgCopy).padStart(4)}   ${i.lang}`
        : `--   ${(i?.note ?? 'not probed').slice(0, 26)}`),
    )
  }

  const totalQueued = queue.filter((r) => r.status === 'queued').length
  console.log(`\nSUMMARY`)
  console.log(`  brands with a usable free feed   : ${okN} of ${rows.length} (${noUrl.length} brands have no base_url at all)`)
  console.log(`  queue rows covered by a feed     : ${okRows} of ${queue.length}  (${((100 * okRows) / queue.length).toFixed(0)}%)`)
  console.log(`  live 'queued' rows covered       : ${okQueued} of ${totalQueued}  (${((100 * okQueued) / totalQueued).toFixed(0)}%)`)
  console.log(`  copy languages across those brands: ${Array.from(langCount.entries()).map(([l, n]) => `${l} ${n}`).join(', ')}`)
  console.log(`\n  cache: ${path.relative(process.cwd(), CACHE)}`)
}

main().catch((err) => { console.error('\n' + (err instanceof Error ? err.message : String(err))); process.exit(1) })
