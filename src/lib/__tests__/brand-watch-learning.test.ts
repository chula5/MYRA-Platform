import { describe, it, expect } from 'vitest'
import { buildLearning, PREDICTED_SKIP_DELTA, type DecidedRow } from '@/lib/brand-watch-learning'

const row = (over: Partial<DecidedRow> = {}): DecidedRow => ({
  kept: false, brandName: null, productName: null, itemType: null,
  colourFamily: null, materialCategory: null, price: null, ...over,
})

/** n decisions on one item type, `keeps` of them kept. */
const runOf = (n: number, keeps: number, itemType: string, over: Partial<DecidedRow> = {}) =>
  Array.from({ length: n }, (_, i) => row({ kept: i < keeps, itemType, ...over }))

describe('buildLearning — delta is measured against her base keep rate', () => {
  it('scores a feature that behaves exactly like her average at zero', () => {
    // Base keep rate 0.6, and 'blouse' is kept at exactly 0.6. It says nothing.
    const learn = buildLearning(runOf(10, 6, 'blouse'))
    expect(learn(row({ itemType: 'blouse' })).delta).toBeCloseTo(0, 6)
  })

  it('separates a feature she keeps from one she skips', () => {
    const learn = buildLearning([...runOf(40, 36, 'knitwear'), ...runOf(40, 4, 'shorts')])
    const good = learn(row({ itemType: 'knitwear' })).delta
    const bad = learn(row({ itemType: 'shorts' })).delta
    expect(good).toBeGreaterThan(0)
    expect(bad).toBeLessThan(0)
    expect(good).toBeGreaterThan(bad)
  })

  it('has no opinion at all with nothing to learn from', () => {
    expect(buildLearning([]) (row({ itemType: 'blouse' })).delta).toBe(0)
  })
})

describe('buildLearning — evidence has to be earned', () => {
  it('barely moves on a single decision, and moves properly on many', () => {
    const thin = buildLearning([...runOf(2, 2, 'cape'), ...runOf(10, 5, 'blouse')])
    const thick = buildLearning([...runOf(60, 60, 'cape'), ...runOf(10, 5, 'blouse')])
    const onThin = thin(row({ itemType: 'cape' })).delta
    const onThick = thick(row({ itemType: 'cape' })).delta
    expect(onThin).toBeGreaterThan(0)
    expect(onThick).toBeGreaterThan(onThin * 2)
  })

  /**
   * The bug this scorer was rewritten for. The old version summed ±2-clamped
   * weights, so two decisions were enough to pin a piece at the maximum +6 —
   * and 54% of 5,377 real decisions landed on exactly that number, leaving the
   * queue unrankable.
   */
  it('cannot be saturated by a handful of one-sided decisions', () => {
    const learn = buildLearning([
      row({ kept: true, itemType: 'knitwear', colourFamily: 'black', materialCategory: 'natural_knit', productName: 'black knit top' }),
      row({ kept: false, itemType: 'blouse', colourFamily: 'pink', materialCategory: 'synthetic_woven', productName: 'pink mesh top' }),
    ])
    const d = learn(row({ itemType: 'knitwear', colourFamily: 'black', materialCategory: 'natural_knit', productName: 'black knit top' })).delta
    expect(d).toBeGreaterThan(0)
    expect(d).toBeLessThan(2)
  })

  it('does not let one idea said four ways count four times', () => {
    // 'knitwear' is overwhelmingly kept. type:, kind: and tc: all restate it,
    // and they share a group, so the piece that states all three cannot score
    // wildly above the piece that states only the type.
    const decided = [
      ...runOf(60, 57, 'knitwear', { colourFamily: 'black', materialCategory: 'natural_knit' }),
      ...runOf(60, 6, 'shorts', { colourFamily: 'pink', materialCategory: 'synthetic_woven' }),
    ]
    const learn = buildLearning(decided)
    const typeOnly = learn(row({ itemType: 'knitwear' })).delta
    const restated = learn(row({ itemType: 'knitwear', colourFamily: 'black', materialCategory: 'natural_knit' })).delta
    // It may score higher — colour and material are real, separate evidence —
    // but nothing like three times higher.
    expect(restated).toBeGreaterThan(typeOnly)
    expect(restated).toBeLessThan(typeOnly * 3)
  })
})

describe('buildLearning — what she has decided about this KIND of piece', () => {
  const decided = [
    ...runOf(20, 18, 'blazer', { materialCategory: 'natural_woven', colourFamily: 'navy' }),
    ...runOf(20, 2, 'blazer', { materialCategory: 'leather_suede', colourFamily: 'black' }),
  ]

  it('counts the type in its material when the material is known', () => {
    const learn = buildLearning(decided)
    const v = learn(row({ itemType: 'blazer', materialCategory: 'leather_suede' }))
    expect(v.kindKeeps).toBe(2)
    expect(v.kindSkips).toBe(18)
  })

  /**
   * 26% of queued rows never state a material. Treating every one of those as
   * a kind never seen put 3,792 of 10,437 queued pieces onto one capped number
   * with no way to rank them.
   */
  it('falls back to the type in its colour when no material is stated', () => {
    const learn = buildLearning(decided)
    const v = learn(row({ itemType: 'blazer', colourFamily: 'navy' }))
    expect(v.kindKeeps + v.kindSkips).toBeGreaterThan(0)
  })

  it('falls back to the bare type when neither is stated', () => {
    const learn = buildLearning(decided)
    const v = learn(row({ itemType: 'blazer' }))
    expect(v.kindKeeps + v.kindSkips).toBe(40)
  })

  it('knows nothing about a piece with no type at all', () => {
    const learn = buildLearning(decided)
    const v = learn(row({ productName: 'mystery' }))
    expect(v.kindKeeps + v.kindSkips).toBe(0)
  })
})

describe('buildLearning — predicting a skip', () => {
  it('stays quiet until there are enough decisions to justify it', () => {
    const learn = buildLearning(runOf(10, 1, 'shorts'))
    expect(learn(row({ itemType: 'shorts' })).predictedSkip).toBe(false)
  })

  it('calls a skip once the evidence is there', () => {
    const learn = buildLearning([...runOf(60, 3, 'shorts'), ...runOf(40, 36, 'knitwear')])
    const v = learn(row({ itemType: 'shorts' }))
    expect(v.delta).toBeLessThanOrEqual(PREDICTED_SKIP_DELTA)
    expect(v.predictedSkip).toBe(true)
  })

  it('never predicts a skip for a piece it likes', () => {
    const learn = buildLearning([...runOf(60, 3, 'shorts'), ...runOf(40, 36, 'knitwear')])
    expect(learn(row({ itemType: 'knitwear' })).predictedSkip).toBe(false)
  })
})

describe('buildLearning — the same answer every time', () => {
  it('is deterministic', () => {
    const decided = [...runOf(30, 20, 'blouse'), ...runOf(30, 5, 'shorts')]
    const a = buildLearning(decided)(row({ itemType: 'blouse', productName: 'silk blouse' }))
    const b = buildLearning(decided)(row({ itemType: 'blouse', productName: 'silk blouse' }))
    expect(a).toEqual(b)
  })

  it('names what moved the number', () => {
    const learn = buildLearning([...runOf(40, 36, 'knitwear'), ...runOf(40, 4, 'shorts')])
    expect(learn(row({ itemType: 'knitwear' })).reasons).toContain('type:knitwear')
  })
})
