// DOES A PIECE LOOK LIKE THE THINGS SHE KEEPS?
//
// This is the question the confidence number was never able to ask. It could
// read brand history, colour family, price band and the words of a product
// name, but it could not see the garment. Measured walk-forward over 5,553 of
// her decisions (2026-09-29) that scored AUC 0.560 against a coin flip, and
// auto-accepting the top decile would have been right 44.8% of the time when
// accepting at random was already 64.7%.
//
// So this learns her taste directly from the tags. Two groups of pieces, one she
// kept and one she turned down, both described by the same seventeen 1-5
// dimensions. The question "does this look like her" then becomes a geometric
// one, and it is answered by measuring which dimensions actually separate the
// two groups rather than by assuming the ones that sound important.
//
// WHAT IT IS
// A linear discriminant, which is the smallest honest thing that can do this.
// For each dimension it computes how far apart the kept and skipped averages
// sit, divides by how noisy that dimension is, and weights the piece by that.
// A dimension where she keeps 4s and skips 2s earns a big positive weight. A
// dimension where both groups look the same earns nothing and is ignored, which
// is the point: it finds the taste rather than being told it.
//
// WHAT IT IS NOT
// Not a fitted predictor of her brand preferences, and not a substitute for the
// brand-level evidence. It says nothing about price, availability or whether a
// brand belongs at all. Combine it with those; do not replace them.
//
// Shrinkage matters and is not optional. With ~17 dimensions and a training set
// in the hundreds, a dimension that happens to separate the groups by luck will
// otherwise get a huge weight. VAR_FLOOR keeps that from happening.

import { TAG_DIMENSIONS, type StyleTags, type TagDimension } from './brand-watch-tag'

/**
 * Variance floor. A dimension whose kept and skipped averages differ by chance
 * would otherwise divide by a variance near zero and take over the model.
 * Expressed in points squared: 0.25 is half a point of standard deviation.
 */
const VAR_FLOOR = 0.25
/** Midpoint of the 1-5 scale, so a neutral reading contributes nothing. */
const NEUTRAL = 3

export interface TaggedSample {
  tags: StyleTags
  kept: boolean
}

export interface DimStat {
  dimension: TagDimension
  /** Average among the pieces she kept. */
  keptMean: number
  /** Average among the pieces she turned down. */
  skippedMean: number
  /** How many kept and skipped pieces carried this dimension at all. */
  keptN: number
  skippedN: number
  /** Direction and strength. Positive means high values suggest she keeps it. */
  weight: number
}

export interface StyleModel {
  /** Overall keep rate, so a piece of no distinguishing character scores 0. */
  baseRate: number
  /** Mean reading per dimension, used to centre each contribution. */
  mean: Partial<Record<TagDimension, number>>
  dims: DimStat[]
  /** Dimensions with a real signal, strongest first. */
  ranked: DimStat[]
  trainN: number
}

const round = (n: number, dp = 3) => Number(n.toFixed(dp))

/**
 * Learn what separates the pieces she kept from the pieces she turned down.
 * Every dimension is treated independently, which is the price of working with
 * a few hundred samples: a full covariance matrix over seventeen correlated
 * dimensions would be fitted to noise long before it was fitted to her.
 */
export function fitStyleModel(samples: TaggedSample[]): StyleModel {
  const kept = samples.filter((s) => s.kept)
  const skipped = samples.filter((s) => !s.kept)
  const baseRate = samples.length ? kept.length / samples.length : 0.5

  const mean: Partial<Record<TagDimension, number>> = {}
  const dims: DimStat[] = []

  for (const d of TAG_DIMENSIONS) {
    const k = kept.map((s) => s.tags[d]).filter((v): v is number => v != null)
    const s = skipped.map((x) => x.tags[d]).filter((v): v is number => v != null)
    if (!k.length || !s.length) continue

    const kMean = k.reduce((a, b) => a + b, 0) / k.length
    const sMean = s.reduce((a, b) => a + b, 0) / s.length
    const all = [...k, ...s]
    const grand = all.reduce((a, b) => a + b, 0) / all.length
    // Pooled variance: the noise level of this dimension, from both groups.
    const varK = k.reduce((a, v) => a + (v - kMean) ** 2, 0) / Math.max(1, k.length - 1)
    const varS = s.reduce((a, v) => a + (v - sMean) ** 2, 0) / Math.max(1, s.length - 1)
    const pooled = ((k.length - 1) * varK + (s.length - 1) * varS) / Math.max(1, k.length + s.length - 2)

    mean[d] = round(grand)
    dims.push({
      dimension: d,
      keptMean: round(kMean, 2),
      skippedMean: round(sMean, 2),
      keptN: k.length,
      skippedN: s.length,
      // The Fisher direction, floored so a lucky split cannot run away.
      weight: round((kMean - sMean) / Math.max(VAR_FLOOR, pooled), 4),
    })
  }

  return {
    baseRate,
    mean,
    dims,
    // Sorted by strength, and only the ones carrying real signal. Reported so a
    // human can look at what the model thinks her taste is and disagree with it.
    ranked: [...dims].sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight)).filter((d) => Math.abs(d.weight) >= 0.05),
    trainN: samples.length,
  }
}

export interface StyleFit {
  /** Log-odds-ish. 0 means "no distinguishing character at all". */
  score: number
  /** How many dimensions were read, and therefore how much was actually judging. */
  coverage: number
  /** The dimensions that pushed this piece, strongest first. */
  drivers: Array<{ dimension: TagDimension; value: number; pull: number }>
}

/**
 * How much this piece looks like the things she keeps.
 *
 * Averaged over the dimensions actually read, not summed. A piece read on six
 * dimensions would otherwise score near zero and look indistinguishable from a
 * genuinely neutral piece read on fourteen, which would quietly push every thin
 * read to the middle of the queue. Both scores are the same number when
 * coverage is equal, so this costs nothing when the tagging is even.
 *
 * Dimensions never read contribute nothing either way: the reading is not known,
 * so it is not evidence.
 */
export function scoreStyle(model: StyleModel, tags: StyleTags): StyleFit {
  const present = model.dims.filter((d) => tags[d.dimension] != null)
  if (!present.length) return { score: 0, coverage: 0, drivers: [] }

  const contribs = present.map((d) => {
    const v = tags[d.dimension] as number
    const centre = model.mean[d.dimension] ?? NEUTRAL
    return { dimension: d.dimension, value: v, pull: d.weight * (v - centre) }
  })
  const score = contribs.reduce((a, c) => a + c.pull, 0) / present.length

  return {
    score: round(score, 4),
    coverage: present.length,
    drivers: [...contribs].sort((a, b) => Math.abs(b.pull) - Math.abs(a.pull)).slice(0, 5),
  }
}

/**
 * The same question asked of a whole brand: what does its catalogue look like
 * in style space, on average? Used to answer "is this brand's aesthetic close to
 * the brands she has already said yes to", which is the second half of how she
 * described wanting this to work.
 */
export function catalogueStyleMean(tagged: StyleTags[]): StyleTags {
  const out: StyleTags = {}
  for (const d of TAG_DIMENSIONS) {
    const vals = tagged.map((t) => t[d]).filter((v): v is number => v != null)
    if (vals.length) out[d] = round(vals.reduce((a, b) => a + b, 0) / vals.length, 2)
  }
  return out
}

// ---------------------------------------------------------------- the neighbour vote

/**
 * A piece reduced to a fixed-length point, one coordinate per dimension, so two
 * pieces are always compared on the same axes. A dimension that was never read
 * is filled with the average reading rather than skipped, because skipping it
 * would let a thinly-tagged piece win a resemblance contest by having fewer
 * ways to differ.
 */
export function styleVector(model: StyleModel, tags: StyleTags): number[] {
  return model.dims.map((d) => tags[d.dimension] ?? model.mean[d.dimension] ?? NEUTRAL)
}

export interface StyleIndexEntry {
  vec: number[]
  kept: boolean
}

/**
 * Turn judged pieces into something a new piece can be compared against.
 * Only ever built from decisions already made, so a score is never informed by
 * the outcome it is predicting.
 */
export function buildStyleIndex(model: StyleModel, samples: TaggedSample[]): StyleIndexEntry[] {
  return samples.map((s) => ({ vec: styleVector(model, s.tags), kept: s.kept }))
}

/**
 * Does this piece resemble the ones she has kept?
 *
 * This is the scorer that works, and the linear one is kept only to show why.
 * Measured walk-forward on 786 tagged decisions (2026-09-29):
 *
 *   linear, per dimension    0.446 → 0.508 as training data grew 4x — flat,
 *                            so it was never learning taste, just noise
 *   neighbour vote           0.483 → 0.535 → 0.577 → 0.605 — rising with every
 *                            slice of data and still climbing at the end
 *
 * The difference is that taste is not per-dimension. A linear model can only ask
 * "is the neckline high?", and answers the same question about every high-necked
 * garment she has ever seen. A neighbour vote asks the question she actually
 * answers: does this look like the things I said yes to? It catches the
 * combinations that a straight line cannot — that oversized works at one length
 * and not another — which is why it beats the linear model at every sample size.
 *
 * The distance weight (1/(d + 0.5)) stops a crowd of unlike pieces from
 * outvoting one near-identical piece. The half-point floor keeps a single piece
 * at distance zero from taking the whole vote.
 */
export function neighbourStyleScore(
  index: StyleIndexEntry[],
  vec: number[],
  k = 20,
): { score: number; neighbours: number } {
  if (!index.length) return { score: 0.5, neighbours: 0 }
  const nearest = index
    .map((e) => ({ d: Math.sqrt(e.vec.reduce((a, v, i) => a + (v - (vec[i] ?? NEUTRAL)) ** 2, 0)), kept: e.kept }))
    .sort((a, b) => a.d - b.d)
    .slice(0, k)
  let weight = 0, keptWeight = 0
  for (const n of nearest) {
    const w = 1 / (n.d + 0.5)
    weight += w
    if (n.kept) keptWeight += w
  }
  return { score: weight ? round(keptWeight / weight, 4) : 0.5, neighbours: nearest.length }
}

/**
 * How close two catalogues look, in the same units as the model. Cosine
 * distance on the shared dimensions, so a brand with a big loud catalogue and a
 * brand with a quiet one are not separated merely by scoring high everywhere.
 */
export function styleSimilarity(a: StyleTags, b: StyleTags): { similarity: number; shared: number } {
  const shared = TAG_DIMENSIONS.filter((d) => a[d] != null && b[d] != null)
  if (shared.length < 4) return { similarity: 0, shared: shared.length }
  let dot = 0, na = 0, nb = 0
  for (const d of shared) {
    const x = (a[d] as number) - NEUTRAL
    const y = (b[d] as number) - NEUTRAL
    dot += x * y
    na += x * x
    nb += y * y
  }
  if (!na || !nb) return { similarity: 0, shared: shared.length }
  return { similarity: round(dot / Math.sqrt(na * nb), 4), shared: shared.length }
}

// ---------------------------------------------------------------- the look

/**
 * THE BETTER GENERAL SIGNAL, and not a solution to the new-brand problem.
 *
 * Everything above this line describes how a garment is built; this describes
 * how it looks. Measured on 3,139 tagged decisions across 32 brands, over four
 * chronological splits:
 *
 *   scorer                      overall AUC     within one brand
 *   the look (embeddings)          0.619            0.643
 *   existing confidence model      0.537            0.651
 *   17 construction dimensions     0.561            0.546
 *
 * The look beat the existing model on every one of the four splits, by +0.028
 * to +0.082 AUC, and beat the construction dimensions on every one. That is the
 * finding, and it is consistent.
 *
 * THE CAVEAT, which is why this is not the win it first looked like: within a
 * single brand the advantage disappears — 0.643 against 0.651, a tie. A new
 * brand lands in exactly that position, so this is NOT evidence that a brand
 * new to the catalogue can be judged from its clothes alone. An earlier run
 * appeared to show a large within-brand win (0.721 against 0.605); it rested on
 * 160 pieces and did not reproduce. Do not quote the new-brand case as settled.
 *
 * AND THE CEILING: in absolute terms this is still modest. On the deep sample
 * the top quartile by look is right 41.7% of the time against a 33.9% base
 * rate. That is a real lift and nowhere near enough to auto-accept on. Nothing
 * here should be trusted as an automation gate without the per-brand trust
 * measure in brand-watch-trust.
 *
 * Descriptions come from describeStyle() in brand-watch-tag and are stored as
 * vectors, so a piece is scored without paying to read anything again.
 */
export interface LookEntry {
  embedding: number[]
  kept: boolean
}

/** Cosine similarity. Vectors are already unit-length from the provider, but
 *  this divides anyway so a hand-supplied vector behaves the same. */
export function cosineSimilarity(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length)
  let dot = 0, na = 0, nb = 0
  for (let i = 0; i < n; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i] }
  return na && nb ? dot / Math.sqrt(na * nb) : 0
}

/** Turn judged pieces into something a new piece can be compared against. */
export function buildLookIndex(samples: Array<{ embedding: number[]; kept: boolean }>): LookEntry[] {
  return samples.filter((s) => s.embedding.length).map((s) => ({ embedding: s.embedding, kept: s.kept }))
}

/**
 * How much this piece looks like the pieces she has kept.
 *
 * The similarity is raised to the fourth power before it votes. That is a
 * deliberate choice and not a fudge: cosine similarities cluster high and
 * narrow, so an unweighted mean over twenty neighbours barely moves between a
 * piece she would love and one she would not. Raising the power sharpens the
 * vote onto the genuinely closest neighbours, which is where the signal is.
 *
 * A neighbour with a negative similarity contributes nothing rather than
 * voting "not kept" — at this scale a negative cosine means unrelated, not
 * opposite, and treating it as active dislike would let any unlike piece drag
 * a score down.
 */
export function lookSimilarityScore(
  index: LookEntry[],
  embedding: number[],
  k = 20,
): { score: number; neighbours: number } {
  if (!index.length || !embedding.length) return { score: 0.5, neighbours: 0 }
  const nearest = index
    .map((e) => ({ sim: cosineSimilarity(embedding, e.embedding), kept: e.kept }))
    .sort((a, b) => b.sim - a.sim)
    .slice(0, k)
  let weight = 0, keptWeight = 0
  for (const n of nearest) {
    const w = Math.max(0, n.sim) ** 4
    weight += w
    if (n.kept) keptWeight += w
  }
  return { score: weight ? round(keptWeight / weight, 4) : 0.5, neighbours: nearest.length }
}

/**
 * The look and the construction dims together, weighted toward the look because
 * that is the one that measured better in every split and inside every brand.
 *
 * Returns null when neither has anything to say, so a caller can tell "no
 * evidence" apart from "evidence of a middling piece" — a distinction the
 * earlier scorers could not make, which is how half the queue ended up on one
 * number.
 */
export function combinedStyleScore(
  look: { score: number; neighbours: number },
  dims: { score: number; coverage: number },
): number | null {
  const hasLook = look.neighbours > 0
  const hasDims = dims.coverage > 0
  if (!hasLook && !hasDims) return null
  if (hasLook && !hasDims) return look.score
  if (!hasLook && hasDims) return dims.score
  return round(look.score * 0.7 + dims.score * 0.3, 4)
}
