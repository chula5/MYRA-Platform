import type { ItemType, ColourFamily } from '@/types/database'
import type { ItemWithBrand } from '@/lib/admin-queries'

// ── Slot taxonomy ─────────────────────────────────────────────────────────────

export type Slot = 'outerwear' | 'top' | 'bottom' | 'dress' | 'shoe' | 'bag' | 'jewellery' | 'accessory'

const ITEM_TYPE_TO_SLOT: Record<ItemType, Slot> = {
  coat: 'outerwear', trench: 'outerwear', jacket: 'outerwear',
  blazer: 'outerwear', gilet: 'outerwear', cape: 'outerwear',
  shirt: 'top', blouse: 'top', 't-shirt': 'top',
  knitwear: 'top', corset: 'top', bodysuit: 'top',
  trousers: 'bottom', jeans: 'bottom', shorts: 'bottom', skirt: 'bottom',
  mini_dress: 'dress', midi_dress: 'dress', maxi_dress: 'dress',
  shirt_dress: 'dress', slip_dress: 'dress',
  boot: 'shoe', heel: 'shoe', flat: 'shoe',
  sneaker: 'shoe', mule: 'shoe', sandal: 'shoe',
  tote: 'bag', shoulder_bag: 'bag', clutch: 'bag',
  crossbody: 'bag', structured_bag: 'bag',
  belt: 'accessory', scarf: 'accessory', hat: 'accessory',
  gloves: 'accessory', sunglasses: 'accessory', hair_accessory: 'accessory',
  necklace: 'jewellery', earrings: 'jewellery', bracelet: 'jewellery',
  ring: 'jewellery', brooch: 'jewellery',
}

export function slotForItemType(t: ItemType): Slot {
  return ITEM_TYPE_TO_SLOT[t]
}

// Slots required to make a complete outfit given the anchor's slot.
// "Required" means the candidate must include something for that slot.
// "Optional" means the composer can include it if a strong match exists.
export interface SlotPlan {
  required: Slot[]
  optional: Slot[]
}

export function slotPlanForAnchor(anchorSlot: Slot): SlotPlan {
  switch (anchorSlot) {
    case 'dress':
      return { required: ['shoe'], optional: ['outerwear', 'bag', 'jewellery'] }
    case 'top':
      return { required: ['bottom', 'shoe'], optional: ['outerwear', 'bag', 'jewellery'] }
    case 'bottom':
      return { required: ['top', 'shoe'], optional: ['outerwear', 'bag', 'jewellery'] }
    case 'outerwear':
      return { required: ['top', 'bottom', 'shoe'], optional: ['bag', 'jewellery'] }
    case 'shoe':
      return { required: ['top', 'bottom'], optional: ['outerwear', 'bag', 'jewellery'] }
    case 'bag':
      return { required: ['top', 'bottom', 'shoe'], optional: ['outerwear', 'jewellery'] }
    case 'jewellery':
    case 'accessory':
      return { required: ['top', 'bottom', 'shoe'], optional: ['outerwear', 'bag'] }
  }
}

// ── Colour compatibility ──────────────────────────────────────────────────────

const NEUTRALS: ColourFamily[] = ['white', 'cream', 'black', 'grey', 'navy', 'brown', 'camel']

function isNeutral(c: ColourFamily | null): boolean {
  return c != null && NEUTRALS.includes(c)
}

function colourCompat(a: ColourFamily | null, b: ColourFamily | null): number {
  if (a == null || b == null) return 0.7 // unknown — be permissive
  if (a === b) return 1.0
  if (isNeutral(a) && isNeutral(b)) return 0.92
  if (isNeutral(a) !== isNeutral(b)) return 0.78 // neutral + colour usually works
  if (a === 'multicolour' || b === 'multicolour') return 0.55
  return 0.45 // two distinct bolds — risky
}

// ── Single-dimension proximity (0..1) ─────────────────────────────────────────

function proximity(a: number | null, b: number | null): number | null {
  if (a == null || b == null) return null
  const delta = Math.abs(a - b)
  // 0→1.0, 1→0.85, 2→0.55, 3→0.25, 4→0.05
  const table = [1.0, 0.85, 0.55, 0.25, 0.05]
  return table[Math.min(delta, 4)]
}

// Pattern clash: two high-pattern pieces clash. Score is lower when both are >= 4.
function patternCompat(a: number | null, b: number | null): number | null {
  if (a == null || b == null) return null
  if (a >= 4 && b >= 4) return 0.3 // double-pattern clash
  if (a >= 3 && b >= 3) return 0.6
  const delta = Math.abs(a - b)
  const table = [1.0, 0.9, 0.7, 0.55, 0.4]
  return table[Math.min(delta, 4)]
}

// ── Pairwise compatibility ────────────────────────────────────────────────────

export interface CompatBreakdown {
  total: number
  materialFormality: number | null
  surface: number | null
  sheen: number | null
  colour: number
  brandTier: number | null
  pattern: number | null
  structure: number | null
}

// Weighted compatibility between two items. Returns a 0..1 score.
// Anchor-vs-candidate uses the same calculation as candidate-vs-candidate.
export function pairCompat(a: ItemWithBrand, b: ItemWithBrand): CompatBreakdown {
  const matFormal = proximity(a.material_formality, b.material_formality)
  const surface = proximity(a.surface, b.surface)
  const sheen = proximity(a.sheen, b.sheen)
  const colour = colourCompat(a.colour_family, b.colour_family)
  const brandTier = proximity(a.brand?.price_tier ?? null, b.brand?.price_tier ?? null)
  const pattern = patternCompat(a.pattern, b.pattern)
  const structure = proximity(a.structure, b.structure)

  const weights = {
    materialFormality: 0.28,
    colour: 0.20,
    surface: 0.13,
    sheen: 0.12,
    brandTier: 0.10,
    pattern: 0.10,
    structure: 0.07,
  }

  let weightedSum = 0
  let totalWeight = 0
  const add = (v: number | null, w: number) => {
    if (v != null) { weightedSum += v * w; totalWeight += w }
  }
  add(matFormal, weights.materialFormality)
  add(colour, weights.colour)
  add(surface, weights.surface)
  add(sheen, weights.sheen)
  add(brandTier, weights.brandTier)
  add(pattern, weights.pattern)
  add(structure, weights.structure)

  const total = totalWeight > 0 ? weightedSum / totalWeight : 0.5
  return { total, materialFormality: matFormal, surface, sheen, colour, brandTier, pattern, structure }
}

// ── Candidate generation ──────────────────────────────────────────────────────

export interface ComposerCandidate {
  // The anchor item is implicit (caller passes it in) — items here are the additions.
  items: { item: ItemWithBrand; slot: Slot }[]
  score: number // average pairwise compatibility across the whole outfit
  breakdown: { slot: Slot; itemId: string; compatWithAnchor: number }[]
}

interface GenerateOpts {
  anchor: ItemWithBrand
  library: ItemWithBrand[]
  perSlotPool?: number       // how many top candidates to consider per slot (default 4)
  maxCandidates?: number     // how many candidate outfits to return (default 10)
  minScore?: number          // floor on overall coherence (default 0.55)
  excludeItemIds?: string[]  // never include these items as additions
}

export function generateCandidates(opts: GenerateOpts): ComposerCandidate[] {
  const {
    anchor,
    library,
    perSlotPool = 4,
    maxCandidates = 10,
    minScore = 0.55,
    excludeItemIds = [],
  } = opts

  const anchorSlot = slotForItemType(anchor.item_type)
  const plan = slotPlanForAnchor(anchorSlot)

  const excluded = new Set([anchor.item_id, ...excludeItemIds])
  const eligible = library.filter(i => !excluded.has(i.item_id))

  // Bucket eligible items by slot, pre-ranked by pairwise compat with the anchor.
  const buckets: Record<Slot, Array<{ item: ItemWithBrand; compat: number }>> = {
    outerwear: [], top: [], bottom: [], dress: [],
    shoe: [], bag: [], jewellery: [], accessory: [],
  }
  for (const item of eligible) {
    const slot = slotForItemType(item.item_type)
    const compat = pairCompat(anchor, item).total
    buckets[slot].push({ item, compat })
  }
  for (const slot of Object.keys(buckets) as Slot[]) {
    buckets[slot].sort((a, b) => b.compat - a.compat)
    buckets[slot] = buckets[slot].slice(0, perSlotPool)
  }

  // Build the slot order to fill. Required first, then optional.
  // Optional slots are only included if at least one strong candidate exists.
  const slotsToFill: Slot[] = [...plan.required]
  for (const optSlot of plan.optional) {
    if ((buckets[optSlot][0]?.compat ?? 0) >= 0.7) {
      slotsToFill.push(optSlot)
    }
  }

  // If any required slot is empty, we can't compose anything.
  for (const s of plan.required) {
    if (buckets[s].length === 0) return []
  }

  // Enumerate combinations across slotsToFill. Skip optional slots when their bucket is empty.
  // To keep the cardinality sane, we treat optional slots as "include best option OR omit".
  type Choice = { item: ItemWithBrand; slot: Slot } | null
  const slotChoices: Choice[][] = slotsToFill.map((s) => {
    const choices: Choice[] = buckets[s].map(({ item }) => ({ item, slot: s }))
    if (plan.optional.includes(s) && choices.length > 0) choices.push(null) // allow omit
    if (choices.length === 0) return [null] // optional empty bucket — skip
    return choices
  })

  const combos: Choice[][] = cartesian(slotChoices)

  const scored: ComposerCandidate[] = []
  for (const combo of combos) {
    const items = combo.filter((c): c is { item: ItemWithBrand; slot: Slot } => c != null)
    if (items.length === 0) continue
    // Coverage gate — every required slot must be filled.
    const filledSlots = new Set(items.map(i => i.slot))
    if (!plan.required.every(s => filledSlots.has(s))) continue

    const score = scoreCombo(anchor, items)
    if (score < minScore) continue

    scored.push({
      items,
      score,
      breakdown: items.map(({ item, slot }) => ({
        slot,
        itemId: item.item_id,
        compatWithAnchor: pairCompat(anchor, item).total,
      })),
    })
  }

  scored.sort((a, b) => b.score - a.score)

  // Diversity filter — avoid near-duplicates (combos that share too many items).
  const picked: ComposerCandidate[] = []
  for (const c of scored) {
    if (picked.length >= maxCandidates) break
    const cIds = new Set(c.items.map(x => x.item.item_id))
    const tooSimilar = picked.some(p => {
      const pIds = new Set(p.items.map(x => x.item.item_id))
      const shared = Array.from(cIds).filter(id => pIds.has(id)).length
      return shared >= cIds.size - 1 && cIds.size >= 3
    })
    if (!tooSimilar) picked.push(c)
  }

  return picked
}

function scoreCombo(anchor: ItemWithBrand, additions: { item: ItemWithBrand; slot: Slot }[]): number {
  // Average of all pairwise compats, with anchor pairs weighted 2x.
  let sum = 0
  let weight = 0
  for (const { item } of additions) {
    sum += pairCompat(anchor, item).total * 2
    weight += 2
  }
  for (let i = 0; i < additions.length; i++) {
    for (let j = i + 1; j < additions.length; j++) {
      sum += pairCompat(additions[i].item, additions[j].item).total
      weight += 1
    }
  }
  return weight > 0 ? sum / weight : 0
}

function cartesian<T>(arrays: T[][]): T[][] {
  return arrays.reduce<T[][]>(
    (acc, curr) => acc.flatMap(a => curr.map(c => [...a, c])),
    [[]],
  )
}

// ── Yield count ──────────────────────────────────────────────────────────────
// How many distinct compositional outfits could be anchored on this item,
// given the current library. Used by the Yield Surface on item records.

export function countYield(anchor: ItemWithBrand, library: ItemWithBrand[]): number {
  return generateCandidates({
    anchor,
    library,
    perSlotPool: 3,
    maxCandidates: 50,
    minScore: 0.60,
  }).length
}

// ── Outfit slot-score derivation ──────────────────────────────────────────────
// Map an item's per-field scores onto the outfit's slot_xxx fields.
// Used when approving a candidate — pre-fills the Outfit record so the user
// doesn't start from zero.

export function deriveSlotScores(items: { item: ItemWithBrand; slot: Slot }[]) {
  const out: Record<string, number | null> = {
    outerwear_construction: null, outerwear_volume: null,
    outerwear_material_weight: null, outerwear_material_formality: null,
    top_construction: null, top_volume: null,
    top_material_weight: null, top_material_formality: null,
    bottom_construction: null, bottom_volume: null,
    bottom_rise: null, bottom_leg_opening: null, bottom_material_weight: null,
    shoe_formality: null, shoe_style: null,
    bag_formality: null,
    jewellery_scale: null, jewellery_formality: null,
  }

  for (const { item, slot } of items) {
    if (slot === 'outerwear') {
      out.outerwear_construction = item.structure
      out.outerwear_volume = item.fit
      out.outerwear_material_weight = item.material_weight
      out.outerwear_material_formality = item.material_formality
    } else if (slot === 'top') {
      out.top_construction = item.structure
      out.top_volume = item.fit
      out.top_material_weight = item.material_weight
      out.top_material_formality = item.material_formality
    } else if (slot === 'bottom') {
      out.bottom_construction = item.structure
      out.bottom_volume = item.fit
      out.bottom_rise = item.rise
      out.bottom_leg_opening = item.leg_opening
      out.bottom_material_weight = item.material_weight
    } else if (slot === 'shoe') {
      out.shoe_formality = item.material_formality
      // shoe_style: 1=flat → 5=heel/statement. Best-effort from item_type.
      out.shoe_style = shoeStyleFromType(item.item_type)
    } else if (slot === 'bag') {
      out.bag_formality = item.material_formality
    } else if (slot === 'jewellery') {
      out.jewellery_scale = item.jewellery_scale
      out.jewellery_formality = item.jewellery_formality
    }
  }

  return out
}

function shoeStyleFromType(t: ItemType): number | null {
  switch (t) {
    case 'flat': case 'sneaker': return 1
    case 'sandal': case 'mule': return 3
    case 'boot': return 4
    case 'heel': return 5
    default: return null
  }
}

// Compute a rough average for outfit-level fields (construction, volume, etc.)
// from the items the composer chose. Anchor included.
export function deriveOutfitLevelScores(anchor: ItemWithBrand, additions: { item: ItemWithBrand; slot: Slot }[]) {
  const all = [anchor, ...additions.map(a => a.item)]
  const avg = (vals: (number | null)[]) => {
    const real = vals.filter((v): v is number => v != null)
    if (real.length === 0) return 3
    return Math.round(real.reduce((s, v) => s + v, 0) / real.length)
  }
  return {
    construction: avg(all.map(i => i.structure)),
    surface_story: avg(all.map(i => i.surface)),
    volume: avg(all.map(i => i.fit)),
    colour_story: avg(all.map(i => i.colour_depth)),
    intent: avg(all.map(i => i.pattern)),
  }
}
