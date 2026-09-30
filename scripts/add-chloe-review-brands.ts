// Append the brands Chloe named in the taste review to her intake list so
// "seed from intake" in the Taste Inspector expands from them too.
// Run: jiti scripts/add-chloe-review-brands.ts
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8').split('\n')
    .filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] }),
)
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
const CHLOE = '9593c768-cd52-4bf2-99bc-5a44ae2bc8e2'
const ADD = ['Ulla Johnson', 'Zimmermann', 'Aflalo']

async function main() {
  const { data: m } = await sb.from('pilot_member').select('brands').eq('member_id', CHLOE).single()
  const brands: Array<{ name: string; rank: number }> = (m?.brands ?? []) as any
  const have = new Set(brands.map((b) => b.name.toLowerCase()))
  let rank = brands.length
  for (const name of ADD) {
    if (have.has(name.toLowerCase())) continue
    brands.push({ name, rank: ++rank })
    console.log(`+ ${name} (rank ${rank})`)
  }
  const { error } = await sb.from('pilot_member').update({ brands }).eq('member_id', CHLOE)
  if (error) { console.error(error.message); process.exit(1) }
  console.log('intake list now:', brands.map((b) => b.name).join(', '))
}

main().catch((e) => { console.error(e); process.exit(1) })
