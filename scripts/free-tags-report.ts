// HOW MUCH OF THE TAGGING PROBLEM IS SOLVABLE WITHOUT PAYING ANYONE?
//
// The queue stores a name like "FEZZA - BLACK" and nothing else, which states
// no cut, no length and no neckline. But it also stores shopify_handle, and a
// Shopify shop will hand back the full product copy for free at
// /products.json — the same feed fetchCatalogue already reads, which is where
// bodyText comes from and which was then thrown away without being stored.
//
// So there are two free tiers of evidence, and this script measures both
// against ground truth rather than guessing:
//
//   names        the queue's own product_name, already in the database
//   copy         name + the shop's own description, refetched from the feed
//
// Ground truth is the accepted side: a kept Brand Watch piece became a library
// item, and that item carries real 1-5 style tags. Running the same reader over
// the two free text sources and comparing to those tags answers, measurably,
// what a free tier can and cannot see — and therefore what, if anything, is
// worth paying a vision model for.
//
//   node_modules/.bin/jiti scripts/free-tags-report.ts --brands=12
//   node_modules/.bin/jiti scripts/free-tags-report.ts --brands=12 --verbose

import fs from 'node:fs'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { tagFromRules, TAG_DIMENSIONS, type StyleTags, type TagDimension } from '../src/lib/brand-watch-tag'

const arg = (n: string): string | undefined =>
  process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=')
const flag = (n: string): boolean => process.argv.includes(`--${n}`)

const CACHE = path.join(process.cwd(), 'scripts', '.eval', 'feeds.json')

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
 * Cached per shop, so a rerun costs nothing. Deliberately the same endpoint and
 * the same shape the scanner reads, so this measures production's evidence and
 * not a convenient approximation of it.
 */
async function feed(baseUrl: string): Promise<Array<{ handle: string; title: string; body: string; type: string; tags: string }>> {
  const store: Record<string, any[]> = fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE, 'utf8')) : {}
  if (store[baseUrl]) return store[baseUrl]
  const out: any[] = []
  for (let page = 1; page <= 40; page++) {
    let res: Response
    try {
      res = await fetch(`${baseUrl}/products.json?limit=250&page=${page}`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh) MYRA-BrandWatch/1.0', Accept: 'application/json' },
      })
    } catch { break }
    if (!res.ok) break
    let batch: any[]
    try { batch = ((await res.json()) as any)?.products ?? [] } catch { break }
    for (const p of batch) {
      out.push({
        handle: String(p.handle ?? ''),
        title: String(p.title ?? ''),
        body: String(p.body_html ?? '').replace(/<[^>]*>/g, ' ').replace(/&[a-z]+;/gi, ' ').replace(/\s+/g, ' ').trim(),
        type: String(p.product_type ?? ''),
        tags: Array.isArray(p.tags) ? p.tags.join(' ') : String(p.tags ?? ''),
      })
    }
    if (batch.length < 250) break
  }
  store[baseUrl] = out
  fs.mkdirSync(path.dirname(CACHE), { recursive: true })
  fs.writeFileSync(CACHE, JSON.stringify(store))
  return out
}

const pct = (n: number, d: number) => (d ? `${((100 * n) / d).toFixed(1)}%` : '—')

async function main() {
  const env = readEnv()
  const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
  const wantBrands = Number(arg('brands') ?? 12)

  // Brands with the most queue rows, so the sample is the volume she actually
  // reviews rather than a handful of shops that happened to scan well. Paged:
  // PostgREST caps a single response, and a silent truncation would quietly
  // turn "the top brands" into "the most recently discovered".
  const rows: any[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from('brand_watch_queue')
      .select('queue_id, watched_brand_id, brand_id, shopify_handle, product_name, item_type, status, item_id')
      .order('queue_id')
      .range(from, from + 999)
    if (error) throw new Error(error.message)
    rows.push(...(data ?? []))
    if (!data || data.length < 1000) break
  }

  const { data: watches } = await db.from('watched_brand').select('watched_brand_id, name, base_url')
  const byId = new Map((watches ?? []).map((w: any) => [w.watched_brand_id, w]))

  const counts = new Map<string, number>()
  for (const r of rows) counts.set(r.watched_brand_id, (counts.get(r.watched_brand_id) ?? 0) + 1)
  const ranked = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).filter(([id]) => byId.get(id)?.base_url)
  const picked = ranked.slice(0, wantBrands)

  console.log(`queue rows: ${rows.length}   brands with a feed: ${ranked.length}   sampling the top ${picked.length}\n`)

  // The accepted pieces, with the library's own tags as ground truth.
  const keptIds = rows.filter((r) => r.status === 'kept' && r.item_id).map((r) => r.item_id)
  const truth = new Map<string, StyleTags>()
  const cols = ['item_id', ...TAG_DIMENSIONS].join(', ')
  for (let i = 0; i < keptIds.length; i += 400) {
    const { data } = await db.from('item').select(cols).in('item_id', keptIds.slice(i, i + 400))
    for (const it of (data ?? []) as any[]) {
      const t: StyleTags = {}
      for (const d of TAG_DIMENSIONS) if (it[d] != null) t[d] = Number(it[d])
      if (Object.keys(t).length) truth.set(it.item_id, t)
    }
  }
  console.log(`ground truth: ${truth.size} accepted pieces carry real 1-5 tags\n`)

  // name-only baseline over every row we hold
  let nameName = 0, nameDims = 0
  const dimCover = new Map<TagDimension, number>()
  for (const r of rows) {
    const t = tagFromRules(String(r.product_name ?? ''))
    const n = Object.keys(t).length
    nameDims += n
    if (n) nameName++
    for (const d of Object.keys(t) as TagDimension[]) dimCover.set(d, (dimCover.get(d) ?? 0) + 1)
  }
  const N = rows.length
  console.log('TIER 1 — rules over product_name alone (cost: $0, already in the database)')
  console.log(`  pieces with at least one dimension : ${pct(nameName, N)}`)
  console.log(`  dimensions per piece               : ${(nameDims / N).toFixed(2)} of ${TAG_DIMENSIONS.length}`)
  const topDims = Array.from(dimCover.entries()).sort((a, b) => b[1] - a[1])
  console.log(`  dimensions ever seen               : ${topDims.map(([d, n]) => `${d} ${pct(n, N)}`).join(', ') || 'none'}`)

  // the copy tier, on the sampled brands
  console.log('\nTIER 2 — rules over name + the shop\'s own copy (cost: $0 to fetch, $0 to read)')
  let sampled = 0, withHandle = 0, matched = 0, copyLong = 0, copyDims = 0, copyAny = 0
  let cmpN = 0, exact = 0, within1 = 0, truthN = 0
  const dimStats = new Map<TagDimension, { read: number; exact: number; near: number }>()
  const misses: Array<{ name: string; read: StyleTags; truth: StyleTags }> = []

  for (const [wid, count] of picked) {
    const w = byId.get(wid) as any
    const feedRows = await feed(String(w.base_url).replace(/\/$/, ''))
    const byHandle = new Map(feedRows.map((f) => [f.handle, f]))
    const mine = rows.filter((r) => r.watched_brand_id === wid)
    sampled += mine.length
    console.log(`  ${w.name.padEnd(28)} ${String(mine.length).padStart(5)} pieces   feed ${String(feedRows.length).padStart(5)} products   with copy ${pct(feedRows.filter((f) => f.body.length > 80).length, feedRows.length)}`)

    for (const r of mine) {
      if (r.shopify_handle) withHandle++
      const f = r.shopify_handle ? byHandle.get(r.shopify_handle) : undefined
      if (f) matched++
      if (f && f.body.length > 80) copyLong++
      const text = [r.item_type, r.product_name, f?.title, f?.type, f?.tags, f?.body].filter(Boolean).join(' ')
      const read = tagFromRules(text)
      const n = Object.keys(read).length
      copyDims += n
      if (n) copyAny++

      const t = r.item_id ? truth.get(r.item_id) : undefined
      if (!t) continue
      truthN++
      // Compare only shared dimensions, and count a dimension as read only if
      // it was genuinely read — an absent reading is not a wrong one.
      for (const d of TAG_DIMENSIONS) {
        if (read[d] == null) continue
        cmpN++
        const st = dimStats.get(d) ?? { read: 0, exact: 0, near: 0 }
        st.read++
        if (t[d] == null) { dimStats.set(d, st); continue }
        const ok = read[d] === t[d]
        const near = Math.abs((read[d] as number) - (t[d] as number)) <= 1
        if (ok) { exact++; st.exact++ } else if (near) { within1++ }
        if (near) st.near++
        dimStats.set(d, st)
      }
      if (flag('verbose') && misses.length < 8 && Object.keys(read).length) {
        misses.push({ name: String(r.product_name), read, truth: t })
      }
    }
  }

  console.log(`\n  handle coverage                    : ${pct(withHandle, sampled)} of sampled pieces`)
  console.log(`  recovered from the feed            : ${pct(matched, sampled)}`)
  console.log(`  copy of usable length              : ${pct(copyLong, sampled)}`)
  console.log(`  pieces with at least one dimension : ${pct(copyAny, sampled)}`)
  console.log(`  dimensions per piece               : ${(copyDims / sampled).toFixed(2)} of ${TAG_DIMENSIONS.length}`)

  // A piece still sitting in the queue is a piece the shop is selling NOW, so
  // its copy is still in the live feed. The low overall match rate is history,
  // not a limitation: it measures how much of a year-old backlog is still
  // recoverable, which is a different question from what a future scan can hold.
  if (flag('samples') || flag('verbose')) {
    const byStatus = new Map<string, { n: number; matched: number; long: number }>()
    for (const [wid] of picked) {
      const w = byId.get(wid) as any
      const feedRows = await feed(String(w.base_url).replace(/\/$/, ''))
      const byHandle = new Map(feedRows.map((f) => [f.handle, f]))
      for (const r of rows.filter((x) => x.watched_brand_id === wid)) {
        const s = byStatus.get(String(r.status)) ?? { n: 0, matched: 0, long: 0 }
        const f = r.shopify_handle ? byHandle.get(r.shopify_handle) : undefined
        s.n++
        if (f) s.matched++
        if (f && f.body.length > 80) s.long++
        byStatus.set(String(r.status), s)
      }
    }
    console.log('\nRECOVERABLE COPY BY STATUS')
    for (const [st, s] of Array.from(byStatus.entries()).sort((a, b) => b[1].n - a[1].n)) {
      console.log(`  ${st.padEnd(9)} ${String(s.n).padStart(5)} pieces   in feed ${pct(s.matched, s.n).padStart(6)}   usable copy ${pct(s.long, s.n).padStart(6)}`)
    }
  }

  if (flag('samples')) {
    // What the copy actually says, verbatim. Whether a text model can read a
    // cut out of this is the whole question, and it cannot be answered by
    // counting dimensions.
    let shown = 0
    for (const [wid] of picked) {
      const w = byId.get(wid) as any
      const feedRows = await feed(String(w.base_url).replace(/\/$/, ''))
      const byHandle = new Map(feedRows.map((f) => [f.handle, f]))
      for (const r of rows.filter((x) => x.watched_brand_id === wid && x.status === 'kept')) {
        const f = r.shopify_handle ? byHandle.get(r.shopify_handle) : undefined
        if (!f || f.body.length < 120 || shown >= 6) continue
        shown++
        const read = tagFromRules([r.item_type, r.product_name, f.body].filter(Boolean).join(' '))
        console.log(`\n  ── ${w.name} · ${r.item_type} · ${r.product_name}`)
        console.log(`     ${f.body.slice(0, 460)}`)
        console.log(`     rules read: ${JSON.stringify(read)}`)
      }
      if (shown >= 6) break
    }
  }

  if (cmpN) {
    console.log(`\nACCURACY — rules reading vs the library's own tags (${truthN} accepted pieces, ${cmpN} dimension readings)`)
    console.log(`  exact agreement   : ${pct(exact, cmpN)}`)
    console.log(`  within one point  : ${pct(exact + within1, cmpN)}`)
    console.log('\n  per dimension (read count, exact, within 1):')
    for (const [d, s] of Array.from(dimStats.entries()).sort((a, b) => b[1].read - a[1].read)) {
      if (s.read < 5) continue
      console.log(`    ${d.padEnd(20)} ${String(s.read).padStart(5)}   ${pct(s.exact, s.read).padStart(6)}   ${pct(s.near, s.read).padStart(6)}`)
    }
  }

  if (flag('verbose')) {
    console.log('\nSAMPLES')
    for (const m of misses) {
      console.log(`  ${m.name}`)
      console.log(`     read  ${JSON.stringify(m.read)}`)
      console.log(`     truth ${JSON.stringify(m.truth)}`)
    }
  }
}

main().catch((err) => { console.error('\n' + (err instanceof Error ? err.message : String(err))); process.exit(1) })
