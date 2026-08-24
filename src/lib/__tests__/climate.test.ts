import { describe, it, expect } from 'vitest'
import { warmthOf, climateReason, climateScore } from '@/lib/climate'

const item = (o: Partial<Parameters<typeof warmthOf>[0]>) => ({ item_type: 'blouse', ...o })

describe('climate', () => {
  it('keeps coat weather out of a hot holiday', () => {
    expect(climateReason('hot', item({ item_type: 'coat' }))).toBeTruthy()
    expect(climateReason('hot', item({ item_type: 'boot' }))).toBeTruthy()
    expect(climateReason('hot', item({ item_type: 'knitwear', material_primary: 'Wool', material_weight: 4 }))).toBeTruthy()
  })

  it('lets summer pieces through', () => {
    expect(climateReason('hot', item({ item_type: 'sandal' }))).toBeNull()
    expect(climateReason('hot', item({ material_primary: 'Linen', material_weight: 2 }))).toBeNull()
    expect(climateReason('hot', item({ item_type: 'midi_dress', material_primary: 'Cotton', sleeve: 1 }))).toBeNull()
  })

  it('allows a fine knit for a hot evening but not a heavy one', () => {
    const fine = item({ item_type: 'knitwear', material_primary: 'Cotton', material_weight: 1 })
    const heavy = item({ item_type: 'knitwear', material_primary: 'Cashmere', material_weight: 5 })
    expect(climateReason('hot', fine)).toBeNull()
    expect(climateReason('hot', heavy)).toBeTruthy()
  })

  it('keeps bare pieces out of the cold, and shorts with them', () => {
    expect(climateReason('cold', item({ item_type: 'shorts' }))).toBeTruthy()
    expect(climateReason('cold', item({ material_primary: 'Linen', material_weight: 1, sleeve: 1 }))).toBeTruthy()
    expect(climateReason('cold', item({ item_type: 'coat', material_primary: 'Wool' }))).toBeNull()
  })

  it('does nothing at all when the weather is unstated', () => {
    for (const c of [null, undefined, 'temperate' as const]) {
      expect(climateReason(c, item({ item_type: 'coat' }))).toBeNull()
      expect(climateScore(c, item({ item_type: 'coat' }))).toBe(0)
    }
  })

  it('scores the airy end up for hot and the padded end up for cold', () => {
    const linen = item({ material_primary: 'Linen', material_weight: 1 })
    const wool = item({ item_type: 'knitwear', material_primary: 'Wool', material_weight: 5 })
    expect(climateScore('hot', linen)).toBeGreaterThan(climateScore('hot', wool))
    expect(climateScore('cold', wool)).toBeGreaterThan(climateScore('cold', linen))
  })

  it('never gates a piece that has no temperature', () => {
    // A structural leather tote is not "too warm for the heat" — material
    // weight means construction on a bag, not insulation.
    for (const t of ['tote', 'structured_bag', 'clutch', 'earrings', 'belt']) {
      expect(climateReason('hot', item({ item_type: t, material_category: 'leather_suede', material_weight: 5 }))).toBeNull()
      expect(climateReason('cold', item({ item_type: t, material_weight: 1 }))).toBeNull()
    }
  })

  it('reads the fibre out of the product name', () => {
    // "Houndstooth Wool Trousers" carries no material_primary at all — the
    // only place it says wool is the name, and it walked through a 25°C gate.
    expect(climateReason('hot', item({ item_type: 'trousers', product_name: 'Houndstooth Wool Trousers', material_category: 'natural_woven' }))).toBeTruthy()
    expect(climateReason('hot', item({ item_type: 'blouse', product_name: 'Linen Camp Shirt' }))).toBeNull()
  })

  it('makes an unlabelled jacket prove it is light', () => {
    // No fibre data at all: a jacket is more likely to be warm than not, and
    // being lenient here puts a wool jacket on a beach.
    expect(climateReason('hot', item({ item_type: 'jacket', product_name: 'Darnley Short Jacket' }))).toBeTruthy()
    expect(climateReason('hot', item({ item_type: 'jacket', product_name: 'Linen Summer Jacket' }))).toBeNull()
    expect(climateReason('hot', item({ item_type: 'jacket', material_primary: 'Cotton', material_weight: 2 }))).toBeNull()
  })

  it('judges an unscored piece on its type and fibre alone', () => {
    expect(warmthOf(item({}))).toBe(3)
    expect(warmthOf(item({ material_primary: 'Linen' }))).toBeLessThan(3)
  })
})
