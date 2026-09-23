import { describe, expect, it } from 'vitest'
import { sizeLabelInTitle, sizeRowsFor } from '@/lib/mirror/sizes'

describe('sizeLabelInTitle — pre-owned titles carry the one size', () => {
  it('reads Sign of the Times title shapes', () => {
    expect(sizeLabelInTitle('Brown plaid trousers - size UK 18')).toBe('UK 18')
    expect(sizeLabelInTitle('Beige slingback heels - size EU 38.5 (UK 5.5)')).toBe('EU 38.5 (UK 5.5)')
    expect(sizeLabelInTitle('Navy striped cardigan - size IT 38')).toBe('IT 38')
    expect(sizeLabelInTitle('Black silk blouse - size M')).toBe('M')
    expect(sizeLabelInTitle('Beige suede bucket bag')).toBeNull()
  })
})

describe('sizeRowsFor — variants first, title as one-of-one fallback', () => {
  it('collapses colourways and keeps availability', () => {
    const { rows, unique } = sizeRowsFor(
      [{ label: 'UK 8', available: false }, { label: 'UK 10', available: true }, { label: 'UK 10', available: false }, { label: 'UK 12', available: false }],
      'Navy dress', 'tops',
    )
    expect(unique).toBe(false)
    expect(rows.map((r) => [r.size_label, r.in_stock, r.canonical_value])).toEqual([['UK 8', false, 8], ['UK 10', true, 10], ['UK 12', false, 12]])
  })
  it('title size becomes a single in-stock unique row, with UK preferred inside brackets', () => {
    const { rows, unique } = sizeRowsFor([], 'Beige slingback heels - size EU 38.5 (UK 5.5)', 'shoes')
    expect(unique).toBe(true)
    expect(rows).toHaveLength(1)
    expect(rows[0].in_stock).toBe(true)
    // MYRA's shoe ladder is whole UK sizes; 5.5 snaps to the canonical 5.
    expect(rows[0].canonical_value).toBe(5)
    expect(rows[0].size_label).toBe('EU 38.5 (UK 5.5)')
  })
  it('alpha sizes span two canonical values', () => {
    const { rows } = sizeRowsFor([{ label: 'M', available: true }], 'Knit', 'tops')
    expect(rows[0].canonical_values?.length).toBeGreaterThan(1)
  })
  it('no category → no rows (bags never demote)', () => {
    expect(sizeRowsFor([{ label: 'One size', available: true }], 'Tote', null).rows).toEqual([])
  })
  it('one size → a row with no canonical value, so it stays unknown', () => {
    const { rows } = sizeRowsFor([{ label: 'One size', available: true }], 'Scarf', 'tops')
    expect(rows[0].canonical_values).toEqual([])
  })
})
