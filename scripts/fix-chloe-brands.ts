// One-off data fix for Chloe's brand world (taste review 2026-09-30):
//  1. Add her 4 unmatched named brands (Massimo Dutti, Mint Velvet, Jigsaw,
//     Ralph Lauren) as reference brands so her intake list stops being
//     discarded, and give her the 1.0 'onboarded' affinity for each.
//  2. Brands she named in the taste review as loved-but-pricey (Ulla Johnson,
//     Zimmermann, AFLALO) → 1.0 'onboarded' so they are exempt from the
//     suggestion price gate; item-level priceVerdict filters at composition.
//  3. MKDT Studio + Cmmn Swdn ("not me at all") → hidden (hard filter).
//  4. Report on the duplicate brand rows (Sandro, POSSE) — read-only.
// Run: jiti scripts/fix-chloe-brands.ts
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8').split('\n')
    .filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] }),
)
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

const CHLOE = '9593c768-cd52-4bf2-99bc-5a44ae2bc8e2'

const MISSING_BRANDS = [
  { name: 'Massimo Dutti', price_tier: 2, aliases: [] },
  { name: 'Mint Velvet', price_tier: 2, aliases: [] },
  { name: 'Jigsaw', price_tier: 2, aliases: [] },
  { name: 'Ralph Lauren', price_tier: 3, aliases: ['Polo Ralph Lauren'] },
]

const REVIEW_NAMED = ['Ulla Johnson', 'Zimmermann', 'AFLALO']
const HIDE = ['MKDT Studio', 'Cmmn Swdn']

async function brandByName(name: string) {
  const { data } = await sb.from('brand').select('brand_id, name, status').ilike('name', name).limit(1)
  return (data ?? [])[0] ?? null
}

async function writeAffinity(brandId: string, patch: Record<string, unknown>, source: string, reason: string) {
  const { data: old } = await sb.from('user_brand_affinity')
    .select('affinity').eq('user_id', CHLOE).eq('brand_id', brandId).maybeSingle()
  const { error } = await sb.from('user_brand_affinity').upsert(
    { user_id: CHLOE, brand_id: brandId, updated_at: new Date().toISOString(), ...patch },
    { onConflict: 'user_id,brand_id' })
  if (error) { console.error(`  ! affinity write failed for ${brandId}:`, error.message); return }
  await sb.from('brand_affinity_event').insert({
    user_id: CHLOE, brand_id: brandId,
    old_value: old?.affinity ?? null, new_value: (patch.affinity as number) ?? old?.affinity ?? null,
    source, reason,
  })
  console.log(`  ✓ ${patch.affinity ?? ''} ${source} (${reason}) — was ${old?.affinity ?? 'none'}`)
}

async function main() {
  console.log('=== 1. Missing named brands → reference + onboarded 1.0 ===')
  for (const b of MISSING_BRANDS) {
    let row = await brandByName(b.name)
    if (!row) {
      const { data, error } = await sb.from('brand').insert({
        name: b.name, price_tier: b.price_tier, aliases: b.aliases,
        era_orientation: 3, aesthetic_output: 3, cultural_legibility: 3, creative_behaviour: 3,
        status: 'reference',
      }).select('brand_id, name, status').single()
      if (error) { console.error(`  ! insert ${b.name}:`, error.message); continue }
      row = data
      console.log(`  + created reference brand ${b.name}`)
    } else {
      console.log(`  · ${b.name} already exists (${row.status})`)
    }
    await writeAffinity(row.brand_id, { affinity: 1.0, source: 'onboarded', expansion_trace: null },
      'onboarded', 'named at intake — brand added to the graph 2026-09-30')
  }

  console.log('\n=== 2. Loved-but-pricey → onboarded 1.0 (exempt from suggestion price gate) ===')
  for (const name of REVIEW_NAMED) {
    const row = await brandByName(name)
    if (!row) { console.error(`  ! ${name} not found in brand table`); continue }
    await writeAffinity(row.brand_id, { affinity: 1.0, source: 'onboarded', expansion_trace: null },
      'onboarded', 'named in taste review 2026-09-30')
  }

  console.log('\n=== 3. Not-her brands → hidden ===')
  for (const name of HIDE) {
    const row = await brandByName(name)
    if (!row) { console.error(`  ! ${name} not found`); continue }
    await writeAffinity(row.brand_id, { hidden: true }, 'hidden', 'taste review 2026-09-30: Scandi, not her')
  }

  console.log('\n=== 4. Duplicate brand rows (read-only report) ===')
  for (const name of ['Sandro – Official Website', 'THE POSSE', 'POSSE']) {
    const { data: rows } = await sb.from('brand').select('brand_id, name, status, vector_item_count').ilike('name', name)
    for (const r of rows ?? []) {
      const { count: items } = await sb.from('item').select('item_id', { count: 'exact', head: true }).eq('brand_id', r.brand_id)
      const { count: affs } = await sb.from('user_brand_affinity').select('brand_id', { count: 'exact', head: true }).eq('brand_id', r.brand_id)
      const { count: mems } = await sb.from('brand_family_membership').select('brand_id', { count: 'exact', head: true }).eq('brand_id', r.brand_id)
      const { count: codes } = await sb.from('brand_codes').select('brand_id', { count: 'exact', head: true }).eq('brand_id', r.brand_id)
      console.log(`  ${r.name} [${r.brand_id.slice(0, 8)}] items=${items} affinities=${affs} families=${mems} codes=${codes}`)
      const { data: sample } = await sb.from('item').select('name, item_type, price_gbp').eq('brand_id', r.brand_id).limit(5)
      for (const i of sample ?? []) console.log(`      · ${i.item_type} | ${i.name} | £${i.price_gbp ?? '?'}`)
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
