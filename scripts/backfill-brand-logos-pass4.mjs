// Pass 4 — variant fill. The brand table has many rows that are the same house
// under different casing/accents/typos ("Toteme"/"TOTEME", "Isabel Marant"/
// "Isbael Marrant"). If any variant resolved a logo, every sibling gets it.
// Matching is on a squashed key (lowercase, accents stripped, non-letters
// removed) plus an explicit alias map for genuine misspellings.
import { createClient } from '@supabase/supabase-js'

const supa = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

const key = (n) => n.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/&/g, 'and').replace(/[^a-z0-9]/g, '')

// Misspellings and short forms → the canonical squashed key.
const ALIAS = {
  isbaelmarant: 'isabelmarant', isbaelmarrant: 'isabelmarant',
  cultagaia: 'cultgaia', cultgaia: 'cultgaia',
  annajosturova: 'annakosturova',
  manseurgavriel: 'mansurgavriel',
  bottega: 'bottegaveneta',
  salvatoreferragamo: 'ferragamo',
  twinsetmilano: 'twinset',
  maxmara: 'maxmara', maxandco: 'maxandco',
  totemestudio: 'toteme',
  awakemode: 'awakemode',
  lemondeberyl: 'lemondeberyl',
  robertofesta: 'robertofesta',
  saintlaurent: 'saintlaurent', ysl: 'saintlaurent',
  '16arlington': 'arlington16', arlington16: 'arlington16',
}
const canon = (n) => { const k = key(n); return ALIAS[k] ?? k }

const { data: brands } = await supa.from('brand').select('brand_id, name, logo_url').order('name')

const donor = new Map()
for (const b of brands) if (b.logo_url) donor.set(canon(b.name), b.logo_url)

let filled = 0
const stillMissing = []
for (const b of brands) {
  if (b.logo_url) continue
  const url = donor.get(canon(b.name))
  if (!url) { stillMissing.push(b); continue }
  await supa.from('brand').update({ logo_url: url }).eq('brand_id', b.brand_id)
  filled++
  console.log('✓', b.name, '← variant match')
}

// What's left, split by whether anything actually uses the row.
const dead = [], live = []
for (const b of stillMissing) {
  const { count } = await supa.from('item').select('*', { count: 'exact', head: true }).eq('brand_id', b.brand_id)
  ;(count ? live : dead).push(b.name)
}

const { data: all } = await supa.from('brand').select('logo_url')
console.log(`\nvariant-filled ${filled}. Coverage: ${all.filter(x => x.logo_url).length}/${all.length}`)
console.log(`\nEMPTY ROWS, no items, safe to delete (${dead.length}):\n  ${dead.join('\n  ')}`)
console.log(`\nREAL BRANDS STILL MISSING (${live.length}):\n  ${live.join('\n  ')}`)
