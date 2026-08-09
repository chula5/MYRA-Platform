import { describe, it, expect } from 'vitest'
import {
  itemNeedsScoring,
  formalityBand,
  deriveOccasionScores,
  computeSwapDeltas,
  buildEjectionConstraints,
  isExcluded,
  hardSkipPairs,
  violatedSkipPairs,
  confidenceGate,
  nextThreshold,
  contextKey,
  THRESHOLD_START,
} from '@/lib/pipeline'
import { emptyModel, applyOffer, approvalRate, applyDecision } from '@/lib/style-brain'

const scoredItem = (over: Record<string, unknown> = {}) => ({
  colour_family: 'black',
  structure: 2, surface: 1, colour_depth: 1, pattern: 1, sheen: 2,
  material_weight: 3, material_formality: 4,
  ...over,
})

describe('itemNeedsScoring', () => {
  it('flags missing colour_family', () => {
    expect(itemNeedsScoring(scoredItem({ colour_family: null }))).toBe(true)
  })
  it('flags null core dimensions', () => {
    expect(itemNeedsScoring(scoredItem({ sheen: null }))).toBe(true)
  })
  it('flags an untouched default block of 3s', () => {
    expect(itemNeedsScoring(scoredItem({ structure: 3, surface: 3, colour_depth: 3, pattern: 3 }))).toBe(true)
  })
  it('accepts a genuinely scored item (even with some 3s)', () => {
    expect(itemNeedsScoring(scoredItem({ structure: 3, surface: 3 }))).toBe(false)
  })
})

describe('formalityBand / deriveOccasionScores', () => {
  it('bands by material formality', () => {
    expect(formalityBand([{ material_formality: 1 }, { material_formality: 2 }])).toBe('casual')
    expect(formalityBand([{ material_formality: 3 }])).toBe('mid')
    expect(formalityBand([{ material_formality: 5 }, { material_formality: 4 }])).toBe('dressy')
  })
  it('never returns defaulted occasion values for a dressy evening look', () => {
    const entries = [
      { item: scoredItem({ material_formality: 5, sheen: 4 }), slot: 'dress' },
      { item: scoredItem({ material_formality: 5, sheen: 3, item_type: 'heel' }), slot: 'shoe' },
    ]
    const s = deriveOccasionScores(entries)
    expect(s.formality).toBeGreaterThanOrEqual(4)
    expect(s.time_of_day).toBeGreaterThanOrEqual(4)
    expect(s.planning).toBeGreaterThanOrEqual(3)
  })
  it('reads a casual look as day-leaning', () => {
    const entries = [
      { item: scoredItem({ material_formality: 1, sheen: 1, colour_family: 'white' }), slot: 'top' },
      { item: scoredItem({ material_formality: 1, sheen: 1, colour_family: 'blue', fit: 4 }), slot: 'bottom' },
    ]
    const s = deriveOccasionScores(entries)
    expect(s.formality).toBeLessThanOrEqual(2)
    expect(s.time_of_day).toBeLessThanOrEqual(2)
  })
})

describe('computeSwapDeltas', () => {
  it('diffs only changed, non-null dimensions', () => {
    const from = scoredItem({ colour_family: 'cream', material_category: 'natural_woven', fit: null })
    const to = scoredItem({ colour_family: 'black', material_category: 'leather_suede', fit: 2 })
    const d = computeSwapDeltas(from, to)
    expect(d.colour_family).toEqual({ from: 'cream', to: 'black' })
    expect(d.material_category).toEqual({ from: 'natural_woven', to: 'leather_suede' })
    expect(d.fit).toBeUndefined() // null on one side — no delta
    expect(d.structure).toBeUndefined() // unchanged
  })
})

describe('ejection constraints', () => {
  const rows = [
    { item_id: 'a', slot: 'shoe', formality_band: 'dressy' },
    { item_id: 'a', slot: 'shoe', formality_band: 'dressy' },
    { item_id: 'b', slot: 'bag', formality_band: 'casual' },
    { item_id: 'c', slot: 'top', formality_band: 'mid' },
    { item_id: 'c', slot: 'bottom', formality_band: 'casual' },
    { item_id: 'c', slot: 'top', formality_band: 'dressy' },
  ]
  const c = buildEjectionConstraints(rows)
  it('excludes 2+ ejections from that context only', () => {
    expect(isExcluded(c, 'a', 'shoe', 'dressy')).toBe(true)
    expect(isExcluded(c, 'a', 'shoe', 'casual')).toBe(false)
  })
  it('leaves single-ejection items in the pool', () => {
    expect(isExcluded(c, 'b', 'bag', 'casual')).toBe(false)
  })
  it('quarantines 3+ ejections everywhere', () => {
    expect(c.quarantined.has('c')).toBe(true)
    expect(isExcluded(c, 'c', 'shoe', 'mid')).toBe(true)
  })
  it('builds context keys consistently', () => {
    expect(contextKey('shoe', 'dressy')).toBe('shoe|dressy')
    expect(contextKey(null, undefined)).toBe('any|any')
  })
})

describe('hard skip pairs', () => {
  it('extracts negative pairs and flags violating candidates', () => {
    const model = emptyModel()
    model.pairs['colour:pink|red'] = [0, 4]
    model.pairs['colour:black|white'] = [5, 1]
    const skips = hardSkipPairs(model)
    expect(skips.has('colour:pink|red')).toBe(true)
    expect(skips.has('colour:black|white')).toBe(false)
    const bad = violatedSkipPairs(
      [{ colour_family: 'pink' }, { colour_family: 'red' }],
      skips,
    )
    expect(bad).toEqual(['colour:pink|red'])
    expect(violatedSkipPairs([{ colour_family: 'black' }, { colour_family: 'white' }], skips)).toEqual([])
  })
})

describe('confidenceGate', () => {
  const base = () => {
    const model = emptyModel()
    model.decisions = 20 // past cold start
    model.pairs['colour:black|black'] = [4, 0]
    model.pairs['brand:khaite|toteme'] = [3, 0]
    return model
  }
  const vec = new Array(34).fill(0.5)
  const items = [
    { colour_family: 'black', brand_name: 'Khaite', item_type: 'knitwear' },
    { colour_family: 'black', brand_name: 'Toteme', item_type: 'trousers' },
  ]
  const gateInput = (over: Partial<Parameters<typeof confidenceGate>[0]> = {}) => ({
    vector: vec,
    approvedVectors: [vec, vec.map((x) => x * 0.9)],
    items,
    itemIds: ['i1', 'i2'],
    itemLabels: ['Khaite knit', 'Toteme trouser'],
    slotByItemId: { i1: 'top', i2: 'bottom' },
    band: 'dressy' as const,
    constraints: buildEjectionConstraints([]),
    model: base(),
    ...over,
  })

  it('gives high confidence to a favoured, un-ejected combination', () => {
    const r = confidenceGate(gateInput())
    expect(r.similarity).toBeGreaterThan(0.95)
    expect(r.confidence).toBeCloseTo(r.similarity, 5)
    expect(r.reasons).toEqual([])
  })
  it('penalises a prior ejection in context with a reason', () => {
    const constraints = buildEjectionConstraints([{ item_id: 'i1', slot: 'top', formality_band: 'dressy' }])
    const r = confidenceGate(gateInput({ constraints }))
    expect(r.confidence).toBeCloseTo(r.similarity - 0.1, 5)
    expect(r.reasons[0]).toMatch(/ejected 1× in dressy context/)
  })
  it('penalises unfavoured colour pairs and unapproved brand pairs', () => {
    const model = base()
    delete model.pairs['colour:black|black']
    delete model.pairs['brand:khaite|toteme']
    const r = confidenceGate(gateInput({ model }))
    expect(r.confidence).toBeCloseTo(r.similarity - 0.05 - 0.05, 5)
    expect(r.reasons.join(' ')).toMatch(/colour pairing/)
    expect(r.reasons.join(' ')).toMatch(/brand pairing .* never approved/)
  })
  it('skips pair penalties during cold start', () => {
    const model = base()
    model.decisions = 3
    delete model.pairs['colour:black|black']
    const r = confidenceGate(gateInput({ model }))
    expect(r.reasons).toEqual([])
  })
})

describe('adaptive threshold', () => {
  it('tightens on a fast-lane override', () => {
    const r = nextThreshold(THRESHOLD_START, 'override', 5)
    expect(r.threshold).toBeGreaterThan(THRESHOLD_START)
    expect(r.cleanStreak).toBe(0)
  })
  it('relaxes only after a sustained clean streak', () => {
    let t = THRESHOLD_START
    let streak = 0
    for (let i = 0; i < 9; i++) {
      const r = nextThreshold(t, 'clean_approve', streak)
      t = r.threshold
      streak = r.cleanStreak
      expect(t).toBe(THRESHOLD_START)
    }
    const r = nextThreshold(t, 'clean_approve', streak)
    expect(r.threshold).toBeLessThan(THRESHOLD_START)
    expect(r.cleanStreak).toBe(0)
  })
})

describe('offer tracking → approval rates', () => {
  it('computes approvals / times offered', () => {
    const model = emptyModel()
    const items = [{ brand_name: 'Khaite', colour_family: 'black' }]
    for (let i = 0; i < 4; i++) applyOffer(model, items)
    applyDecision(model, items, 'approve')
    const r = approvalRate(model, 'brand:khaite')!
    expect(r.offered).toBe(4)
    expect(r.approvals).toBe(1)
    expect(r.rate).toBeCloseTo(0.25)
  })
  it('falls back to acted-on counts when offers were never logged', () => {
    const model = emptyModel()
    const items = [{ brand_name: 'Toteme' }]
    applyDecision(model, items, 'approve')
    applyDecision(model, items, 'skip')
    const r = approvalRate(model, 'brand:toteme')!
    expect(r.offered).toBe(2)
    expect(r.rate).toBeCloseTo(0.5)
  })
})
