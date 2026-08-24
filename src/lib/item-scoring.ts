// Which model reads an item's style dimensions off its photograph.
//
// One item costs one call and the library is thousands of items deep, so the
// tier is a real decision rather than a default. Measured against 25 pieces
// already scored by hand and by Opus (see src/lib/__tests__/README notes and
// the eval in scripts/): on the dimensions that actually drive composition —
// fit, structure, length, pattern, colour and material — Haiku sits within a
// fraction of a point of the expensive tiers, at roughly a fiftieth of the
// cost. That difference is what makes scoring the WHOLE library affordable,
// and an unscored item contributes nothing at all.
export const DEFAULT_SCORING_MODEL = 'claude-haiku-4-5-20251001'

// The 1-5 dimensions the composer reads. Kept here so the backfill, the eval
// and the coverage read all agree on what "scored" means.
export const SCORED_DIMENSIONS = [
  'fit', 'length', 'rise', 'structure', 'shoulder', 'waist_definition',
  'leg_opening', 'surface', 'colour_depth', 'pattern', 'sheen',
  'material_weight', 'material_formality',
] as const

// The ones composition leans on hardest — a piece missing these is invisible
// to the shape preferences and to the persona lens.
export const CORE_DIMENSIONS = ['fit', 'structure', 'length', 'pattern', 'colour_depth', 'material_formality'] as const

export interface ScorableItem {
  item_id: string
  item_type: string | null
  colour_family: string | null
  material_category: string | null
  material_primary: string | null
  [k: string]: unknown
}

/** What a vision read gives back — the shape analyseProductImage returns. */
export interface AnalysedScores {
  item_type?: string | null
  colour_family?: string | null
  colour_hex?: string | null
  material_primary?: string | null
  material_category?: string | null
  neckline?: number | null
  [k: string]: unknown
}

const clamp15 = (v: unknown): number | null => {
  const n = Number(v)
  if (!Number.isFinite(n)) return null
  const r = Math.round(n)
  return r >= 1 && r <= 5 ? r : null
}

/**
 * The columns to write for one scored item.
 *
 * Two rules, both about not making things worse:
 *   — a dimension already scored is never overwritten. Hand-scored pieces and
 *     earlier passes are the yardstick this was measured against.
 *   — the feed's own facts win. Brand Watch reads item_type from the retailer's
 *     category and colour from its slug or option; the eval put vision at 52%
 *     on item_type against those, so vision only fills what is missing.
 */
export function scoreUpdateFor(item: ScorableItem, a: AnalysedScores): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const d of SCORED_DIMENSIONS) {
    if (item[d] != null) continue
    const v = clamp15(a[d])
    if (v != null) out[d] = v
  }
  // neckline and sleeve live outside SCORED_DIMENSIONS because their columns
  // are still being repaired by migration 0047 — the writer drops either if
  // this database does not have it yet.
  for (const f of ['neckline', 'sleeve'] as const) {
    if (item[f] != null) continue
    const v = clamp15((a as Record<string, unknown>)[f])
    if (v != null) out[f] = v
  }
  for (const f of ['colour_family', 'material_category', 'material_primary', 'colour_hex'] as const) {
    if (item[f] != null) continue
    const v = a[f]
    if (typeof v === 'string' && v.trim()) out[f] = v.trim()
  }
  return out
}

/** True once the piece carries enough for the composer to see it at all. */
export function isComposable(item: Record<string, unknown>): boolean {
  return CORE_DIMENSIONS.every((d) => item[d] != null)
}

// Sleeve and neckline only mean something on something worn on the body. A
// vision call asking a handbag about its sleeves costs the same as a real one.
export const SLEEVED_TYPES = [
  'coat', 'trench', 'jacket', 'blazer', 'gilet', 'cape', 'shirt', 'blouse',
  't-shirt', 'knitwear', 'corset', 'bodysuit', 'mini_dress', 'midi_dress',
  'maxi_dress', 'shirt_dress', 'slip_dress',
] as const
