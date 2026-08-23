// What a member's swaps and removes say about the KIND of thing she rejects.
//
// The composer already learned per item ("not that bag") and per brand ("less
// MUNTHE"). Both are too narrow to converge. Measured on Alison's first 18
// looks: five different MUNTHE black structured bags were offered and swapped
// away one after another, and a Sessùn bag she removed came back two days
// later — because each new piece arrives with a clean per-item record and the
// brand penalty is a nudge, not a rule.
//
// A trait is any description a decision generalises to: the brand, the type,
// the colour, the price band, the shape — and, more usefully, the pairs of
// those. "Black structured bag by MUNTHE" is the trait she was rejecting; the
// individual bags were incidental.
//
// Pure and dependency-free so it can be unit-tested against her real history.

export interface TraitItem {
  item_id: string
  brand_id?: string | null
  brand_name?: string | null
  item_type?: string | null
  colour_family?: string | null
  material_category?: string | null
  price_gbp?: number | null
  fit?: number | null
  structure?: number | null
  length?: number | null
  leg_opening?: number | null
  rise?: number | null
  pattern?: number | null
}

export interface TraitDecision { item: TraitItem; kept: boolean }

export interface TraitStat { accepts: number; rejects: number }
export interface TraitModel {
  stats: Map<string, TraitStat>
  blocked: Set<string>
}

const band = (p: number | null | undefined): string | null => {
  if (typeof p !== 'number') return null
  if (p < 100) return 'under100'
  if (p < 200) return '100_200'
  if (p < 350) return '200_350'
  if (p < 600) return '350_600'
  return 'over600'
}

/** Shape words derived from the scored dimensions — the same vocabulary the
 *  authored shape preferences use, so learning and authoring agree. */
function shapeTags(i: TraitItem): string[] {
  const out: string[] = []
  if (typeof i.fit === 'number') out.push(i.fit >= 4 ? 'oversized' : i.fit <= 2 ? 'fitted' : 'easy')
  if (typeof i.structure === 'number') out.push(i.structure >= 4 ? 'unstructured' : i.structure <= 2 ? 'structured' : 'softly_structured')
  if (typeof i.length === 'number') out.push(i.length >= 4 ? 'long' : i.length <= 2 ? 'short' : 'mid')
  if (typeof i.leg_opening === 'number') out.push(i.leg_opening >= 4 ? 'wide_leg' : i.leg_opening <= 2 ? 'narrow_leg' : 'straight_leg')
  if (typeof i.rise === 'number' && i.rise >= 4) out.push('high_waisted')
  if (typeof i.pattern === 'number') out.push(i.pattern >= 4 ? 'patterned' : 'plain')
  return out
}

/**
 * Every trait one item carries. Unary traits describe it; the pairs are what
 * actually carry taste — she buys black bags and she buys MUNTHE, and rejects
 * MUNTHE's black bags. Neither half of that is visible on its own.
 */
export function traitsOf(i: TraitItem): string[] {
  const brand = i.brand_id ? `brand:${i.brand_id}` : null
  const type = i.item_type ? `type:${i.item_type}` : null
  const colour = i.colour_family ? `colour:${i.colour_family}` : null
  const material = i.material_category ? `material:${i.material_category}` : null
  const price = band(i.price_gbp) ? `price:${band(i.price_gbp)}` : null
  const shapes = shapeTags(i).map((s) => `shape:${s}`)

  const unary = [brand, type, colour, material, price, ...shapes].filter(Boolean) as string[]
  const pairs: string[] = []
  if (brand && type) pairs.push(`${brand}+${type}`)
  if (colour && type) pairs.push(`${colour}+${type}`)
  if (brand && colour) pairs.push(`${brand}+${colour}`)
  for (const s of shapes) if (type) pairs.push(`${s}+${type}`)
  return [...unary, ...pairs]
}

const isPair = (t: string) => t.includes('+')

// How much evidence before a trait is allowed to speak at all. Three is the
// point where a run of rejections stops looking like one bad piece.
export const MIN_EVIDENCE = 3

// A block needs a run of rejections AND a lopsided ratio. Requiring zero
// keeps sounded right and blocked nothing on real data: an accept row is
// written for every item in an approved look, so a piece tolerated once inside
// an otherwise good outfit counts as a keep even when its siblings were all
// swapped away. Four-to-one is where the pattern stops being noise —
// calibrated on Alison: it catches MUNTHE structured bags (6 out, 1 kept) and
// leaves black bags in general (11 out, 10 kept) alone.
export const BLOCK_MIN_REJECTS = 4
export const BLOCK_RATIO = 4

/**
 * Blocked traits. Only pairs can block — a unary block is too blunt, "no
 * black" or "no bags" is never what she meant, and one wrong block costs a
 * whole category.
 */
export function buildTraitModel(decisions: TraitDecision[]): TraitModel {
  const stats = new Map<string, TraitStat>()
  for (const d of decisions) {
    for (const t of traitsOf(d.item)) {
      const s = stats.get(t) ?? { accepts: 0, rejects: 0 }
      if (d.kept) s.accepts++
      else s.rejects++
      stats.set(t, s)
    }
  }
  const blocked = new Set<string>()
  for (const [t, s] of Array.from(stats.entries())) {
    if (isPair(t) && s.rejects >= BLOCK_MIN_REJECTS && s.rejects >= BLOCK_RATIO * s.accepts) blocked.add(t)
  }
  return { stats, blocked }
}

/** True when this piece matches something she has consistently rejected. */
export function traitBlocked(model: TraitModel, item: TraitItem): string | null {
  for (const t of traitsOf(item)) if (model.blocked.has(t)) return t
  return null
}

// Soft steer, bounded so it can shade a ranking without overturning it.
export const MAX_TRAIT_PENALTY = 0.6

/**
 * A penalty in the same units as the composer's other item scores.
 *
 * The WORST pair decides it, not an average across every trait. Averaging
 * buried the finding: "MUNTHE black" at 13 rejections to 4 keeps came out near
 * zero once diluted by the brand being liked overall and the colour being her
 * most-worn. The specific reading is the one she is acting on.
 */
export function traitPenalty(model: TraitModel, item: TraitItem): number {
  let worstPair = 0
  let worstUnary = 0
  for (const t of traitsOf(item)) {
    const s = model.stats.get(t)
    if (!s) continue
    const n = s.accepts + s.rejects
    const net = (s.rejects - s.accepts) / n
    if (isPair(t)) {
      if (n >= MIN_EVIDENCE && net > worstPair) worstPair = net
    } else if (n >= MIN_EVIDENCE * 2 && net > worstUnary) {
      worstUnary = net
    }
  }
  // A unary trait alone is weak evidence — it describes half the library.
  const net = worstPair > 0 ? worstPair : worstUnary * 0.5
  return net <= 0 ? 0 : Math.min(MAX_TRAIT_PENALTY, net * MAX_TRAIT_PENALTY)
}

/** Plain-language reasons, for the admin panel — learning she can audit. */
export function explainTraits(model: TraitModel, label: (t: string) => string): string[] {
  const rows = Array.from(model.stats.entries())
    .filter(([t, s]) => isPair(t) && s.rejects >= MIN_EVIDENCE)
    .sort((a, b) => (b[1].rejects - b[1].accepts) - (a[1].rejects - a[1].accepts))
    .slice(0, 12)
  return rows.map(([t, s]) =>
    `${label(t)} — ${s.rejects} out, ${s.accepts} kept${model.blocked.has(t) ? ' · BLOCKED' : ''}`)
}
