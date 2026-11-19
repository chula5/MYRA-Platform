// NEW BRANDS JOIN THE WORLDS SHE TOOK WHOLE.
//
// When the daily picker placement (lib/picker-placement) files a new brand
// into a style world, a member who took that whole world — every brand the
// picker offers in it is one she loves or said never to (lib/brand-worlds
// tookWholeWorld) — gets the new brand added to her brands, through the same
// path her own tap takes (lib/member-brands addBrandsForMember). Only when its
// price bracket sits within one of the brands she loves in that world: a
// member who took Romance & occasion at Self-Portrait prices is not handed a
// £3,000 label because it was filed beside them.
//
// A brand she already has, said never to, wears-but-never-wants, or once took
// out (a hidden affinity row) is never added back. Dry-run plumbing members
// (is_synthetic) are never touched. NOT a 'use server' module: cron only.

import { brandKey } from '@/lib/brand-affinity'
import { addBrandsForMember } from '@/lib/member-brands'
import { brandBracket, type Bracket } from '@/lib/brand-families'
import { bracketFits, bracketFromMedian, tookWholeWorld, worldNames, worldOf } from '@/lib/brand-worlds'

export interface NewlyFiled { brand_id: string; brand: string; group: string }
export interface WorldJoin { member_id: string; member: string; brands: string[]; error?: string }

/** Clothing, shoes and bags only: a pair of earrings says little about a label's price. */
const PRICE_SKIP = /jewel|earring|necklace|bracelet|ring|brooch|hair|sock|belt|scarf|glove|sunglass|hat/

async function estimatedBracket(admin: any, b: NewlyFiled): Promise<Bracket | null> {
  const authored = brandBracket(b.brand)
  if (authored) return authored
  const { data } = await admin.from('item').select('price_gbp, item_type').eq('brand_id', b.brand_id).not('price_gbp', 'is', null).limit(300)
  const prices = ((data ?? []) as any[]).filter((i) => !PRICE_SKIP.test(String(i.item_type ?? ''))).map((i) => Number(i.price_gbp)).filter((p) => p > 0).sort((x, y) => x - y)
  return prices.length ? bracketFromMedian(prices[Math.floor(prices.length / 2)]) : null
}

/** Brands filed into a world in the last two days: the join retries a day that failed, and is a no-op for a member who already has them. */
export async function recentlyFiled(admin: any, days = 2): Promise<NewlyFiled[]> {
  const since = new Date(Date.now() - days * 86_400_000).toISOString()
  const { data } = await admin.from('brand').select('brand_id, name, picker_group')
    .eq('status', 'stocked').gte('picker_group_at', since).not('picker_group', 'is', null).neq('picker_group', 'none')
  return ((data ?? []) as any[]).map((r) => ({ brand_id: String(r.brand_id), brand: String(r.name), group: String(r.picker_group) }))
}

export async function joinWholeWorlds(admin: any, filed: NewlyFiled[], opts: { dry?: boolean } = {}): Promise<WorldJoin[]> {
  const placed = filed.filter((f) => f.group && f.group !== 'none')
  if (!placed.length) return []
  const newIds = new Set(placed.map((p) => p.brand_id))

  const [{ data: members }, { data: filedRows }] = await Promise.all([
    admin.from('pilot_member').select('member_id, name, brands, brands_never, brands_input_only').eq('is_synthetic', false),
    admin.from('brand').select('brand_id, name, picker_group').eq('status', 'stocked').not('picker_group', 'is', null).neq('picker_group', 'none'),
  ])
  // The world as she saw it when she chose: the new brands themselves are not yet in it.
  const before = ((filedRows ?? []) as any[]).filter((r) => !newIds.has(String(r.brand_id)))
  const brackets = new Map<string, Bracket | null>()
  for (const p of placed) brackets.set(p.brand_id, await estimatedBracket(admin, p))

  const out: WorldJoin[] = []
  for (const m of (members ?? []) as any[]) {
    const lovedNames = ((m.brands ?? []) as any[]).map((b) => String(b?.name ?? '')).filter(Boolean)
    const loved = new Set(lovedNames.map(brandKey))
    const never = new Set([...(m.brands_never ?? []), ...(m.brands_input_only ?? [])].map((n: string) => brandKey(String(n))))
    const adds: string[] = []
    for (const p of placed) {
      const k = brandKey(p.brand)
      if (loved.has(k) || never.has(k)) continue
      if (!tookWholeWorld(worldNames(p.group, before), loved, never)) continue
      const hers = lovedNames
        .filter((n) => worldOf({ name: n, picker_group: before.find((r) => brandKey(r.name) === brandKey(n))?.picker_group }) === p.group)
        .map((n) => brandBracket(n))
        .filter((x): x is Bracket => x != null)
      if (!bracketFits(brackets.get(p.brand_id) ?? null, hers)) continue
      adds.push(p.brand)
    }
    if (!adds.length) continue
    // Never back in if she once took it out.
    const ids = placed.filter((p) => adds.includes(p.brand)).map((p) => p.brand_id)
    const { data: hidden } = await admin.from('user_brand_affinity').select('brand_id').eq('user_id', m.member_id).eq('hidden', true).in('brand_id', ids)
    const out_ = new Set(((hidden ?? []) as any[]).map((r) => String(r.brand_id)))
    const names = placed.filter((p) => adds.includes(p.brand) && !out_.has(p.brand_id)).map((p) => p.brand)
    if (!names.length) continue
    const row: WorldJoin = { member_id: m.member_id, member: m.name, brands: names }
    if (!opts.dry) {
      const r = await addBrandsForMember({ memberId: m.member_id, test: false }, names)
      if (r.error) row.error = r.error
    }
    out.push(row)
  }
  return out
}
