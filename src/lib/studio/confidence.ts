// Studio confidence scoring — REUSES the composer pipeline's coherence maths.
//
// The composer gates candidates on an average pairwise pairCompat score
// (minScore 0.55) and treats ≥0.70 as a "strong" match (its optional-slot
// inclusion threshold). The review queue reuses exactly those numbers:
//   · confidence  = the same anchor-weighted average pairwise compat the
//                   composer scores candidates with (scoreCombo's formula)
//   · fast lane   = confidence ≥ FAST_LANE_THRESHOLD (0.70)
//   · floor       = COHERENCE_FLOOR (0.55) — matches composer minScore
//
// Also defines the deterministic per-ITEM vector used for swap-candidate
// cosine ranking — built purely from the item's scored 1-5 dimensions plus
// colour buckets, mirroring how the 34-dim outfit vector normalises fields.

import { pairCompat, slotForItemType, type Slot } from '@/lib/composer'
import type { ItemWithBrand } from '@/lib/admin-queries'

export const COHERENCE_FLOOR = 0.55       // composer minScore
export const FAST_LANE_THRESHOLD = 0.70   // composer strong-candidate gate

export type ReviewLane = 'fast' | 'standard'

export function laneFor(confidence: number): ReviewLane {
  return confidence >= FAST_LANE_THRESHOLD ? 'fast' : 'standard'
}

// Anchor-weighted average pairwise compatibility across the outfit — the same
// aggregation the composer's scoreCombo uses (anchor pairs ×2). With no anchor
// identified, first item stands in (sort_order 0 is the anchor by convention).
export function computeOutfitConfidence(items: ItemWithBrand[]): number {
  if (items.length < 2) return 0
  const [anchor, ...rest] = items
  let sum = 0
  let weight = 0
  for (const item of rest) {
    sum += pairCompat(anchor, item).total * 2
    weight += 2
  }
  for (let i = 0; i < rest.length; i++) {
    for (let j = i + 1; j < rest.length; j++) {
      sum += pairCompat(rest[i], rest[j]).total
      weight += 1
    }
  }
  return weight > 0 ? sum / weight : 0
}

// ── Item vector ───────────────────────────────────────────────────────────────
// Deterministic vector for one item, for cosine ranking of swap candidates
// against the outgoing piece. Same 1-5 → [0,1] normalisation (n5) as the
// outfit taste vector; null → 0.5 so unknowns don't skew direction.

function n5(v: number | null | undefined): number {
  if (v == null || Number.isNaN(v)) return 0.5
  return (Math.max(1, Math.min(5, v)) - 1) / 4
}

const NEUTRALS = new Set(['white', 'cream', 'black', 'grey', 'navy', 'beige', 'camel', 'brown'])

export function buildItemVector(item: ItemWithBrand): number[] {
  const it = item as any
  const colour = String(it.colour_family ?? '')
  const inSet = (...c: string[]) => (c.includes(colour) ? 1 : 0)
  const slot = slotForItemType(item.item_type)
  const slotHot = (s: Slot) => (slot === s ? 1 : 0)
  return [
    // Scored dimensions
    n5(it.fit), n5(it.length), n5(it.structure),
    n5(it.surface), n5(it.colour_depth), n5(it.pattern), n5(it.sheen),
    n5(it.material_weight), n5(it.material_formality),
    n5(it.jewellery_scale), n5(it.jewellery_formality),
    // Brand positioning
    n5(it.brand?.price_tier), n5(it.brand?.aesthetic_output), n5(it.brand?.era_orientation),
    // Colour buckets (mirrors the outfit vector's colour story dims)
    NEUTRALS.has(colour) ? 1 : 0,
    inSet('black'), inSet('white', 'cream'), inSet('navy', 'blue'),
    inSet('brown', 'camel'), inSet('green'),
    inSet('red', 'burgundy', 'orange', 'pink', 'yellow', 'purple'),
    inSet('multicolour'),
    // Slot one-hot — keeps candidates directionally in-slot even when the
    // caller widens the pool
    slotHot('outerwear'), slotHot('top'), slotHot('bottom'), slotHot('dress'),
    slotHot('shoe'), slotHot('bag'), slotHot('jewellery'), slotHot('accessory'),
  ]
}

export function itemCosine(a: ItemWithBrand, b: ItemWithBrand): number {
  const va = buildItemVector(a)
  const vb = buildItemVector(b)
  let dot = 0, ma = 0, mb = 0
  for (let i = 0; i < va.length; i++) {
    dot += va[i] * vb[i]
    ma += va[i] * va[i]
    mb += vb[i] * vb[i]
  }
  if (ma === 0 || mb === 0) return 0
  return dot / (Math.sqrt(ma) * Math.sqrt(mb))
}
