// HER TASTE GRAPH, as the places she shops through read it — Browse and the
// Mirror's MORE OF THE SAME. The labels she named and the ones the graph put
// next to them (user_brand_affinity above the baseline every stocked label
// gets), never one she hid, wears-but-never-wants sent, or refused; and her
// price ceilings per kind of piece. An Oscar de la Renta skirt is not an
// answer for a woman who shops ME+EM on a £250 ceiling.
//
// No session is read here: the caller has already resolved the member.

import { SEED, brandKey } from '@/lib/brand-affinity'
import { namedBrands } from '@/lib/new-in'
import { readPriceBands, priceVerdict, type PriceBands } from '@/lib/pilot-stylist'

export interface BrandKeys { brand_id: string; keys: string[] }

export interface TasteGraph {
  /** brand_id → how strongly the label is hers, 0..1: her named labels in her
   *  own order, then the neighbours by how close they are. Empty when she has
   *  no graph and named no labels — then nothing is limited. */
  weights: Map<string, number>
  /** Labels she hid, wears-but-never-wants sent, or refused: never shown, not even as a discovery. */
  blocked: Set<string>
  bands: PriceBands
  /** Her named labels' brand ids, in her own order (lib/brand-worlds reads her worlds off them). */
  named?: string[]
}

let keyCache: { at: number; rows: BrandKeys[] } | null = null

async function brandKeys(admin: any): Promise<BrandKeys[]> {
  if (keyCache && Date.now() - keyCache.at < 5 * 60_000) return keyCache.rows
  const { data } = await admin.from('brand').select('brand_id, name, aliases').limit(3000)
  const rows = ((data ?? []) as any[]).filter((b) => b?.name).map((b) => ({
    brand_id: String(b.brand_id),
    keys: [brandKey(String(b.name)), ...((Array.isArray(b.aliases) ? b.aliases : []) as string[]).map((a) => brandKey(String(a)))].filter(Boolean),
  }))
  keyCache = { at: Date.now(), rows }
  return rows
}

export async function loadTasteGraph(admin: any, memberId: string, known?: BrandKeys[]): Promise<TasteGraph> {
  const [{ data: m }, { data: aff }, labels] = await Promise.all([
    admin.from('pilot_member').select('brands, brands_input_only, brands_never, price_bands').eq('member_id', memberId).maybeSingle(),
    // Above the baseline; plus every row she took out (hidden rows sit at the
    // floor, under the baseline, so they were never read here before) and every
    // label she has saved or said yes to — a save from a quiet maybe promotes it.
    admin.from('user_brand_affinity').select('brand_id, affinity, hidden, positive_count').eq('user_id', memberId)
      .or(`affinity.gt.${SEED.baseline},hidden.eq.true,positive_count.gt.0`).limit(1000),
    known ? Promise.resolve(known) : brandKeys(admin),
  ])
  const idsOf = (name: string) => { const k = brandKey(name); return labels.filter((b) => b.keys.includes(k)).map((b) => b.brand_id) }
  const blocked = new Set([...(m?.brands_input_only ?? []), ...(m?.brands_never ?? [])].flatMap((n: string) => idsOf(String(n))))
  // Her named labels, in her order. Naming a label is the later, truer word:
  // a hidden row left over from an earlier removal never blocks one she named.
  const namedNames = namedBrands({ member_id: memberId, ...(m ?? {}) })
  const namedIds = new Set(namedNames.flatMap(idsOf))
  const weights = new Map<string, number>()
  for (const r of ((aff ?? []) as any[])) {
    if (r.hidden && !namedIds.has(r.brand_id)) blocked.add(r.brand_id)
    if (r.hidden || blocked.has(r.brand_id)) continue
    // A label she saved or said yes to is hers, even if it started at the baseline.
    weights.set(r.brand_id, Math.min(1, Math.max(Number(r.affinity) || 0, Number(r.positive_count) > 0 ? SEED.baseline + 0.05 : 0)))
  }
  // Her named labels lead, in the order she put them.
  const named: string[] = []
  namedNames.forEach((name, i) => {
    for (const id of idsOf(name)) {
      if (blocked.has(id)) continue
      weights.set(id, Math.max(0.8, 1 - i * 0.04) + 0.001)
      if (!named.includes(id)) named.push(id)
    }
  })
  return { weights, blocked, bands: readPriceBands(m), named }
}

/** Over her ceiling for this kind of piece? A piece with no price is not judged. */
export function overHerBudget(graph: Pick<TasteGraph, 'bands'>, it: { item_type?: string | null; price_gbp?: unknown }): boolean {
  return priceVerdict(graph.bands, { item_type: it.item_type, price_gbp: it.price_gbp != null ? Number(it.price_gbp) : null }) === 'over'
}

/** A label she has turned away — never put in front of her by any route. */
export function blockedForHer(graph: Pick<TasteGraph, 'blocked'>, it: { brand_id?: string | null }): boolean {
  return graph.blocked.has(String(it.brand_id ?? ''))
}

/** Is the piece from a label in her graph? Everything is, when she has no graph yet. */
export function inHerGraph(graph: Pick<TasteGraph, 'weights'>, it: { brand_id?: string | null }): boolean {
  return !graph.weights.size || graph.weights.has(String(it.brand_id ?? ''))
}
