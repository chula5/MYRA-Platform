import { describe, it, expect } from 'vitest'
import { lookPasses, checkDidNotRun, type JudgedLook, type LookCheck } from '../look-check'

const check = (verdict: LookCheck['verdict']): LookCheck =>
  ({ verdict, colourHarmony: 4, piecesGoTogether: 4, issues: [], confidence: 0.5 })

describe('lookPasses — the look check fails closed', () => {
  it('passes a checked look that works or is borderline', () => {
    expect(lookPasses({ check: check('works'), sizes: {} })).toBe(true)
    expect(lookPasses({ check: check('borderline'), sizes: {} })).toBe(true)
  })

  it('never passes a look the check could not judge', () => {
    expect(lookPasses({ check: null, sizes: {} })).toBe(false)
  })

  it('fails a clash, and a piece not in her size', () => {
    expect(lookPasses({ check: check('clashes'), sizes: {} })).toBe(false)
    const outOfSize = { check: check('works'), sizes: { a: { verdict: 'not_in_size' } } } as unknown as JudgedLook
    expect(lookPasses(outOfSize)).toBe(false)
  })
})

describe('checkDidNotRun', () => {
  it('is true only when no look got a verdict', () => {
    expect(checkDidNotRun([{ check: null }, { check: null }])).toBe(true)
    expect(checkDidNotRun([{ check: null }, { check: check('clashes') }])).toBe(false)
    expect(checkDidNotRun([])).toBe(false)
  })
})
