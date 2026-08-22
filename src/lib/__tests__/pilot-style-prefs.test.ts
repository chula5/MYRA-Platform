import { describe, it, expect } from 'vitest'
import { matchesShape, avoidReasons, lovedScore, readStylePrefs, EMPTY_STYLE_PREFS, SHAPE_PREFERENCES } from '@/lib/pilot-stylist'

const prefs = (p: Partial<typeof EMPTY_STYLE_PREFS>) => ({ ...EMPTY_STYLE_PREFS, ...p })

describe('shape predicates', () => {
  it('reads oversized off the fit scale, not the product name', () => {
    expect(matchesShape('oversized', { fit: 5 })).toBe(true)
    expect(matchesShape('oversized', { fit: 2 })).toBe(false)
    // unscored item is not claimed either way
    expect(matchesShape('fitted', { fit: null })).toBe(false)
  })

  it('only calls trousers wide-leg — a flared skirt is not wide trousers', () => {
    expect(matchesShape('wide_leg', { item_type: 'trousers', leg_opening: 5 })).toBe(true)
    expect(matchesShape('wide_leg', { item_type: 'jeans', leg_opening: 4 })).toBe(true)
    expect(matchesShape('wide_leg', { item_type: 'skirt', leg_opening: 5 })).toBe(false)
  })

  it('every shape id has a distinct label and a working predicate', () => {
    const ids = SHAPE_PREFERENCES.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const s of SHAPE_PREFERENCES) expect(typeof s.match({})).toBe('boolean')
  })
})

describe('avoidReasons', () => {
  it('names the colour, the type and the shape that broke the rule', () => {
    const p = prefs({ colours_avoided: ['red'], types_avoided: ['sneaker'], shapes_avoided: ['oversized'] })
    expect(avoidReasons(p, { colour_family: 'red' })).toEqual(['RED'])
    expect(avoidReasons(p, { item_type: 'sneaker' })).toEqual(['SNEAKER'])
    expect(avoidReasons(p, { fit: 5 })).toEqual(['OVERSIZED / ROOMY FIT'])
    expect(avoidReasons(p, { colour_family: 'navy', item_type: 'blazer', fit: 2 })).toEqual([])
  })

  it('is silent when nothing is authored', () => {
    expect(avoidReasons(undefined, { colour_family: 'red', fit: 5 })).toEqual([])
    expect(avoidReasons(EMPTY_STYLE_PREFS, { colour_family: 'red', fit: 5 })).toEqual([])
  })
})

describe('lovedScore', () => {
  it('rewards an authored love and caps the total', () => {
    const p = prefs({ colours_loved: ['navy'], types_loved: ['blazer'], shapes_loved: ['high_rise'] })
    expect(lovedScore(p, { colour_family: 'navy' })).toBeCloseTo(0.18)
    expect(lovedScore(p, { colour_family: 'grey' })).toBe(0)
    expect(lovedScore(p, { colour_family: 'navy', item_type: 'blazer', rise: 5 })).toBeLessThanOrEqual(0.45)
    expect(lovedScore(p, { colour_family: 'navy', item_type: 'blazer', rise: 5 })).toBeGreaterThan(0.3)
  })
})

describe('readStylePrefs', () => {
  it('survives a pre-0045 row with no preference columns', () => {
    expect(readStylePrefs(null)).toEqual(EMPTY_STYLE_PREFS)
    expect(readStylePrefs({} as any)).toEqual(EMPTY_STYLE_PREFS)
    expect(readStylePrefs({ colours_loved: ['navy', 42 as any] } as any).colours_loved).toEqual(['navy'])
  })
})
