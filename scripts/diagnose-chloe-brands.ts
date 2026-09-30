// Read-only diagnostic: why was Chloe matched with MKDT Studio / CMMN SWDN?
// Run: jiti scripts/diagnose-chloe-brands.ts
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8').split('\n')
    .filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] }),
)
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

const INTERESTING = ['mkdt', 'cmmn', 'claudie', 'sandro', 'posse', 'ulla', 'zimmermann', 'aflalo', 'massimo', 'mint velvet', 'jigsaw', 'ralph lauren', 'sezane', 'sézane', 'maje', 'isabel marant', 'antik batik']

async function main() {
  // 1. find Chloe
  const { data: members } = await sb.from('pilot_member').select('member_id, name, brands, brands_input_only, price_bands, is_synthetic')
  const chloe = (members ?? []).find((m: any) => /chloe/i.test(m.name ?? ''))
  if (!chloe) { console.log('Chloe not found; members:', (members ?? []).map((m: any) => m.name)); return }
  console.log('=== MEMBER ===')
  console.log('name:', chloe.name, '| id:', chloe.member_id)
  console.log('brands:', JSON.stringify(chloe.brands))
  console.log('brands_input_only:', JSON.stringify(chloe.brands_input_only))
  console.log('price_bands:', JSON.stringify(chloe.price_bands))

  // 2. her affinities above baseline, with traces
  const { data: aff } = await sb.from('user_brand_affinity').select('*').eq('user_id', chloe.member_id)
  const { data: brands } = await sb.from('brand').select('brand_id, name, aliases, status, price_tier, vector_item_count, median_price_overall, median_price_by_category, core_category, price_position')
  const byId = new Map((brands ?? []).map((b: any) => [b.brand_id, b]))
  const rows = (aff ?? [])
    .filter((r: any) => r.affinity > 0.1 || r.source !== 'expanded' || (r.expansion_trace && r.expansion_trace !== 'baseline'))
    .sort((a: any, b: any) => b.affinity - a.affinity)
  console.log('\n=== AFFINITIES (above baseline) ===')
  for (const r of rows) {
    const b: any = byId.get(r.brand_id)
    console.log(`${r.affinity.toFixed(2)} ${r.source.padEnd(10)} ${b?.name ?? r.brand_id} | median £${b?.median_price_overall ?? '?'} | trace: ${r.expansion_trace ?? '-'}`)
  }

  // 3. the interesting brands: codes + price position + families
  console.log('\n=== BRAND RECORDS ===')
  const hits = (brands ?? []).filter((b: any) => INTERESTING.some((p) => String(b.name).toLowerCase().includes(p)))
  const { data: codes } = await sb.from('brand_codes').select('*')
  const codesBy = new Map<string, any[]>()
  for (const c of codes ?? []) { const l = codesBy.get(c.brand_id) ?? []; l.push(c); codesBy.set(c.brand_id, l) }
  const { data: mems } = await sb.from('brand_family_membership').select('*')
  const { data: fams } = await sb.from('brand_family').select('*')
  const famName = new Map((fams ?? []).map((f: any) => [f.family_id, f.name]))
  for (const b of hits) {
    console.log(`\n${b.name} [${b.status}] tier=${b.price_tier} items=${b.vector_item_count} median=£${b.median_price_overall ?? '?'} core=${b.core_category} pos=${b.price_position ? Math.exp(b.price_position).toFixed(0) : '?'}`)
    console.log('  codes:', JSON.stringify(Object.fromEntries((codesBy.get(b.brand_id) ?? []).map((c: any) => [c.dimension_key, c.value]))))
    const m = (mems ?? []).filter((x: any) => x.brand_id === b.brand_id)
    console.log('  families:', m.map((x: any) => `${famName.get(x.family_id)} (${x.weight})`).join(', ') || 'none')
  }

  // 4. families containing the scandi suspects
  console.log('\n=== FAMILIES OF MKDT/CMMN ===')
  for (const b of hits.filter((b: any) => /mkdt|cmmn/i.test(b.name))) {
    for (const m of (mems ?? []).filter((x: any) => x.brand_id === b.brand_id)) {
      const others = (mems ?? []).filter((x: any) => x.family_id === m.family_id && x.brand_id !== b.brand_id)
      console.log(`${b.name} in "${famName.get(m.family_id)}" (${m.weight}) with: ${others.map((x: any) => `${(byId.get(x.brand_id) as any)?.name}(${x.weight})`).join(', ')}`)
    }
  }

  // 5. unmatched log for Chloe
  const { data: un } = await sb.from('unmatched_brand_log').select('raw_name, created_at').eq('user_id', chloe.member_id)
  console.log('\n=== UNMATCHED LOG ===')
  console.log((un ?? []).map((r: any) => r.raw_name).join(', ') || 'none')
}

main().catch((e) => { console.error(e); process.exit(1) })
