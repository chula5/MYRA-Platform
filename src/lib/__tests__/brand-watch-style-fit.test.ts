import { describe, it, expect } from 'vitest'
import {
  fitStyleModel, scoreStyle, catalogueStyleMean, styleSimilarity,
  styleVector, buildStyleIndex, neighbourStyleScore,
  cosineSimilarity, buildLookIndex, lookSimilarityScore, combinedStyleScore,
} from '@/lib/brand-watch-style-fit'
import type { StyleTags } from '@/lib/brand-watch-tag'

/** A piece where every dimension reads the same value, for clean fixtures. */
const flat = (v: number): StyleTags => ({
  fit: v, length: v, rise: v, structure: v, shoulder: v, neckline: v, sleeve: v,
  waist_definition: v, leg_opening: v, surface: v, colour_depth: v, pattern: v,
  sheen: v, material_weight: v, material_formality: v,
})

describe('fitStyleModel', () => {
  it('finds a dimension that separates what she keeps from what she skips', () => {
    // She keeps high-neck pieces and turns down plunging ones. Nothing else
    // varies, so neckline is the only thing there is to learn.
    const samples = [
      ...Array.from({ length: 40 }, () => ({ tags: { ...flat(3), neckline: 1 }, kept: true })),
      ...Array.from({ length: 40 }, () => ({ tags: { ...flat(3), neckline: 5 }, kept: false })),
    ]
    const model = fitStyleModel(samples)
    const neck = model.dims.find((d) => d.dimension === 'neckline')!
    expect(neck.weight).toBeLessThan(0) // lower neckline reading means she keeps it
    expect(model.ranked[0].dimension).toBe('neckline')
  })

  it('gives a dimension that looks the same either way no influence', () => {
    const samples = [
      ...Array.from({ length: 40 }, () => ({ tags: { ...flat(3), neckline: 1, sleeve: 3 }, kept: true })),
      ...Array.from({ length: 40 }, () => ({ tags: { ...flat(3), neckline: 5, sleeve: 3 }, kept: false })),
    ]
    const model = fitStyleModel(samples)
    const sleeve = model.dims.find((d) => d.dimension === 'sleeve')!
    expect(Math.abs(sleeve.weight)).toBeLessThan(0.05)
    expect(model.ranked.map((d) => d.dimension)).not.toContain('sleeve')
  })

  /** A chance split on a thin dimension must not take over the model. */
  it('cannot be hijacked by a dimension that separates by luck', () => {
    const samples = [
      // Three noisy readings against thirty steady ones: without the variance
      // floor this is exactly the shape that produces a runaway weight.
      { tags: { fit: 5, length: 3, structure: 3, surface: 3, material_weight: 3 }, kept: true },
      { tags: { fit: 4, length: 3, structure: 3, surface: 3, material_weight: 3 }, kept: true },
      { tags: { fit: 5, length: 3, structure: 3, surface: 3, material_weight: 3 }, kept: true },
      ...Array.from({ length: 30 }, () => ({ tags: { fit: 3, length: 3, structure: 3, surface: 3, material_weight: 3 }, kept: true })),
      ...Array.from({ length: 30 }, () => ({ tags: { fit: 3, length: 3, structure: 3, surface: 3, material_weight: 3 }, kept: false })),
    ]
    const model = fitStyleModel(samples)
    for (const d of model.dims) expect(Math.abs(d.weight)).toBeLessThan(20)
  })

  it('skips a dimension that only one side ever carried', () => {
    const samples = [
      { tags: { neckline: 1, sleeve: 3 }, kept: true },
      { tags: { sleeve: 3 }, kept: false },
    ]
    const model = fitStyleModel(samples)
    expect(model.dims.map((d) => d.dimension)).not.toContain('neckline')
    expect(model.dims.map((d) => d.dimension)).toContain('sleeve')
  })

  it('reports the base rate so a neutral piece can score zero', () => {
    const samples = [
      ...Array.from({ length: 30 }, () => ({ tags: flat(3), kept: true })),
      ...Array.from({ length: 10 }, () => ({ tags: flat(3), kept: false })),
    ]
    expect(fitStyleModel(samples).baseRate).toBeCloseTo(0.75, 2)
  })
})

describe('scoreStyle', () => {
  const model = fitStyleModel([
    ...Array.from({ length: 40 }, () => ({ tags: { ...flat(3), neckline: 1 }, kept: true })),
    ...Array.from({ length: 40 }, () => ({ tags: { ...flat(3), neckline: 5 }, kept: false })),
  ])

  it('scores a piece she would keep above one she would not', () => {
    const liked = scoreStyle(model, { ...flat(3), neckline: 1 })
    const disliked = scoreStyle(model, { ...flat(3), neckline: 5 })
    expect(liked.score).toBeGreaterThan(disliked.score)
  })

  it('is not dragged to the middle by a thin read', () => {
    // Both are "very like her" reads; one simply has fewer dimensions known.
    // Summing instead of averaging would rank the thin one as neutral.
    const full = scoreStyle(model, { ...flat(3), neckline: 1, sleeve: 3, fit: 3 })
    const thin = scoreStyle(model, { neckline: 1 })
    expect(Math.sign(full.score)).toBe(Math.sign(thin.score))
    expect(thin.coverage).toBe(1)
  })

  it('treats an unknown dimension as no evidence rather than as a neutral three', () => {
    const none = scoreStyle(model, {})
    expect(none.score).toBe(0)
    expect(none.coverage).toBe(0)
  })

  it('names the dimensions that pushed the piece', () => {
    const fit = scoreStyle(model, { ...flat(3), neckline: 1 })
    expect(fit.drivers[0].dimension).toBe('neckline')
    expect(fit.drivers[0].value).toBe(1)
  })
})

describe('catalogueStyleMean and styleSimilarity', () => {
  it('averages a catalogue dimension by dimension', () => {
    const mean = catalogueStyleMean([
      { fit: 1, sleeve: 5 },
      { fit: 5, sleeve: 5 },
    ])
    expect(mean.fit).toBe(3)
    expect(mean.sleeve).toBe(5)
  })

  it('rates two catalogues that share a direction as alike', () => {
    // Four shared dimensions, because comparing on fewer is refused below.
    const a = catalogueStyleMean([{ fit: 5, sleeve: 1, length: 4, structure: 4 }, { fit: 4, sleeve: 2, length: 4, structure: 4 }])
    const b = catalogueStyleMean([{ fit: 5, sleeve: 1, length: 4, structure: 4 }, { fit: 5, sleeve: 1, length: 5, structure: 4 }])
    const c = catalogueStyleMean([{ fit: 1, sleeve: 5, length: 2, structure: 2 }, { fit: 2, sleeve: 5, length: 2, structure: 2 }])
    expect(styleSimilarity(a, b).similarity).toBeGreaterThan(styleSimilarity(a, c).similarity)
  })

  it('declines to compare catalogues it cannot see enough of', () => {
    expect(styleSimilarity({ fit: 5 }, { fit: 1 }).similarity).toBe(0)
    expect(styleSimilarity({ fit: 5 }, { fit: 1 }).shared).toBeLessThan(4)
  })
})

describe('the neighbour vote', () => {
  const samples = [
    ...Array.from({ length: 20 }, () => ({ tags: { ...flat(3), neckline: 1, length: 1 }, kept: true })),
    ...Array.from({ length: 20 }, () => ({ tags: { ...flat(3), neckline: 5, length: 5 }, kept: false })),
  ]
  const model = fitStyleModel(samples)
  const index = buildStyleIndex(model, samples)

  it('recognises a piece that resembles what she kept', () => {
    const liked = neighbourStyleScore(index, styleVector(model, { ...flat(3), neckline: 1, length: 1 }))
    const disliked = neighbourStyleScore(index, styleVector(model, { ...flat(3), neckline: 5, length: 5 }))
    expect(liked.score).toBeGreaterThan(0.8)
    expect(disliked.score).toBeLessThan(0.2)
  })

  /**
   * The reason this scorer exists, and the one thing a per-dimension model
   * provably cannot do.
   *
   * Her taste here is an exclusive-or: oversized-and-cropped yes,
   * slim-and-long yes, but oversized-and-long no and slim-and-cropped no.
   * Each dimension on its own is identical across both outcomes — the average
   * fit is 3 whether she kept it or not, and so is the average length — so a
   * linear model has literally nothing to weight and scores every piece the
   * same. The neighbour vote sees the pairing and gets it right.
   */
  it('reads a combination that no single dimension can reveal', () => {
    const xor = [
      ...Array.from({ length: 12 }, () => ({ tags: { ...flat(3), fit: 5, length: 1 }, kept: true })),
      ...Array.from({ length: 12 }, () => ({ tags: { ...flat(3), fit: 1, length: 5 }, kept: true })),
      ...Array.from({ length: 12 }, () => ({ tags: { ...flat(3), fit: 5, length: 5 }, kept: false })),
      ...Array.from({ length: 12 }, () => ({ tags: { ...flat(3), fit: 1, length: 1 }, kept: false })),
    ]
    const m = fitStyleModel(xor)
    const idx = buildStyleIndex(m, xor)

    const keptShape = { ...flat(3), fit: 5, length: 1 }
    const skippedShape = { ...flat(3), fit: 5, length: 5 }

    // Marginally indistinguishable: both dimensions average 3 either way.
    expect(m.dims.find((d) => d.dimension === 'fit')!.weight).toBeCloseTo(0, 2)
    expect(m.dims.find((d) => d.dimension === 'length')!.weight).toBeCloseTo(0, 2)
    const linKept = scoreStyle(m, keptShape).score
    const linSkipped = scoreStyle(m, skippedShape).score
    expect(Math.abs(linKept - linSkipped)).toBeLessThan(0.01)

    // The pairing tells them apart anyway.
    const knnKept = neighbourStyleScore(idx, styleVector(m, keptShape)).score
    const knnSkipped = neighbourStyleScore(idx, styleVector(m, skippedShape)).score
    expect(knnKept).toBeGreaterThan(0.8)
    expect(knnSkipped).toBeLessThan(0.2)
  })

  it('compares a thinly-read piece on the same axes as a well-read one', () => {
    const full = styleVector(model, { ...flat(3), neckline: 1, length: 1, sleeve: 3 })
    const thin = styleVector(model, { neckline: 1 })
    expect(thin.length).toBe(full.length)
    expect(thin.length).toBe(model.dims.length)
  })

  it('falls back to a coin flip rather than a verdict when it has nothing to compare', () => {
    expect(neighbourStyleScore([], styleVector(model, flat(3))).score).toBe(0.5)
    expect(neighbourStyleScore([], styleVector(model, flat(3))).neighbours).toBe(0)
  })

  it('does not let one near-identical piece outvote a crowd of unlike ones', () => {
    // One piece exactly like the query, and twenty that are nothing like it.
    // The distance weight exists so the crowd wins: a single lucky match must
    // not drown out what she has mostly been saying no to.
    const idx = buildStyleIndex(model, [
      { tags: { ...flat(3), neckline: 1, length: 1 }, kept: true },
      ...Array.from({ length: 20 }, () => ({ tags: { ...flat(3), neckline: 5, length: 5 }, kept: false })),
    ])
    const score = neighbourStyleScore(idx, styleVector(model, { ...flat(3), neckline: 1, length: 1 }), 20).score
    expect(score).toBeLessThan(0.5)
  })
})

describe('the look, as embeddings', () => {
  /** Two-axis vectors stand in for descriptions: [minimal, romantic]. */
  const minimal = [1, 0]
  const romantic = [0, 1]
  const index = buildLookIndex([
    { embedding: minimal, kept: true },
    { embedding: [0.9, 0.1], kept: true },
    { embedding: romantic, kept: false },
    { embedding: [0.1, 0.9], kept: false },
  ])

  it('scores a look like the kept ones above a look like the skipped ones', () => {
    expect(lookSimilarityScore(index, minimal).score).toBeGreaterThan(0.8)
    expect(lookSimilarityScore(index, romantic).score).toBeLessThan(0.2)
  })

  it('returns a coin flip when there is nothing to compare against', () => {
    expect(lookSimilarityScore([], minimal).score).toBe(0.5)
    expect(lookSimilarityScore(index, []).score).toBe(0.5)
    expect(buildLookIndex([{ embedding: [], kept: true }])).toHaveLength(0)
  })

  it('measures cosine similarity in the usual way', () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBeCloseTo(1, 6)
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 6)
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1, 6)
    expect(cosineSimilarity([], [1, 0])).toBe(0)
  })

  /**
   * Similarity clusters high and narrow, so an unweighted mean barely moves
   * between a piece she would love and one she would not. The fourth power is
   * what makes the score actually separate them.
   */
  it('sharpens onto the closest neighbours rather than averaging every one', () => {
    // Ten near-identical kept pieces from one corner of the space, ten skipped
    // from a different corner, and the query sits beside the kept corner.
    const spread = buildLookIndex([
      ...Array.from({ length: 10 }, (_, i) => ({ embedding: [1, i * 0.01], kept: true })),
      ...Array.from({ length: 10 }, (_, i) => ({ embedding: [i * 0.01, 1], kept: false })),
    ])
    const nearKept = lookSimilarityScore(spread, [1, 0.02]).score
    const nearSkipped = lookSimilarityScore(spread, [0.02, 1]).score
    expect(nearKept).toBeGreaterThan(0.9)
    expect(nearSkipped).toBeLessThan(0.1)
  })

  it('does not let an unrelated piece vote against, only fail to vote for', () => {
    // A negative cosine means unrelated at this scale, not the opposite.
    const onlyOpposite = buildLookIndex([{ embedding: [-1, 0], kept: false }])
    const score = lookSimilarityScore(onlyOpposite, [1, 0]).score
    expect(score).toBe(0.5) // nothing voted, so nothing was concluded
  })
})

describe('combinedStyleScore', () => {
  it('prefers the look, which measured better in every split', () => {
    const score = combinedStyleScore({ score: 0.9, neighbours: 20 }, { score: 0.1, coverage: 12 })
    expect(score).toBeGreaterThan(0.6)
  })

  it('falls back to the dimensions when no look was read', () => {
    expect(combinedStyleScore({ score: 0.5, neighbours: 0 }, { score: 0.8, coverage: 12 })).toBe(0.8)
  })

  it('falls back to the look when no dimensions were read', () => {
    expect(combinedStyleScore({ score: 0.8, neighbours: 20 }, { score: 0, coverage: 0 })).toBe(0.8)
  })

  it('says "no evidence" rather than "a middling piece" when it has neither', () => {
    expect(combinedStyleScore({ score: 0.5, neighbours: 0 }, { score: 0, coverage: 0 })).toBeNull()
  })
})
