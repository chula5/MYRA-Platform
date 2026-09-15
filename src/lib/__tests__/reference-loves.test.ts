import { describe, it, expect } from 'vitest'
import { lovesToAdd, qualifyingTypes } from '../reference-loves'

// Alison's first ten reference pictures (2026-09-15), as scored.
const ALISON = [
  ['coat', 'shirt', 'trousers', 'structured_bag', 'flat', 'earrings', 'ring'],
  ['knitwear', 'shirt', 'trousers', 'flat', 'sunglasses', 'bracelet', 'ring'],
  ['knitwear', 't-shirt', 'trousers', 'shirt', 'flat', 'sneaker', 'structured_bag', 'crossbody', 'tote', 'sunglasses'],
  ['blazer', 'shirt', 'jeans', 'flat', 'tote'],
  ['jacket', 'shirt', 'trousers', 'crossbody', 'belt', 'sandal', 'earrings', 'bracelet'],
  ['trench', 'jeans', 'sneaker', 'structured_bag', 'sunglasses', 'ring'],
  ['jacket', 'jeans', 'heel', 'sunglasses', 'earrings', 'ring', 'shoulder_bag'],
  ['trench', 'knitwear', 'trousers', 'heel', 'structured_bag', 'earrings'],
  ['trench', 'knitwear', 'trousers', 'sneaker', 'tote', 'sunglasses', 'ring'],
  ['trench', 'trousers', 'sneaker', 'crossbody', 'necklace'],
]
const PREFS = { types_loved: ['blouse', 'skirt', 'trousers', 'flat', 'sneaker'], types_avoided: ['heel', 'mini_dress'] }

describe('lovesToAdd', () => {
  it("adds the pieces Alison's pictures keep showing", () => {
    expect(lovesToAdd([], ALISON, PREFS)).toEqual(['shirt', 'knitwear', 'trench', 'jeans'])
  })

  it('never adds a piece she avoids, however often it appears', () => {
    const heels = Array.from({ length: 8 }, () => ['heel', 'trousers'])
    expect(lovesToAdd([], heels, { types_loved: [], types_avoided: ['heel'] })).toEqual(['trousers'])
  })

  it('never adds bags or jewellery — the loves list is clothes and shoes', () => {
    expect(qualifyingTypes(ALISON).has('ring')).toBe(false)
    expect(qualifyingTypes(ALISON).has('structured_bag')).toBe(false)
  })

  it('says nothing from too few pictures', () => {
    expect(lovesToAdd([], ALISON.slice(0, 4), PREFS)).toEqual([])
  })

  it('does not re-add a piece that already qualified before the new pictures', () => {
    const more = [...ALISON, ['shirt', 'trousers']]
    expect(lovesToAdd(ALISON, more, { types_loved: PREFS.types_loved, types_avoided: [] })).toEqual([])
  })
})
