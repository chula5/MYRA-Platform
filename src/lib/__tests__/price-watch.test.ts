import { describe, expect, it } from 'vitest'
import { isDrop, poundsOf } from '@/lib/price-watch'
import { priceFromJsonLd, priceFromShopifyJs } from '@/lib/retailer-prices'
import { savedSearchMessage } from '@/lib/saved-search'

describe('WAIT FOR SALE', () => {
  it('a drop must be 5% and £3 under both the rung price and the lowest told', () => {
    expect(isDrop(95, 140, null)).toBe(true)
    expect(isDrop(138, 140, null)).toBe(false) // under 5%
    expect(isDrop(38, 40, null)).toBe(false) // 5% but under £3
    expect(isDrop(95, 140, 95)).toBe(false) // already told of £95
    expect(isDrop(80, 140, 95)).toBe(true) // a further drop tells again
    expect(isDrop(95, null, null)).toBe(false) // no price when rung: nothing to compare
  })

  it('reads a foreign price at the piece\'s own rate', () => {
    expect(poundsOf({ amount: 100, was: 200, currency: null }, { currency: 'GBP' })).toEqual({ now: 100, was: 200 })
    expect(poundsOf({ amount: 150, was: null, currency: 'USD' }, { price: '300', currency: 'USD', price_gbp: 240 })).toEqual({ now: 120, was: null })
    // A different currency from the stored one, named by the page: the house rate.
    expect(poundsOf({ amount: 100, was: null, currency: 'EUR' }, { price: '300', currency: 'USD', price_gbp: 240 })).toEqual({ now: 85.7, was: null })
    expect(poundsOf({ amount: 100, was: null, currency: 'XYZ' }, { currency: null })).toBeNull()
    expect(poundsOf({ amount: 248, was: null, currency: null }, { currency: null })).toBeNull()
  })

  it('reads Shopify .js in minor units with compare_at', () => {
    const r = priceFromShopifyJs({ variants: [
      { available: true, price: 9500, compare_at_price: 14000 },
      { available: false, price: 5000, compare_at_price: null },
    ] })
    expect(r).toEqual({ amount: 95, was: 140, currency: null })
  })

  it('reads the lowest live JSON-LD offer', () => {
    const html = `<script type="application/ld+json">${JSON.stringify({
      '@type': 'Product',
      offers: [
        { '@type': 'Offer', price: '120.00', priceCurrency: 'gbp', availability: 'https://schema.org/InStock' },
        { '@type': 'Offer', price: '60.00', priceCurrency: 'gbp', availability: 'https://schema.org/OutOfStock' },
      ],
    })}</script>`
    expect(priceFromJsonLd(html)).toEqual({ amount: 120, was: null, currency: 'GBP' })
    expect(priceFromJsonLd('<p>no data</p>')).toBeNull()
  })
})

describe('SAVED SEARCHES note', () => {
  it('says nothing when nothing is new, and names the busiest searches', () => {
    expect(savedSearchMessage([{ query: 'navy cami top', fresh: 0 }])).toBeNull()
    expect(savedSearchMessage([{ query: 'navy cami top', fresh: 3 }])?.body).toBe('3 new pieces for "navy cami top".')
    expect(savedSearchMessage([
      { query: 'a', fresh: 1 }, { query: 'b', fresh: 4 }, { query: 'c', fresh: 2 },
    ])?.body).toBe('4 new pieces for "b", 2 for "c" and 1 more of your searches.')
  })
})
