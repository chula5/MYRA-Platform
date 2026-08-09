import { describe, it, expect } from 'vitest'
import {
  supportingOverlap,
  sharesShoesAndBag,
  directionsDiffer,
  validateVariantPair,
  isDistinctFromAll,
  statementConsistent,
  validateSet,
  isUnderStyled,
  DIRECTION_PRESETS,
  type SetVariant,
} from '@/lib/styling-sets'

const v = (over: Partial<SetVariant> = {}): SetVariant => ({
  supportingIds: ['a', 'b', 'c', 'd'],
  shoeId: 'shoe1',
  bagId: 'bag1',
  direction: 'daytime',
  formality: 2,
  timeOfDay: 1,
  statementItemId: 'hero',
  ...over,
})

describe('supporting-item distinctness (60% rule)', () => {
  it('measures overlap over the larger variant', () => {
    expect(supportingOverlap(v(), v())).toBe(1)
    expect(supportingOverlap(v(), v({ supportingIds: ['a', 'x', 'y', 'z'] }))).toBe(0.25)
    expect(supportingOverlap(v({ supportingIds: [] }), v({ supportingIds: [] }))).toBe(1)
  })
  it('rejects pairs where fewer than 60% of supporting items differ', () => {
    // 2 of 4 shared = 50% differ → fail
    const p = validateVariantPair(v(), v({ supportingIds: ['a', 'b', 'x', 'y'], direction: 'evening' }))
    expect(p.ok).toBe(false)
    expect(p.reasons.join()).toMatch(/60%/)
  })
  it('accepts pairs with 60%+ difference', () => {
    // 1 of 4 shared = 75% differ → ok (and different direction, different shoes)
    const p = validateVariantPair(
      v(),
      v({ supportingIds: ['a', 'x', 'y', 'z'], direction: 'evening', shoeId: 'shoe2' }),
    )
    expect(p.ok).toBe(true)
  })
})

describe('shoes + bag rule', () => {
  it('no two variants may share the same shoes AND the same bag', () => {
    expect(sharesShoesAndBag(v(), v({ supportingIds: ['x', 'y', 'z', 'w'] }))).toBe(true)
    expect(sharesShoesAndBag(v(), v({ shoeId: 'shoe2' }))).toBe(false)
    expect(sharesShoesAndBag(v(), v({ bagId: 'bag2' }))).toBe(false)
    const p = validateVariantPair(v(), v({ supportingIds: ['x', 'y', 'z', 'w'], direction: 'evening' }))
    expect(p.ok).toBe(false)
    expect(p.reasons.join()).toMatch(/same shoes AND the same bag|same shoes AND same bag/)
  })
})

describe('direction / occasion / formality difference', () => {
  it('differs by direction preset', () => {
    expect(directionsDiffer(v(), v({ direction: 'evening' }))).toBe(true)
  })
  it('differs by formality when direction matches', () => {
    expect(directionsDiffer(v(), v({ formality: 4 }))).toBe(true)
  })
  it('fails when nothing differs', () => {
    expect(directionsDiffer(v(), v())).toBe(false)
  })
})

describe('statement consistency', () => {
  it('hero-as-statement must hold across every variant', () => {
    const a = v({ statementItemId: 'hero' })
    const b = v({ statementItemId: 'other' })
    expect(statementConsistent('hero', [a, b])).toBe(false)
    expect(statementConsistent('hero', [a, v({ statementItemId: 'hero' })])).toBe(true)
  })
  it('a base-piece hero lets each variant pick its own statement', () => {
    const a = v({ statementItemId: 'x' })
    const b = v({ statementItemId: 'y' })
    expect(statementConsistent('hero', [a, b])).toBe(true)
  })
})

describe('validateSet', () => {
  const goodSet = (): SetVariant[] => [
    v({ supportingIds: ['a', 'b', 'c'], direction: 'daytime', shoeId: 's1', bagId: 'b1' }),
    v({ supportingIds: ['d', 'e', 'f'], direction: 'evening', shoeId: 's2', bagId: 'b2', formality: 4, timeOfDay: 4 }),
    v({ supportingIds: ['g', 'h', 'a'], direction: 'weekend', shoeId: 's3', bagId: 'b1', formality: 1 }),
  ]
  it('passes a genuinely varied set', () => {
    const r = validateSet('hero', goodSet())
    expect(r.violations).toEqual([])
    expect(r.ok).toBe(true)
  })
  it('rejects sets below minimum size', () => {
    const r = validateSet('hero', goodSet().slice(0, 2))
    expect(r.ok).toBe(false)
    expect(r.violations.join()).toMatch(/needs 3-4/)
  })
  it('names the offending pair', () => {
    const set = goodSet()
    set[1] = v({ supportingIds: ['a', 'b', 'x'], direction: 'daytime', shoeId: 's1', bagId: 'b1' })
    const r = validateSet('hero', set)
    expect(r.ok).toBe(false)
    expect(r.violations.join()).toMatch(/variants 1 & 2/)
  })
})

describe('under-styled + presets', () => {
  it('flags below 2 live variants', () => {
    expect(isUnderStyled(1)).toBe(true)
    expect(isUnderStyled(2)).toBe(false)
  })
  it('ships four distinct direction presets', () => {
    expect(DIRECTION_PRESETS.length).toBe(4)
    expect(new Set(DIRECTION_PRESETS.map((d) => d.key)).size).toBe(4)
  })
})

describe('isDistinctFromAll', () => {
  it('checks a candidate against every accepted variant', () => {
    const accepted = [v(), v({ supportingIds: ['x', 'y', 'z', 'w'], direction: 'evening', shoeId: 's2' })]
    const dupe = v({ supportingIds: ['a', 'b', 'c', 'q'], direction: 'layered', shoeId: 's9', bagId: 'b9' })
    expect(isDistinctFromAll(dupe, accepted).ok).toBe(false) // 3/4 shared with first
    const fresh = v({ supportingIds: ['m', 'n', 'o', 'p'], direction: 'layered', shoeId: 's9', bagId: 'b9' })
    expect(isDistinctFromAll(fresh, accepted).ok).toBe(true)
  })
})
