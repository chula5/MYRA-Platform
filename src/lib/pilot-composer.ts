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
  type ComposerCandidate,
} from '@/lib/composer'
import type { LookItem, StylePrefs, PriceBands } from '@/lib/pilot-stylist'
import { avoidReasons, lovedScore, priceVerdict } from '@/lib/pilot-stylist'
import { mixesWhiteAndCream } from '@/lib/pale-tone'
import { judgeLook, type MemberRules } from '@/lib/style-rules'
import { toHouseItem } from '@/lib/house-item'
import { learnedBonus, blendStrength, type StyleModel, type FeatureItem } from '@/lib/style-brain'
import { isExcluded, formalityBand, hardSkipPairs, type EjectionConstraints } from '@/lib/pipeline'
import { pieceBreaksLearnedRule, type LearnedRuleMatch } from '@/lib/learning-scope'
import { judgeAgainstBrief, briefAffinity, briefBlocks, briefPull, type StylistBrief } from '@/lib/stylist-brief'
import { priceOfItem } from '@/lib/brand-affinity'
import { itemPseudoVector } from '@/lib/brand-affinity'
import { cosine } from '@/lib/taste-vector'
import { isOwnedItem, ownedBrandLabel, estimatedValueOf } from '@/lib/wardrobe/owned-items'
import { traitBlocked, traitPenalty, type TraitModel } from '@/lib/member-traits'
import { climateReason, climateScore, type ClimateId } from '@/lib/climate'

// ── Persona lens ────────────────────────────────────────────────────────────
// A member can be assigned a stylist persona. Its envelope — the mean and
// spread computed from that persona's CONFIRMED moodboard images — pulls her
// looks toward that eye while she is new.
//
// It is a prior, not a filter: nothing is excluded for sitting outside the
// envelope, and the pull is scaled by a weight that decays every time she says
// yes or no. Early on the moodboard is doing the styling; by the time she has
// responded thirty times her own history is.

export interface PersonaLens {
  name?: string | null
  envelope: { mean: number[]; spread: number[] } | null
  weight: number
  /**
   * Her own reference pictures — what SHE likes, added on her profile. A second
   * envelope, scored exactly like the house style's, but hers: it does not fade
   * as she responds and it never teaches the style.
   */
  reference?: { envelope: { mean: number[]; spread: number[] }; weight: number } | null
  /**
   * Her reference looks one by one — the pictures she keeps and the photographs
   * of what she wears. The envelope above is their average, and an average
   * blurs a distinctive look into the middle; this keeps each look whole, so a
   * piece that belongs in ONE of them is recognised as belonging.
   */
  referenceLooks?: number[][] | null
}

/** How much her reference pictures pull, relative to the house style's lens. */
export const REFERENCE_LENS_WEIGHT = 0.5

/**
 * The dimensions a SINGLE GARMENT can be compared to an outfit-level envelope
 * on. The envelope's other axes — construction, volume, colour story, intent,
 * shoe and bag formality — describe a whole look, and one item has no value for
 * them, so buildOutfitVector leaves them at the neutral 0.5. Measured, those
 * eight neutral dims swamped the real signal and pinned every item to the
 * negative floor, making two opposite personas compose identical looks.
 *
 * What's left is what a garment genuinely expresses, and it maps onto exactly
 * what the moodboard vision pass reads: structure, pattern, material formality.
 */
// dim → the item field that fills it, so an unscored field can be skipped
// rather than read as the neutral 0.5 and counted as disagreement.
export const ITEM_LENS_DIMS: { dim: number; field: 'structure' | 'pattern' | 'material_formality' }[] = [
  { dim: 0, field: 'structure' },
  { dim: 1, field: 'pattern' },
  { dim: 30, field: 'material_formality' },
]

/**
 * How much this persona wants this item, in the same ~[-0.5, 1] register as
 * memberItemScore. Dead centre of the envelope scores +1, two sigma out scores
 * 0, further out goes mildly negative — all multiplied by the current weight.
 *
 * Only dimensions the item has actually been SCORED on are compared. An
 * unscored field sits at the neutral 0.5 in the vector, and counting that as
 * distance made every unscored item look maximally wrong for every persona —
 * so a piece nobody has scored gets no opinion (0), not a penalty.
 */
export function personaFitScore(lens: PersonaLens | undefined, item: ItemWithBrand): number {
  if (!lens) return 0
  let score = 0
  if (lens.envelope?.mean?.length && lens.weight > 0) score += envelopeFit(lens.envelope, item) * lens.weight
  if (lens.reference?.envelope?.mean?.length && lens.reference.weight > 0) {
    score += envelopeFit(lens.reference.envelope, item) * lens.reference.weight
  }
  score += nearestLookFit(lens.referenceLooks, item)
  return score
}

/**
 * How close this piece sits to the SINGLE reference look it suits best. Her
 * average says what she is usually like; this says "this belongs in that
 * picture". A lift only — a piece unlike every one of her looks is already
 * answered by the envelope, and punishing it twice would flatten the library.
 */
export const NEAREST_LOOK_WEIGHT = 0.35
/** Below this a piece is no closer to her looks than the library average. */
export const NEAREST_LOOK_FLOOR = 0.79
/** At this it belongs in one of her pictures. */
export const NEAREST_LOOK_FULL = 0.86
export function nearestLookFit(looks: number[][] | null | undefined, item: ItemWithBrand): number {
  if (!looks?.length) return 0
  const v = pseudoVec(item)
  let best = 0
  for (const look of looks) {
    if (look.length !== v.length) continue
    const c = cosine(v, look)
    if (c > best) best = c
  }
  // Measured on her library: a piece's closest look sits around 0.73 for the
  // middle of the library and 0.86 for the pieces that genuinely belong in one
  // of her pictures. Only that top end earns the lift.
  const t = (best - NEAREST_LOOK_FLOOR) / (NEAREST_LOOK_FULL - NEAREST_LOOK_FLOOR)
  return Math.max(0, Math.min(1, t)) * NEAREST_LOOK_WEIGHT
}

/** One envelope's opinion of a piece, before weighting: +1 dead centre, 0 at two sigma. */
function envelopeFit(envelope: { mean: number[]; spread: number[] }, item: ItemWithBrand): number {
  const v = pseudoVec(item)
  let total = 0
  let n = 0
  for (const { dim, field } of ITEM_LENS_DIMS) {
    if ((item as any)[field] == null) continue // not scored — no evidence either way
    const spread = envelope.spread?.[dim] ?? 0
    const denom = Math.max(spread, 0.125)
    total += Math.abs(v[dim] - (envelope.mean[dim] ?? 0)) / denom
    n++
  }
  if (n === 0) return 0
  return Math.max(-0.5, 1 - total / n / 2)
}

// ── Occasion fit ─────────────────────────────────────────────────────────────
// The delivery's effective_weights already carry the occasion tilt (and the
// work formality floor), so its room-mix vector is the occasion-shaped target.
// On top of the vector, deterministic type priors keep the obvious rules firm:
// no stilettos at daytime casual, no sneakers at an event.

export interface OccasionContext {
  id: string | null
  vector: number[] | null // lookTasteVector(effective_weights)
  // Where she is going, not just what for. A hot holiday and a ski week are
  // both 'travel'.
  climate?: ClimateId | null
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
  // What her decisions say about KINDS of piece, not individual ones. Absent
  // on members with no history yet, and then nothing here applies.
  traits?: TraitModel
  pairNet: Map<string, number> // "a|b" → accepts − swaps
  // What she has TOLD us (authored, never learned over): colours/shapes/types
  // she loves or won't wear. Avoided = hard gate, loved = scoring bonus.
  prefs?: StylePrefs
  // What she actually spends, per kind of piece. Over her ceiling is a gate;
  // below her floor is a nudge, not a veto.
  priceBands?: PriceBands
  /**
   * Her own taste vector — built from what she has said yes to, saved, clicked
   * and bought (recomputeMemberVector). A gentle pull, never a gate: she is
   * more than her last ten answers.
   */
  tasteVector?: number[]
  // The rules her looks are held to, by layer (lib/style-rules): global bans,
  // her house style, or Chloe style. Absent = no rules beyond her own gates.
  rules?: MemberRules
  // Her stylist's brief (lib/stylist-brief): its bans gate, its preferences
  // score. Absent when she has no persona, or the persona has no brief.
  brief?: StylistBrief
  // What Chloe's rejections have taught: Style Brain learning, Composer
  // ejections and learned material pairings. Shared by every client so the
  // system keeps getting smarter from what she turns down.
  styleModel?: StyleModel
  // Her house style's own Style Brain (e.g. SCandi-Mum), learned from decisions
  // made for its clients. Starts empty and ramps in as it learns.
  houseStyleModel?: StyleModel
  // Lessons promoted to her house style (or her stylist) from repeated
  // rejections — "a cream skirt swapped out of dinner looks".
  learnedRules?: LearnedRuleMatch[]
  ejections?: EjectionConstraints
  learnedPairs?: { approved: Set<string>; rejected: Set<string> }
}

/**
 * A lesson promoted to her house style or stylist lowers a piece — it does not
 * block it. Measured on Alison's history, one client alone would promote 42
 * lessons as coarse as "woven trousers pulled from casual day looks" (a skipped
 * look counts every piece in it), and as blocks they would strip trousers and
 * blouses — two of her loved types — from every client on the style.
 */
export const LEARNED_RULE_PENALTY = 0.15
export function learnedRulePenalty(t: MemberTaste, item: ItemWithBrand, occasionId?: string | null): number {
  if (!t.learnedRules?.length) return 0
  const hits = t.learnedRules.filter((r) => pieceBreaksLearnedRule(r, item as any, occasionId)).length
  return Math.min(2 * LEARNED_RULE_PENALTY, hits * LEARNED_RULE_PENALTY)
}

/** A library piece as the Style Brain reads it — same fields as the Composer. */
function toFeature(it: ItemWithBrand): FeatureItem {
  return {
    item_type: it.item_type,
    colour_family: (it as any).colour_family ?? null,
    pattern: (it as any).pattern ?? null,
    material_formality: (it as any).material_formality ?? null,
    brand_name: it.brand?.name ?? null,
    price_tier: (it.brand as any)?.price_tier ?? null,
  }
}

/** Her rules for this look, with what Chloe's decisions have taught folded in. */
function judgeMemberLook(t: MemberTaste, all: ItemWithBrand[], slots?: (string | undefined)[]) {
  if (!t.rules) return null
  return judgeLook(all.map((it, i) => toHouseItem(it, slots?.[i])), t.rules, {
    learnedApprovedPairs: t.learnedPairs?.approved,
    learnedRejectedPairs: t.learnedPairs?.rejected,
    softSkipPairs: t.styleModel ? hardSkipPairs(t.styleModel) : undefined,
  })
}

/**
 * The learned part of a look's score: Style Brain approval of the combination,
 * minus the weight of any soft rule it breaks (a missing statement piece for a
 * Chloe-style client, say). Zero when nothing has been learned yet.
 */
export function styleLearningBonus(t: MemberTaste, anchor: ItemWithBrand, items: { item: ItemWithBrand; slot: Slot }[]): number {
  const all = [anchor, ...items.map((x) => x.item)]
  let b = 0
  const features = all.map(toFeature)
  // Chloe's rejections are always carried; her house style's own learning is
  // added on top and ramps in with its own decisions (blendStrength starts at 0).
  if (t.styleModel) b += blendStrength(t.styleModel) * learnedBonus(t.styleModel, features)
  if (t.houseStyleModel) b += blendStrength(t.houseStyleModel) * learnedBonus(t.houseStyleModel, features)
  const j = judgeMemberLook(t, all, [undefined, ...items.map((x) => x.slot)])
  if (j) b -= j.penalty
  if (t.brief) {
    b -= judgeAgainstBrief(all.map(briefPiece), t.brief).penalty
    // Her stylist's signature pieces, brands and fabrics pull a look her way —
    // the only pull she has before her reference outfits are confirmed.
    b += Math.min(BRIEF_LIFT_CAP, all.reduce((acc, it) => acc + briefAffinity(briefPiece(it), t.brief!), 0) * BRIEF_LIFT_PER_HIT)
  }
  return b
}

const BRIEF_LIFT_PER_HIT = 0.06
const BRIEF_LIFT_CAP = 0.3

const briefPiece = (it: ItemWithBrand) => ({
  product_name: it.product_name, item_type: it.item_type, material_primary: (it as any).material_primary,
  material_category: (it as any).material_category, colour_family: (it as any).colour_family,
  print_flag: (it as any).print_flag, brand_name: it.brand?.name ?? null,
})

/**
 * The brief at the SHORTLIST, not only at the score. Each slot is cut to its
 * best few pieces by compatibility before any combination is scored, so a pull
 * applied to combinations could never reach a piece outside those few. Eight
 * stylists handed one top all came back in the same trousers, sneaker and
 * jacket — the house, wearing name badges — because their briefs were
 * consulted after the cut. Scaled against pairwise compatibility (0–1): a
 * brand in the brief is worth about a quarter of it, a signature piece an
 * eighth. The moodboard's envelope goes into the shortlist the same way.
 */
const BRIEF_SHORTLIST_SCALE = 0.12
const PERSONA_SHORTLIST_SCALE = 0.2
function stylistPull(t: MemberTaste, lens: PersonaLens | undefined, item: ItemWithBrand): number {
  return BRIEF_SHORTLIST_SCALE * briefPull(briefPiece(item), t.brief) + PERSONA_SHORTLIST_SCALE * personaFitScore(lens, item)
}

/**
 * A piece the stylist would never put on her is not shortlisted at all.
 * memberGate refuses the COMBINATION, but by then the most compatible
 * trousers were all jeans, and a stylist who bans denim had nothing left to
 * build with while 78 tailored trousers sat outside the cut. What she owns
 * is exempt, as in the gate; the piece she asked about is kept and the gate
 * decides. Only if the bans leave nothing composable does the unfiltered pool
 * come back, where the gate then behaves exactly as it did before.
 */
function withoutBanned(t: MemberTaste, pool: ItemWithBrand[], heroId?: string | null): ItemWithBrand[] {
  if (!t.brief?.nevers.some((n) => n.kind === 'ban')) return pool
  const kept = pool.filter((i) => i.item_id === heroId || isOwnedItem(i as any) || !briefBlocks(briefPiece(i), t.brief))
  return canBuildLooks(kept) ? kept : pool
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

// Her price verdict on a piece, resolving the price the same way the rest of
// the system does (price_gbp, else the item's own currency converted).
export function itemPriceVerdict(t: MemberTaste, item: ItemWithBrand) {
  if (!t.priceBands) return 'unknown' as const
  const { gbp } = priceOfItem(item as any)
  return priceVerdict(t.priceBands, { item_type: item.item_type, price_gbp: gbp })
}

// How much this member wants this item, independent of the outfit around it.
/** A look's combination, order-independent: its item ids, sorted. */
export const lookSignature = (itemIds: (string | null | undefined)[]): string =>
  Array.from(new Set(itemIds.filter(Boolean) as string[])).sort().join('|')

export function memberItemScore(t: MemberTaste, item: ItemWithBrand): number {
  const brandId = item.brand_id ?? undefined
  let s = brandId ? (t.affinity.get(brandId) ?? 0.08) : 0.08
  if (brandId) {
    const swaps = t.brandSwapOut.get(brandId) ?? 0
    s -= Math.min(0.12 * swaps, 0.4)
  }
  const itemSwaps = t.itemSwapOut.get(item.item_id) ?? 0
  s -= Math.min(0.3 * itemSwaps, 0.6)
  // The per-item and per-brand penalties above only ever punish the exact
  // piece she saw. This punishes the description she keeps rejecting, so the
  // sixth black MUNTHE bag is not offered as if it were the first.
  if (t.traits) s -= traitPenalty(t.traits, item as any)
  // She already owns it — it has passed her taste once. A small, steady lift so
  // her own pieces surface in swap pickers; coherence still decides the look.
  if (isOwnedItem(item as any)) s += 0.1
  // Authored preferences. The avoid penalty only bites in the fallback pool —
  // normally avoided pieces are gated out entirely before scoring.
  s += lovedScore(t.prefs, item as any)
  if (avoidReasons(t.prefs, item as any).length) s -= 0.5
  // What she has actually responded to, as a shape rather than a list.
  if (t.tasteVector?.length) {
    const c = cosine(pseudoVec(item), t.tasteVector)
    s += Math.max(-0.1, Math.min(0.1, (c - 0.8) * 1.2))
  }
  const pv = itemPriceVerdict(t, item)
  // Over her ceiling normally never reaches scoring (it is gated out of the
  // pool); the penalty only bites in the fallback pool. Below her floor is a
  // gentle nudge — cheap for her is a quality signal, not a rule.
  if (pv === 'over') s -= 0.5
  else if (pv === 'under') s -= 0.15
  return Math.max(-0.5, Math.min(1.4, s))
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

const SHOE_TYPES = new Set(['sneaker', 'flat', 'boot', 'heel', 'sandal', 'mule'])
/** How many usable pieces a shoe type needs before it can own the slot alone. */
export const SHOE_PREFERENCE_MIN = 4

/**
 * Her shoes, not the anchor's. The shoe bucket is filled by pairwise
 * compatibility with the anchor, so an authored "loves trainers" (+0.15 on the
 * piece) never reached it — boots won on compatibility. When she loves shoe
 * types, the shoe slot is drawn from those; trainers lead outright when she
 * loves them and there are enough to vary. Falls back to every loved shoe type,
 * then to all shoes, so a thin library still dresses her.
 */
export function preferLovedShoes(t: MemberTaste, pool: ItemWithBrand[]): ItemWithBrand[] {
  const loved = new Set((t.prefs?.types_loved ?? []).filter((x) => SHOE_TYPES.has(x)))
  if (!loved.size) return pool
  const isShoe = (i: ItemWithBrand) => slotForItemType(i.item_type) === 'shoe'
  const shoes = pool.filter(isShoe)
  const rest = pool.filter((i) => !isShoe(i))
  if (loved.has('sneaker')) {
    const sneakers = shoes.filter((i) => i.item_type === 'sneaker')
    if (sneakers.length >= SHOE_PREFERENCE_MIN) return [...rest, ...sneakers]
  }
  const lovedShoes = shoes.filter((i) => i.item_type && loved.has(i.item_type))
  if (lovedShoes.length >= SHOE_PREFERENCE_MIN) return [...rest, ...lovedShoes]
  return pool
}

// Hard gate: excluded brand pairs and input-only brands never appear.
export function memberGate(
  t: MemberTaste,
  anchor: ItemWithBrand,
  items: { item: ItemWithBrand; slot: Slot }[],
  /** false = her house-style / Chloe-style rules are relaxed; global bans still hold. */
  strict = true,
): boolean {
  const all = [anchor, ...items.map((i) => i.item)]
  for (const it of all) {
    // The Zara rule (input, never output) is about what we RECOMMEND. A piece
    // she already owns is never a recommendation, so owned items are exempt.
    if (isOwnedItem(it as any)) continue
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
  // White and cream do not go together — a house rule the constitution only
  // penalised, and never applied to member looks at all. Read from the colour
  // itself: half the "cream" library is white (lib/pale-tone).
  if (mixesWhiteAndCream(all as any)) return false
  // Pieces Chloe has ejected from this kind of look in the Composer.
  if (t.ejections) {
    const band = formalityBand(all as any)
    for (const x of [{ item: anchor, slot: slotForItemType(anchor.item_type) }, ...items]) {
      if (isExcluded(t.ejections, x.item.item_id, x.slot, band)) return false
    }
  }
  const j = judgeMemberLook(t, all, [undefined, ...items.map((x) => x.slot)])
  if (j?.blocked) {
    // Relaxed pass: only the global bans still block.
    if (strict || j.violations.some((v) => GLOBAL_BAN_CODES.has(v.code))) return false
  }
  // Her stylist's NEVERS — a ban is a ban in the relaxed pass too: a piece the
  // stylist would never put on her is not "nearly right". What she already
  // owns is exempt (it is hers, not a recommendation) and is penalised instead.
  if (t.brief && judgeAgainstBrief(all.filter((it) => !isOwnedItem(it as any)).map(briefPiece), t.brief).blocked) return false
  return true
}

const GLOBAL_BAN_CODES = new Set(['colour.fuchsia', 'colour.discordant', 'category.activewear'])

export function toLookItem(item: ItemWithBrand): LookItem {
  const owned = isOwnedItem(item as any)
  const priceGbp =
    (item as any).price_gbp != null ? Number((item as any).price_gbp) : item.price != null ? Number(item.price) : null
  return {
    brand: owned ? ownedBrandLabel(item as any) : item.brand?.name ?? '—',
    product_name: item.product_name,
    // Owned = £0 of new spend. Her replacement-value estimate rides separately.
    price_gbp: owned ? null : priceGbp != null && !isNaN(priceGbp) ? priceGbp : null,
    estimated_value_gbp: owned ? estimatedValueOf(item as any) : undefined,
    url: owned ? undefined : item.retailer_url ?? undefined,
    owned,
    in_stock: owned ? true : item.stock_status !== 'out_of_stock',
    stock_checked_at: (item as any).stock_checked_at ?? null,
    item_id: item.item_id,
    brand_id: item.brand_id ?? null,
    image_url: item.image_url ?? null,
    slot: slotForItemType(item.item_type),
    item_type: item.item_type,
    material_primary: item.material_primary ?? null,
  }
}

// Slots a composed look should always carry if the library can fill them.
const ENSURE_SLOTS: Slot[] = ['bag']

export interface ComposedLook {
  items: LookItem[]
  notes: string
  score: number
  /** How many of the pieces she already owns (wardrobe import). */
  ownedCount: number
}

// ── Owned-items modes ───────────────────────────────────────────────────────
//
// NOTE on the House Style Constitution: it governs what MYRA PUBLISHES — the
// public feed, via the Outfit Composer, the pipeline and outfit review. It does
// NOT run here. A private client's looks are filtered by HER stylist persona
// (the moodboard envelope, via personaFitScore) plus her own authored
// preferences and her feedback history, which sharpen as she responds. A rule
// like "every look needs exactly one statement element" is a house editorial
// position, not a universal one — for a quiet persona it would reject precisely
// the looks that are right for her.
export interface ComposeOptions {
  /**
   * blend        — (default) her owned pieces sit in the pool and compete for
   *                every slot like any retail piece.
   * style_owned  — "style what she owns": at least ⌈count × ownedTargetShare⌉
   *                looks contain ≥1 owned piece, each anchored on one (any slot).
   * retail_only  — ignore the wardrobe (what composition did before import).
   */
  ownedMode?: 'blend' | 'style_owned' | 'retail_only'
  ownedTargetShare?: number
  /** Ask again and get different answers: shifts the rotation, nothing else. */
  shuffle?: number
}

export const DEFAULT_OWNED_TARGET_SHARE = 0.6

export function lookHasOwned(items: { owned?: boolean }[]): boolean {
  return items.some((i) => i.owned)
}

// What this member has already been shown — so composition explores rather
// than replaying its own argmax, WITHOUT walking away from the pieces that
// worked.
export interface ComposeHistory {
  /** Shown before and not kept. A nudge toward variety, nothing more. */
  seenCounts: Map<string, number>
  /** She approved a look containing it. Evidence FOR the piece. */
  keptCounts?: Map<string, number>
  rejected: Set<string>
  /** How many times it was swapped away, removed or skipped. */
  rejectedCounts?: Map<string, number>
  /**
   * Pieces that have already ANCHORED a look she approved.
   *
   * A piece that has had its look does not need another one built around it —
   * that is what "style 3 ways" is for. It stays available as a supporting
   * piece, and stays findable by name in the swap picker; it simply stops
   * being the seed of a fresh composition.
   */
  anchoredIds?: Set<string>
  /**
   * Looks MYRA made and Chloe passed over: their combinations (by signature)
   * and the pieces that anchored them. Ignoring a look is an answer — the same
   * outfit is not offered again, and its anchor waits its turn.
   */
  passedSignatures?: Set<string>
  passedAnchors?: Set<string>
}

/**
 * Her latest answer on this piece was a rejection, so it is not offered.
 *
 * This used to need two rejections, because `rejected` counted every rejection
 * ever made — a swap undone a minute later included. Now `rejected` holds only
 * pieces whose MOST RECENT answer is a rejection (lib/piece-verdicts), so one
 * unreversed "no" is her answer. Composing the DIVIO PHONE bag she removed and
 * never kept, while the confidence score marked the same look 0% for it, was
 * the two halves disagreeing. The starvation net still releases the gate.
 */
export function rejectedEnoughToBlock(h: ComposeHistory | undefined, itemId: string): boolean {
  return !!h && h.rejected.has(itemId)
}

/**
 * The variety nudge, the reward for a piece that worked, and the penalty for
 * one that did not.
 *
 * These were the wrong way round. Every accepted item incremented seenCounts,
 * so a piece she had approved twice carried −0.9 while a piece she had
 * REJECTED carried −0.5: the composer walked away from what worked harder than
 * from what failed, and reached further into the long tail with every good
 * delivery. That is what "the outfits have got worse" looks like from the
 * inside.
 *
 * Now: being shown is a small nudge, being KEPT is a credit, and being
 * rejected compounds until the piece is gone.
 */
function historyPenalty(h: ComposeHistory | undefined, itemId: string): number {
  if (!h) return 0
  let p = 0
  const shown = h.seenCounts.get(itemId) ?? 0
  if (shown) p += 0.15 * Math.min(shown, 3)
  const kept = h.keptCounts?.get(itemId) ?? 0
  if (kept) p -= Math.min(0.3, 0.15 * kept)
  const rejected = h.rejectedCounts?.get(itemId) ?? (h.rejected.has(itemId) ? 1 : 0)
  if (rejected) p += Math.min(1.5, 0.8 * rejected)
  return p
}

// Deterministic tie-rotation: a small per-item offset seeded by how much
// history exists, so two back-to-back compositions with near-tied scores pick
// different pieces — and the same inputs still reproduce the same output.
function varietyJitter(itemId: string, seed: number): number {
  let h = (0x811c9dc5 ^ seed) >>> 0
  for (let i = 0; i < itemId.length; i++) h = Math.imul(h ^ itemId.charCodeAt(i), 0x01000193) >>> 0
  return ((h % 1000) / 1000 - 0.5) * 0.16
}

/**
 * Where a piece sits on a slot's shortlist, beyond its fit: pieces she has been
 * shown step back, pieces she kept step forward, near-ties rotate. Applied to
 * the piece itself — the same penalty averaged across a whole look moved a
 * shown-three-times necklace by ~0.03 and changed nothing.
 */
function varietyAdjust(h: ComposeHistory | undefined, itemId: string, seed: number): number {
  return -historyPenalty(h, itemId) + varietyJitter(itemId, seed)
}

/** The piece that completes a slot (the bag): the best few by fit, then her history and rotation decide. */
function pickFill(
  t: MemberTaste, library: ItemWithBrand[], slot: Slot, keep: ItemWithBrand[], exclude: Set<string>,
  occ: OccasionContext | undefined, lens: PersonaLens | undefined, history: ComposeHistory | undefined, seed: number,
): { item: ItemWithBrand; score: number } | undefined {
  return rankAlternates(t, library, slot, keep, exclude, 6, occ, lens)
    .map((o) => ({ ...o, score: o.score + varietyAdjust(history, o.item.item_id, seed) }))
    .sort((a, b) => b.score - a.score)[0]
}

// Compose up to `count` looks. Anchors are the member's highest-affinity
// dresses/tops (each look anchored on a different brand where possible);
// the rest of each look comes from the Outfit Composer with the member's
// taste folded into generation. Items never repeat across the set, and the
// member's look history pushes fresh pieces forward each delivery.
// A pool can build looks if it can dress the body: a dress, or a top and a
// bottom. Accessories alone are not an outfit.
function canBuildLooks(pool: ItemWithBrand[]): boolean {
  let dress = 0, top = 0, bottom = 0, shoe = 0
  for (const i of pool) {
    const slot = slotForItemType(i.item_type)
    if (slot === 'dress') dress++
    else if (slot === 'top') top++
    else if (slot === 'bottom') bottom++
    else if (slot === 'shoe') shoe++
  }
  // Every plan needs a shoe: a pool with none is not one to fall back on.
  return shoe >= 1 && (dress >= 2 || (top >= 2 && bottom >= 2))
}

export function composeMemberLooks(
  t: MemberTaste,
  libraryIn: ItemWithBrand[],
  count = 3,
  occ?: OccasionContext,
  lens?: PersonaLens,
  history?: ComposeHistory,
  opts: ComposeOptions = {},
): ComposedLook[] {
  const mode = opts.ownedMode ?? 'blend'
  const library = mode === 'retail_only' ? libraryIn.filter((i) => !isOwnedItem(i as any)) : libraryIn

  const seed = history ? Array.from(history.seenCounts.values()).reduce((s, n) => s + n, 0) + history.rejected.size : 0
  const inStock = library.filter(
    (i) =>
      i.image_url &&
      i.stock_status !== 'out_of_stock' &&
      // owned pieces are exempt from the input-only (Zara) rule — see memberGate
      (isOwnedItem(i as any) || !(i.brand?.name && t.inputOnlyBrands.has(i.brand.name.toLowerCase()))),
  )
  // Authored avoids are a hard gate: a colour or shape she has told us she
  // won't wear never gets composed. Safety net — if the gate would leave too
  // little to build a look from, fall back to the full pool (where the same
  // avoids still apply as a heavy scoring penalty) rather than send nothing.
  // The weather is not a preference. A wool jacket in 25°C is wrong however
  // thin the pool gets, so this gate sits OUTSIDE the starvation net — the old
  // net released all four gates together, and one over-tight preference was
  // enough to put houndstooth wool trousers in a hot-holiday look.
  const weatherOk = inStock.filter((i) => !climateReason(occ?.climate, i as any))

  const preferred = weatherOk.filter(
    (i) => avoidReasons(t.prefs, i as any).length === 0 &&
      itemPriceVerdict(t, i) !== 'over' &&
      // A description she has rejected and never once kept — "MUNTHE
      // structured bag" — is treated exactly like an authored avoid.
      !(t.traits && traitBlocked(t.traits, i as any)) &&
      // Rejected twice is an answer. "I skipped it one or two times and it
      // keeps showing up" was a soft −0.5 losing to brand affinity; it is now
      // a gate, released only by the same starvation net.
      !rejectedEnoughToBlock(history, i.item_id),
  )
  // Relax her preferences before the weather, and only fall past the weather
  // when the library genuinely has nothing for it — at which point the caller
  // says so rather than quietly dressing her for the wrong season.
  const usableBase = canBuildLooks(preferred)
    ? preferred
    : canBuildLooks(weatherOk)
      ? weatherOk
      : inStock
  const usable = withoutBanned(t, preferLovedShoes(t, usableBase), undefined)

  const itemScore = (i: ItemWithBrand) =>
    memberItemScore(t, i) + occasionItemScore(occ, i) + climateScore(occ?.climate, i as any) + personaFitScore(lens, i)
      - historyPenalty(history, i.item_id) - learnedRulePenalty(t, i, occ?.id) + varietyJitter(i.item_id, seed)

  // Regular anchors: dresses and tops (owned or retail, in blend mode).
  const anchorPool = usable.filter((i) => {
    const slot = slotForItemType(i.item_type)
    return slot === 'dress' || slot === 'top'
  })
  // A piece that already anchored an approved look has had its outfit. Styling
  // it again is what STYLE 3 WAYS does, deliberately; a fresh delivery should
  // be finding her something new. Relaxed only if nothing is left to anchor.
  // A piece that anchored a look she passed over does not anchor the next one.
  const passedAnchor = (id: string) => !!history?.passedAnchors?.has(id)
  const unusedAnchors = history?.anchoredIds?.size
    ? anchorPool.filter((i) => !history.anchoredIds!.has(i.item_id))
    : anchorPool
  const freshAnchors = unusedAnchors.filter((i) => !passedAnchor(i.item_id))
  const anchors = (freshAnchors.length ? freshAnchors : unusedAnchors.length ? unusedAnchors : anchorPool)
    .map((i) => ({ item: i, score: itemScore(i) }))
    .sort((a, b) => b.score - a.score)

  // Owned anchors for "style what she owns": ANY slot — a coat, a bag or a pair
  // of boots she owns is a perfectly good thing to build the rest around.
  const ownedAnchors = mode === 'style_owned'
    ? usable.filter((i) => isOwnedItem(i as any)).map((i) => ({ item: i, score: itemScore(i) })).sort((a, b) => b.score - a.score)
    : []
  const ownedTarget = mode === 'style_owned' && ownedAnchors.length
    ? Math.max(1, Math.ceil(count * (opts.ownedTargetShare ?? DEFAULT_OWNED_TARGET_SHARE)))
    : 0

  const looks: ComposedLook[] = []
  const usedItems = new Set<string>()
  const usedAnchorBrands = new Set<string>()
  let ownedLooks = 0
  // Her style rules hold first; only if they leave the delivery short are they
  // relaxed for the remaining looks, and those looks say so in their notes.
  let strictRules = true

  const tryAnchor = (a: { item: ItemWithBrand; score: number }, anchorsInPhase: number): boolean => {
    if (usedItems.has(a.item.item_id)) return false
    const brandId = a.item.brand_id ?? ''
    // brand diversity across the set — relax only if we run out of brands
    if (brandId && usedAnchorBrands.has(brandId) && anchorsInPhase > count) return false

    const anchorOwned = isOwnedItem(a.item as any)
    // The persona lens and her own preferences do the filtering; the only hard
    // gate is hers — input-only brands and brand pairs she has excluded.
    const cands = generateCandidates({
      anchor: a.item,
      library: usable,
      perSlotPool: 5,
      maxCandidates: 5,
      shortlistAdjust: (i) => varietyAdjust(history, i.item_id, seed) + stylistPull(t, lens, i),
      minScore: 0.5,
      excludeItemIds: Array.from(usedItems),
      learnedBonus: (items) =>
        memberComboBonus(t, a.item, items) + styleLearningBonus(t, a.item, items) +
        items.reduce((sum, i) => sum + occasionItemScore(occ, i.item) + personaFitScore(lens, i.item)
          - historyPenalty(history, i.item.item_id) - learnedRulePenalty(t, i.item, occ?.id) + varietyJitter(i.item.item_id, seed), 0) /
          Math.max(1, items.length),
      learnedBlend: 0.4,
      houseGate: (items) => memberGate(t, a.item, items, strictRules),
    })
    const best = cands[0]
    if (!best) return false

    const all = [
      { item: a.item, slot: slotForItemType(a.item.item_type) },
      ...best.items,
    ]

    // A finished look carries a bag. The shared composer treats bag as
    // optional (it competes with omitting it), so top it up here rather than
    // changing slot planning for the main Outfit Composer.
    for (const need of ENSURE_SLOTS) {
      if (all.some((x) => x.slot === need)) continue
      const exclude = new Set([...Array.from(usedItems), ...all.map((x) => x.item.item_id)])
      const pick = pickFill(t, usable, need, all.map((x) => x.item), exclude, occ, lens, history, seed)
      if (pick) all.push({ item: pick.item, slot: need })
    }

    // She has already passed this exact combination over. Only offer it again
    // if relaxing everything else still leaves the delivery short.
    if (strictRules && history?.passedSignatures?.has(lookSignature(all.map(({ item }) => item.item_id)))) return false

    all.forEach(({ item }) => usedItems.add(item.item_id))
    if (brandId) usedAnchorBrands.add(brandId)

    const famPairs: string[] = []
    for (let i = 0; i < all.length; i++)
      for (let j = i + 1; j < all.length; j++)
        if (shareFamily(t, all[i].item.brand_id, all[j].item.brand_id))
          famPairs.push(`${all[i].item.brand?.name} × ${all[j].item.brand?.name}`)

    const ownedCount = all.filter(({ item }) => isOwnedItem(item as any)).length
    const affinity = memberItemScore(t, a.item)
    const occFit = occasionItemScore(occ, a.item)
    const lensFit = personaFitScore(lens, a.item)
    const anchorLabel = anchorOwned ? `her own ${a.item.product_name}` : a.item.brand?.name ?? '—'
    const notes = [
      `Anchor ${anchorLabel} (affinity ${affinity.toFixed(2)}${occ?.id ? `, occasion fit ${occFit >= 0 ? '+' : ''}${occFit.toFixed(2)}` : ''})`,
      lens?.envelope && lens.weight > 0
        ? `through ${lens.name ?? 'persona'} at weight ${lens.weight.toFixed(2)} (lens fit ${lensFit >= 0 ? '+' : ''}${lensFit.toFixed(2)})`
        : null,
      lens?.reference?.envelope ? 'shaped by her reference pictures' : null,
      `coherence ${best.score.toFixed(2)}`,
      ownedCount ? `◈ ${ownedCount} from her wardrobe` : null,
      !strictRules && t.rules?.source !== 'global_only' ? `${t.rules?.styleName ?? 'house style'} rules relaxed — too few looks passed them` : null,
      famPairs.length ? `family pairing: ${Array.from(new Set(famPairs)).join(', ')}` : null,
    ]
      .filter(Boolean)
      .join(' · ')

    looks.push({ items: all.map(({ item }) => toLookItem(item)), notes, score: best.score, ownedCount })
    if (ownedCount) ownedLooks++
    return true
  }

  // Phase 1 — style what she owns: one look per owned anchor until the target is met.
  for (const a of ownedAnchors) {
    if (looks.length >= count || ownedLooks >= ownedTarget) break
    tryAnchor(a, ownedAnchors.length)
  }
  // Phase 2 — fill the delivery from the regular anchors (owned or retail).
  for (const a of anchors) {
    if (looks.length >= count) break
    tryAnchor(a, anchors.length)
  }
  // Phase 3 — still short: relax her style rules (never the global bans).
  if (looks.length < count && t.rules && t.rules.source !== 'global_only') {
    strictRules = false
    for (const a of anchors) {
      if (looks.length >= count) break
      tryAnchor(a, anchors.length)
    }
  }

  return looks
}

// ── VARIANTS PER HERO ────────────────────────────────────────────────────────
// The member's real question is "what else can I wear this with?" — so hold ONE
// hero fixed and compose several genuinely different looks around it.
// generateCandidates already returns many ranked outfits for one anchor; we keep
// the most DISTINCT few (no more than half their supporting pieces shared) so the
// set reads as real alternatives, not the same look nudged. Each returned look is
// an ordinary ComposedLook whose first item is the shared hero, so it approves,
// swaps and shoots exactly like any other look.
export function composeMemberVariants(
  t: MemberTaste,
  libraryIn: ItemWithBrand[],
  heroId: string,
  count = 3,
  occ?: OccasionContext,
  lens?: PersonaLens,
  history?: ComposeHistory,
  opts: ComposeOptions = {},
): ComposedLook[] {
  const mode = opts.ownedMode ?? 'blend'
  const library = mode === 'retail_only' ? libraryIn.filter((i) => !isOwnedItem(i as any)) : libraryIn
  const seed = (history ? Array.from(history.seenCounts.values()).reduce((s, n) => s + n, 0) + history.rejected.size : 0)
    + (opts.shuffle ?? 0) * 7919

  // Same pool construction as composeMemberLooks — kept in step deliberately so
  // a variant is never built from a piece a fresh delivery wouldn't use.
  const inStock = library.filter(
    (i) => i.image_url && i.stock_status !== 'out_of_stock' &&
      (isOwnedItem(i as any) || !(i.brand?.name && t.inputOnlyBrands.has(i.brand.name.toLowerCase()))),
  )
  const weatherOk = inStock.filter((i) => !climateReason(occ?.climate, i as any))
  const preferred = weatherOk.filter(
    (i) => avoidReasons(t.prefs, i as any).length === 0 && itemPriceVerdict(t, i) !== 'over' &&
      !(t.traits && traitBlocked(t.traits, i as any)) &&
      // Same as a fresh delivery: a piece she last rejected is not styled in.
      (i.item_id === heroId || !rejectedEnoughToBlock(history, i.item_id)),
  )
  const usable = withoutBanned(t, preferLovedShoes(t, canBuildLooks(preferred) ? preferred : canBuildLooks(weatherOk) ? weatherOk : inStock), heroId)

  const anchor = usable.find((i) => i.item_id === heroId)
    ?? inStock.find((i) => i.item_id === heroId)
    ?? libraryIn.find((i) => i.item_id === heroId)
  if (!anchor) return []

  const cands = generateCandidates({
    anchor,
    library: usable,
    perSlotPool: 8,
    maxCandidates: 20,
    shortlistAdjust: (i) => varietyAdjust(history, i.item_id, seed) + stylistPull(t, lens, i),
    minScore: 0.45,
    excludeItemIds: [],
    learnedBonus: (items) =>
      memberComboBonus(t, anchor, items) + styleLearningBonus(t, anchor, items) +
      items.reduce((sum, i) => sum + occasionItemScore(occ, i.item) + personaFitScore(lens, i.item)
        - historyPenalty(history, i.item.item_id) - learnedRulePenalty(t, i.item, occ?.id) + varietyJitter(i.item.item_id, seed), 0) /
        Math.max(1, items.length),
    learnedBlend: 0.4,
    houseGate: (items) => memberGate(t, anchor, items),
  })

  const supportIds = (c: ComposerCandidate) => new Set(c.items.map((x) => x.item.item_id))
  const overlap = (a: Set<string>, b: Set<string>) => {
    let shared = 0
    a.forEach((id) => { if (b.has(id)) shared++ })
    return shared / Math.max(a.size, b.size, 1)
  }
  const picked: ComposerCandidate[] = []
  // Ways to wear the same hero should not all finish with the same necklace or
  // bag — one pearl necklace ended up on two variants of Alison's looks.
  const finishIds = (c: ComposerCandidate) =>
    new Set(c.items.filter((x) => x.slot === 'jewellery' || x.slot === 'bag').map((x) => x.item.item_id))
  const sharesFinish = (a: ComposerCandidate, b: ComposerCandidate) => {
    const fb = finishIds(b)
    return Array.from(finishIds(a)).some((id) => fb.has(id))
  }
  // Distinctness, in three passes, so "three ways to wear it" are three
  // outfits: first no repeated top, shoe, coat, bag or necklace at all; then
  // allow a repeat except the top and the shoe; then, only if the library is
  // genuinely too thin, rank order. Sharing half the pieces used to pass, and
  // that is how one white shirt and one pair of trainers ended up in every look.
  const keyOf = (c: ComposerCandidate, slot: string) => c.items.find((x) => x.slot === slot)?.item.item_id ?? null
  const sharesSlot = (a: ComposerCandidate, b: ComposerCandidate, slots: readonly string[]) =>
    slots.some((sl) => { const x = keyOf(a, sl); return !!x && x === keyOf(b, sl) })
  const joins = (c: ComposerCandidate, slots: readonly string[], maxOverlap: number) =>
    picked.every((p) => overlap(supportIds(c), supportIds(p)) <= maxOverlap && !sharesSlot(c, p, slots) && !sharesFinish(c, p))
  for (const c of cands) { if (picked.length >= count) break; if (joins(c, VARIANT_DISTINCT_SLOTS, 0.34)) picked.push(c) }
  for (const c of cands) { if (picked.length >= count) break; if (!picked.includes(c) && joins(c, ['top', 'shoe'], 0.5)) picked.push(c) }
  for (const c of cands) { if (picked.length >= count) break; if (!picked.includes(c)) picked.push(c) }

  const heroSlot = slotForItemType(anchor.item_type)
  const fillUsed = new Set<string>() // bags added to earlier variants
  const anchorOwned = isOwnedItem(anchor as any)
  const anchorLabel = anchorOwned ? `her own ${anchor.product_name}` : anchor.brand?.name ?? '—'
  // What each slot has already worn across these variants. The shortlist can be
  // so lopsided that the same shoe wins every time; when that happens the piece
  // is replaced with the best one that has not been used here yet, and only
  // kept if there is genuinely nothing else in her size.
  const usedBySlot = new Map<string, Set<string>>()
  const usedIn = (slot: string) => usedBySlot.get(slot) ?? new Set<string>()
  const noteUsed = (slot: string, id: string) => {
    const set = usedBySlot.get(slot) ?? new Set<string>()
    set.add(id)
    usedBySlot.set(slot, set)
  }
  return picked.map((best) => {
    const all = [{ item: anchor, slot: heroSlot }, ...best.items]
    for (const need of ENSURE_SLOTS) {
      if (all.some((x) => x.slot === need)) continue
      const exclude = new Set([...Array.from(fillUsed), ...all.map((x) => x.item.item_id)])
      const pick = pickFill(t, usable, need, all.map((x) => x.item), exclude, occ, lens, history, seed)
      if (pick) { all.push({ item: pick.item, slot: need }); fillUsed.add(pick.item.item_id) }
    }
    for (const entry of all) {
      const slot = entry.slot
      if (!slot || slot === heroSlot || !VARIANT_DISTINCT_SLOTS.includes(slot as any)) continue
      if (!usedIn(slot).has(entry.item.item_id)) { noteUsed(slot, entry.item.item_id); continue }
      const exclude = new Set([...Array.from(usedIn(slot)), ...all.map((x) => x.item.item_id), ...Array.from(fillUsed)])
      const swap = pickFill(t, usable, slot as any, all.filter((x) => x !== entry).map((x) => x.item), exclude, occ, lens, history, seed)
      if (swap) entry.item = swap.item
      noteUsed(slot, entry.item.item_id)
    }
    const ownedCount = all.filter(({ item }) => isOwnedItem(item as any)).length
    const notes = [
      `Anchor ${anchorLabel} (affinity ${memberItemScore(t, anchor).toFixed(2)})`,
      `coherence ${best.score.toFixed(2)}`,
      ownedCount ? `◈ ${ownedCount} from her wardrobe` : null,
    ].filter(Boolean).join(' · ')
    return { items: all.map(({ item }) => toLookItem(item)), notes, score: best.score, ownedCount }
  })
}

// Ranked alternates for one slot of a look — what the SWAP picker shows.
// Half member taste, half coherence with the rest of the look.
/** The slots that make a look look different. Repeat one and it reads as the same outfit. */
export const VARIANT_DISTINCT_SLOTS = ['top', 'shoe', 'outerwear', 'bag', 'jewellery', 'bottom', 'dress'] as const

/** A sibling look has to be a different OUTFIT, not the same one in other shoes. */
export const MIN_SUPPORTING_DIFFERENCE = 0.6

/**
 * True when two ways of styling the same hero are really one way.
 *
 * The hero is shared by definition, so only the supporting pieces can carry
 * the difference. Requiring the sets to be identical before rejecting a
 * variant let a look through that changed one sandal — "style 3 ways" returned
 * the same outfit twice, which is worse than returning one.
 */
export function tooSimilarVariant(
  a: (string | null | undefined)[],
  b: (string | null | undefined)[],
  heroId?: string | null,
): boolean {
  const supporting = (ids: (string | null | undefined)[]) =>
    new Set(ids.filter((id): id is string => !!id && id !== heroId))
  const A = supporting(a)
  const B = supporting(b)
  if (!A.size && !B.size) return true
  const shared = Array.from(A).filter((id) => B.has(id)).length
  const different = 1 - shared / Math.max(A.size, B.size)
  return different < MIN_SUPPORTING_DIFFERENCE
}

export function rankAlternates(
  t: MemberTaste,
  library: ItemWithBrand[],
  slot: Slot,
  keepItems: ItemWithBrand[],
  excludeIds: Set<string>,
  limit = 12,
  occ?: OccasionContext,
  lens?: PersonaLens,
): Array<{ item: ItemWithBrand; score: number }> {
  const inSlot = library.filter(
    (i) =>
      slotForItemType(i.item_type) === slot &&
      !excludeIds.has(i.item_id) &&
      i.image_url &&
      i.stock_status !== 'out_of_stock' &&
      (isOwnedItem(i as any) || !(i.brand?.name && t.inputOnlyBrands.has(i.brand.name.toLowerCase()))),
  )
  // The swap and add pickers were offering everything the COMPOSER refuses:
  // heels she has said she never wears, pieces over her ceiling, descriptions
  // she has rejected repeatedly, wool for a hot holiday. "I am still being
  // shown heels" was this list, not the composed looks. Same gates, same
  // starvation relief — an empty slot picker is worse than an imperfect one.
  const allowed = inSlot.filter(
    (i) =>
      avoidReasons(t.prefs, i as any).length === 0 &&
      itemPriceVerdict(t, i) !== 'over' &&
      !(t.traits && traitBlocked(t.traits, i as any)) &&
      !climateReason(occ?.climate, i as any) &&
      // A swap must not put white next to cream — the rule applies to every
      // client, so it holds in the picker as well as in composing.
      !mixesWhiteAndCream([...keepItems, i] as any) &&
      // Her stylist's bans hold in the picker as they do in the shortlist.
      (isOwnedItem(i as any) || !briefBlocks(briefPiece(i), t.brief)),
  )
  return (allowed.length ? allowed : inSlot)
    .map((i) => {
      const compat =
        keepItems.length > 0
          ? keepItems.reduce((s, k) => s + pairCompat(k, i).total, 0) / keepItems.length
          : 0.7
      return { item: i, score: 0.5 * memberItemScore(t, i) + 0.5 * compat + occasionItemScore(occ, i) + personaFitScore(lens, i) + BRIEF_SHORTLIST_SCALE * briefPull(briefPiece(i), t.brief) - learnedRulePenalty(t, i, occ?.id) }
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
}
