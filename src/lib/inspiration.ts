// ── INSPIRATION IMAGES ──────────────────────────────────────────────────────
// A persona's moodboard as scored records rather than borrowed URLs.
//
// The pipeline: ingest → re-host on Cloudinary → vision-score → review by hand
// → confirm → envelope. Only CONFIRMED images count. A pending or rejected
// image has no influence on the persona's behaviour whatsoever.
//
// The envelope is per-dimension mean AND spread. The spread is the point: a
// persona that is certain about volume but catholic about colour should read
// that way, instead of being flattened under one global tolerance.

import type { VectorRange } from '@/lib/stylist-store'
import { VECTOR_DIM, buildOutfitVector } from '@/lib/taste-vector'
import type { OutfitWithItems } from '@/types/database'

export const MIN_CONFIRMED_IMAGES = 15

export type InspirationSource =
  | 'curator_seed' | 'user_upload' | 'runway' | 'campaign' | 'street_style' | 'social'
export type InspirationStatus = 'pending_scoring' | 'scored' | 'confirmed' | 'rejected'

// The taxonomy dimensions that are legible from a photograph. Everything here
// is 1–5 and hand-correctable in review.
export interface InspirationScores {
  construction: number | null
  volume: number | null
  colour_story: number | null
  surface_story: number | null
  pattern: number | null
  colour_depth: number | null
  sheen: number | null
  formality: number | null
  item_types: string[]
}

export const SCORE_DIMENSIONS: {
  key: keyof Omit<InspirationScores, 'item_types'>
  label: string
  low: string
  high: string
}[] = [
  { key: 'construction', label: 'CONSTRUCTION', low: 'TAILORED', high: 'UNSTRUCTURED' },
  { key: 'volume', label: 'VOLUME', low: 'FITTED', high: 'OVERSIZED' },
  { key: 'colour_story', label: 'COLOUR STORY', low: 'MONOCHROME', high: 'HIGH CONTRAST' },
  { key: 'surface_story', label: 'SURFACE', low: 'CLEAN', high: 'TEXTURED' },
  { key: 'pattern', label: 'PATTERN', low: 'SOLID', high: 'STATEMENT PRINT' },
  { key: 'colour_depth', label: 'COLOUR DEPTH', low: 'PALE', high: 'DEEP / SATURATED' },
  { key: 'sheen', label: 'SHEEN', low: 'MATTE', high: 'HIGH SHINE' },
  { key: 'formality', label: 'FORMALITY', low: 'EVERYDAY', high: 'BLACK TIE' },
]

export interface InspirationImage {
  image_id: string
  persona_id: string
  user_id: string | null
  image_url: string
  source_url: string | null
  source: InspirationSource
  status: InspirationStatus
  scores: InspirationScores | null
  scores_original: InspirationScores | null
  corrected_fields: string[]
  corrected_at: string | null
  occasion_read: string[] | null
  score_confidence: number | null
  vector: number[] | null
  scoring_error: string | null
  created_at: string
}

export function emptyScores(): InspirationScores {
  return {
    construction: null, volume: null, colour_story: null, surface_story: null,
    pattern: null, colour_depth: null, sheen: null, formality: null, item_types: [],
  }
}

// ── scores → the shared 34-dim vector ───────────────────────────────────────

/**
 * Build the same 34-dim vector items and outfits live in, so the envelope can
 * drive the existing item mask directly. A photograph carries no brand and no
 * per-garment colour family, so those dimensions come out at zero for every
 * image — see OBSERVABLE_DIMS, which stops that absence being read as a rule.
 */
export function vectorFromInspiration(s: InspirationScores, occasions: string[] = []): number[] {
  const types = s.item_types?.length ? s.item_types : ['blouse']
  const pseudoItem = {
    structure: s.construction,
    pattern: s.pattern,
    colour_depth: s.colour_depth,
    sheen: s.sheen,
    material_formality: s.formality,
    material_weight: null,
    colour_family: null,
    brand: null,
  }
  const pseudo = {
    outfit_item: types.map((t) => ({ slot: null, item: { ...pseudoItem, item_type: t } })),
    occasion_tags: occasions,
    construction: s.construction,
    surface_story: s.surface_story,
    volume: s.volume,
    colour_story: s.colour_story,
    intent: s.formality,
    shoe_formality: s.formality,
    shoe_style: null,
    bag_formality: s.formality,
    jewellery_scale: null,
  }
  return buildOutfitVector(pseudo as unknown as OutfitWithItems)
}

/**
 * Dimensions the envelope is allowed to CONSTRAIN. Deliberately narrow, because
 * three kinds of dimension must never become a hard rule:
 *
 *   absent      brand positioning (9–13) and per-garment colour families
 *               (14–21) — a photograph carries neither, so they sit at zero for
 *               every image. Constraining them would demand zero of everything.
 *   flat        item count (2), shoe style (27), jewellery scale (28), material
 *               weight (31), occasion breadth (32) — constant by construction
 *               here, so their spread is a measurement artefact, not agreement.
 *   tendency    which garments appear (22–26) is binary per outfit. A moodboard
 *               of blazers means this persona LEANS outerwear, not that every
 *               look must contain some — measured, it excluded 207 of 211 live
 *               outfits. Narrated in the rules, never enforced.
 *
 * What's left is the continuous, genuinely stylistic axes.
 */
export const CONSTRAINED_DIMS: number[] = [0, 1, 3, 4, 5, 6, 7, 8, 29, 30, 33]
const CONSTRAINED = new Set(CONSTRAINED_DIMS)

/** Composition leanings — reported, never enforced. */
export const TENDENCY_DIMS: { index: number; label: string }[] = [
  { index: 22, label: 'DRESSES' },
  { index: 23, label: 'TROUSERS' },
  { index: 24, label: 'SKIRTS' },
  { index: 25, label: 'OUTERWEAR' },
  { index: 26, label: 'CASUAL STAPLES' },
]

/**
 * Minimum half-width of any constrained dimension. The vector maps a 1–5 score
 * onto [0,1], so one whole scale point is 0.25 — unanimous agreement in the
 * moodboard should still admit a piece one step away, or the mask matches
 * nothing. Measured: at 0.08 the envelope admitted zero live outfits.
 */
export const RANGE_FLOOR = 0.25

// ── envelope ────────────────────────────────────────────────────────────────

export interface Envelope {
  /** Per-dimension mean over confirmed images — the centre. */
  mean: number[]
  /** Per-dimension population standard deviation — the tolerance. */
  spread: number[]
  /** Confirmed images the envelope was computed from. */
  n: number
  /** Mean spread across dimensions — one number for the UI. */
  tightness: number
}

/**
 * Envelope from confirmed vectors only. Mean gives the centre, spread gives
 * how far a piece may sit from it on each axis before it stops being this
 * persona. Returns null below the minimum — an envelope from four images is
 * not an envelope, it's an accident.
 */
export function computeEnvelope(vectors: number[][], minImages = MIN_CONFIRMED_IMAGES): Envelope | null {
  const valid = vectors.filter((v) => Array.isArray(v) && v.length === VECTOR_DIM)
  if (valid.length < Math.min(minImages, 1)) return null
  if (!valid.length) return null

  const n = valid.length
  const mean = new Array(VECTOR_DIM).fill(0)
  for (const v of valid) for (let i = 0; i < VECTOR_DIM; i++) mean[i] += v[i] / n

  const spread = new Array(VECTOR_DIM).fill(0)
  for (const v of valid) for (let i = 0; i < VECTOR_DIM; i++) spread[i] += (v[i] - mean[i]) ** 2 / n
  for (let i = 0; i < VECTOR_DIM; i++) spread[i] = Math.sqrt(spread[i])

  // Tightness reads only the dimensions an image can speak to — averaging in
  // the always-zero brand/colour dims would make every persona look narrow.
  const tightness = CONSTRAINED_DIMS.reduce((a, i) => a + spread[i], 0) / CONSTRAINED_DIMS.length
  return {
    mean: mean.map((x) => +x.toFixed(4)),
    spread: spread.map((x) => +x.toFixed(4)),
    n,
    tightness: +tightness.toFixed(4),
  }
}

/**
 * The envelope as the min/max VectorRange the item mask already speaks.
 * Width is mean ± (k × spread), floored so a dimension every image agrees on
 * doesn't collapse to a range nothing can satisfy.
 */
export function envelopeToRange(env: Envelope, k = 1.5, floor = RANGE_FLOOR): VectorRange {
  const min: number[] = []
  const max: number[] = []
  for (let i = 0; i < VECTOR_DIM; i++) {
    // Anything not in CONSTRAINED_DIMS constrains nothing.
    if (!CONSTRAINED.has(i)) { min.push(0); max.push(1); continue }
    const half = Math.max(env.spread[i] * k, floor)
    min.push(+Math.max(0, env.mean[i] - half).toFixed(4))
    max.push(+Math.min(1, env.mean[i] + half).toFixed(4))
  }
  const observedSpread = CONSTRAINED_DIMS.reduce((a, i) => a + env.spread[i], 0) / CONSTRAINED_DIMS.length
  return { min, max, tolerance: +Math.max(observedSpread * k, floor).toFixed(4) }
}

// ── proposed rules ──────────────────────────────────────────────────────────

/** Dimensions the envelope is most opinionated about — tight spread, and far
 *  enough from the middle to be a stance rather than a shrug. */
export function definingDimensions(
  env: Envelope,
  dims: { index: number; label: string; low: string; high: string }[],
  limit = 6,
): { label: string; reading: string; mean: number; spread: number }[] {
  return dims
    .filter((d) => CONSTRAINED.has(d.index))
    .map((d) => {
      const mean = env.mean[d.index]
      const spread = env.spread[d.index]
      // Conviction: away from the midpoint, and consistent about it.
      const conviction = Math.abs(mean - 0.5) * (1 - Math.min(spread * 3, 0.95))
      return { ...d, mean, spread, conviction }
    })
    .sort((a, b) => b.conviction - a.conviction)
    .slice(0, limit)
    .map((d) => ({
      label: d.label,
      reading: describe(d.mean, d.spread, d.low, d.high),
      mean: +d.mean.toFixed(3),
      spread: +d.spread.toFixed(3),
    }))
}

function describe(mean: number, spread: number, low: string, high: string): string {
  const side = mean < 0.42 ? low : mean > 0.58 ? high : `between ${low.toLowerCase()} and ${high.toLowerCase()}`
  const width = spread < 0.12 ? 'consistently' : spread < 0.22 ? 'mostly' : 'loosely'
  return `${width} ${side.toLowerCase()}`
}

/** Vector dimensions worth narrating in the rules, mapped to buildOutfitVector. */
export const NARRATED_DIMS = [
  { index: 0, label: 'STRUCTURE', low: 'Soft', high: 'Structured' },
  { index: 1, label: 'PATTERN', low: 'Solid', high: 'Patterned' },
  { index: 3, label: 'DRESSINESS', low: 'Undone', high: 'Dressed' },
  { index: 4, label: 'CONSTRUCTION', low: 'Tailored', high: 'Unstructured' },
  { index: 5, label: 'SURFACE', low: 'Clean', high: 'Textured' },
  { index: 6, label: 'VOLUME', low: 'Fitted', high: 'Oversized' },
  { index: 7, label: 'COLOUR STORY', low: 'Monochrome', high: 'Contrast' },
  { index: 8, label: 'INTENT', low: 'Quiet', high: 'Deliberate' },
  { index: 9, label: 'PRICE POSITION', low: 'Accessible', high: 'Luxury' },
  { index: 14, label: 'NEUTRALS', low: 'Colour', high: 'Neutral' },
  { index: 22, label: 'DRESSES', low: 'Rarely', high: 'Often' },
  { index: 25, label: 'OUTERWEAR', low: 'Rarely', high: 'Often' },
  { index: 30, label: 'MATERIAL FORMALITY', low: 'Casual', high: 'Formal' },
]

/** The draft rules shown in the existing edit + confirm step. */
export function proposeRulesFromEnvelope(env: Envelope, itemTypeCounts: Record<string, number>): {
  note: string
  articles: { title: string; rules: string[] }[]
} {
  const defining = definingDimensions(env, NARRATED_DIMS)
  const topTypes = Object.entries(itemTypeCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([t, c]) => `${t.replace(/_/g, ' ')} (${c})`)

  return {
    note: `DRAFT — computed from ${env.n} confirmed images. Mean sets the centre, spread sets the tolerance. Edit each article, then confirm.`,
    articles: [
      {
        title: 'WHAT THIS PERSONA IS',
        rules: defining.map((d) => `${d.label}: ${d.reading} (mean ${d.mean}, spread ${d.spread}).`),
      },
      {
        title: 'TOLERANCE',
        rules: [
          `Overall tightness ${env.tightness.toFixed(3)} — ${
            env.tightness < 0.12 ? 'a narrow persona; reject freely.' :
            env.tightness < 0.2 ? 'a defined persona with room to move.' :
            'a broad persona; the moodboard may be mixing more than one lens.'
          }`,
          'Dimensions with a wide spread are deliberately permissive — do not tighten them by hand unless the moodboard was wrong.',
        ],
      },
      {
        title: 'LEANS TOWARD (not enforced)',
        rules: TENDENCY_DIMS.map((t) => {
          const m = env.mean[t.index]
          const word = m > 0.8 ? 'nearly always' : m > 0.55 ? 'usually' : m > 0.25 ? 'sometimes' : 'rarely'
          return `${t.label}: ${word} (${Math.round(m * 100)}% of the moodboard).`
        }),
      },
      {
        title: 'GARMENT VOCABULARY',
        rules: topTypes.length
          ? [`Recurring in the moodboard: ${topTypes.join(', ')}.`]
          : ['No item types were read from the moodboard — score more images before relying on this.'],
      },
    ],
  }
}

/** Every occasion the confirmed images read as, most frequent first. */
export function occasionProfile(occasions: string[][]): { occasion: string; count: number }[] {
  const m = new Map<string, number>()
  for (const list of occasions) for (const o of list ?? []) m.set(o, (m.get(o) ?? 0) + 1)
  return Array.from(m, ([occasion, count]) => ({ occasion, count })).sort((a, b) => b.count - a.count)
}
