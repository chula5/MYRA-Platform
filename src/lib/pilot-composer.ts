// ── PRIVATE STYLIST composer — build looks for a member from the library ────
// Reuses the Outfit Composer's slot plan + pairwise coherence, then folds in
// what makes this MEMBER different:
//
//   member score(item) = brand affinity (onboarded ranks + learned)
//                      + brand-family adjacency to her loved brands
//                      − swap penalties (items/brands Chloe swapped away for her)
//
// Pairing learning: every accept records the look's brand pairs as good;
// every swap records the outgoing brand's pairs as bad. Pairs feed the
// composer's learnedBonus so combinations that survive review rank higher.
// Chloe reviews everything for now — the learning is what lets the system
// graduate to pairing things itself later.

import type { ItemWithBrand } from '@/lib/admin-queries'
import {
  generateCandidates,
  pairCompat,
  slotForItemType,
  type Slot,
} from '@/lib/composer'
import type { LookItem } from '@/lib/pilot-stylist'
import { itemPseudoVector } from '@/lib/brand-affinity'
import { cosine } from '@/lib/taste-vector'

// ── Occasion fit ─────────────────────────────────────────────────────────────
// The delivery's effective_weights already carry the occasion tilt (and the
// work formality floor), so its room-mix vector is the occasion-shaped target.
// On top of the vector, deterministic type priors keep the obvious rules firm:
// no stilettos at daytime casual, no sneakers at an event.

export interface OccasionContext {
  id: string | null
  vector: number[] | null // lookTasteVector(effective_weights)
}

const OCCASION_TYPE_PRIOR: Record<string, { favour: string[]; avoid: string[] }> = {
  work_standard: { favour: ['blazer', 'trousers', 'shirt', 'knitwear', 'flat', 'tote'], avoid: ['mini_dress', 'slip_dress', 'shorts', 'sandal', 'corset'] },
  work_elevated: { favour: ['blazer', 'trousers', 'shirt', 'heel', 'structured_bag'], avoid: ['mini_dress', 'slip_dress', 'shorts', 'sandal', 'sneaker', 'corset', 'jeans'] },
  casual_day: { favour: ['jeans', 't-shirt', 'knitwear', 'sneaker', 'flat', 'tote', 'crossbody'], avoid: ['heel', 'clutch', 'maxi_dress', 'corset'] },
  dinner_drinks: { favour: ['heel', 'slip_dress', 'midi_dress', 'clutch', 'blouse', 'shoulder_bag'], avoid: ['sneaker', 'tote', 'gilet'] },
  event: { favour: ['maxi_dress', 'midi_dress', 'slip_dress', 'heel', 'clutch'], avoid: ['sneaker', 'jeans', 't-shirt', 'tote', 'shorts', 'gilet'] },
  travel: { favour: ['sneaker', 'flat', 'trousers', 'jeans', 'knitwear', 'tote', 'crossbody'], avoid: ['heel', 'clutch', 'corset'] },
}

const pseudoCache = new WeakMap<object, number[]>()
function pseudoVec(item: ItemWithBrand): number[] {
  let v = pseudoCache.get(item as object)
  if (!v) {
    v = itemPseudoVector(item)
    pseudoCache.set(item as object, v)
  }
  return v
}

// ~[-0.5, 0.65]: type prior dominates, room-mix vector breaks ties.
export function occasionItemScore(occ: OccasionContext | undefined, item: ItemWithBrand): number {
  if (!occ) return 0
  let s = 0
  const prior = occ.id ? OCCASION_TYPE_PRIOR[occ.id] : undefined
  if (prior) {
    if (prior.favour.includes(item.item_type)) s += 0.15
    if (prior.avoid.includes(item.item_type)) s -= 0.35
  }
  if (occ.vector) {
    const c = cosine(pseudoVec(item), occ.vector)
    s += Math.max(-0.15, Math.min(0.15, (c - 0.8) * 1.5))
  }
  return s
}

export interface MemberTaste {
  affinity: Map<string, number> // brand_id → 0..1
  families: Map<string, Set<string>> // brand_id → family ids
  excludedPairs: Set<string> // "a|b" with a<b
  inputOnlyBrands: Set<string> // lowercased brand names never recommended
  itemSwapOut: Map<string, number> // item_id → times swapped away
  brandSwapOut: Map<string, number> // brand_id → times swapped away
  pairNet: Map<string, number> // "a|b" → accepts − swaps
}

const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`)

export function shareFamily(t: MemberTaste, a?: string | null, b?: string | null): boolean {
  if (!a || !b || a === b) return false
  const fa = t.families.get(a)
  const fb = t.families.get(b)
  if (!fa || !fb) return false
  for (const f of Array.from(fa)) if (fb.has(f)) return true
  return false
}

// How much this member wants this item, independent of the outfit around it.
export function memberItemScore(t: MemberTaste, item: ItemWithBrand): number {
  const brandId = item.brand_id ?? undefined
  let s = brandId ? (t.affinity.get(brandId) ?? 0.08) : 0.08
  if (brandId) {
    const swaps = t.brandSwapOut.get(brandId) ?? 0
    s -= Math.min(0.12 * swaps, 0.4)
  }
  const itemSwaps = t.itemSwapOut.get(item.item_id) ?? 0
  s -= Math.min(0.3 * itemSwaps, 0.6)
  return Math.max(-0.5, Math.min(1, s))
}

// learnedBonus hook for generateCandidates: brand taste + pairing history for
// the whole combination, ~[-1, 1].
export function memberComboBonus(
  t: MemberTaste,
  anchor: ItemWithBrand,
  items: { item: ItemWithBrand; slot: Slot }[],
): number {
  const all = [anchor, ...items.map((i) => i.item)]
  let s = 0
  let n = 0
  for (const it of all) {
    s += memberItemScore(t, it)
    n++
  }
  let pairs = 0
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      const a = all[i].brand_id
      const b = all[j].brand_id
      if (!a || !b || a === b) continue
      if (shareFamily(t, a, b)) s += 0.12
      const net = t.pairNet.get(pairKey(a, b)) ?? 0
      s += Math.max(-0.3, Math.min(0.3, net * 0.08))
      pairs++
    }
  }
  return Math.max(-1, Math.min(1, s / Math.max(1, n + pairs * 0.5)))
}

// Hard gate: excluded brand pairs and input-only brands never appear.
export function memberGate(
  t: MemberTaste,
  anchor: ItemWithBrand,
  items: { item: ItemWithBrand; slot: Slot }[],
): boolean {
  const all = [anchor, ...items.map((i) => i.item)]
  for (const it of all) {
    const name = it.brand?.name?.toLowerCase()
    if (name && t.inputOnlyBrands.has(name)) return false
  }
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      const a = all[i].brand_id
      const b = all[j].brand_id
      if (a && b && a !== b && t.excludedPairs.has(pairKey(a, b))) return false
    }
  }
  return true
}

export function toLookItem(item: ItemWithBrand): LookItem {
  const priceGbp =
    (item as any).price_gbp != null ? Number((item as any).price_gbp) : item.price != null ? Number(item.price) : null
  return {
    brand: item.brand?.name ?? '—',
    product_name: item.product_name,
    price_gbp: priceGbp != null && !isNaN(priceGbp) ? priceGbp : null,
    url: item.retailer_url ?? undefined,
    owned: false,
    in_stock: item.stock_status !== 'out_of_stock',
    stock_checked_at: (item as any).stock_checked_at ?? null,
    item_id: item.item_id,
    brand_id: item.brand_id ?? null,
    image_url: item.image_url ?? null,
    slot: slotForItemType(item.item_type),
    item_type: item.item_type,
    material_primary: item.material_primary ?? null,
  }
}

export interface ComposedLook {
  items: LookItem[]
  notes: string
  score: number
}

// Compose up to `count` looks. Anchors are the member's highest-affinity
// dresses/tops (each look anchored on a different brand where possible);
// the rest of each look comes from the Outfit Composer with the member's
// taste folded into generation. Items never repeat across the set.
export function composeMemberLooks(
  t: MemberTaste,
  library: ItemWithBrand[],
  count = 3,
  occ?: OccasionContext,
): ComposedLook[] {
  const usable = library.filter(
    (i) =>
      i.image_url &&
      i.stock_status !== 'out_of_stock' &&
      !(i.brand?.name && t.inputOnlyBrands.has(i.brand.name.toLowerCase())),
  )

  const anchors = usable
    .filter((i) => {
      const slot = slotForItemType(i.item_type)
      return slot === 'dress' || slot === 'top'
    })
    .map((i) => ({ item: i, score: memberItemScore(t, i) + occasionItemScore(occ, i) }))
    .sort((a, b) => b.score - a.score)

  const looks: ComposedLook[] = []
  const usedItems = new Set<string>()
  const usedAnchorBrands = new Set<string>()

  for (const a of anchors) {
    if (looks.length >= count) break
    if (usedItems.has(a.item.item_id)) continue
    const brandId = a.item.brand_id ?? ''
    // brand diversity across the set — relax only if we run out of brands
    if (brandId && usedAnchorBrands.has(brandId) && anchors.length > count) continue

    const cands = generateCandidates({
      anchor: a.item,
      library: usable,
      perSlotPool: 5,
      maxCandidates: 5,
      minScore: 0.5,
      excludeItemIds: Array.from(usedItems),
      learnedBonus: (items) =>
        memberComboBonus(t, a.item, items) +
        items.reduce((sum, i) => sum + occasionItemScore(occ, i.item), 0) / Math.max(1, items.length),
      learnedBlend: 0.4,
      houseGate: (items) => memberGate(t, a.item, items),
    })
    const best = cands[0]
    if (!best) continue

    const all = [
      { item: a.item, slot: slotForItemType(a.item.item_type) },
      ...best.items,
    ]
    all.forEach(({ item }) => usedItems.add(item.item_id))
    if (brandId) usedAnchorBrands.add(brandId)

    const famPairs: string[] = []
    for (let i = 0; i < all.length; i++)
      for (let j = i + 1; j < all.length; j++)
        if (shareFamily(t, all[i].item.brand_id, all[j].item.brand_id))
          famPairs.push(`${all[i].item.brand?.name} × ${all[j].item.brand?.name}`)

    const affinity = memberItemScore(t, a.item)
    const occFit = occasionItemScore(occ, a.item)
    const notes = [
      `Anchor ${a.item.brand?.name ?? '—'} (affinity ${affinity.toFixed(2)}${occ?.id ? `, occasion fit ${occFit >= 0 ? '+' : ''}${occFit.toFixed(2)}` : ''})`,
      `coherence ${best.score.toFixed(2)}`,
      famPairs.length ? `family pairing: ${Array.from(new Set(famPairs)).join(', ')}` : null,
    ]
      .filter(Boolean)
      .join(' · ')

    looks.push({ items: all.map(({ item }) => toLookItem(item)), notes, score: best.score })
  }

  return looks
}

// Ranked alternates for one slot of a look — what the SWAP picker shows.
// Half member taste, half coherence with the rest of the look.
export function rankAlternates(
  t: MemberTaste,
  library: ItemWithBrand[],
  slot: Slot,
  keepItems: ItemWithBrand[],
  excludeIds: Set<string>,
  limit = 12,
  occ?: OccasionContext,
): Array<{ item: ItemWithBrand; score: number }> {
  return library
    .filter(
      (i) =>
        slotForItemType(i.item_type) === slot &&
        !excludeIds.has(i.item_id) &&
        i.image_url &&
        i.stock_status !== 'out_of_stock' &&
        !(i.brand?.name && t.inputOnlyBrands.has(i.brand.name.toLowerCase())),
    )
    .map((i) => {
      const compat =
        keepItems.length > 0
          ? keepItems.reduce((s, k) => s + pairCompat(k, i).total, 0) / keepItems.length
          : 0.7
      return { item: i, score: 0.5 * memberItemScore(t, i) + 0.5 * compat + occasionItemScore(occ, i) }
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
}
