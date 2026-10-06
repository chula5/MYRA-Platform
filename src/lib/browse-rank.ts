// BROWSE RANKING — how a piece answers what she typed.
//
// The same reading the Edit's looks search uses (search-taxonomy.ts) is turned
// into REQUIREMENTS here, not hints. Every facet MYRA heard — the label, the
// piece, the colour, the cloth, how dressed-up the occasion is — must hold on
// the one piece for it to be an EXACT answer. A piece that answers most of
// them, but not all, is SIMILAR: it waits behind a button, never in front of
// the real answers. So "silk slip skirt" is silk skirts first and cotton
// skirts only if she asks to see what comes close, and "j.crew" is J.Crew.
//
// Pure functions, so the rules can be tested without a database.

import { estimateItemFormality, hasMaterial, OCCASION_LEAD_TYPES, type ParsedQuery } from './search-taxonomy'

export interface RankablePiece {
  item_id: string
  product_name?: string | null
  item_type?: string | null
  colour_family?: string | null
  material_primary?: string | null
  material_formality?: number | null
  status?: string | null
  brand_id?: string | null
  brand?: { name?: string | null } | null
}

export interface RankContext {
  /** Ids of the brands her words named (the parsed brand, all rows sharing its name). */
  brandIds: Set<string>
  /** The words she typed, minus stopwords — the fallback when nothing was understood. */
  words: string[]
  /** The whole phrase, lower-cased. */
  needle: string
}

export interface Scored<T> { it: T; score: number; hits: number; facets: number; bonus: number }
export interface Ranked<T> { exact: Scored<T>[]; similar: Scored<T>[] }

/** How far a piece may sit outside the asked formality range and still count. */
const FORMALITY_SLACK = 0.5

// Whole-word match so "red" doesn't light up on "altered".
export function hasWord(hay: string | null | undefined, needle: string): boolean {
  if (!hay) return false
  return new RegExp(`\\b${needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(hay)
}

/** The facets her words carried — what a piece will be held to. */
export function facetCount(p: ParsedQuery): number {
  return (p.brand ? 1 : 0) + (p.itemTypes.length ? 1 : 0) + (p.colourFamilies.length ? 1 : 0)
    + (p.materials.length ? 1 : 0) + (p.formalityRange ? 1 : 0)
}

/**
 * Does the piece sit inside the formality she asked for (a wedding → 3–4)?
 * A dressed-up occasion has no ceiling: a gown is never too much for a
 * wedding, so a range that reaches 4 is open at the top. A casual ask keeps
 * both bounds — a gown is not the answer to "something easy".
 */
export function formalityFits(it: RankablePiece, range: [number, number]): boolean {
  const f = estimateItemFormality(it)
  if (f == null) return false
  const top = range[1] >= 4 ? 5 : range[1]
  return f >= range[0] - FORMALITY_SLACK && f <= top + FORMALITY_SLACK
}

/**
 * Score one piece. `hits`/`facets` is the strict part — exact means every
 * facet held. `bonus` only orders pieces within a tier: the descriptor she
 * used ("slip", "wide leg") in the name, the whole phrase in the name, a live
 * piece over a draft, and dresses first for a dressed-up occasion when she
 * named no piece.
 */
export function scorePiece(it: RankablePiece, p: ParsedQuery, ctx: RankContext): Scored<RankablePiece> {
  const name = String(it.product_name ?? '').toLowerCase()
  let hits = 0
  let facets = 0
  const part = (hit: boolean) => { facets += 1; if (hit) hits += 1 }

  if (p.brand) part(ctx.brandIds.has(String(it.brand_id ?? '')) || hasWord(it.brand?.name, p.brand))
  if (p.itemTypes.length) part(p.itemTypes.includes(String(it.item_type ?? '')))
  if (p.colourFamilies.length) {
    part(p.colourFamilies.includes(String(it.colour_family ?? '')) || p.colourFamilies.some((c) => hasWord(name, c)))
  }
  if (p.materials.length) part(p.materials.some((m) => hasMaterial(it, m)))
  if (p.formalityRange) part(formalityFits(it, p.formalityRange))

  let bonus = 0
  if (p.intentTerms.length) {
    const hit = p.intentTerms.filter((t) => hasWord(name, t) || hasWord(it.material_primary, t)).length
    bonus += 0.3 * (hit / p.intentTerms.length)
  }
  if (ctx.needle && name.includes(ctx.needle)) bonus += 0.1
  if (String(it.status) === 'live') bonus += 0.05
  if (p.formalityRange && !p.itemTypes.length && p.formalityRange[1] >= 4) {
    const lead = OCCASION_LEAD_TYPES.indexOf(String(it.item_type ?? ''))
    if (lead >= 0) bonus += 0.2 - lead * 0.02
  }

  if (facets === 0) {
    // Nothing understood: she typed a name, or a label we do not stock. Hold
    // the piece to the words themselves instead.
    const words = ctx.words.length ? ctx.words : (ctx.needle ? [ctx.needle] : [])
    const matched = words.filter((w) => name.includes(w)).length
    const score = words.length ? matched / words.length : 0
    return { it, score: score + bonus, hits: matched, facets: words.length, bonus }
  }
  return { it, score: hits / facets + bonus, hits, facets, bonus }
}

/**
 * Split the candidates into the exact answers and what comes close. Exact is
 * every facet held; similar is at least half of them (and at least one), so
 * with a piece and a cloth named, a skirt in the wrong cloth or the cloth in
 * another piece is similar, and a piece that is neither is gone.
 */
export function rankPieces<T extends RankablePiece>(items: T[], p: ParsedQuery, ctx: RankContext): Ranked<T> {
  const exact: Scored<T>[] = []
  const similar: Scored<T>[] = []
  const seen = new Set<string>()
  for (const it of items) {
    if (!it?.item_id || seen.has(it.item_id)) continue
    seen.add(it.item_id)
    const s = scorePiece(it, p, ctx) as Scored<T>
    if (s.facets === 0) continue
    if (s.hits === s.facets) exact.push(s)
    else if (s.hits >= 1 && s.hits * 2 >= s.facets) similar.push(s)
  }
  const order = (a: Scored<T>, b: Scored<T>) => b.score - a.score || String(a.it.product_name ?? '').localeCompare(String(b.it.product_name ?? ''))
  exact.sort(order)
  similar.sort(order)
  return { exact, similar }
}
