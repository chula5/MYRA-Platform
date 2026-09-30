// CAN THE RELEASE MONTH TELL US THE SEASON?
//
// The queue is full of summer clothes in September, and the season module
// cannot help because it guesses from the kind of piece and its material — for
// THE POSSE that leaves 320 of 438 pieces unplaced, and an unplaced piece counts
// as in-season, so summer shows up in the autumn view.
//
// The shops carry a much better signal and already publish it: when the product
// went live. Shopify serves published_at on every product, free, with no API
// call. (POSSE additionally tags products with a month-year code — AUGUST2025,
// MAY2026 — and published_at matches that tag 78% of the time. But that tag is
// POSSE's own convention: across 12,896 cached products from 8 other shops, not
// one carries it. So published_at is the signal worth relying on.)
//
// But is a release month actually a SEASON? Fashion runs ahead of the calendar,
// and an autumn drop can land in July. That is not a thing to assume, so this
// checks it against the shops that state their season outright: where a product
// carries both an explicit code (SS26, AW25) and a release month, do the two
// agree?
//
//   node_modules/.bin/jiti scripts/release-month-season.ts

import fs from 'node:fs'
import path from 'node:path'

const CACHE = path.join(process.cwd(), 'scripts', '.eval', 'release-month-season.json')

/** Shopify serves up to 250 products per page; 40 pages is the practical ceiling. */
async function fetchFeed(base: string): Promise<any[]> {
  const out: any[] = []
  for (let page = 1; page <= 40; page++) {
    let res: Response
    try {
      res = await fetch(`${base}/products.json?limit=250&page=${page}`, {
        headers: { 'User-Agent': 'Mozilla/5.0 MYRA-BrandWatch/1.0', Accept: 'application/json' },
        signal: AbortSignal.timeout(25000),
      })
    } catch { break }
    if (!res.ok) break
    const json: any = await res.json().catch(() => ({}))
    const batch: any[] = json?.products ?? []
    if (!batch.length) break
    out.push(...batch)
    if (batch.length < 250) break
  }
  return out
}

const MONTHS = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER']

/**
 * The month a product went live. Shopify serves this on every product, so it is
 * available for the whole catalogue without reading a single image.
 */
export function releaseMonth(publishedAt: unknown): { month: number; year: number } | null {
  const raw = String(publishedAt ?? '').trim()
  if (!raw) return null
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return null
  const month = Number(m[2])
  const year = Number(m[1])
  if (month < 1 || month > 12) return null
  return { month, year }
}

/** The shop's own season code, where it states one. */
export function explicitSeason(tags: string[], title: string): { season: 'aw' | 'ss'; year: number } | null {
  const hay = [...tags, title].join(' ').toUpperCase()
  let best: { season: 'aw' | 'ss'; year: number } | null = null
  for (const m of Array.from(hay.matchAll(/\b(AW|FW|SS|PE|SP|HS)\s?(\d{2,4})\b/g))) {
    const season = /^(AW|FW)$/.test(m[1]) ? 'aw' : 'ss'
    const raw = Number(m[2])
    const year = raw < 100 ? 2000 + raw : raw
    if (!best || year > best.year) best = { season, year }
  }
  return best
}

/**
 * Which season a release month belongs to.
 *
 * August to January is autumn/winter, February to July spring/summer — the same
 * boundaries season.ts uses for "the season we are heading into", so a piece
 * released now is in season by construction.
 */
export const seasonOfMonth = (month: number): 'aw' | 'ss' => (month >= 8 || month <= 1 ? 'aw' : 'ss')

async function main() {
  // The cached feeds were saved as a projection without published_at, so the
  // release dates have to come from the live feeds. Reuse a previous fetch.
  let store: Record<string, any[]> = {}
  if (fs.existsSync(CACHE)) {
    store = JSON.parse(fs.readFileSync(CACHE, 'utf8'))
    console.log(`reusing ${Object.keys(store).length} cached feeds from ${path.relative(process.cwd(), CACHE)}`)
  }
  const raw = fs.existsSync(path.join(process.cwd(), 'scripts', '.eval', 'feeds.json'))
    ? Object.entries(JSON.parse(fs.readFileSync(path.join(process.cwd(), 'scripts', '.eval', 'feeds.json'), 'utf8')) as Record<string, any[]>)
    : []
  const targets = raw.filter(([, rows]) => rows.length >= 200).map(([url]) => url).concat(['https://posse.com'])

  for (const url of targets) {
    if (store[url]?.length) continue
    process.stdout.write(`fetching ${url} ... `)
    const rows = await fetchFeed(url)
    console.log(`${rows.length} products`)
    if (rows.length) store[url] = rows
  }
  fs.mkdirSync(path.dirname(CACHE), { recursive: true })
  fs.writeFileSync(CACHE, JSON.stringify(store))
  const shops = Object.entries(store).filter(([, rows]) => rows.length >= 50)
  if (!shops.length) throw new Error('no feeds fetched — check network access')

  interface Pair { shop: string; code: 'aw' | 'ss'; codeYear: number; month: number; monthYear: number; agrees: boolean }
  const pairs: Pair[] = []
  let withCode = 0, withMonth = 0, total = 0
  const perShop: Array<{ shop: string; n: number; both: number; agree: number }> = []

  for (const [url, rows] of shops) {
    let both = 0, agree = 0
    const name = url.replace(/^https?:\/\/(?:www\.)?/, '').split('.')[0]
    for (const r of rows) {
      total++
      const tags: string[] = Array.isArray(r.tags) ? r.tags : String(r.tags ?? '').split(',').map((s: string) => s.trim()).filter(Boolean)
      const code = explicitSeason(tags, String(r.title ?? ''))
      const rm = releaseMonth(r.published_at ?? r.created_at)
      if (code) withCode++
      if (rm) withMonth++
      if (!code || !rm) continue
      both++
      const agrees = seasonOfMonth(rm.month) === code.season
      if (agrees) agree++
      pairs.push({ shop: name, code: code.season, codeYear: code.year, month: rm.month, monthYear: rm.year, agrees })
    }
    perShop.push({ shop: name, n: rows.length, both, agree })
  }

  console.log(`checked ${total} products across ${shops.length} shops\n`)
  console.log(`  products stating a season code   : ${withCode} (${((100 * withCode) / total).toFixed(0)}%)`)
  console.log(`  products with a release date     : ${withMonth} (${((100 * withMonth) / total).toFixed(0)}%)`)
  console.log(`  both, so comparable              : ${pairs.length}`)

  if (!pairs.length) throw new Error('no products carry both — cannot validate')

  const agree = pairs.filter((p) => p.agrees).length
  console.log(`\nDOES THE RELEASE MONTH MATCH THE STATED SEASON?`)
  console.log(`  ${agree} of ${pairs.length} agree — ${((100 * agree) / pairs.length).toFixed(1)}%`)

  // Where they disagree, by month, is what says whether the boundary is wrong.
  console.log('\n  by release month (n, % agreeing with the stated season)')
  for (let m = 1; m <= 12; m++) {
    const list = pairs.filter((p) => p.month === m)
    if (list.length < 3) continue
    const ok = list.filter((p) => p.agrees).length
    const rate = ok / list.length
    console.log(`    ${MONTHS[m - 1].padEnd(10)} ${String(list.length).padStart(4)}   ${(rate * 100).toFixed(0).padStart(3)}%  ${'#'.repeat(Math.round(rate * 30))}`)
  }

  console.log('\n  per shop (where comparable)')
  for (const s of perShop.filter((x) => x.both >= 5).sort((a, b) => b.both - a.both)) {
    console.log(`    ${s.shop.padEnd(22)} ${String(s.both).padStart(4)} comparable   ${((100 * s.agree) / s.both).toFixed(0).padStart(3)}% agree`)
  }

  // The boundary question: is August the right start for autumn, or do the
  // shops themselves treat July as autumn already?
  console.log('\n  IS THE AUGUST BOUNDARY RIGHT?')
  for (const [label, months] of [['Feb-Jul as ss', [2, 3, 4, 5, 6, 7]], ['Aug-Jan as aw', [8, 9, 10, 11, 12, 1]]] as Array<[string, number[]]>) {
    const list = pairs.filter((p) => months.includes(p.month))
    if (!list.length) continue
    const ok = list.filter((p) => p.agrees).length
    console.log(`    ${label.padEnd(16)} ${String(list.length).padStart(4)} pairs, ${((100 * ok) / list.length).toFixed(1)}% agree`)
  }
  const july = pairs.filter((p) => p.month === 7)
  if (july.length >= 5) {
    const julyAw = july.filter((p) => p.code === 'aw').length
    console.log(`    July alone: ${july.length} pairs, ${julyAw} state autumn — ${((100 * julyAw) / july.length).toFixed(0)}% would be misfiled as summer`)
  }
}

main().catch((err) => { console.error('\n' + (err instanceof Error ? err.message : String(err))); process.exit(1) })
