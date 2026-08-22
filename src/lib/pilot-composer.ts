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
import type { LookItem, StylePrefs } from '@/lib/pilot-stylist'
import { avoidReasons, lovedScore } from '@/lib/pilot-stylist'
import { itemPseudoVector } from '@/lib/brand-affinity'
import { cosine } from '@/lib/taste-vector'
import { evaluateHouseStyle, type EvaluateOpts } from '@/lib/house-style'
import { toHouseItem } from '@/lib/house-item'
import { isOwnedItem, ownedBrandLabel, estimatedValueOf } from '@/lib/wardrobe/owned-items'

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
}

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
  if (!lens?.envelope?.mean?.length || lens.weight <= 0) return 0
  const v = pseudoVec(item)
  let total = 0
  let n = 0
  for (const { dim, field } of ITEM_LENS_DIMS) {
    if ((item as any)[field] == null) continue // not scored — no evidence either way
    const spread = lens.envelope.spread?.[dim] ?? 0
    const denom = Math.max(spread, 0.125)
    total += Math.abs(v[dim] - (lens.envelope.mean[dim] ?? 0)) / denom
    n++
  }
  if (n === 0) return 0
  const raw = Math.max(-0.5, 1 - total / n / 2)
  return raw * lens.weight
}

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
  // What she has TOLD us (authored, never learned over): colours/shapes/types
  // she loves or won't wear. Avoided = hard gate, loved = scoring bonus.
  prefs?: StylePrefs
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
  // She already owns it — it has passed her taste once. A small, steady lift so
  // her own pieces surface in swap pickers; coherence still decides the look.
  if (isOwnedItem(item as any)) s += 0.1
  // Authored preferences. The avoid penalty only bites in the fallback pool —
  // normally avoided pieces are gated out entirely before scoring.
  s += lovedScore(t.prefs, item as any)
  if (avoidReasons(t.prefs, item as any).length) s -= 0.5
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

// Hard gate: excluded brand pairs and input-only brands never appear.
export function memberGate(
  t: MemberTaste,
  anchor: ItemWithBrand,
  items: { item: ItemWithBrand; slot: Slot }[],
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
  return true
}

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
  /** True when the House Style Constitution had to be relaxed to build it (retail-only looks only). */
  constitutionRelaxed: boolean
}

// ── Owned-items modes & the constitution gate ───────────────────────────────
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
  /**
   * The House Style Constitution gate — statement budget, echo rule, silhouette
   * balance, material pairing, colour rules, price integrity (which skips
   * null-priced owned pieces). On by default. A look containing an owned piece
   * is NEVER relaxed — an owned item that can't be styled to standard doesn't
   * get forced in. A retail-only look falls back to the member gate only when
   * the constitution would leave nothing to send, and says so in its notes.
   */
  houseStyle?: { enabled?: boolean; opts?: EvaluateOpts }
}

export const DEFAULT_OWNED_TARGET_SHARE = 0.6

export function lookHasOwned(items: { owned?: boolean }[]): boolean {
  return items.some((i) => i.owned)
}

// What this member has already been shown, so composition explores instead
// of replaying its own greedy argmax delivery after delivery.
export interface ComposeHistory {
  seenCounts: Map<string, number> // item_id → times already featured in her looks
  rejected: Set<string> // item_ids she skipped / had removed
}

function historyPenalty(h: ComposeHistory | undefined, itemId: string): number {
  if (!h) return 0
  let p = 0
  const n = h.seenCounts.get(itemId) ?? 0
  if (n) p += 0.3 * Math.min(n, 3) // shown before — rank down, don't ban (small library)
  if (h.rejected.has(itemId)) p += 0.5 // she said no to it
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

// Compose up to `count` looks. Anchors are the member's highest-affinity
// dresses/tops (each look anchored on a different brand where possible);
// the rest of each look comes from the Outfit Composer with the member's
// taste folded into generation. Items never repeat across the set, and the
// member's look history pushes fresh pieces forward each delivery.
// A pool can build looks if it can dress the body: a dress, or a top and a
// bottom. Accessories alone are not an outfit.
function canBuildLooks(pool: ItemWithBrand[]): boolean {
  let dress = 0, top = 0, bottom = 0
  for (const i of pool) {
    const slot = slotForItemType(i.item_type)
    if (slot === 'dress') dress++
    else if (slot === 'top') top++
    else if (slot === 'bottom') bottom++
  }
  return dress >= 2 || (top >= 2 && bottom >= 2)
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
  const hsEnabled = opts.houseStyle?.enabled !== false
  const hsOpts: EvaluateOpts = { occasion: occ?.id ?? null, ...(opts.houseStyle?.opts ?? {}) }

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
  const preferred = inStock.filter((i) => avoidReasons(t.prefs, i as any).length === 0)
  const usable = canBuildLooks(preferred) ? preferred : inStock
  const retailUsable = usable.filter((i) => !isOwnedItem(i as any))

  const constitutionPass = (all: { item: ItemWithBrand; slot: Slot }[]): boolean =>
    evaluateHouseStyle(all.map(({ item, slot }) => toHouseItem(item, slot)), hsOpts).pass

  const itemScore = (i: ItemWithBrand) =>
    memberItemScore(t, i) + occasionItemScore(occ, i) + personaFitScore(lens, i)
      - historyPenalty(history, i.item_id) + varietyJitter(i.item_id, seed)

  // Regular anchors: dresses and tops (owned or retail, in blend mode).
  const anchors = usable
    .filter((i) => {
      const slot = slotForItemType(i.item_type)
      return slot === 'dress' || slot === 'top'
    })
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

  const tryAnchor = (a: { item: ItemWithBrand; score: number }, requireOwned: boolean, anchorsInPhase: number): boolean => {
    if (usedItems.has(a.item.item_id)) return false
    const brandId = a.item.brand_id ?? ''
    // brand diversity across the set — relax only if we run out of brands
    if (brandId && usedAnchorBrands.has(brandId) && anchorsInPhase > count) return false

    const anchorOwned = isOwnedItem(a.item as any)
    const baseGate = (items: { item: ItemWithBrand; slot: Slot }[]) => memberGate(t, a.item, items)
    const fullGate = (items: { item: ItemWithBrand; slot: Slot }[]) =>
      baseGate(items) && (!hsEnabled || constitutionPass([{ item: a.item, slot: slotForItemType(a.item.item_type) }, ...items]))
    const generate = (lib: ItemWithBrand[], gate: (items: { item: ItemWithBrand; slot: Slot }[]) => boolean) =>
      generateCandidates({
        anchor: a.item,
        library: lib,
        perSlotPool: 5,
        maxCandidates: 5,
        minScore: 0.5,
        excludeItemIds: Array.from(usedItems),
        learnedBonus: (items) =>
          memberComboBonus(t, a.item, items) +
          items.reduce((sum, i) => sum + occasionItemScore(occ, i.item) + personaFitScore(lens, i.item)
            - historyPenalty(history, i.item.item_id) + varietyJitter(i.item.item_id, seed), 0) /
            Math.max(1, items.length),
        learnedBlend: 0.4,
        houseGate: gate,
      })

    let cands = generate(usable, fullGate)
    let relaxed = false
    // Constitution fallback — retail-only. If the anchor is owned, or the only
    // way through is with owned pieces, we don't force it: owned items are never
    // styled below standard.
    if (!cands.length && hsEnabled && !anchorOwned && !requireOwned) {
      cands = generate(retailUsable, baseGate)
      relaxed = cands.length > 0
    }
    const best = cands[0]
    if (!best) return false

    const all = [
      { item: a.item, slot: slotForItemType(a.item.item_type) },
      ...best.items,
    ]

    // A finished look carries a bag. The shared composer treats bag as
    // optional (it competes with omitting it), so top it up here rather than
    // changing slot planning for the main Outfit Composer — and the bag must
    // still clear the constitution with the rest of the look.
    for (const need of ENSURE_SLOTS) {
      if (all.some((x) => x.slot === need)) continue
      const exclude = new Set([...Array.from(usedItems), ...all.map((x) => x.item.item_id)])
      const picks = rankAlternates(t, relaxed ? retailUsable : usable, need, all.map((x) => x.item), exclude, 4, occ)
      for (const pick of picks) {
        const withBag = [...all, { item: pick.item, slot: need }]
        if (!hsEnabled || relaxed || constitutionPass(withBag)) { all.push({ item: pick.item, slot: need }); break }
      }
    }

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
      `coherence ${best.score.toFixed(2)}`,
      ownedCount ? `◈ ${ownedCount} from her wardrobe` : null,
      hsEnabled ? (relaxed ? 'constitution relaxed (retail only)' : 'constitution ✓') : null,
      famPairs.length ? `family pairing: ${Array.from(new Set(famPairs)).join(', ')}` : null,
    ]
      .filter(Boolean)
      .join(' · ')

    looks.push({ items: all.map(({ item }) => toLookItem(item)), notes, score: best.score, ownedCount, constitutionRelaxed: relaxed })
    if (ownedCount) ownedLooks++
    return true
  }

  // Phase 1 — style what she owns: one look per owned anchor until the target is met.
  for (const a of ownedAnchors) {
    if (looks.length >= count || ownedLooks >= ownedTarget) break
    tryAnchor(a, true, ownedAnchors.length)
  }
  // Phase 2 — fill the delivery from the regular anchors (owned or retail).
  for (const a of anchors) {
    if (looks.length >= count) break
    tryAnchor(a, false, anchors.length)
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
  lens?: PersonaLens,
): Array<{ item: ItemWithBrand; score: number }> {
  return library
    .filter(
      (i) =>
        slotForItemType(i.item_type) === slot &&
        !excludeIds.has(i.item_id) &&
        i.image_url &&
        i.stock_status !== 'out_of_stock' &&
        (isOwnedItem(i as any) || !(i.brand?.name && t.inputOnlyBrands.has(i.brand.name.toLowerCase()))),
    )
    .map((i) => {
      const compat =
        keepItems.length > 0
          ? keepItems.reduce((s, k) => s + pairCompat(k, i).total, 0) / keepItems.length
          : 0.7
      return { item: i, score: 0.5 * memberItemScore(t, i) + 0.5 * compat + occasionItemScore(occ, i) + personaFitScore(lens, i) }
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
}
