// THE OUTFIT REVIEW RECIPE, shared.
//
// /admin/outfit-review is the composer that works: quick, brand-coherent,
// and every look it proposes has been through the House Style Constitution
// before Chloe sees it. This module is that recipe lifted out of the review
// action so other surfaces — the Outfit Quality Lab first — compose exactly the
// same way, with hooks for whose taste the shortlist is pulled towards.
//
//   1. Library minus outerwear, the anchor, and any duplicate listing of it;
//      minus anything the ejection constraints quarantine in this context.
//   2. Per slot, the top `perSlotPool` pieces by pairwise compatibility with
//      the anchor (plus any `shortlistAdjust` pull), brand tiers kept in band
//      (high-street / contemporary never with luxury / ultra; premium bridges).
//   3. Cartesian product of the slot pools: the other garment (for a
//      separates anchor) + shoes + bag. Outerwear and jewellery are never
//      composed here — they are styled on afterwards, by hand.
//   4. House Style Constitution hard rules discard a combo before scoring;
//      the learned skip-list is a soft penalty inside the verdict.
//   5. Style Brain blend on top of the hand-tuned coherence score.
//   6. Diversity: no piece in more than `maxUsesPerItem` of the picks.
//
// Pure: string-in, looks-out. Loading the model, learned pairs and ejection
// constraints is the caller's job.

import type { ItemWithBrand } from '@/lib/admin-queries'
import { pairCompat, slotForItemType } from '@/lib/composer'
import { evaluateHouseStyle, type HouseVerdict, type RuleHit } from '@/lib/house-style'
import { toHouseItem } from '@/lib/house-item'
import { blendedScore, emptyModel, type FeatureItem, type StyleModel } from '@/lib/style-brain'
import { formalityBand, hardSkipPairs, isExcluded, type EjectionConstraints } from '@/lib/pipeline'

// Anchor garments a review look is built around.
export const REVIEW_DRESS = new Set(['mini_dress', 'midi_dress', 'maxi_dress', 'shirt_dress', 'slip_dress'])
export const REVIEW_TOP = new Set(['shirt', 'blouse', 't-shirt', 'knitwear', 'corset', 'bodysuit'])
export const REVIEW_BOTTOM = new Set(['skirt', 'trousers', 'jeans'])
export const REVIEW_ANCHOR_TYPES = new Set<string>([...REVIEW_DRESS, ...REVIEW_TOP, ...REVIEW_BOTTOM])
export const REVIEW_OUTERWEAR = new Set(['coat', 'trench', 'jacket', 'blazer', 'gilet', 'cape'])

export const REVIEW_PER_SLOT_POOL = 5
export const REVIEW_PICK_COUNT = 6
export const REVIEW_MAX_USES_PER_ITEM = 2

export type ReviewAnchorCategory = 'dress' | 'top' | 'bottom'

export function reviewAnchorCategory(itemType: string | null | undefined): ReviewAnchorCategory | null {
  const t = String(itemType ?? '')
  if (REVIEW_DRESS.has(t)) return 'dress'
  if (REVIEW_TOP.has(t)) return 'top'
  if (REVIEW_BOTTOM.has(t)) return 'bottom'
  return null
}

// price_tier 1 HIGH STREET · 2 CONTEMPORARY · 3 PREMIUM · 4 LUXURY · 5 ULTRA.
// Don't pair ≤2 with ≥4; premium (3) bridges.
export function tierBandViolation(tiers: (number | null | undefined)[]): boolean {
  const t = tiers.filter((x): x is number => typeof x === 'number')
  return t.some((x) => x <= 2) && t.some((x) => x >= 4)
}

/** The slots a review look fills for an anchor: the other garment, shoes, bag. */
export function reviewSlotsFor(cat: ReviewAnchorCategory): { garment: 'top' | 'bottom' | null; slots: string[] } {
  const garment = cat === 'top' ? 'bottom' : cat === 'bottom' ? 'top' : null
  return { garment, slots: [...(garment ? [garment] : []), 'shoe', 'bag'] }
}

/**
 * Library minus outerwear, the anchor, and any duplicate listing of it (same
 * image or same name), minus what the ejection constraints exclude for this
 * anchor's formality band.
 */
export function reviewLibrary(
  library: ItemWithBrand[],
  anchor: ItemWithBrand,
  constraints?: EjectionConstraints | null,
): ItemWithBrand[] {
  const anchorImg = String(anchor.image_url ?? '')
  const anchorName = String(anchor.product_name ?? '').toLowerCase().trim()
  const band = formalityBand([anchor])
  return library.filter(
    (it) =>
      !REVIEW_OUTERWEAR.has(String(it.item_type)) &&
      it.item_id !== anchor.item_id &&
      !(anchorImg && String(it.image_url) === anchorImg) &&
      !(anchorName && String(it.product_name ?? '').toLowerCase().trim() === anchorName) &&
      !(constraints && isExcluded(constraints, it.item_id, slotForItemType(it.item_type), band)),
  )
}

// Coherence of a combo: average pairwise compat, anchor pairs weighted 2×.
export function reviewComboScore(anchor: ItemWithBrand, additions: ItemWithBrand[]): number {
  let sum = 0
  let w = 0
  for (const it of additions) { sum += 2 * pairCompat(anchor, it).total; w += 2 }
  for (let i = 0; i < additions.length; i++) {
    for (let j = i + 1; j < additions.length; j++) { sum += pairCompat(additions[i], additions[j]).total; w += 1 }
  }
  return w ? sum / w : 0
}

export function reviewFeature(it: ItemWithBrand): FeatureItem {
  return {
    item_type: (it.item_type ?? null) as string | null,
    colour_family: (it.colour_family ?? null) as string | null,
    // The item's 1-5 pattern score, passed through unchanged (the model keys
    // on its string form either way).
    pattern: (it.pattern ?? null) as unknown as string | null,
    material_formality: it.material_formality ?? null,
    brand_name: it.brand?.name ?? null,
    price_tier: it.brand?.price_tier ?? null,
  }
}

export interface ReviewComposeOpts {
  anchor: ItemWithBrand
  /** Already a `reviewLibrary` (or anything narrower). */
  library: ItemWithBrand[]
  /** Whose learned taste re-ranks: Chloe's live model in Review, the frozen stylist model in the Lab. */
  styleModel?: StyleModel | null
  learnedPairs?: { approved: Set<string>; rejected: Set<string> } | null
  perSlotPool?: number
  count?: number
  maxUsesPerItem?: number
  /**
   * Per-piece pull on each slot's shortlist, added to the pairwise compat
   * before the top `perSlotPool` are taken: a member's loves and history, a
   * stylist's envelope, a variety penalty. Omitted = ranked by compat alone.
   */
  shortlistAdjust?: (item: ItemWithBrand) => number
  /** Extra score for a whole combination (anchor included), in ~[-1, 1] units already scaled. */
  comboBonus?: (all: ItemWithBrand[]) => number
  /** A further hard gate on the whole look (anchor first): a member's rule layer, say. */
  lookGate?: (all: ItemWithBrand[]) => boolean
}

export interface ReviewPick {
  /** The additions, anchor excluded, each at its slot. */
  items: { item: ItemWithBrand; slot: string }[]
  score: number
  verdict: HouseVerdict
}

export interface ReviewComposeResult {
  picks: ReviewPick[]
  /** Every hard-rule violation that discarded a combo — for the rejection ledger. */
  rejectionHits: RuleHit[]
}

export function composeReviewLooks(opts: ReviewComposeOpts): ReviewComposeResult {
  const {
    anchor,
    library,
    perSlotPool = REVIEW_PER_SLOT_POOL,
    count = REVIEW_PICK_COUNT,
    maxUsesPerItem = REVIEW_MAX_USES_PER_ITEM,
    shortlistAdjust,
    comboBonus,
    lookGate,
  } = opts
  const styleModel = opts.styleModel ?? emptyModel()
  const cat = reviewAnchorCategory(anchor.item_type)
  if (!cat) return { picks: [], rejectionHits: [] }
  const anchorTier = anchor.brand?.price_tier ?? null

  // Top-ranked, brand-tier-coherent pieces per slot.
  const pool = (slot: string) =>
    library
      .filter((it) => slotForItemType(it.item_type) === slot && !tierBandViolation([anchorTier, it.brand?.price_tier ?? null]))
      .map((it) => ({ it, rank: pairCompat(anchor, it).total + (shortlistAdjust ? shortlistAdjust(it) : 0) }))
      .sort((a, b) => b.rank - a.rank)
      .slice(0, perSlotPool)
      .map((x) => x.it)

  const pools = reviewSlotsFor(cat).slots
    .map((slot) => ({ slot, items: pool(slot) }))
    .filter((p) => p.items.length > 0) // best-effort if a slot is empty
  if (pools.length === 0) return { picks: [], rejectionHits: [] }

  // Cartesian product of the slot pools.
  let combos: { item: ItemWithBrand; slot: string }[][] = [[]]
  for (const p of pools) {
    const next: typeof combos = []
    for (const combo of combos) for (const it of p.items) next.push([...combo, { item: it, slot: p.slot }])
    combos = next
  }

  // HOUSE STYLE CONSTITUTION — the pre-score gate. Hard rules discard the
  // combo before it is scored; the learned skip-list is a SOFT penalty inside
  // the verdict, not a ban. Written rules override learned statistics.
  const houseOpts = {
    learnedApprovedPairs: opts.learnedPairs?.approved,
    learnedRejectedPairs: opts.learnedPairs?.rejected,
    softSkipPairs: hardSkipPairs(styleModel),
  }
  const verdicts = new Map<string, HouseVerdict>()
  const verdictFor = (items: { item: ItemWithBrand; slot: string }[]) => {
    const key = items.map((i) => i.item.item_id).sort().join('|')
    let v = verdicts.get(key)
    if (!v) {
      v = evaluateHouseStyle([toHouseItem(anchor), ...items.map((i) => toHouseItem(i.item, i.slot))], houseOpts)
      verdicts.set(key, v)
    }
    return v
  }
  const rejectionHits: RuleHit[] = []

  const scored = combos
    .filter((items) => !tierBandViolation([anchorTier, ...items.map((i) => i.item.brand?.price_tier ?? null)]))
    .filter((items) => {
      const v = verdictFor(items)
      if (!v.pass) rejectionHits.push(...v.violations)
      return v.pass
    })
    .filter((items) => !lookGate || lookGate([anchor, ...items.map((i) => i.item)]))
    .map((items) => {
      const all = [anchor, ...items.map((i) => i.item)]
      const base = blendedScore(styleModel, reviewComboScore(anchor, items.map((i) => i.item)), all.map(reviewFeature))
      const score = Math.max(0, Math.min(1, base + (comboBonus ? comboBonus(all) : 0)))
      return { items, score, verdict: verdictFor(items) }
    })
    .sort((a, b) => b.score - a.score)

  // Diversity: no single piece in more than `maxUsesPerItem` picks; top up
  // from the rest only if that leaves the set short.
  const use = new Map<string, number>()
  const picked: ReviewPick[] = []
  for (const s of scored) {
    if (s.items.some(({ item }) => (use.get(item.item_id) ?? 0) >= maxUsesPerItem)) continue
    s.items.forEach(({ item }) => use.set(item.item_id, (use.get(item.item_id) ?? 0) + 1))
    picked.push(s)
    if (picked.length >= count) break
  }
  if (picked.length < count) {
    for (const s of scored) {
      if (picked.includes(s)) continue
      picked.push(s)
      if (picked.length >= count) break
    }
  }
  return { picks: picked, rejectionHits }
}
