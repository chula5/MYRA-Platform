// Applying a frozen evaluation-profile context to candidate selection/ranking.
//
// An evaluation profile is coverage context only — style, brand group, budget,
// size, and occasion ranges built from controlled catalogue/intake values. This
// module turns the FROZEN profile context snapshot (carried on every candidate
// version) into:
//
//   * a canonical SizeProfile used to gate the generation pool to the profile's
//     declared clothing/shoe sizes (a WEARABLE match required — sold out fails
//     closed), and to answer objective size possibility;
//   * budget price-tier / max-price constraints read from the profile's budget,
//     with GBP prices resolved through the canonical priceOfItem contract;
//   * a per-item affinity nudge folding budget, controlled brand-group
//     membership, occasion, and style family into the composer's shortlist
//     ranking AND the anchor iteration order.
//
// Everything here is pure: it never reads mutable stylist/member tables and
// takes only plain item facts, so it unit-tests cleanly and both generation and
// objective checking consume the same frozen context.

import { isWearable, type MatchQuality, type SizeCategory, type SizeProfile } from '@/lib/size-canonical'
import { BRAND_GROUPS } from '@/app/onboarding/brand-groups'

// ── Controlled brand groups ──────────────────────────────────────────────────
//
// The controlled brand-group taxonomy is the onboarding BRAND_GROUPS list
// (aesthetic + price-point groups with explicit brand lists). Profile
// brand_groups values are keys into THAT list, and scoring is by actual
// brand-list membership — never by a parallel price-tier label map.

/** The controlled brand-group keys a profile may declare. */
export const CONTROLLED_BRAND_GROUP_KEYS: string[] = BRAND_GROUPS.map((g) => g.key)

// Same canonical brand-name key rules as brand-affinity's brandKey, kept local
// so this module stays pure (no server import chain).
function normalizeBrandName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/** Normalised brand name → the controlled group keys whose list contains it. */
const BRAND_GROUP_MEMBERSHIP = new Map<string, string[]>()
for (const group of BRAND_GROUPS) {
  for (const brand of group.brands) {
    const key = normalizeBrandName(brand)
    const list = BRAND_GROUP_MEMBERSHIP.get(key) ?? []
    list.push(group.key)
    BRAND_GROUP_MEMBERSHIP.set(key, list)
  }
}

/** The controlled group keys a brand belongs to ([] when in no group list). */
export function brandGroupsForBrand(brandName: string | null | undefined): string[] {
  if (!brandName) return []
  return BRAND_GROUP_MEMBERSHIP.get(normalizeBrandName(brandName)) ?? []
}

/**
 * Occasion id → item types it favours / avoids. Mirrors the composer's occasion
 * priors (pilot-composer `OCCASION_TYPE_PRIOR`) so an evaluation profile ranks
 * occasion-appropriate pieces up without pulling in the composer's heavy
 * server-side scoring machinery.
 */
export const OCCASION_FAVOUR: Record<string, { favour: string[]; avoid: string[] }> = {
  work_standard: { favour: ['blazer', 'trousers', 'shirt', 'knitwear', 'flat', 'tote'], avoid: ['mini_dress', 'slip_dress', 'shorts', 'sandal', 'corset'] },
  work_elevated: { favour: ['blazer', 'trousers', 'shirt', 'heel', 'structured_bag'], avoid: ['mini_dress', 'slip_dress', 'shorts', 'sandal', 'sneaker', 'corset', 'jeans'] },
  casual_day: { favour: ['jeans', 't-shirt', 'knitwear', 'sneaker', 'flat', 'tote', 'crossbody'], avoid: ['heel', 'clutch', 'maxi_dress', 'corset'] },
  dinner_drinks: { favour: ['heel', 'slip_dress', 'midi_dress', 'clutch', 'blouse', 'shoulder_bag'], avoid: ['sneaker', 'tote', 'gilet'] },
  event: { favour: ['maxi_dress', 'midi_dress', 'slip_dress', 'heel', 'clutch'], avoid: ['sneaker', 'jeans', 't-shirt', 'tote', 'shorts', 'gilet'] },
  travel: { favour: ['sneaker', 'flat', 'trousers', 'jeans', 'knitwear', 'tote', 'crossbody'], avoid: ['heel', 'clutch', 'corset'] },
}

const NEUTRAL_COLOURS = new Set(['white', 'cream', 'black', 'grey', 'navy', 'brown', 'camel', 'beige'])
const SOFT_COLOURS = new Set(['pink', 'burgundy', 'red', 'cream', 'purple'])

// ── Frozen profile facts ─────────────────────────────────────────────────────

export interface BudgetProfile {
  price_tiers?: number[] | null
  max_gbp?: number | null
  min_gbp?: number | null
}

export interface EvaluationProfileFacts {
  style_families: string[]
  brand_groups: string[]
  budget_profile: BudgetProfile
  size_profile: Record<string, unknown>
  occasions: string[]
}

/**
 * Read the frozen evaluation-profile facts from a candidate's context snapshot.
 * Returns null for a real-member context (its sizing/preferences flow through a
 * different path) or any snapshot without profile coverage fields.
 */
export function profileFactsFromContext(contextSnapshot: unknown): EvaluationProfileFacts | null {
  const snap = contextSnapshot as Record<string, unknown> | null | undefined
  if (!snap || snap.type !== 'evaluation_profile') return null
  return {
    style_families: Array.isArray(snap.style_families) ? (snap.style_families as string[]) : [],
    brand_groups: Array.isArray(snap.brand_groups) ? (snap.brand_groups as string[]) : [],
    budget_profile: (snap.budget_profile ?? {}) as BudgetProfile,
    size_profile: (snap.size_profile ?? {}) as Record<string, unknown>,
    occasions: Array.isArray(snap.occasions) ? (snap.occasions as string[]) : [],
  }
}

// ── Size profile ─────────────────────────────────────────────────────────────

const SIZE_CATEGORIES: SizeCategory[] = ['tops', 'bottoms', 'outerwear', 'shoes']

/** Build a canonical SizeProfile from a profile's stored `size_profile` jsonb. */
export function buildSizeProfile(sizeProfile: Record<string, unknown> | null | undefined): SizeProfile {
  const out: SizeProfile = {}
  if (!sizeProfile) return out
  for (const c of SIZE_CATEGORIES) {
    const entry = (sizeProfile as Record<string, any>)[c]
    const value = entry?.value
    if (value != null && Number.isFinite(Number(value))) {
      const adjacent = entry?.adjacent
      out[c] = { value: Number(value), adjacent: adjacent != null && Number.isFinite(Number(adjacent)) ? Number(adjacent) : null }
    }
  }
  return out
}

/** True when the profile declares at least one clothing/shoe size. */
export function hasAnySize(profile: SizeProfile): boolean {
  return SIZE_CATEGORIES.some((c) => profile[c]?.value != null)
}

/**
 * Keep decision for the size-gated generation pool. Genuinely unsized pieces
 * (bags, jewellery, belts, scarves…) are never gated by size. A sized piece is
 * kept only when a WEARABLE matching size exists — an exact or listed-adjacent
 * match that is actually buyable. A sold-out matching size row (quality full/
 * acceptable but wearable=false) is NOT kept: sold out fails closed. Unknown
 * sizing is NOT kept either — it would fail the objective size check.
 */
export function keepForProfileSize(sizeApplicable: boolean, quality: MatchQuality, wearable: boolean): boolean {
  if (!sizeApplicable) return true
  return wearable && isWearable(quality)
}

// ── Budget ───────────────────────────────────────────────────────────────────

/**
 * The brand price-tiers this profile accepts. Tiers come from the budget
 * profile only — brand_groups are an aesthetic membership signal scored by
 * brand-list membership, never a price-tier map.
 */
export function budgetTiers(facts: EvaluationProfileFacts): number[] {
  const set = new Set<number>()
  for (const t of facts.budget_profile?.price_tiers ?? []) {
    if (Number.isFinite(Number(t))) set.add(Number(t))
  }
  return Array.from(set).sort((a, b) => a - b)
}

export function budgetMaxGbp(facts: EvaluationProfileFacts): number | null {
  const v = facts.budget_profile?.max_gbp
  return v != null && Number.isFinite(Number(v)) ? Number(v) : null
}

// ── Per-item affinity ─────────────────────────────────────────────────────────

export interface AffinityItemFacts {
  item_type: string | null
  /** GBP price resolved through the canonical priceOfItem contract. */
  price_gbp: number | null
  brand_price_tier: number | null
  /** The item's brand display name, for controlled brand-group membership. */
  brand_name: string | null
  colour_family: string | null
  /** 1 (casual) → 5 (formal). */
  material_formality: number | null
  /** 1 (plain) → 5 (bold pattern). */
  pattern: number | null
}

function occasionNudge(facts: EvaluationProfileFacts, item: AffinityItemFacts): number {
  if (!item.item_type) return 0
  let s = 0
  for (const occ of facts.occasions) {
    const prior = OCCASION_FAVOUR[occ]
    if (!prior) continue
    if (prior.favour.includes(item.item_type)) s += 0.15
    if (prior.avoid.includes(item.item_type)) s -= 0.3
  }
  // Don't let several occasions compound without bound.
  return Math.max(-0.3, Math.min(0.3, s))
}

function budgetNudge(facts: EvaluationProfileFacts, item: AffinityItemFacts): number {
  const tiers = budgetTiers(facts)
  let s = 0
  if (tiers.length && item.brand_price_tier != null) {
    s += tiers.includes(item.brand_price_tier) ? 0.3 : -0.3
  }
  const max = budgetMaxGbp(facts)
  if (max != null && item.price_gbp != null && item.price_gbp > max) s -= 0.3
  return Math.max(-0.4, Math.min(0.3, s))
}

function styleNudge(facts: EvaluationProfileFacts, item: AffinityItemFacts): number {
  if (!facts.style_families.length) return 0
  const neutral = item.colour_family != null && NEUTRAL_COLOURS.has(item.colour_family)
  const soft = item.colour_family != null && SOFT_COLOURS.has(item.colour_family)
  const formality = item.material_formality
  const pattern = item.pattern
  let s = 0
  for (const fam of facts.style_families) {
    switch (fam) {
      case 'minimal':
        if (neutral) s += 0.12
        if (pattern != null && pattern >= 4) s -= 0.12
        break
      case 'classic':
        if (neutral) s += 0.08
        if (formality != null && formality >= 3) s += 0.06
        break
      case 'relaxed':
        if (formality != null && formality <= 2) s += 0.1
        if (formality != null && formality >= 4) s -= 0.08
        break
      case 'statement':
        if (!neutral) s += 0.1
        if (pattern != null && pattern >= 4) s += 0.08
        break
      case 'romantic':
        if (soft) s += 0.12
        break
    }
  }
  return Math.max(-0.2, Math.min(0.2, s))
}

/**
 * Brand-group membership nudge, scored by the item brand's ACTUAL membership
 * of the controlled onboarding brand lists. Only controlled keys count —
 * unrecognised brand_groups values are ignored. A brand in no controlled list
 * is neutral (we cannot judge it), not penalised.
 */
function brandGroupNudge(facts: EvaluationProfileFacts, item: AffinityItemFacts): number {
  const wanted = facts.brand_groups.filter((g) => CONTROLLED_BRAND_GROUP_KEYS.includes(g))
  if (!wanted.length || !item.brand_name) return 0
  const membership = brandGroupsForBrand(item.brand_name)
  if (!membership.length) return 0
  return membership.some((m) => wanted.includes(m)) ? 0.2 : -0.1
}

/**
 * A per-item ranking nudge (~[-1.0, 1.0]) folding the frozen profile's budget,
 * brand group, occasion, and style-family context into the composer shortlist.
 * Size is handled as a hard gate (`keepForProfileSize`), not here.
 */
export function profileItemAffinity(facts: EvaluationProfileFacts, item: AffinityItemFacts): number {
  return budgetNudge(facts, item) + occasionNudge(facts, item) + styleNudge(facts, item) + brandGroupNudge(facts, item)
}
