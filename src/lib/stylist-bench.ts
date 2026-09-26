// THE BENCH'S SCORECARD — what a stylist's look can be measured on, for free.
//
// A column on the bench is one stylist's answer to one piece. Eyeballing eight
// of them tells Chloe they differ; it does not tell her whether Rosie got
// better after twenty new pictures. These numbers do. Every one is pure and
// costs nothing, so a trial can be re-run as often as she likes. All are
// 0–100, rounded, and NULL when the thing they measure does not exist (no
// brief, no occasion, no envelope) — a null is "not measurable", never a zero.
//
// The hero is in every column, so averages run over the supporting pieces
// only; a brief's nevers are judged over the whole look, because a brief may
// ban the very piece she was asked about, and that is worth saying.

import type { ItemWithBrand } from '@/lib/admin-queries'
import {
  briefPull, judgeAgainstBrief, paletteFamily, normBrand,
  type StylistBrief, type StylistNever,
} from '@/lib/stylist-brief'
import {
  briefPiece, occasionItemScore, personaFitScore, ITEM_LENS_DIMS, tooSimilarVariant,
  type OccasionContext,
} from '@/lib/pilot-composer'
import { pairCompat } from '@/lib/composer'
import { lookSimilarity } from '@/lib/look-similarity'
import { neverCandidates, cleanWord, type NeverAttr, type NeverPiece } from '@/lib/never-words'
export type { NeverAttr, NeverPiece } from '@/lib/never-words'

/** Bump when a formula changes, so old trial batches are never compared to new ones silently. */
export const SCORECARD_VERSION = 1

export interface BenchScorecard {
  version: number
  /** 50 = the brief was not touched; 100 = brand-level pull on every piece. */
  on_brief: number | null
  /** Supporting pieces the brief reaches for at all. */
  brief_hits: number
  brand_share: number | null
  palette_share: number | null
  violations: { text: string; kind: 'ban' | 'preference'; piece: string }[]
  hero_banned: boolean
  /** No client: favoured 65 · neutral 50 · avoided 15. */
  occasion: number | null
  occasion_avoided: string[]
  /** Mean pairwise compatibility of the whole look — deliberately NOT the composer's score, which moves as the model learns. */
  coherence: number
  /** The composer's own score, for reference. */
  score: number
  envelope: number | null
  /** Supporting pieces with none of the lens dimensions scored. */
  unscored: number
  /** 100 = shares nothing with any other column. */
  distinct: number | null
  /** Stylists whose look is really this one. */
  twins: string[]
}

const pct = (n: number) => Math.round(Math.max(0, Math.min(100, n)))
const mean = (xs: number[]): number | null => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)

export function scoreBenchColumn(input: {
  hero: ItemWithBrand
  /** The supporting pieces — the look without its hero. */
  pieces: ItemWithBrand[]
  brief?: StylistBrief | null
  envelope?: { mean: number[]; spread: number[] } | null
  occ?: OccasionContext
  score: number
}): Omit<BenchScorecard, 'distinct' | 'twins'> {
  const { hero, pieces, brief, envelope, occ, score } = input
  const all = [hero, ...pieces]

  let on_brief: number | null = null
  let brief_hits = 0
  let brand_share: number | null = null
  let palette_share: number | null = null
  let violations: BenchScorecard['violations'] = []
  let hero_banned = false
  if (brief) {
    const pulls = pieces.map((p) => Math.max(-2, Math.min(2, briefPull(briefPiece(p), brief))))
    const avg = mean(pulls)
    on_brief = avg == null ? 50 : pct(50 + 25 * avg)
    brief_hits = pulls.filter((x) => x > 0).length
    const brands = new Set(brief.brands.map(normBrand))
    brand_share = pieces.length
      ? pct((100 * pieces.filter((p) => p.brand?.name && brands.has(normBrand(p.brand.name))).length) / pieces.length)
      : null
    const families = new Set(brief.palette.map(paletteFamily))
    const coloured = pieces.filter((p) => (p as any).colour_family)
    palette_share = coloured.length
      ? pct((100 * coloured.filter((p) => families.has(String((p as any).colour_family).toLowerCase())).length) / coloured.length)
      : null
    const judged = judgeAgainstBrief(all.map(briefPiece), brief)
    violations = judged.violations.map((v) => ({ text: v.never.text, kind: v.never.kind, piece: v.piece }))
    const heroName = hero.product_name ?? hero.item_type ?? ''
    hero_banned = judged.blocked && judged.violations.some((v) => v.never.kind === 'ban' && v.piece === heroName)
  }

  let occasion: number | null = null
  const occasion_avoided: string[] = []
  if (occ) {
    const scores = pieces.map((p) => occasionItemScore(occ, p))
    const avg = mean(scores)
    occasion = avg == null ? 50 : pct(50 + 100 * avg)
    pieces.forEach((p, i) => { if (scores[i] <= -0.3) occasion_avoided.push(p.product_name) })
  }

  const compat: number[] = []
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) compat.push(pairCompat(all[i], all[j]).total)
  }
  const coherence = pct(100 * (mean(compat) ?? 0))

  let env: number | null = null
  let unscored = 0
  if (envelope?.mean?.length) {
    // weight 1 and no reference pictures: this IS the envelope fit, nothing else.
    const lens = { name: null, envelope, weight: 1 }
    const fits = pieces.map((p) => personaFitScore(lens, p))
    unscored = pieces.filter((p) => ITEM_LENS_DIMS.every(({ field }) => (p as any)[field] == null)).length
    const avg = mean(fits)
    env = avg == null ? null : pct(100 * Math.max(0, Math.min(1, avg)))
  }

  return {
    version: SCORECARD_VERSION,
    on_brief, brief_hits, brand_share, palette_share, violations, hero_banned,
    occasion, occasion_avoided, coherence, score, envelope: env, unscored,
  }
}

/**
 * How far each column stands from the others. The hero and the occasion are
 * shared by every column, so they are left out — with them in, similarity
 * never falls below a floor and nothing reads as distinct.
 */
/**
 * lookSimilarity's ceiling with the occasion left out: 0.6 for the pieces and
 * 0.3 for the brands. Two identical looks score 0.9, not 1, so the scale is
 * normalised by it — identical reads 0, nothing shared reads 100.
 */
const SIMILARITY_CEILING = 0.9

export function scoreDistinctness(
  cols: { stylist_name: string; pieces: { item_id: string | null; brand: string | null }[] }[],
  heroId: string,
): { distinct: number | null; twins: string[] }[] {
  const supporting = cols.map((c) => ({ items: c.pieces.filter((p) => p.item_id !== heroId) }))
  const ids = cols.map((c) => c.pieces.map((p) => p.item_id))
  return cols.map((c, i) => {
    if (cols.length < 2) return { distinct: null, twins: [] }
    let maxSim = 0
    const twins: string[] = []
    cols.forEach((other, j) => {
      if (j === i) return
      maxSim = Math.max(maxSim, lookSimilarity(supporting[i], supporting[j]))
      if (tooSimilarVariant(ids[i], ids[j], heroId)) twins.push(other.stylist_name)
    })
    return { distinct: pct(100 * (1 - maxSim / SIMILARITY_CEILING)), twins }
  })
}

/** How many of the brief's brands the library holds at all — so a BRANDS of 0 reads as inventory, not failure. */
export function brandsInStock(brief: StylistBrief | null | undefined, pool: { brand?: { name?: string | null } | null }[]): number {
  if (!brief?.brands.length) return 0
  const have = new Set(pool.map((i) => (i.brand?.name ? normBrand(i.brand.name) : '')).filter(Boolean))
  return brief.brands.filter((b) => have.has(normBrand(b))).length
}

// ── A NO that becomes a rule ───────────────────────────────────────────────
//
// A never is matched on ANY of its words (stylist-brief `hits`), so one never
// carrying "white" and "sneaker" would fire on every white piece. Each chip
// therefore makes one never on one word — see lib/never-words for what a
// piece offers — and Chloe promotes it to a ban in the brief if she means it.

/** The word a never carries for this piece and attribute — or the word she typed. */
export function neverWordFor(piece: NeverPiece, attr: NeverAttr, word?: string | null): string | null {
  if (attr === 'word' || attr === 'material') {
    const w = word ? cleanWord(word) : ''
    return w || null
  }
  const found = neverCandidates(piece).find((c) => c.attr === attr)
  return found?.word ?? null
}

export function neverFromPiece(piece: NeverPiece, attr: NeverAttr, when = new Date(), word?: string | null): StylistNever | null {
  const w = neverWordFor(piece, attr, word)
  if (!w) return null
  return { text: `No ${w} — bench, ${when.toISOString().slice(0, 10)}`, kind: 'preference', match: [w] }
}

/** Adds a never unless one with the same words is already there. */
export function appendNever(brief: StylistBrief, never: StylistNever): StylistBrief {
  const key = (n: StylistNever) => n.match.slice().sort().join('|')
  if (brief.nevers.some((n) => key(n) === key(never))) return brief
  return { ...brief, nevers: [...brief.nevers, never] }
}
