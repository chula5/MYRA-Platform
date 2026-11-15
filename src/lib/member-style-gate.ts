// HER REACH — what may be put in front of her unasked, as a gate over any
// list of pieces.
//
// The composer gates every piece on her avoided colours, shapes and types,
// her price bands and (for discovery) the brand's customer age. Pieces shown
// on their own — new in at her brands, her sale, the Monday edit, a studio
// look landing in her Looks — must honour the same words:
//
//   · a member who avoids heels is never sent a heel because it is 41% off
//     (Chloe, 2026-11-15, Alison's Monday draft)
//   · a £2,700 Zimmermann gilet is never "new in" for a member whose
//     outerwear band stops at £750 (Ann-Marie's draft, the same day)
//   · a brand whose customer is clearly younger than her — its oldest
//     customer, plus headroom, still under her youngest age — is never
//     pushed at her, named or not: naming a brand lets her search it, it
//     does not ask MYRA to send her its slip dresses (Anne, 60, got a
//     Reformation Radziwill dress from the studio, the same day). A member
//     with no age range, or a brand with no register, is not gated.

import 'server-only'
import { avoidReasons, readStylePrefs, priceVerdict, readPriceBands, type StylePrefs, type PriceBands } from '@/lib/pilot-stylist'
import { AGE_DIMENSION, withinMemberAgeReach, loadMemberAgeRanges } from '@/lib/brand-affinity'
import { cosine, isZero, lookVectorFromItems } from '@/lib/taste-vector'

/** The item columns the shape and colour matchers read; add to any card select that will pass through the gate. */
export const STYLE_DIMS = 'fit, length, rise, structure, shoulder, neckline, sleeve, waist_definition, leg_opening, pattern'

export interface MemberReach {
  prefs: StylePrefs
  bands: PriceBands | null
  ageRange: string | null
  /** Her 34-dim taste vector (null until she has one) — for ordering, never gating. */
  tasteVector: number[] | null
  /** customer_age_register by brand_id (brand_codes), for the age gate. */
  registerOf: (brandId: string | null | undefined) => number | null
}

export interface ReachItem {
  item_type?: string | null
  colour_family?: string | null
  product_name?: string | null
  price_gbp?: unknown
  brand_id?: string | null
}

let registerCache: { at: number; map: Map<string, number> } | null = null

/** Every brand's customer age register, read once and kept five minutes. */
export async function loadAgeRegisters(admin: any): Promise<Map<string, number>> {
  if (registerCache && Date.now() - registerCache.at < 5 * 60_000) return registerCache.map
  const map = new Map<string, number>()
  try {
    const { data } = await admin.from('brand_codes').select('brand_id, value').eq('dimension_key', AGE_DIMENSION).limit(5000)
    for (const r of (data ?? []) as any[]) if (r.value != null) map.set(String(r.brand_id), Number(r.value))
  } catch { /* no registers → no age gate */ }
  registerCache = { at: Date.now(), map }
  return map
}

export async function loadMemberReach(admin: any, memberId: string): Promise<MemberReach> {
  const [{ data: m }, ages, registers] = await Promise.all([
    admin.from('pilot_member')
      .select('colours_loved, colours_avoided, shapes_loved, shapes_avoided, types_loved, types_avoided, price_bands, taste_vector')
      .eq('member_id', memberId).maybeSingle(),
    loadMemberAgeRanges(admin, [memberId]),
    loadAgeRegisters(admin),
  ])
  return {
    prefs: readStylePrefs(m),
    bands: m ? readPriceBands(m) : null,
    ageRange: ages.get(memberId) ?? null,
    tasteVector: Array.isArray(m?.taste_vector) && m.taste_vector.length && !isZero(m.taste_vector) ? m.taste_vector.map(Number) : null,
    registerOf: (id) => (id ? registers.get(String(id)) ?? null : null),
  }
}

/** Why this piece is not for her, in a few words — null when it is. */
export function whyNotHers(reach: MemberReach, it: ReachItem, opts: { budget?: boolean } = {}): string | null {
  const avoided = avoidReasons(reach.prefs, it as any)
  if (avoided.length) return `she avoids ${avoided[0].toLowerCase()}`
  if (opts.budget !== false && reach.bands
    && priceVerdict(reach.bands, { item_type: it.item_type, price_gbp: it.price_gbp != null ? Number(it.price_gbp) : null }) === 'over') return 'over her budget'
  if (!withinMemberAgeReach(reach.ageRange, { customer_age_register: reach.registerOf(it.brand_id) })) return 'a younger label than her'
  return null
}

/** The item columns a single-piece taste vector reads, beyond STYLE_DIMS; the brand join needs price_tier, era_orientation, aesthetic_output, cultural_legibility, creative_behaviour. */
export const TASTE_DIMS = 'material_formality, material_weight'

/** How close one piece sits to her taste, 0 when she has no vector yet. Ordering only. */
export function herTaste(reach: MemberReach | undefined, it: any): number {
  if (!reach?.tasteVector) return 0
  const v = lookVectorFromItems([it])
  return isZero(v) ? 0 : cosine(reach.tasteVector, v)
}

/** Keeps the pieces she has not ruled out, in her words, her bands and her age. */
export function forHer<T extends ReachItem>(reach: MemberReach | undefined, items: T[], opts: { budget?: boolean } = {}): T[] {
  if (!reach) return items
  return items.filter((it) => whyNotHers(reach, it, opts) == null)
}

/** @deprecated kept for the first callers; use forHer. */
export const notAvoided = <T extends ReachItem>(prefs: StylePrefs | undefined, items: T[]): T[] =>
  prefs ? items.filter((it) => avoidReasons(prefs, it as any).length === 0) : items
export { loadMemberReach as loadStylePrefs }
