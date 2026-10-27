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
//      (high-street / contemporary never with luxury / ultra; premium bridges),
//      and only brands from the anchor's family within one price bracket
//      (lib/brand-families: the onboarding groups, bracketed by hand).
//   3. Cartesian product of the slot pools: the other garment (for a
//      separates anchor) + shoes + bag. Review itself never composes
//      outerwear or jewellery (styled on by hand); a member's look may ask for
//      them as EXTRA slots, where a coat has to earn its place.
//   4. House Style Constitution hard rules discard a combo before scoring;
//      the learned skip-list is a soft penalty inside the verdict.
//   5. Style Brain blend on top of the hand-tuned coherence score.
//   6. Diversity: no piece in more than `maxUsesPerItem` of the picks, and
//      no two picks sharing all but one piece (no same-look-new-shoes twins).
//
// Pure: string-in, looks-out. Loading the model, learned pairs and ejection
// constraints is the caller's job.

import type { ItemWithBrand } from '@/lib/admin-queries'
import { pairCompat, slotForItemType } from '@/lib/composer'
import { evaluateHouseStyle, statementKind, type HouseVerdict, type RuleHit } from '@/lib/house-style'
import { toHouseItem } from '@/lib/house-item'
import { blendedScore, emptyModel, type FeatureItem, type StyleModel } from '@/lib/style-brain'
import { formalityBand, hardSkipPairs, isExcluded, type EjectionConstraints } from '@/lib/pipeline'
import { judgeLook, type MemberRules } from '@/lib/style-rules'
import { bracketSpreadViolation, familyFits } from '@/lib/brand-families'

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

// A coat or jacket can also be the piece a look is built AROUND (Outfit
// Review's type filter: "fur coat outfits"). Kept out of reviewAnchorCategory
// on purpose: the Lab and the member composers pick their own anchors from the
// garments, and only Review offers outerwear as an anchor.
export type ReviewAnchorKind = ReviewAnchorCategory | 'outerwear'

export function reviewAnchorKind(itemType: string | null | undefined): ReviewAnchorKind | null {
  return reviewAnchorCategory(itemType) ?? (REVIEW_OUTERWEAR.has(String(itemType ?? '')) ? 'outerwear' : null)
}

/**
 * The shapes a look can take for an anchor, one slot list per shape. A garment
 * anchor has one shape (the other garment + shoes + bag); an outerwear anchor
 * goes over separates OR over a dress, and the two shapes compete on score.
 */
export function reviewSlotPlansFor(kind: ReviewAnchorKind): string[][] {
  if (kind === 'outerwear') return [['top', 'bottom', 'shoe', 'bag'], ['dress', 'shoe', 'bag']]
  return [reviewSlotsFor(kind).slots]
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
  opts: { keepOuterwear?: boolean } = {},
): ItemWithBrand[] {
  const anchorImg = String(anchor.image_url ?? '')
  const anchorName = String(anchor.product_name ?? '').toLowerCase().trim()
  const band = formalityBand([anchor])
  return library.filter(
    (it) =>
      (opts.keepOuterwear || !REVIEW_OUTERWEAR.has(String(it.item_type))) &&
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

export interface ExtraSlot {
  slot: string
  /** A required extra slot with nothing to fill it means no look; an optional one competes with being left out. */
  required: boolean
  perSlotPool?: number
}

export interface ReviewComposeOpts {
  anchor: ItemWithBrand
  /** Already a `reviewLibrary` (or anything narrower). */
  library: ItemWithBrand[]
  /** Whose learned taste re-ranks: Chloe's live model in Review, the frozen stylist model in the Lab. */
  styleModel?: StyleModel | null
  /**
   * THE HOUSE BASE under `styleModel`: Chloe's learned model when the look is
   * being composed for another stylist. Both blend in at their own confidence
   * and their skip-pairs are pooled, so a stylist with ten decisions still
   * composes on everything Chloe has taught, and her own ten narrow it. Leave
   * unset when `styleModel` IS Chloe's — the same model twice would count double.
   */
  baseStyleModel?: StyleModel | null
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
  /**
   * A MEMBER'S RULE LAYER (lib/style-rules). When given, the House Style
   * Constitution is judged through her codes — global bans for everyone, her
   * persona's constitution or Chloe's — instead of the whole constitution:
   * a blocked code discards the combo, a soft one (the statement rule) lowers
   * its score. This is how a persona that dropped the statement rule keeps it
   * dropped, and how the relaxed pass can hand in the global bans alone.
   */
  rules?: MemberRules | null
  /**
   * Slots beyond the review shape (other garment + shoes + bag): outerwear
   * when the weather calls for it, jewellery to finish. An optional slot's
   * pool carries "leave it out", so a coat has to earn its place.
   */
  extraSlots?: ExtraSlot[]
  /** Pieces fixed in their slot before anything is chosen: an owned bag or coat the look is built around. */
  pinned?: { item: ItemWithBrand; slot: string }[]
  /** The occasion, for the constitution's occasion rules. */
  occasion?: string | null
  /**
   * Show fewer looks rather than pad the set with near-twins (Outfit Review,
   * where every pick is shown side by side). Off, the twins still go to the
   * back of the list — callers that run their own distinctness passes over a
   * wide candidate list (pilot composer, Quality Lab) keep every candidate.
   */
  noTwins?: boolean
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

const EXTRA_SLOT_POOL = 3

/** Slots that finish a look rather than make it: swapping one of these alone is not a new outfit. */
const FINISH_SLOTS = new Set(['shoe', 'bag', 'jewellery'])

/**
 * How many pieces two picks may share before they read as the same outfit.
 * One, whatever the look's size: on a four-piece look, sharing two (same
 * jumper + same boots, another skirt) still read as a twin side by side
 * (2026-10-12).
 */
export function maxSharedWith(_n: number): number {
  return 1
}
/** Shortlist places kept for statement pieces when the anchor is plain. */
const STATEMENT_RESERVE = 2

/**
 * Compose, widening the per-slot shortlist when nothing passes. Five pieces
 * per slot is the right width when the shortlist has range; on a large
 * library it can be five near-identical pieces (the same camel knit five
 * times), and then the constitution refuses every combination for want of a
 * fitted piece, an echo or a statement. Doubling the shortlist twice gives
 * the rules something to choose from before the anchor is given up on.
 */
export function composeReviewLooks(opts: ReviewComposeOpts): ReviewComposeResult {
  const base = opts.perSlotPool ?? REVIEW_PER_SLOT_POOL
  let result = composeReviewLooksOnce({ ...opts, perSlotPool: base })
  for (const size of [base * 2, base * 4]) {
    if (result.picks.length > 0 || size > REVIEW_MAX_SLOT_POOL) break
    result = composeReviewLooksOnce({ ...opts, perSlotPool: size })
  }
  return result
}

/** The widest a slot shortlist is allowed to grow (20³ = 8,000 combinations). */
const REVIEW_MAX_SLOT_POOL = 20

function composeReviewLooksOnce(opts: ReviewComposeOpts): ReviewComposeResult {
  const {
    anchor,
    perSlotPool = REVIEW_PER_SLOT_POOL,
    count = REVIEW_PICK_COUNT,
    maxUsesPerItem = REVIEW_MAX_USES_PER_ITEM,
    shortlistAdjust,
    comboBonus,
    lookGate,
    rules,
  } = opts
  const styleModel = opts.styleModel ?? emptyModel()
  const baseModel = opts.baseStyleModel ?? null
  const cat = reviewAnchorKind(anchor.item_type)
  if (!cat) return { picks: [], rejectionHits: [] }
  const anchorSlot = slotForItemType(anchor.item_type)
  const anchorTier = anchor.brand?.price_tier ?? null
  const pinned = opts.pinned ?? []
  const pinnedIds = new Set(pinned.map((p) => p.item.item_id))
  const library = pinnedIds.size ? opts.library.filter((it) => !pinnedIds.has(it.item_id)) : opts.library

  // Top-ranked, brand-tier-coherent pieces per slot. When the anchor is a
  // plain piece, the last STATEMENT_RESERVE places go to the best statement
  // pieces (a hero print, a bold accessory, a colour pop) if the top of the
  // list has none — the constitution wants exactly one statement element,
  // and a shortlist of five perfectly compatible plain pieces can never
  // provide it. Measured 2026-10-11 on a 7k library: an Isabel Marant black
  // sweater produced 125 combinations and the rule refused every one.
  const anchorIsStatement = statementKind(toHouseItem(anchor)) != null
  const pool = (slot: string, size: number) => {
    const ranked = library
      .filter((it) => slotForItemType(it.item_type) === slot && !tierBandViolation([anchorTier, it.brand?.price_tier ?? null]))
      .filter((it) => familyFits(anchor.brand, it.brand, slot))
      .map((it) => ({ it, rank: pairCompat(anchor, it).total + (shortlistAdjust ? shortlistAdjust(it) : 0) }))
      .sort((a, b) => b.rank - a.rank)
    const top = ranked.slice(0, size).map((x) => x.it)
    if (anchorIsStatement || top.some((it) => statementKind(toHouseItem(it, slot)) != null)) return top
    const statements = ranked.filter((x) => statementKind(toHouseItem(x.it, slot)) != null).slice(0, STATEMENT_RESERVE).map((x) => x.it)
    if (statements.length === 0) return top
    return [...top.slice(0, Math.max(0, size - statements.length)), ...statements]
  }

  type Choice = { item: ItemWithBrand; slot: string } | null
  // One cartesian product per shape the look can take (a garment anchor has
  // one; an outerwear anchor goes over separates or over a dress), all scored
  // together below.
  const combos: Choice[][] = []
  for (const coreSlots of reviewSlotPlansFor(cat)) {
    const slotChoices: Choice[][] = []
    const extras = (opts.extraSlots ?? []).filter((e) => !coreSlots.includes(e.slot) && e.slot !== anchorSlot)
    let viable = true
    for (const slot of coreSlots) {
      const pin = pinned.find((p) => p.slot === slot)
      const items = pin ? [pin.item] : pool(slot, perSlotPool)
      if (items.length === 0) {
        // Best-effort for a missing shoe or bag; a missing garment means this
        // shape has no clothes (a coat over nothing), so the shape is out.
        if (!FINISH_SLOTS.has(slot)) { viable = false; break }
        continue
      }
      slotChoices.push(items.map((item) => ({ item, slot })))
    }
    for (const extra of extras) {
      const pin = pinned.find((p) => p.slot === extra.slot)
      const items = pin ? [pin.item] : pool(extra.slot, extra.perSlotPool ?? EXTRA_SLOT_POOL)
      if (items.length === 0) {
        if (extra.required) { viable = false; break }
        continue
      }
      const choices: Choice[] = items.map((item) => ({ item, slot: extra.slot }))
      if (!extra.required && !pin) choices.push(null) // leave it out
      slotChoices.push(choices)
    }
    if (!viable || slotChoices.length === 0) continue

    // Cartesian product of this shape's slot pools.
    let shapeCombos: Choice[][] = [[]]
    for (const choices of slotChoices) {
      const next: Choice[][] = []
      for (const combo of shapeCombos) for (const c of choices) next.push([...combo, c])
      shapeCombos = next
    }
    combos.push(...shapeCombos)
  }
  if (combos.length === 0) return { picks: [], rejectionHits: [] }

  // HOUSE STYLE CONSTITUTION — the pre-score gate. Hard rules discard the
  // combo before it is scored; the learned skip-list is a SOFT penalty inside
  // the verdict, not a ban. Written rules override learned statistics. For a
  // member the verdict is read through her rule layer (judgeLook).
  const houseOpts = {
    occasion: opts.occasion ?? null,
    learnedApprovedPairs: opts.learnedPairs?.approved,
    learnedRejectedPairs: opts.learnedPairs?.rejected,
    softSkipPairs: baseModel
      ? new Set([...hardSkipPairs(baseModel), ...hardSkipPairs(styleModel)])
      : hardSkipPairs(styleModel),
  }
  const verdicts = new Map<string, HouseVerdict>()
  const houseItemsOf = (items: { item: ItemWithBrand; slot: string }[]) =>
    [toHouseItem(anchor), ...items.map((i) => toHouseItem(i.item, i.slot))]
  const verdictFor = (items: { item: ItemWithBrand; slot: string }[]) => {
    const key = items.map((i) => i.item.item_id).sort().join('|')
    let v = verdicts.get(key)
    if (!v) {
      v = evaluateHouseStyle(houseItemsOf(items), houseOpts)
      verdicts.set(key, v)
    }
    return v
  }
  const rejectionHits: RuleHit[] = []
  // Pass / penalty through the whole constitution (Review), or through her codes.
  const judge = (items: { item: ItemWithBrand; slot: string }[]): { pass: boolean; penalty: number } => {
    if (!rules) {
      const v = verdictFor(items)
      if (!v.pass) rejectionHits.push(...v.violations)
      return { pass: v.pass, penalty: 0 }
    }
    const j = judgeLook(houseItemsOf(items), rules, houseOpts)
    if (j.blocked) rejectionHits.push(...j.violations)
    return { pass: !j.blocked, penalty: j.penalty }
  }

  const scored = combos
    .map((combo) => combo.filter((c): c is { item: ItemWithBrand; slot: string } => c != null))
    .filter((items) => items.length > 0)
    .filter((items) => !tierBandViolation([anchorTier, ...items.map((i) => i.item.brand?.price_tier ?? null)]))
    // Pinned pieces are hers already — her wardrobe isn't held to a bracket.
    .filter((items) => !bracketSpreadViolation([anchor.brand, ...items.filter((i) => !pinnedIds.has(i.item.item_id)).map((i) => i.item.brand)]))
    .map((items) => ({ items, judged: judge(items) }))
    .filter(({ judged }) => judged.pass)
    .filter(({ items }) => !lookGate || lookGate([anchor, ...items.map((i) => i.item)]))
    .map(({ items, judged }) => {
      const all = [anchor, ...items.map((i) => i.item)]
      const features = all.map(reviewFeature)
      const coherence = reviewComboScore(anchor, items.map((i) => i.item))
      // The house base first, the stylist's own learning on top of it.
      const base = blendedScore(styleModel, baseModel ? blendedScore(baseModel, coherence, features) : coherence, features)
      const score = Math.max(0, Math.min(1, base - judged.penalty + (comboBonus ? comboBonus(all) : 0)))
      return { items, score, verdict: verdictFor(items) }
    })
    .sort((a, b) => b.score - a.score)

  // Diversity: no single piece in more than `maxUsesPerItem` picks, and no
  // pick a near-twin of one already taken. The per-piece cap alone let the
  // top two scores through as the same dress + same bag with only the shoes
  // swapped (2026-10-11: "the same outfit twice every time"), because two
  // uses each is exactly what a twin needs. Any two picks share at most
  // `maxSharedWith` pieces — one. Top up in loosening passes only if that leaves the set
  // short: drop the per-piece cap first, then (last resort, unless
  // `noTwins`) the twin rule.
  const use = new Map<string, number>()
  const picked: (typeof scored)[number][] = []
  const shared = (a: (typeof scored)[number], b: (typeof scored)[number]) => {
    const ids = new Set(b.items.map(({ item }) => item.item_id))
    return a.items.filter(({ item }) => ids.has(item.item_id)).length
  }
  // The clothes make the outfit: the same top + trousers under the same coat
  // with other shoes and another bag is the same look (2026-10-11, the Rixo
  // coat and the Isabel Marant gilet each came back as two pairs of twins
  // that the piece count let through). Shoes, bag and jewellery are finishes.
  const clothesKey = (s: (typeof scored)[number]) =>
    s.items.filter(({ slot }) => !FINISH_SLOTS.has(slot)).map(({ item }) => item.item_id).sort().join('|')
  const isTwin = (s: (typeof scored)[number]) =>
    picked.some((p) =>
      shared(s, p) > maxSharedWith(Math.min(s.items.length, p.items.length)) ||
      (clothesKey(s) !== '' && clothesKey(s) === clothesKey(p)))
  const passes: ((s: (typeof scored)[number]) => boolean)[] = [
    (s) => !isTwin(s) && !s.items.some(({ item }) => (use.get(item.item_id) ?? 0) >= maxUsesPerItem),
    (s) => !isTwin(s),
    ...(opts.noTwins ? [] : [() => true]),
  ]
  for (const ok of passes) {
    for (const s of scored) {
      if (picked.length >= count) break
      if (picked.includes(s) || !ok(s)) continue
      s.items.forEach(({ item }) => use.set(item.item_id, (use.get(item.item_id) ?? 0) + 1))
      picked.push(s)
    }
    if (picked.length >= count) break
  }
  return { picks: picked, rejectionHits }
}
