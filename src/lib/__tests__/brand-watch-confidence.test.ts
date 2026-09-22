import { describe, it, expect } from 'vitest'
import {
  baseModel, confidenceFor, fitBrandModel, measureConfidence, summariseConfidence,
  CONFIDENCE_MIN_PREDICTIONS, type ConfidenceDecision,
} from '@/lib/brand-watch-confidence'

const sample = (kept: boolean, delta: number, score: number) => ({ kept, delta, score })

describe('fitBrandModel', () => {
  it('says her keep rate when there is nothing to learn from', () => {
    const m = fitBrandModel([sample(true, 2, 6), sample(false, -2, 3)])
    expect(m.wDelta).toBe(0)
    expect(confidenceFor(m, 5, 9)).toBeCloseTo(0.5, 5)
  })

  it('never claims certainty from one-sided evidence', () => {
    const all = Array.from({ length: 30 }, (_, i) => sample(true, i % 5, 5))
    const m = fitBrandModel(all)
    // Every decision was a keep: the answer is her keep rate, capped short of 1.
    expect(confidenceFor(m, 4, 7)).toBeLessThan(0.99)
  })

  it('learns that a higher lift means she keeps', () => {
    const keeps = Array.from({ length: 25 }, () => sample(true, 3, 7))
    const skips = Array.from({ length: 25 }, () => sample(false, -3, 2))
    const m = fitBrandModel([...keeps, ...skips])
    expect(confidenceFor(m, 3, 7)).toBeGreaterThan(confidenceFor(m, -3, 2))
    expect(confidenceFor(m, 3, 7)).toBeGreaterThan(0.75)
  })

  it('is the same model every time — no randomness', () => {
    const rows = [...Array.from({ length: 20 }, () => sample(true, 2, 6)), ...Array.from({ length: 20 }, () => sample(false, -1, 3))]
    expect(fitBrandModel(rows)).toEqual(fitBrandModel(rows))
  })
})

describe('summariseConfidence', () => {
  it('will not trust a bar on too few pieces', () => {
    const t = summariseConfidence(20, 5, 5, 0.92)
    expect(t.trusted).toBe(false)
    expect(t.summary).toContain(`${CONFIDENCE_MIN_PREDICTIONS}`)
  })
  it('trusts a bar that has proven itself', () => {
    const t = summariseConfidence(40, 20, 19, 0.92)
    expect(t.trusted).toBe(true)
    expect(t.summary).toContain('TRUSTED AT 92%')
  })
  it('does not trust a bar it keeps getting wrong', () => {
    const t = summariseConfidence(40, 20, 12, 0.92)
    expect(t.trusted).toBe(false)
    expect(t.summary).toContain('60%')
  })
})

describe('measureConfidence', () => {
  const decision = (kept: boolean, at: string, score: number, name: string): ConfidenceDecision => ({
    kept, brandName: 'b', productName: name, itemType: kept ? 'blouse' : 'shorts',
    colourFamily: kept ? 'cream' : 'pink', materialCategory: kept ? 'silk' : 'nylon',
    price: null, priceGbp: kept ? 200 : 40, at, score,
  })

  it('never counts a bulk keep or an auto-keep as proof', () => {
    // Fifty keeps in the same second: a KEEP ALL press, not fifty judgements.
    const bulk = Array.from({ length: 50 }, (_, i) => decision(true, '2026-01-01T10:00:00.000Z', 7, `bulk ${i}`))
    const auto = Array.from({ length: 30 }, (_, i) => ({ ...decision(true, `2026-01-02T10:${String(i).padStart(2, '0')}:00.000Z`, 7, `auto ${i}`), autoKept: true }))
    expect(measureConfidence([...bulk, ...auto]).careful).toBe(0)
  })

  it('measures on her one-by-one decisions', () => {
    const rows: ConfidenceDecision[] = []
    for (let i = 0; i < 80; i++) {
      const kept = i % 2 === 0
      rows.push(decision(kept, `2026-02-${String(1 + Math.floor(i / 2)).padStart(2, '0')}T${String(9 + (i % 2)).padStart(2, '0')}:00:00.000Z`, kept ? 8 : 1, `piece ${i}`))
    }
    const t = measureConfidence(rows, 0.9)
    expect(t.careful).toBeGreaterThan(0)
    // Whatever it predicts, precision and coverage stay inside their bounds.
    expect(t.predictions).toBeLessThanOrEqual(t.careful)
    expect(t.precision === null || (t.precision >= 0 && t.precision <= 1)).toBe(true)
  })
})
