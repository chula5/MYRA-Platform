// STYLING SETS — pure logic.
//
// The composer's unit of work is not a single outfit but a styling set: every
// hero item is styled into 3-4 distinct outfits so users always see multiple
// representations of a piece. These are the distinctness rules that make a set
// genuinely varied — no lazy near-duplicates. DB + composition orchestration
// live in the styling actions; this file is fully unit-testable.

export interface SetVariant {
  /** Supporting item ids — the hero is NOT included. */
  supportingIds: string[]
  shoeId?: string | null
  bagId?: string | null
  /** Direction preset key ('daytime' | 'evening' | 'layered' | 'weekend' | …). */
  direction?: string | null
  /** Derived occasion scores at composition time. */
  formality?: number | null
  timeOfDay?: number | null
  /** House verdict's statement item for this variant (may be the hero). */
  statementItemId?: string | null
}

// ── Direction presets ─────────────────────────────────────────────────────────
// How the composer steers each variant of a set apart: shoe register, layering,
// jewellery temperature and target time-of-day. "Same dress: daytime casual
// with flats / evening with heels and pendant / weekend-away with jacket."

export interface DirectionPreset {
  key: string
  label: string
  shoeTypes: string[]           // preferred item_types for the shoe slot
  wantOuterwear: boolean
  jewellery: 'minimal' | 'open' // minimal = dainty only; open = statement allowed
  targetTimeOfDay: [number, number]
  targetFormality: [number, number]
}

export const DIRECTION_PRESETS: DirectionPreset[] = [
  {
    key: 'daytime', label: 'DAYTIME CASUAL',
    shoeTypes: ['flat', 'sneaker', 'sandal', 'mule'],
    wantOuterwear: false, jewellery: 'minimal',
    targetTimeOfDay: [1, 2], targetFormality: [1, 3],
  },
  {
    key: 'evening', label: 'EVENING',
    shoeTypes: ['heel', 'mule'],
    wantOuterwear: false, jewellery: 'open',
    targetTimeOfDay: [4, 5], targetFormality: [3, 5],
  },
  {
    key: 'layered', label: 'LAYERED / TRANSITIONAL',
    shoeTypes: ['boot', 'flat', 'heel'],
    wantOuterwear: true, jewellery: 'minimal',
    targetTimeOfDay: [2, 4], targetFormality: [2, 4],
  },
  {
    key: 'weekend', label: 'WEEKEND AWAY',
    shoeTypes: ['flat', 'sneaker', 'boot', 'sandal'],
    wantOuterwear: true, jewellery: 'minimal',
    targetTimeOfDay: [1, 3], targetFormality: [1, 2],
  },
]

export const SET_TARGET_SIZE = 4
export const SET_MIN_SIZE = 3
/** A set with fewer live/approved variants than this is under-styled. */
export const SET_MIN_LIVE = 2
/** Between any two variants, at least this share of supporting items differs. */
export const MIN_SUPPORT_DIFFERENCE = 0.6

// ── Pairwise rules ────────────────────────────────────────────────────────────

/** Share of supporting items the two variants have in common (0..1, over the larger set). */
export function supportingOverlap(a: SetVariant, b: SetVariant): number {
  const sa = new Set(a.supportingIds)
  const sb = new Set(b.supportingIds)
  if (sa.size === 0 && sb.size === 0) return 1
  let shared = 0
  for (const id of sa) if (sb.has(id)) shared++
  return shared / Math.max(sa.size, sb.size, 1)
}

export function sharesShoesAndBag(a: SetVariant, b: SetVariant): boolean {
  return !!a.shoeId && !!b.bagId && a.shoeId === b.shoeId && a.bagId === b.bagId
}

/** Variants must differ in occasion OR formality OR styling direction. */
export function directionsDiffer(a: SetVariant, b: SetVariant): boolean {
  if (a.direction && b.direction && a.direction !== b.direction) return true
  if (a.formality != null && b.formality != null && Math.abs(a.formality - b.formality) >= 1) return true
  if (a.timeOfDay != null && b.timeOfDay != null && Math.abs(a.timeOfDay - b.timeOfDay) >= 2) return true
  return false
}

export interface PairVerdict { ok: boolean; reasons: string[] }

export function validateVariantPair(a: SetVariant, b: SetVariant): PairVerdict {
  const reasons: string[] = []
  const overlap = supportingOverlap(a, b)
  if (overlap > 1 - MIN_SUPPORT_DIFFERENCE + 1e-9) {
    reasons.push(`only ${Math.round((1 - overlap) * 100)}% of supporting items differ (minimum 60%)`)
  }
  if (sharesShoesAndBag(a, b)) reasons.push('same shoes AND same bag as another variant')
  if (!directionsDiffer(a, b)) reasons.push('no difference in occasion, formality or styling direction')
  return { ok: reasons.length === 0, reasons }
}

/** True when the candidate is pairwise-distinct from every accepted variant. */
export function isDistinctFromAll(candidate: SetVariant, accepted: SetVariant[]): PairVerdict {
  for (const v of accepted) {
    const p = validateVariantPair(candidate, v)
    if (!p.ok) return p
  }
  return { ok: true, reasons: [] }
}

// ── Set-level rules ───────────────────────────────────────────────────────────

export interface SetVerdict { ok: boolean; violations: string[] }

/**
 * Statement consistency: if the hero is the statement element in ANY variant it
 * must be the statement in EVERY variant (the base changes around it). If the
 * hero is a base piece, each variant may choose its own statement.
 */
export function statementConsistent(heroItemId: string, variants: SetVariant[]): boolean {
  const heroIsStatement = variants.some((v) => v.statementItemId === heroItemId)
  if (!heroIsStatement) return true
  return variants.every((v) => v.statementItemId === heroItemId)
}

export function validateSet(heroItemId: string, variants: SetVariant[]): SetVerdict {
  const violations: string[] = []
  if (variants.length < SET_MIN_SIZE) {
    violations.push(`only ${variants.length} variants — a set needs ${SET_MIN_SIZE}-${SET_TARGET_SIZE}`)
  }
  for (let i = 0; i < variants.length; i++) {
    for (let j = i + 1; j < variants.length; j++) {
      const p = validateVariantPair(variants[i], variants[j])
      if (!p.ok) violations.push(`variants ${i + 1} & ${j + 1}: ${p.reasons.join('; ')}`)
    }
  }
  if (!statementConsistent(heroItemId, variants)) {
    violations.push('hero is the statement in some variants but not all — it must stay the statement everywhere')
  }
  return { ok: violations.length === 0, violations }
}

/** Live/approved variant counting → under-styled flag. */
export function isUnderStyled(liveVariantCount: number): boolean {
  return liveVariantCount < SET_MIN_LIVE
}
