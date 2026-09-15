import { describe, it, expect } from 'vitest'
import { whyThisSuitsHer, WHY_FALLBACK } from '@/lib/look-why'
import { EMPTY_STYLE_PREFS, type StylePrefs } from '@/lib/pilot-stylist'

// Alison's own words on her profile (2026-09-15), trimmed.
const ALISON: StylePrefs = {
  ...EMPTY_STYLE_PREFS,
  colours_loved: ['black', 'cream', 'navy'],
  shapes_loved: ['oversized', 'wide_leg', 'unstructured', 'long_length'],
  types_loved: ['blouse', 'skirt', 'trousers', 'flat', 'sneaker', 'knitwear', 'shirt', 'trench'],
  types_avoided: ['heel', 'mini_dress'],
}

describe('whyThisSuitsHer', () => {
  it('says it in one plain sentence from what she loves', () => {
    const why = whyThisSuitsHer([
      { item_type: 'blouse', colour_family: 'navy', fit: 3 },
      { item_type: 'trousers', colour_family: 'cream', leg_opening: 5 },
      { item_type: 'sneaker', colour_family: 'cream' },
    ], ALISON)
    expect(why).toBe('Wide trousers and a blouse, in the navy and cream you wear most.')
  })

  it('leads with her own piece when a look is built around it', () => {
    const why = whyThisSuitsHer([
      { item_type: 'skirt', colour_family: 'brown', product_name: 'Cow-print Midi Skirt', owned: true },
      { item_type: 'sneaker', colour_family: 'black' },
    ], ALISON)
    expect(why.startsWith('Built around your own cow-print midi skirt')).toBe(true)
    expect(why).toContain('black')
  })

  it('never calls something she avoids a reason', () => {
    const why = whyThisSuitsHer([{ item_type: 'heel', colour_family: 'red' }], ALISON)
    expect(why).not.toMatch(/heel/i)
  })

  it('does not say trousers twice', () => {
    const why = whyThisSuitsHer([{ item_type: 'trousers', leg_opening: 5, colour_family: 'grey' }], ALISON)
    expect(why).toBe('Wide trousers — the way you like to dress.')
  })

  it('falls back gently when nothing in the look is one of her words', () => {
    expect(whyThisSuitsHer([{ item_type: 'heel', colour_family: 'red' }], EMPTY_STYLE_PREFS)).toBe(WHY_FALLBACK)
  })
})
