// OUTFIT ASK — a sentence read as the pieces of an outfit.
//
// "I want to piece together an outfit with a silk blue dress, bronw isable
// marant heels and a leather jacket" is three pieces: a DRESS in blue silk,
// HEELS in brown by Isabel Marant, a JACKET in leather. "Find a long dress to
// go with this anchor" is one: a long DRESS, to sit beside the anchor.
//
// The item library shows what matches each piece; the Composer and Outfit
// Review put the matches together into looks. Deterministic, on the same
// dictionaries as the Edit's search (search-taxonomy), so a word means the
// same thing here as everywhere else — no API cost, instant.

import { parseQuery, hasMaterial, isTypoOf, TYPE, COLOUR, MATERIAL, MATERIAL_TERMS, STOPWORDS } from '@/lib/search-taxonomy'
import { slotForItemType, type Slot } from '@/lib/composer'
import type { ItemType } from '@/types/database'

export interface PieceSpec {
  /** Her words for this piece, cleaned: "silk blue dress". */
  label: string
  /** item_type values it may be; empty = any type ("something blue"). */
  itemTypes: string[]
  colours: string[]
  materials: string[]
  brand: string | null
  /** Length she asked for — held strictly first, relaxed if nothing fits. */
  length: 'long' | 'short' | null
  /** Leftover words ("slip", "wide leg", "ruffled") — they rank, never filter. */
  descriptors: string[]
}

export interface OutfitAsk {
  raw: string
  pieces: PieceSpec[]
}

// How she asks for a look carries no facet: "piece together", "to go with
// this anchor", "style it with".
const ASK_WORDS = new Set([
  'piece', 'together', 'put', 'make', 'build', 'create', 'compose', 'style', 'styled', 'pair', 'paired', 'match', 'matching',
  'goes', 'go', 'going', 'around', 'outfit', 'outfits', 'look', 'looks', 'anchor', 'it', 'them', 'one', 'ones', 'wearing', 'worn', 'want', 'wanted', 'need', 'add', 'also',
  'maybe', 'perhaps', 'really', 'very', 'quite', 'bit', 'little', 'new', 'nice', 'pretty', 'cute', 'chic', 'great',
  'something', 'anything', 'any', 'item', 'items', 'thing', 'things', 'pls', 'thanks', 'thank', 'you', 'we', 'us', 'her', 'she',
])

// Lengths say what she means more than the type: a long dress is a maxi or a
// midi, never a mini.
const LONG_WORDS = new Set(['long', 'longline', 'floor', 'floorlength', 'ankle'])
const SHORT_WORDS = new Set(['short', 'cropped'])
const LONG_TYPES = new Set(['maxi_dress', 'midi_dress'])
const SHORT_TYPES = new Set(['mini_dress', 'shorts'])
const LONG_TERMS = ['maxi', 'midi', 'long', 'floor length', 'floor-length', 'column', 'gown', 'ankle length']
const SHORT_TERMS = ['mini', 'short', 'cropped']

// The words that join pieces: commas, "and", "with", "plus", "&".
const JOINERS = /\s*(?:,|;|\+|&|\band\b|\bwith\b|\bplus\b|\balongside\b|\bthen\b|\balso\b)\s*/

const fold = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').replace(/\s+/g, ' ').trim()

// Words, with the punctuation that joins pieces (, ; & +) kept as tokens of
// their own — a brand's "&" is then matched like any other word of it.
const wordsOf = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/([,;&+])/g, ' $1 ')
    .replace(/[^a-z0-9\s,;&+-]/g, ' ')
    .split(/[\s-]+/)
    .filter(Boolean)

// A token close enough to a brand word: exact for short words, one typo for
// longer ones ("isable" for "isabel", "marrant" for "marant").
function brandWordMatch(tok: string, word: string): boolean {
  if (tok === word) return true
  if (word.length < 5 || tok.length < 5) return false
  return isTypoOf(tok, word)
}

// Words that are garment, colour or cloth words are never read as a brand on
// their own — a one-word label "Mother" must not eat "mother of the bride"
// any more than a brand called "Silk" could take "silk".
const isTaxonomyWord = (w: string) => Object.hasOwn(TYPE, w) || Object.hasOwn(COLOUR, w) || Object.hasOwn(MATERIAL, w)

/**
 * Find the brands named in the text (one typo per word allowed), longest
 * labels first, and stand each in for a placeholder so "Rag & Bone" is not
 * split at its "&".
 */
function extractBrands(tokens: string[], knownBrands: string[]): { tokens: string[]; brands: string[] } {
  const out = tokens.slice()
  const brands: string[] = []
  const labels = Array.from(new Set(knownBrands))
    .map((b) => ({ b, words: wordsOf(b), compact: fold(b).replace(/[^a-z0-9]/g, '') }))
    .filter((x) => x.words.length > 0 && x.compact.length >= 3)
    .sort((a, b) => b.compact.length - a.compact.length)
  for (const { b, words, compact } of labels) {
    for (let i = 0; i + words.length <= out.length; i++) {
      const window = out.slice(i, i + words.length)
      if (window.some((t) => t.startsWith('§'))) continue
      const spelled = window.every((t, k) => brandWordMatch(t, words[k]))
      if (spelled && !(words.length === 1 && (isTaxonomyWord(window[0]) || STOPWORDS.has(window[0])))) {
        out.splice(i, words.length, `§${brands.length}`)
        brands.push(b)
        break
      }
    }
    // "jcrew", "isabelmarant" — the label typed as one word.
    if (words.length > 1 && !brands.includes(b)) {
      const idx = out.findIndex((t) => !t.startsWith('§') && t.length >= 4 && brandWordMatch(t, compact))
      if (idx >= 0) { out[idx] = `§${brands.length}`; brands.push(b) }
    }
  }
  return { tokens: out, brands }
}

function emptySpec(): PieceSpec {
  return { label: '', itemTypes: [], colours: [], materials: [], brand: null, length: null, descriptors: [] }
}

const addAll = (arr: string[], vals: string[]) => { for (const v of vals) if (!arr.includes(v)) arr.push(v) }

function readChunk(words: string[], brands: string[]): PieceSpec | null {
  const spec = emptySpec()
  const plain: string[] = []
  for (const w of words) {
    if (w.startsWith('§')) { spec.brand = brands[Number(w.slice(1))] ?? null; continue }
    if (LONG_WORDS.has(w)) { spec.length = 'long'; continue }
    if (SHORT_WORDS.has(w)) { spec.length = 'short'; continue }
    plain.push(w)
  }
  const text = plain.join(' ')
  const p = parseQuery(text)
  addAll(spec.itemTypes, p.itemTypes)
  addAll(spec.colours, p.colourFamilies)
  addAll(spec.materials, p.materials)
  // "maxi", "mini" are read as types by parseQuery; as lengths they mean the same.
  spec.descriptors = p.intentTerms.filter((t) => !ASK_WORDS.has(t) && !STOPWORDS.has(t) && !/^\d+$/.test(t))
  // A long or short dress narrows the dress types; any other piece keeps its
  // type and holds the length as a word on the label.
  // A long dress is never a mini (nor a short one a maxi); a slip or shirt
  // dress stays in, held to the length by its name.
  if (spec.length && spec.itemTypes.length > 0) {
    const opposite = spec.length === 'long' ? SHORT_TYPES : LONG_TYPES
    const keep = spec.itemTypes.filter((t) => !opposite.has(t))
    if (keep.length > 0) spec.itemTypes = keep
  }
  const hasFacet = spec.itemTypes.length > 0 || spec.colours.length > 0 || spec.materials.length > 0 || !!spec.brand
  if (!hasFacet) return null
  spec.label = Array.from(new Set([
    spec.length,
    ...spec.colours,
    ...spec.materials,
    spec.brand,
    ...spec.descriptors,
    ...words.filter((w) => !w.startsWith('§') && Object.hasOwn(TYPE, w)),
  ].filter(Boolean) as string[]))
    .join(' ')
    .trim() || text
  return spec
}

// "blue dress brown heels" — two garments with no joiner — is two pieces: the
// words before each garment word belong to it. Garment words side by side
// ("slip skirt", "shirt dress") are one piece.
function splitAtGarments(words: string[]): string[][] {
  const isGarment = (w: string) => Object.hasOwn(TYPE, w)
  const out: string[][] = []
  let cur: string[] = []
  for (let i = 0; i < words.length; i++) {
    cur.push(words[i])
    const nextIsGarment = i + 1 < words.length && isGarment(words[i + 1])
    if (isGarment(words[i]) && !nextIsGarment && words.slice(i + 1).some(isGarment)) {
      out.push(cur)
      cur = []
    }
  }
  if (cur.length) out.push(cur)
  return out
}

// A chunk with no garment in it ("lace trim", "in brown") describes the piece
// before it; on its own at the start it is a piece of any type.
function mergeInto(target: PieceSpec, extra: PieceSpec) {
  addAll(target.colours, extra.colours)
  addAll(target.materials, extra.materials)
  addAll(target.descriptors, extra.descriptors)
  if (extra.brand && !target.brand) target.brand = extra.brand
  if (extra.length && !target.length) target.length = extra.length
  target.label = `${target.label} ${extra.label}`.trim()
}

/** Read a sentence as the pieces of an outfit. */
export function parseOutfitAsk(raw: string, knownBrands: string[] = []): OutfitAsk {
  const { tokens, brands } = extractBrands(wordsOf(raw), knownBrands)
  const chunks = tokens.join(' ').split(JOINERS).map((c) => c.split(' ').filter(Boolean)).filter((c) => c.length > 0)
    .flatMap(splitAtGarments)
  const pieces: PieceSpec[] = []
  for (const words of chunks) {
    const spec = readChunk(words, brands)
    if (!spec) continue
    const prev = pieces[pieces.length - 1]
    if (spec.itemTypes.length === 0 && prev && prev.itemTypes.length > 0 && !(spec.brand && prev.brand)) {
      mergeInto(prev, spec)
      continue
    }
    pieces.push(spec)
  }
  return { raw, pieces }
}

// ── Matching ────────────────────────────────────────────────────────────────

export interface AskItem {
  item_id: string
  product_name?: string | null
  item_type?: string | null
  colour_family?: string | null
  material_primary?: string | null
  stock_status?: string | null
  created_at?: string | null
  brand?: { name?: string | null } | null
}

// Blue reaches navy: she says "blue" of a navy dress as often as not.
const COLOUR_REACH: Record<string, string[]> = { blue: ['blue', 'navy'] }

const hasTerm = (hay: string, term: string) => new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(hay)

function lengthFits(item: AskItem, length: 'long' | 'short'): boolean {
  const t = String(item.item_type ?? '')
  if ((length === 'long' ? LONG_TYPES : SHORT_TYPES).has(t)) return true
  if ((length === 'long' ? SHORT_TYPES : LONG_TYPES).has(t)) return false
  const name = fold(String(item.product_name ?? ''))
  return (length === 'long' ? LONG_TERMS : SHORT_TERMS).some((term) => hasTerm(name, term))
}

/**
 * The facets a piece is held to, strictest first. Each relaxation drops the
 * softest thing she said and says so: the cloth and the length go first,
 * then the colour, then the brand. The type is never dropped — she asked for
 * heels, she gets heels.
 */
export const RELAX_LEVELS = ['exact', 'no-cloth', 'no-colour', 'no-brand'] as const
export type RelaxLevel = (typeof RELAX_LEVELS)[number]

export function matchesPiece(item: AskItem, spec: PieceSpec, level: RelaxLevel = 'exact'): boolean {
  const depth = RELAX_LEVELS.indexOf(level)
  if (spec.itemTypes.length > 0 && !spec.itemTypes.includes(String(item.item_type ?? ''))) return false
  if (spec.brand && depth < 3 && fold(item.brand?.name ?? '') !== fold(spec.brand)) return false
  if (spec.colours.length > 0 && depth < 2) {
    const fam = String(item.colour_family ?? '')
    if (!spec.colours.some((c) => (COLOUR_REACH[c] ?? [c]).includes(fam))) return false
  }
  if (depth < 1) {
    if (spec.materials.some((m) => !hasMaterial(item, m))) return false
    if (spec.length && !lengthFits(item, spec.length)) return false
  }
  return true
}

/** How well the leftover words land on the name — ranks, never filters. */
export function descriptorScore(item: AskItem, spec: PieceSpec): number {
  const name = fold(String(item.product_name ?? ''))
  let s = 0
  for (const d of spec.descriptors) if (hasTerm(name, d)) s += 1
  // Kept facets that only ranked at a looser level still count for something.
  if (spec.length && lengthFits(item, spec.length)) s += 0.5
  for (const m of spec.materials) if (hasMaterial(item, m)) s += 0.5
  // The cloth in the piece's own name beats a cloth only in its tags: a "mink
  // fur jacket" leads a fur ask before a jacket merely tagged fur.
  for (const m of spec.materials) if ((MATERIAL_TERMS[m] ?? [m]).some((t) => hasTerm(name, fold(t)))) s += 0.5
  return s
}

const stockRank = (s: string | null | undefined) => (s === 'out_of_stock' ? 2 : s === 'unknown' ? 1 : 0)

export interface PieceMatches<T extends AskItem> {
  spec: PieceSpec
  level: RelaxLevel
  /** Plain-words note when something she said had to give, else null. */
  relaxed: string | null
  total: number
  items: T[]
}

function relaxNote(spec: PieceSpec, level: RelaxLevel): string | null {
  if (level === 'exact') return null
  const dropped: string[] = []
  if (spec.materials.length || spec.length) dropped.push([spec.length, ...spec.materials].filter(Boolean).join(' '))
  if (level !== 'no-cloth' && spec.colours.length) dropped.push(spec.colours.join('/'))
  if (level === 'no-brand' && spec.brand) dropped.push(spec.brand)
  const what = dropped.filter(Boolean).join(', ')
  return what ? `Nothing exact for “${spec.label}” — showing without ${what}` : null
}

/**
 * The items for one piece, best first: the strictest level that finds
 * anything, then the leftover words, sellable before not, then the caller's
 * own order (compatibility with an anchor) and the newest.
 */
export function rankForPiece<T extends AskItem>(
  pool: T[],
  spec: PieceSpec,
  opts: { limit?: number; score?: (item: T) => number } = {},
): PieceMatches<T> {
  const limit = opts.limit ?? 24
  for (const level of RELAX_LEVELS) {
    if (level === 'no-cloth' && !spec.materials.length && !spec.length) continue
    if (level === 'no-colour' && !spec.colours.length) continue
    if (level === 'no-brand' && !spec.brand) continue
    const hits = pool.filter((it) => matchesPiece(it, spec, level))
    if (hits.length === 0) continue
    const extra = new Map(hits.map((it) => [it.item_id, opts.score ? opts.score(it) : 0]))
    const desc = new Map(hits.map((it) => [it.item_id, descriptorScore(it, spec)]))
    hits.sort((a, b) =>
      (desc.get(b.item_id)! - desc.get(a.item_id)!) ||
      (stockRank(a.stock_status) - stockRank(b.stock_status)) ||
      (extra.get(b.item_id)! - extra.get(a.item_id)!) ||
      String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')))
    return { spec, level, relaxed: relaxNote(spec, level), total: hits.length, items: hits.slice(0, limit) }
  }
  return { spec, level: 'exact', relaxed: null, total: 0, items: [] }
}

/** The slot a piece lands in, when every type it may be lands in one. */
export function slotOfPiece(spec: PieceSpec): Slot | null {
  const slots = new Set(spec.itemTypes.map((t) => slotForItemType(t as ItemType)).filter(Boolean))
  return slots.size === 1 ? Array.from(slots)[0] : null
}
