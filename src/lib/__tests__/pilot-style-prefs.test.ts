import { describe, it, expect } from 'vitest'
import { matchesShape, avoidReasons, lovedScore, readStylePrefs, EMPTY_STYLE_PREFS, SHAPE_PREFERENCES, matchesColourPref, COLOUR_SHADES } from '@/lib/pilot-stylist'

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

describe('colour shades', () => {
  it('separates a shade from its family — no mint is not no green', () => {
    const mintTop = { colour_family: 'green', product_name: 'Aria knit mint green' }
    const forestTop = { colour_family: 'green', product_name: 'Aria knit forest green' }
    expect(matchesColourPref('mint', mintTop)).toBe(true)
    expect(matchesColourPref('mint', forestTop)).toBe(false)
    // the family still catches both
    expect(matchesColourPref('green', mintTop)).toBe(true)
    expect(matchesColourPref('green', forestTop)).toBe(true)
  })

  it('tells cobalt from navy', () => {
    const cobalt = { colour_family: 'blue', product_name: 'Lena dress cobalt' }
    const navy = { colour_family: 'navy', product_name: 'Serge navy' }
    expect(matchesColourPref('cobalt', cobalt)).toBe(true)
    expect(matchesColourPref('cobalt', navy)).toBe(false)
    // NAVY is a family, so it answers on the scored family alone
    expect(matchesColourPref('navy', navy)).toBe(true)
    expect(matchesColourPref('navy', cobalt)).toBe(false)
    expect(matchesColourPref('navy', { colour_family: 'navy', product_name: 'Unnamed coat' })).toBe(true)
  })

  it('reads the real colourways sitting in the library', () => {
    expect(matchesColourPref('khaki', { colour_family: 'green', product_name: 'JIKOLAZ - STRIPE KHAKI' })).toBe(true)
    expect(matchesColourPref('taupe', { colour_family: 'camel', product_name: 'Claudia Vegetal soft calf Taupe' })).toBe(true)
    expect(matchesColourPref('olive', { colour_family: 'green', product_name: 'Tarisha Calf suede Dried olive' })).toBe(true)
    expect(matchesColourPref('chocolate', { colour_family: 'brown', product_name: 'Ayano Ganache Leather' })).toBe(true)
  })

  it('will not let a stray word overrule the scored family', () => {
    // "rose" in a style name, but the piece is scored black
    expect(matchesColourPref('dusty_rose', { colour_family: 'black', product_name: 'Rose blazer black' })).toBe(false)
    // family unknown → trust the colourway
    expect(matchesColourPref('dusty_rose', { colour_family: null, product_name: 'Petal dusty rose' })).toBe(true)
  })

  it('never matches an item with no colour text and no family', () => {
    for (const s of COLOUR_SHADES) expect(matchesColourPref(s.id, { colour_family: null, product_name: '' })).toBe(false)
    // ...and a family preference is equally silent when nothing was scored
    expect(matchesColourPref('green', { colour_family: null, product_name: '' })).toBe(false)
  })

  it('gates and rewards through the shade, not the family', () => {
    const p = { ...EMPTY_STYLE_PREFS, colours_avoided: ['mint'], colours_loved: ['navy'] }
    expect(avoidReasons(p, { colour_family: 'green', product_name: 'Knit mint green' })).toEqual(['MINT / SEAFOAM'])
    expect(avoidReasons(p, { colour_family: 'green', product_name: 'Knit olive green' })).toEqual([])
    expect(lovedScore(p, { colour_family: 'navy', product_name: 'Serge navy' })).toBeCloseTo(0.18)
  })
})
