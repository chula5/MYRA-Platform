// WHERE DOES A STYLING TAP GO? — one tap, stage by stage, against the live
// database (no judge spend unless --judge; nothing is written except the
// size cache the real path writes too, and the library snapshot).
//
//   JITI_ALIAS="{\"@/\":\"$PWD/src/\",\"server-only\":\"next/dist/compiled/server-only/empty.js\",\"@vercel/functions\":\"$PWD/scripts/stubs/vercel-functions.cjs\",\"next/cache\":\"$PWD/scripts/stubs/next-cache.cjs\"}" \
//     node_modules/.bin/jiti scripts/profile-styling-tap.ts [memberId] [heroItemId] [blend|wardrobe|inspiration] [--judge] [--cold]
//
// --judge   also runs MYRA's eye on the composed looks (~2p a look)
// --cold    ignore the library snapshot: read the shop from the database
//           (what a tap paid before lib/library-snapshot) and write it back
//
// Measured 2026-11-03 (Chloe, 16Arlington Flora skirt, inspiration): the
// library was 20–49s cold from the database and everything else under 5s.

import fs from 'node:fs'
import path from 'node:path'

for (const line of fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
}
const args = process.argv.slice(2).filter((a) => !a.startsWith('--'))
const MEMBER = args[0] ?? '9593c768-cd52-4bf2-99bc-5a44ae2bc8e2'
const HERO = args[1] ?? '3fa02b88-d889-4e4f-b2a5-09507756cc5d'
const MODE = (args[2] ?? 'inspiration') as 'blend' | 'wardrobe' | 'inspiration'
const JUDGE = process.argv.includes('--judge')
const COLD = process.argv.includes('--cold')
const t = (label: string, t0: number) => console.log(`${label}: ${Date.now() - t0}ms`)

async function main() {
  const { createAdminClient } = await import('@/lib/supabase-server')
  const admin = createAdminClient() as any
  const T0 = Date.now()
  let t0 = Date.now()
  const [{ data: member }, { data: hero }] = await Promise.all([
    admin.from('pilot_member').select('*').eq('member_id', MEMBER).maybeSingle(),
    admin.from('item').select('*, brand(*)').eq('item_id', HERO).neq('status', 'archived').maybeSingle(),
  ])
  t('member + hero reads', t0)
  if (!member || !hero) throw new Error('member or hero not found')

  const snap = await import('@/lib/library-snapshot')
  if (COLD) {
    t0 = Date.now(); const r = await snap.refreshLibrarySnapshotIfDue({ demand: true, admin }); t(`library from the DATABASE (snapshot ${r.refreshed ? 'rewritten' : 'kept'})`, t0)
    snap.resetLibrarySnapshotMemory()
  }
  t0 = Date.now(); const lib = await snap.loadRetailLibrary({ admin }); t(`loadRetailLibrary → ${lib.items.length} pieces, ${lib.sizeRows.size} with sizes, from ${lib.from}, ${Math.round((Date.now() - lib.at) / 1000)}s old`, t0)

  const acts = await import('@/app/admin/private-stylist/actions')
  t0 = Date.now(); const library = await acts.loadComposableLibrary(member); t(`loadComposableLibrary (her gate + owned) → ${library.length}`, t0)
  t0 = Date.now(); await acts.loadComposableLibrary(member); t('loadComposableLibrary again (memory)', t0)

  const sw = await import('@/lib/styled-ways')
  t0 = Date.now()
  const [taste, lens, history, kept] = await Promise.all([
    acts.loadMemberTaste(admin, member), acts.loadPersonaLens(admin, MEMBER), acts.loadComposeHistory(admin, MEMBER), sw.keptItemIds(admin, MEMBER, HERO, MODE),
  ])
  t(`taste + lens + history + kept (${kept.length} kept)`, t0)

  const { composeMemberVariants } = await import('@/lib/pilot-composer')
  const { isOwnedItem } = await import('@/lib/wardrobe/owned-items')
  const { occasionsForMember } = await import('@/lib/client-occasions')
  const retail = library.filter((i: any) => !isOwnedItem(i))
  const pool = MODE === 'inspiration'
    ? (retail.some((i: any) => i.item_id === HERO) ? retail : [...retail, hero])
    : (library.some((i: any) => i.item_id === HERO) ? library : [...library, hero])
  const occ = occasionsForMember(member.occasions).filter((id: string) => id !== 'kids').slice(0, 2)
  const looks: any[] = []
  const rounds: (string | null)[] = occ.length ? occ : [null]
  rounds.forEach((id, oi) => {
    t0 = Date.now()
    const out = composeMemberVariants(taste, pool as any, HERO, 3, id ? { id, climate: null, workDressCode: member.work_dress_code ?? null } as any : undefined, lens, history, { ownedMode: MODE === 'inspiration' ? 'retail_only' : 'blend', shuffle: oi })
    t(`composeMemberVariants[${id ?? 'no occasion'}] → ${out.length} looks over ${pool.length}`, t0)
    looks.push(...out)
  })
  const chosen = looks.slice(0, 5)
  console.log('pieces per look:', chosen.map((l) => l.items.length).join(', '))

  const { memberMemory } = await import('@/lib/member-memory')
  t0 = Date.now(); const mem = await memberMemory(MEMBER); t(`memberMemory (${mem.text.length} chars)`, t0)
  const { checkSizesForMember } = await import('@/lib/look-size-check')
  const allItems = chosen.flatMap((l) => l.items)
  t0 = Date.now(); const szNone = await checkSizesForMember(admin, MEMBER, allItems, 'none'); t(`sizes from the cache: ${szNone.size} pieces`, t0)
  const unconfirmed = Array.from(szNone.values()).filter((v) => v.verdict === 'unconfirmed').length
  t0 = Date.now(); const sz = await checkSizesForMember(admin, MEMBER, allItems, 'unknown'); t(`sizes re-read from retailers (${unconfirmed} unconfirmed before, ${Array.from(sz.values()).filter((v) => v.verdict === 'unconfirmed').length} after)`, t0)

  if (JUDGE) {
    const { checkLook } = await import('@/lib/look-check')
    t0 = Date.now()
    await Promise.all(chosen.map(async (l, i) => {
      const s = Date.now(); const c = await checkLook(l.items, mem.text)
      console.log(`  checkLook[${i}] ${Date.now() - s}ms → ${c?.verdict ?? 'null'}${c?.issues?.length ? ` (${c.issues.join('; ')})` : ''}`)
    }))
    t(`checkLook ×${chosen.length} in parallel`, t0)
  }
  t('TOTAL', T0)
  const stub = await import('@vercel/functions') as any
  if (typeof stub.flush === 'function') await stub.flush()
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
