// RETYPE SHOES — pieces filed under a garment, bag or accessory type because
// their name says only "shoes", "clogs" or "slippers", words the scanner's
// type rules did not know (MKDT Studio "Ardea Shoes" was a blouse, Bellerose
// "Ponyhair Clogs" hair accessories, Chylak "Monk Shoes" bags). Re-reads each
// stored name with the scanner's own classifier (typeFromStoredRow) and moves
// the piece ONLY when its name now reads as a shoe. Dry run by default;
// --apply writes.
//
//   JITI_ALIAS="{\"@/\":\"$PWD/src/\",\"server-only\":\"$PWD/scripts/stubs/server-only.cjs\",\"@vercel/functions\":\"$PWD/scripts/stubs/vercel-functions.cjs\",\"next/cache\":\"$PWD/scripts/stubs/next-cache.cjs\"}" \
//     node_modules/.bin/jiti scripts/retype-shoes.ts [--apply]
//
// Why (Chloe, 2026-11-12): Outfit Review set an MKDT Studio fringed flat in
// the TOP slot of an outfit. After --apply, rewrite the library snapshot.

import fs from 'node:fs'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'

for (const line of fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
}

const apply = process.argv.includes('--apply')
const SHOES = new Set(['boot', 'heel', 'flat', 'sneaker', 'mule', 'sandal'])

async function main() {
  const { typeFromStoredRow } = await import('@/lib/brand-watch')
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

  const rows: any[] = []
  // Only names carrying one of the words the rules newly read: a read of the
  // whole table times out on this database.
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from('item')
      .select('item_id,product_name,item_type,status,retailer_url,price,currency,image_url,stock_status,brand:brand_id(name)')
      .or('product_name.ilike.%shoe%,product_name.ilike.%clog%,product_name.ilike.%slipper%,product_name.ilike.%moccasin%,product_name.ilike.%brogue%')
      .range(from, from + 999)
    if (error) throw error
    const page = data ?? []
    rows.push(...page.filter((r: any) => !SHOES.has(r.item_type) && r.status !== 'archived' && r.status !== 'sold'))
    if (page.length < 1000) break
  }
  console.log(`pieces not filed as shoes: ${rows.length}`)

  const moves: Array<{ item_id: string; name: string; brand: string; from: string; to: string; status: string }> = []
  for (const r of rows) {
    const to = typeFromStoredRow(r)
    if (!to || !SHOES.has(to)) continue
    moves.push({ item_id: r.item_id, name: r.product_name, brand: (r as any).brand?.name ?? '', from: r.item_type, to, status: r.status })
  }
  const byType: Record<string, number> = {}
  for (const m of moves) byType[m.to] = (byType[m.to] ?? 0) + 1
  console.log(`to move: ${moves.length}`, byType)
  console.table(moves.map((m) => ({ id: m.item_id.slice(0, 8), brand: m.brand.slice(0, 18), name: m.name.slice(0, 60), from: m.from, to: m.to, status: m.status })))

  if (!apply) { console.log('dry run — pass --apply to write'); return }
  let done = 0
  for (const to of Object.keys(byType)) {
    const ids = moves.filter((m) => m.to === to).map((m) => m.item_id)
    for (let i = 0; i < ids.length; i += 200) {
      const { error } = await sb.from('item').update({ item_type: to }).in('item_id', ids.slice(i, i + 200))
      if (error) throw error
      done += Math.min(200, ids.length - i)
    }
  }
  console.log(`updated ${done} pieces`)
}

main().catch((e) => { console.error(e); process.exit(1) })
