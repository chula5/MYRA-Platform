// Server-side persistence for the House Style Constitution.
// Pure rules live in house-style.ts; this file loads what they've learned and
// records what they reject.
import 'server-only'
import { createAdminClient } from '@/lib/supabase-server'
import { materialFamily, type HouseItem, type RuleHit } from '@/lib/house-style'
import type { ItemWithBrand } from '@/lib/admin-queries'
import { slotForItemType } from '@/lib/composer'

// Map a library item onto the constitution's item shape.
export function toHouseItem(it: ItemWithBrand, slot?: string): HouseItem {
  const a = it as any
  return {
    item_id: it.item_id,
    slot: slot ?? slotForItemType(it.item_type),
    item_type: it.item_type as string,
    product_name: it.product_name,
    brand_name: it.brand?.name ?? null,
    colour_family: a.colour_family ?? null,
    colour_hex: a.colour_hex ?? null,
    colour_depth: a.colour_depth ?? null,
    pattern: a.pattern ?? null,
    surface: a.surface ?? null,
    sheen: a.sheen ?? null,
    fit: a.fit ?? null,
    structure: a.structure ?? null,
    waist_definition: a.waist_definition ?? null,
    leg_opening: a.leg_opening ?? null,
    length: a.length ?? null,
    material_category: a.material_category ?? null,
    material_primary: a.material_primary ?? null,
    material_formality: a.material_formality ?? null,
    material_weight: a.material_weight ?? null,
    jewellery_scale: a.jewellery_scale ?? null,
    jewellery_finish: a.jewellery_finish ?? null,
    jewellery_style: a.jewellery_style ?? null,
    price: a.price ?? null,
    price_tier: (it.brand as any)?.price_tier ?? null,
    print_flag: a.print_flag ?? null,
    neckline: a.neckline ?? null,
    is_activewear: a.is_activewear ?? null,
  }
}

// ── Learned material pairings ────────────────────────────────────────────────

export interface LearnedPairs {
  approved: Set<string>
  rejected: Set<string>
}

export async function loadLearnedMaterialPairs(): Promise<LearnedPairs> {
  const empty = { approved: new Set<string>(), rejected: new Set<string>() }
  try {
    const admin = createAdminClient()
    const { data } = await admin.from('material_pairing' as any).select('pair_key, verdict, approvals, rejections').limit(2000)
    const approved = new Set<string>()
    const rejected = new Set<string>()
    for (const r of (data ?? []) as any[]) {
      if (r.verdict === 'approved') approved.add(r.pair_key)
      else if (r.verdict === 'rejected') rejected.add(r.pair_key)
      // Undecided pairs settle once one side clearly leads.
      else if (r.approvals >= 3 && r.approvals > r.rejections * 2) approved.add(r.pair_key)
      else if (r.rejections >= 3 && r.rejections > r.approvals * 2) rejected.add(r.pair_key)
    }
    return { approved, rejected }
  } catch {
    return empty
  }
}

const pairKeyOf = (a: string, b: string) => [a, b].sort().join('+')

// Log every material pairing Chloé approves (kept in an outfit) or swaps out —
// this is how the table grows beyond the constitution's seed list.
export async function recordMaterialPairings(
  items: HouseItem[],
  outcome: 'approve' | 'reject',
  // When set, only pairs INVOLVING this item are recorded — used on swap-out so
  // the pairs among the pieces she kept aren't logged as rejections.
  focusItemId?: string,
): Promise<void> {
  try {
    const admin = createAdminClient()
    const seen = new Set<string>()
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        if (focusItemId && items[i].item_id !== focusItemId && items[j].item_id !== focusItemId) continue
        const fa = materialFamily(items[i])
        const fb = materialFamily(items[j])
        if (fa === 'other' || fb === 'other' || fa === fb) continue
        const key = pairKeyOf(fa, fb)
        if (seen.has(key)) continue
        seen.add(key)
        const { data: existing } = await admin
          .from('material_pairing' as any)
          .select('id, approvals, rejections')
          .eq('pair_key', key)
          .maybeSingle()
        if (existing) {
          const e = existing as any
          await (admin.from('material_pairing') as any)
            .update({
              approvals: e.approvals + (outcome === 'approve' ? 1 : 0),
              rejections: e.rejections + (outcome === 'reject' ? 1 : 0),
              updated_at: new Date().toISOString(),
            })
            .eq('id', e.id)
        } else {
          await (admin.from('material_pairing') as any).insert({
            pair_key: key,
            family_a: fa < fb ? fa : fb,
            family_b: fa < fb ? fb : fa,
            approvals: outcome === 'approve' ? 1 : 0,
            rejections: outcome === 'reject' ? 1 : 0,
          })
        }
      }
    }
  } catch (err) {
    console.error('[recordMaterialPairings]', err)
  }
}

export interface MaterialPairRow {
  pair_key: string
  family_a: string
  family_b: string
  approvals: number
  rejections: number
  verdict: string | null
}

export async function loadMaterialPairTable(limit = 40): Promise<MaterialPairRow[]> {
  try {
    const admin = createAdminClient()
    const { data } = await admin
      .from('material_pairing' as any)
      .select('pair_key, family_a, family_b, approvals, rejections, verdict')
      .order('approvals', { ascending: false })
      .limit(limit)
    return (data ?? []) as any[]
  } catch {
    return []
  }
}

// ── House-rule rejections ────────────────────────────────────────────────────
// Recorded so an empty candidate pool is explainable ("38 rejected: 22 no echo").

export async function recordHouseRejections(
  hits: RuleHit[],
  anchorItemId?: string | null,
): Promise<void> {
  if (!hits.length) return
  try {
    const admin = createAdminClient()
    const counts = new Map<string, { rule: string; n: number }>()
    for (const h of hits) {
      const cur = counts.get(h.code) ?? { rule: h.rule, n: 0 }
      cur.n++
      counts.set(h.code, cur)
    }
    await (admin.from('house_rejection') as any).insert(
      [...counts.entries()].map(([code, v]) => ({
        code, rule: v.rule, count: v.n, anchor_item_id: anchorItemId ?? null,
      })),
    )
  } catch (err) {
    console.error('[recordHouseRejections]', err)
  }
}

export async function loadHouseRejectionStats(sinceDays = 30): Promise<{ code: string; rule: string | null; count: number }[]> {
  try {
    const admin = createAdminClient()
    const since = new Date(Date.now() - sinceDays * 86400000).toISOString()
    const { data } = await admin
      .from('house_rejection' as any)
      .select('code, rule, count')
      .gte('created_at', since)
      .limit(20000)
    const agg = new Map<string, { rule: string | null; count: number }>()
    for (const r of (data ?? []) as any[]) {
      const cur = agg.get(r.code) ?? { rule: r.rule, count: 0 }
      cur.count += r.count ?? 1
      agg.set(r.code, cur)
    }
    return [...agg.entries()]
      .map(([code, v]) => ({ code, rule: v.rule, count: v.count }))
      .sort((a, b) => b.count - a.count)
  } catch {
    return []
  }
}

// ── Collection selection signal (the learning mandate) ───────────────────────

export async function recordCollectionSelection(rows: {
  brandName: string
  collection?: string | null
  candidate: Record<string, unknown>
  selected: boolean
  itemId?: string | null
}[]): Promise<void> {
  if (!rows.length) return
  try {
    const admin = createAdminClient()
    await (admin.from('collection_selection') as any).insert(
      rows.map((r) => ({
        brand_name: r.brandName,
        collection: r.collection ?? null,
        candidate: r.candidate,
        selected: r.selected,
        item_id: r.itemId ?? null,
      })),
    )
  } catch (err) {
    console.error('[recordCollectionSelection]', err)
  }
}

export interface SelectionStats {
  total: number
  selected: number
  rate: number
  byBrand: { brand: string; offered: number; taken: number; rate: number }[]
}

export async function loadSelectionStats(): Promise<SelectionStats | null> {
  try {
    const admin = createAdminClient()
    const { data } = await admin
      .from('collection_selection' as any)
      .select('brand_name, selected')
      .limit(20000)
    const rows = (data ?? []) as { brand_name: string; selected: boolean }[]
    if (!rows.length) return { total: 0, selected: 0, rate: 0, byBrand: [] }
    const byBrand = new Map<string, { offered: number; taken: number }>()
    for (const r of rows) {
      const cur = byBrand.get(r.brand_name) ?? { offered: 0, taken: 0 }
      cur.offered++
      if (r.selected) cur.taken++
      byBrand.set(r.brand_name, cur)
    }
    const selected = rows.filter((r) => r.selected).length
    return {
      total: rows.length,
      selected,
      rate: selected / rows.length,
      byBrand: [...byBrand.entries()]
        .map(([brand, v]) => ({ brand, offered: v.offered, taken: v.taken, rate: v.taken / v.offered }))
        .sort((a, b) => b.offered - a.offered),
    }
  } catch {
    return null
  }
}
