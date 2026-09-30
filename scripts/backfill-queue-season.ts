// FILL IN THE SEASON ON PIECES ALREADY IN THE QUEUE.
//
// A scan writes a season on each piece it queues, but only for pieces it queues
// from then on. Everything already sitting in the queue was queued before that,
// so its season is null — and a null season counts as in season, which is why
// THE POSSE's summer stock kept showing in the autumn view long after the scan
// was taught better. Worse, the admin page cannot work the season out for itself:
// it re-derives from the row, and the row does not keep the shop's tags, which is
// where the season is stated.
//
// This reads each brand's shop the same way a scan does — its catalogue for the
// tags, its own season collections for the pieces the shop has filed by season —
// and writes the answer onto the rows that are already there. With
// --remove-out-of-season, old summer rows are recorded as wrong-season skips;
// nothing is deleted.
//
//   node_modules/.bin/jiti scripts/backfill-queue-season.ts            # every brand
//   node_modules/.bin/jiti scripts/backfill-queue-season.ts --brand=POSSE
//   node_modules/.bin/jiti scripts/backfill-queue-season.ts --dry-run
//   node_modules/.bin/jiti scripts/backfill-queue-season.ts --remove-out-of-season
//
// Run supabase/migrations/0076_queue_new_in.sql first to also record which
// pieces are in the shop's new-in section; without it the season is still filled
// and new_in is left alone.

import fs from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { seasonOf } from '../src/lib/season'
import { inCurrentSeason } from '../src/lib/season'
import { fetchShopSignals, type SeasonByHandle } from '../src/lib/brand-watch-collections'

const env: Record<string, string> = {}
for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
}

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const removeOutOfSeason = args.includes('--remove-out-of-season')
const brandArg = args.find((a) => a.startsWith('--brand='))?.split('=')[1]

const UA = 'Mozilla/5.0 (Macintosh) MYRA-BrandWatch/1.0'

/** The whole catalogue, so a queued handle can be looked up for its tags. */
async function fetchCatalogue(baseUrl: string): Promise<Map<string, any>> {
  const out = new Map<string, any>()
  for (let page = 1; page <= 40; page++) {
    let res: Response
    try {
      res = await fetch(`${baseUrl}/products.json?limit=250&page=${page}`, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(25000) })
    } catch { break }
    if (!res.ok) break
    const json: any = await res.json().catch(() => ({}))
    const batch: any[] = json?.products ?? []
    for (const p of batch) if (p?.handle) out.set(String(p.handle), p)
    if (batch.length < 250) break
  }
  return out
}

async function main() {
  const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

  // Does the new_in column exist yet? If not, leave it alone.
  const probe = await (db as any).from('brand_watch_queue').select('queue_id, new_in').limit(1)
  const hasNewIn = !probe.error

  const { data: brands, error: berr } = await (db as any)
    .from('watched_brand')
    .select('watched_brand_id, name, base_url, platform')
    .order('name')
  if (berr) throw new Error(berr.message)

  const wanted = (brands ?? []).filter((b: any) =>
    (!brandArg || String(b.name).toUpperCase().includes(brandArg.toUpperCase())) && b.platform === 'shopify')

  console.log(`${dryRun ? 'DRY RUN — ' : ''}${wanted.length} Shopify brands${brandArg ? ` matching "${brandArg}"` : ''}`)
  if (!hasNewIn) console.log('note: new_in column not present (run migration 0076 to record it)')

  let totalRows = 0
  let totalChanged = 0
  let totalPlaced = 0
  const summary: Array<{ name: string; rows: number; placed: number; outOfSeason: number; newIn: number; couldNotAsk: boolean }> = []

  const rowFields = 'queue_id, product_name, item_type, material_category, material_primary, shopify_handle, season' + (hasNewIn ? ', new_in' : '')

  for (const b of wanted) {
    const rows: any[] = []
    for (let from = 0; ; from += 1000) {
      const { data, error } = await (db as any)
        .from('brand_watch_queue')
        .select(rowFields)
        .eq('watched_brand_id', b.watched_brand_id)
        .eq('status', 'queued')
        .order('queue_id')
        .range(from, from + 999)
      if (error) throw new Error(`${b.name}: ${error.message}`)
      rows.push(...(data ?? []))
      if (!data || data.length < 1000) break
    }
    if (!rows.length) continue
    totalRows += rows.length

    const catalogue = await fetchCatalogue(b.base_url)
    const signals = await fetchShopSignals(b.base_url)
    const seasonByHandle: SeasonByHandle | null = signals.seasonByHandle
    const preOrderByHandle = signals.preOrderByHandle
    const couldNotAsk = signals.newIn === null && seasonByHandle === null

    let placed = 0
    let outOfSeason = 0
    let newInCount = 0
    const now = new Date()

    for (const r of rows) {
      const p = catalogue.get(String(r.shopify_handle))
      const tags: string[] = p ? (Array.isArray(p.tags) ? p.tags : String(p.tags ?? '').split(',').map((s: string) => s.trim()).filter(Boolean)) : []
      const fromShop = seasonByHandle?.get(String(r.shopify_handle)) ?? null
      const read = seasonOf({
        tags,
        title: r.product_name,
        productType: p?.product_type ?? null,
        itemType: r.item_type,
        materialCategory: r.material_category,
        materialPrimary: r.material_primary,
        collectionSeason: fromShop?.season ?? null,
        collectionCode: fromShop?.code ?? null,
        preOrder: preOrderByHandle?.has(String(r.shopify_handle)) ?? false,
      })
      const isNewIn = signals.newIn !== null && signals.newIn.has(String(r.shopify_handle))
      if (read.season) placed++
      // The same test the queue uses: the opposite season, or a season already
      // gone by (a piece tagged AW25 is last autumn's stock).
      if (!inCurrentSeason(read.season, read.code, now)) outOfSeason++
      if (isNewIn) newInCount++

      const patch: Record<string, unknown> = {}
      // The code matters as much as the season: it is what says whether a piece
      // is last season's stock, so a row left holding a stale code would keep
      // showing. Comparing only the season missed exactly that.
      if (r.season !== read.season) patch.season = read.season
      if (r.season_code !== read.code) patch.season_code = read.code
      if (hasNewIn && Boolean(r.new_in) !== isNewIn) patch.new_in = isNewIn
      if (removeOutOfSeason && !inCurrentSeason(read.season, read.code, now)) {
        patch.status = 'skipped'
        patch.decided_at = new Date().toISOString()
        patch.skip_reason = 'wrong_season'
      }
      if (!Object.keys(patch).length) continue
      totalChanged++
      if (!dryRun) {
        let { error } = await (db as any).from('brand_watch_queue').update(patch).eq('queue_id', r.queue_id)
        // Older installations may not have skip_reason yet. The season
        // cleanup still matters, so retry the status update without it.
        if (error && /skip_reason/.test(error.message)) {
          const { skip_reason: _skipReason, ...withoutReason } = patch
          ;({ error } = await (db as any).from('brand_watch_queue').update(withoutReason).eq('queue_id', r.queue_id))
        }
        if (error) throw new Error(`${b.name} ${r.queue_id}: ${error.message}`)
      }
    }

    totalPlaced += placed
    summary.push({ name: b.name, rows: rows.length, placed, outOfSeason, newIn: newInCount, couldNotAsk })
    console.log(`  ${String(b.name).slice(0, 24).padEnd(26)} ${String(rows.length).padStart(4)} queued, ${String(placed).padStart(4)} placed by season, ${String(outOfSeason).padStart(4)} out of season, ${String(newInCount).padStart(3)} new in${couldNotAsk ? '  [shop could not be asked]' : ''}`)
  }

  console.log(`\n${totalRows} queued rows, ${totalPlaced} placed by season, ${totalChanged} rows ${dryRun ? 'would be' : ''} updated`)
  const worst = summary.filter((s) => s.outOfSeason > 0).sort((a, b) => b.outOfSeason - a.outOfSeason).slice(0, 8)
  if (worst.length) {
    console.log('\nnow behind the SUMMER chip:')
    for (const s of worst) console.log(`  ${String(s.name).slice(0, 24).padEnd(26)} ${s.outOfSeason}`)
  }
}

main().catch((e) => { console.error('\n' + (e instanceof Error ? e.message : String(e))); process.exit(1) })
