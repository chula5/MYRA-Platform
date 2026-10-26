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

import { CUT_WORDS, estimateItemFormality, hasMaterial, OCCASION_LEAD_TYPES, type ParsedQuery } from './search-taxonomy'

export interface RankablePiece {
  item_id: string
  product_name?: string | null
  item_type?: string | null
  colour_family?: string | null
  material_primary?: string | null
  material_formality?: number | null
  /** 1 sheer … 5 structural. */
  material_weight?: number | null
  /** 1 sleeveless … 5 full long sleeve. */
  sleeve?: number | null
  /** 1 none … 5 statement pattern. */
  pattern?: number | null
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
  /** Her taste graph, brand_id → how strongly the label is hers (0..1). They lead when she named no label. */
  herBrands?: Map<string, number>
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
    + (p.materials.length ? 1 : 0) + (p.formalityRange ? 1 : 0) + (p.seasons.length ? 1 : 0) + (p.cuts.length ? 1 : 0)
}

/** Is the piece sold as the cut she named? Read off its name — a pencil skirt says so.
 *  A word of hers outside CUT_WORDS ("ruffle") also takes its plain endings: ruffled, ruffles. */
export function cutFits(it: RankablePiece, cut: string): boolean {
  const words = CUT_WORDS[cut]
  if (words) return words.some((w) => hasWord(it.product_name, w))
  return new RegExp(`\\b${cut.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(s|es|d|ed|y|ing)?\\b`, 'i').test(String(it.product_name ?? ''))
}

// ── Seasons ───────────────────────────────────────────────────────────────────
//
// A piece has no season tag, so the season is read off the piece itself: its
// colour, how heavy its cloth is, how long its sleeve, and the words on its
// label. Winter is dark colours and weight — velvet, wool, knit, leather,
// long sleeves; it is never linen, a sundress, a sheer or a summer print.
// Summer is the mirror. Autumn and spring sit between, and are only held to
// what plainly belongs to the other end of the year.

const WINTER_COLOURS = new Set(['black', 'navy', 'burgundy', 'brown', 'grey', 'green', 'purple', 'red', 'camel'])
const SUMMER_COLOURS = new Set(['white', 'cream', 'yellow', 'pink', 'orange', 'blue', 'multicolour'])
const HEAVY_WORDS = ['velvet', 'velour', 'wool', 'merino', 'cashmere', 'knit', 'knitted', 'rib', 'ribbed', 'mohair', 'alpaca', 'tweed', 'bouclé', 'boucle', 'leather', 'suede', 'shearling', 'fur', 'brocade', 'jacquard', 'corduroy', 'flannel', 'felt', 'quilted', 'padded', 'turtleneck', 'roll neck', 'rollneck', 'polo neck', 'funnel neck', 'long sleeve', 'long-sleeve', 'long sleeved', 'winter', 'thermal', 'fleece', 'tartan', 'plaid', 'check']
const LIGHT_WORDS = ['linen', 'chiffon', 'organza', 'voile', 'seersucker', 'broderie', 'eyelet', 'crochet', 'poplin', 'gauze', 'cheesecloth', 'muslin', 'sundress', 'sun dress', 'beach', 'swim', 'bikini', 'resort', 'holiday', 'summer', 'floral', 'print', 'printed', 'tropical', 'gingham', 'sheer', 'raffia', 'straw', 'espadrille', 'sandal', 'short sleeve', 'short-sleeve', 'cap sleeve', 'sleeveless', 'strappy', 'halter']

/** The pieces a season reads off a label: ≥1 means it belongs, ≤ -1 means it plainly does not. */
export function seasonSignal(it: RankablePiece, season: string): number {
  const name = String(it.product_name ?? '').toLowerCase()
  const cloth = String(it.material_primary ?? '').toLowerCase()
  const text = `${name} ${cloth}`
  const heavyWord = HEAVY_WORDS.some((w) => hasWord(text, w))
  const lightWord = LIGHT_WORDS.some((w) => hasWord(text, w))
  const weight = typeof it.material_weight === 'number' ? it.material_weight : null
  const sleeve = typeof it.sleeve === 'number' ? it.sleeve : null
  const pattern = typeof it.pattern === 'number' ? it.pattern : null
  const colour = String(it.colour_family ?? '')
  const heavy = heavyWord || (weight != null && weight >= 4)
  const light = lightWord || (weight != null && weight <= 1)

  // How wintry the piece reads, as a sum of what can be seen on it.
  let cold = 0
  if (heavy) cold += 2
  else if (weight != null && weight >= 3) cold += 1
  if (light) cold -= 2
  else if (weight != null && weight <= 2 && !heavy) cold -= 1
  if (WINTER_COLOURS.has(colour)) cold += 1
  if (SUMMER_COLOURS.has(colour)) cold -= 1
  if (sleeve != null && sleeve >= 4) cold += 1
  if (sleeve != null && sleeve <= 2 && !heavy) cold -= 1
  if (pattern != null && pattern >= 4 && !heavy) cold -= 1

  switch (season) {
    case 'winter': return cold
    case 'autumn': return cold + 1
    case 'summer': return -cold
    case 'spring': return -cold + 1
    default: return 0
  }
}

/** Does the piece belong to the season she named? A dark, heavy, long-sleeved
 *  piece is winter; a striped linen dress, a white mini, a floral print are not. */
export function seasonFits(it: RankablePiece, season: string): boolean {
  return seasonSignal(it, season) >= 1
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
  if (p.seasons.length) part(p.seasons.some((season) => seasonFits(it, season)))
  if (p.cuts.length) part(p.cuts.every((cut) => cutFits(it, cut)))

  let bonus = 0
  // Within the season, the most seasonal first: a velvet long sleeve over a
  // dark short sleeve for winter.
  if (p.seasons.length) bonus += 0.04 * Math.max(0, Math.min(5, Math.max(...p.seasons.map((season) => seasonSignal(it, season)))))
  if (p.intentTerms.length) {
    const hit = p.intentTerms.filter((t) => hasWord(name, t) || hasWord(it.material_primary, t)).length
    bonus += 0.3 * (hit / p.intentTerms.length)
  }
  if (ctx.needle && name.includes(ctx.needle)) bonus += 0.1
  if (String(it.status) === 'live') bonus += 0.05
  // Her brands first: Fiona asking for the office sees ME+EM before its neighbours.
  const weight = !p.brand ? ctx.herBrands?.get(String(it.brand_id ?? '')) : undefined
  if (weight != null) bonus += 0.3 * weight
  // An occasion's own pieces in its order: for the office, tailoring before a bag.
  if (p.occasionTypes.length && p.itemTypes.length === p.occasionTypes.length) {
    const lead = p.occasionTypes.indexOf(String(it.item_type ?? ''))
    if (lead >= 0) bonus += 0.1 - lead * 0.005
  }
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

/**
 * An occasion asked with no piece named is answered as a rail, not a wall:
 * one of each kind of piece in turn (a blazer, trousers, a shirt, a knit…),
 * each kind still in its own order, so her brands lead within it.
 */
export function mixByType<T extends RankablePiece>(list: Scored<T>[]): Scored<T>[] {
  const byType = new Map<string, Scored<T>[]>()
  for (const s of list) {
    const k = String(s.it.item_type ?? '')
    const q = byType.get(k) ?? []
    q.push(s)
    byType.set(k, q)
  }
  const queues = Array.from(byType.values())
  const out: Scored<T>[] = []
  while (out.length < list.length) for (const q of queues) { const next = q.shift(); if (next) out.push(next) }
  return out
}
