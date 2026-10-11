import { describe, it, expect } from 'vitest'
import { validateDelivery, isFastFashion, FORMALITY_FLOOR_BAND, SYNTH_PERSONAS } from '../pilot-stylist'

const mum = SYNTH_PERSONAS[1]

describe('validateDelivery — the non-negotiables', () => {
  const memberBrands = mum.brands.map((b) => b.name)
  const checked = new Date().toISOString()
  const goodLooks = [
    {
      items: [
        { brand: 'Zara', product_name: 'wide-leg trousers', owned: true },
        { brand: 'ME+EM', product_name: 'merino knit', owned: false, in_stock: true, stock_checked_at: checked },
      ],
    },
    {
      items: [
        // Toast is NOT in mum's named brands — the new-brand slot
        { brand: 'Toast', product_name: 'linen shirt', owned: false, in_stock: true, stock_checked_at: checked },
      ],
    },
    {
      items: [
        { brand: 'Sessùn', product_name: 'cropped jacket', owned: false, in_stock: true, stock_checked_at: checked },
      ],
    },
  ]

  it('passes a compliant delivery', () => {
    expect(validateDelivery(goodLooks, memberBrands)).toEqual([])
  })

  it('blocks Zara as a recommendation but allows it owned (input, never output)', () => {
    const withZaraRec = [
      { ...goodLooks[0] },
      goodLooks[1],
      { items: [{ brand: 'Zara', product_name: 'blazer', owned: false, in_stock: true, stock_checked_at: checked }] },
    ]
    const errors = validateDelivery(withZaraRec, memberBrands)
    expect(errors.some((e) => e.includes('FAST FASHION'))).toBe(true)
  })

  it('requires the owned-item anchor and the new-brand slot', () => {
    const noAnchor = goodLooks.map((l) => ({ ...l, items: l.items.filter((it) => !it.owned) }))
    expect(validateDelivery(noAnchor, memberBrands).some((e) => e.includes('OWNS'))).toBe(true)
    const noNewBrand = validateDelivery([goodLooks[0], goodLooks[0], goodLooks[2]], memberBrands)
    expect(noNewBrand.some((e) => e.includes('DIDN’T NAME'))).toBe(true)
  })

  it('blocks unchecked or out-of-stock items at send', () => {
    const unchecked = [goodLooks[0], goodLooks[1], { items: [{ brand: 'Sessùn', product_name: 'cropped jacket', owned: false }] }]
    expect(validateDelivery(unchecked, memberBrands).some((e) => e.includes('STOCK NOT CHECKED'))).toBe(true)
  })

  it('requires exactly 3 looks, and no longer asks for a room mix', () => {
    expect(validateDelivery([goodLooks[0]], memberBrands).some((e) => e.includes('3'))).toBe(true)
    expect(validateDelivery(goodLooks, memberBrands).some((e) => e.includes('ROOM MIX'))).toBe(false)
  })
})

describe('formatting & helpers', () => {
  it('flags fast fashion regardless of case', () => {
    expect(isFastFashion('ZARA')).toBe(true)
    expect(isFastFashion('Sessùn')).toBe(false)
  })
  it('the work formality floor is a band per dress code', () => {
    expect(FORMALITY_FLOOR_BAND.suited_corporate).toBe('dressy')
    expect(FORMALITY_FLOOR_BAND.smart_unwritten).toBe('mid')
    expect(FORMALITY_FLOOR_BAND.creative).toBeNull()
  })
})
