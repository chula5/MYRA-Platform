import { describe, it, expect } from 'vitest'
import {
  lookConfidence, calibrateThreshold, indexHistory, historySignals,
  MIN_USEFUL_SEPARATION, type LookSignals, type LookRecord,
} from '@/lib/look-confidence'

const base: LookSignals = {
  constitutionPassed: true, containsRejected: false, containsBlockedTrait: false,
  provenPieceShare: 0, troubledPieceShare: 0, provenPairShare: 0, brokenPairShare: 0,
  usedFallbackPool: false, unscoredShare: 0,
}

describe('look confidence', () => {
  it('refuses outright on the things that are never acceptable', () => {
    for (const [field, label] of [
      ['constitutionPassed', 'house rule'],
      ['containsRejected', 'already turned down'],
      ['containsBlockedTrait', 'keeps rejecting'],
    ] as const) {
      const s = { ...base, [field]: field === 'constitutionPassed' ? false : true }
      const c = lookConfidence(s)
      expect(c.score).toBe(0)
      expect(c.high).toBe(false)
      expect(c.reasons.join(' ')).toContain(label)
    }
  })

  it('rises with pieces she has already kept — the whole point', () => {
    // This is what makes the score improve as she uses it: a look built from
    // pieces that have already survived her is a safer bet than a look of
    // strangers, and nothing else the composer knows says that.
    const none = lookConfidence(base).score
    const half = lookConfidence({ ...base, provenPieceShare: 0.5 }).score
    const all = lookConfidence({ ...base, provenPieceShare: 1 }).score
    expect(half).toBeGreaterThan(none)
    expect(all).toBeGreaterThan(half)
    expect(lookConfidence({ ...base, provenPieceShare: 1 }).reasons.join(' ')).toMatch(/already kept/)
  })

  it('falls for pieces that have only ever been edited out', () => {
    const c = lookConfidence({ ...base, troubledPieceShare: 1 })
    expect(c.score).toBeLessThan(lookConfidence(base).score)
    expect(c.high).toBe(false)
  })

  it('counts brand pairings that have worked before, more gently than pieces', () => {
    const pieces = lookConfidence({ ...base, provenPieceShare: 1 }).score
    const pairs = lookConfidence({ ...base, provenPairShare: 1 }).score
    expect(pairs).toBeGreaterThan(lookConfidence(base).score)
    expect(pairs).toBeLessThan(pieces)
  })

  it('marks down a relaxed pool and unscored pieces', () => {
    expect(lookConfidence({ ...base, usedFallbackPool: true }).score).toBeLessThan(lookConfidence(base).score)
    expect(lookConfidence({ ...base, unscoredShare: 0.8 }).score).toBeLessThan(lookConfidence(base).score)
  })
})

describe('reading her history', () => {
  const look = (itemIds: string[], brandIds: string[], kept: boolean): LookRecord => ({ itemIds, brandIds, kept })

  it('treats one yes as proof, whatever happened to the piece elsewhere', () => {
    // Appearing in a look is the composer's choice; being kept is hers.
    const h = indexHistory([
      look(['a'], ['b1'], false),
      look(['a'], ['b1'], true),
    ])
    expect(h.keptPieces.has('a')).toBe(true)
    expect(h.troubledPieces.has('a')).toBe(false)
  })

  it('scores a new look by how much of it she has worn before', () => {
    const h = indexHistory([look(['a', 'b'], ['x', 'y'], true), look(['c'], ['z'], false)])
    const s = historySignals(h, ['a', 'b', 'c', 'd'], ['x', 'y'])
    expect(s.provenPieceShare).toBeCloseTo(0.5)
    expect(s.troubledPieceShare).toBeCloseTo(0.25)
    expect(s.provenPairShare).toBeCloseTo(1)
  })

  it('says nothing about a look with no history behind it', () => {
    const s = historySignals(indexHistory([]), ['new1', 'new2'], ['b1', 'b2'])
    expect(s.provenPieceShare).toBe(0)
    expect(s.troubledPieceShare).toBe(0)
  })
})

describe('calibration', () => {
  it('judges the gate on what she would be SENT, not on the average', () => {
    const history = [
      ...Array.from({ length: 15 }, () => ({ score: 0.9, wasClean: true })),
      ...Array.from({ length: 15 }, () => ({ score: 0.3, wasClean: false })),
    ]
    const c = calibrateThreshold(history, 0.75)
    expect(c.reaching).toBe(15)
    expect(c.precision).toBe(1)
    expect(c.lift).toBeCloseTo(0.5)
    expect(c.usable).toBe(true)
  })

  it('refuses a gate that is no better than guessing', () => {
    // Scores unrelated to the outcome: half of what reaches her is clean,
    // which is exactly what picking at random would give.
    const history = Array.from({ length: 40 }, (_, i) => ({ score: 0.8, wasClean: i % 2 === 0 }))
    const c = calibrateThreshold(history, 0.75)
    expect(c.precision).toBeCloseTo(0.5)
    expect(c.lift).toBeCloseTo(0)
    expect(c.usable).toBe(false)
  })

  it('refuses a gate with too little evidence behind it', () => {
    const history = [
      ...Array.from({ length: 3 }, () => ({ score: 0.9, wasClean: true })),
      ...Array.from({ length: 20 }, () => ({ score: 0.2, wasClean: false })),
    ]
    expect(calibrateThreshold(history, 0.75).usable).toBe(false)
  })
})
