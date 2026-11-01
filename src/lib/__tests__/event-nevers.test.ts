import { describe, it, expect } from 'vitest'
import { brandKey, describeNevers, neverReason, pictureLeans, readNevers } from '../events/nevers'

const BRANDS = ['Rixo', 'ME+EM', 'Me', 'Joseph', 'Victoria Beckham']

describe('readNevers', () => {
  it('reads a price, brands and fussy from her words', () => {
    const n = readNevers({ nevers: 'Nothing fussy, not mother of the bride. No more than £600 on a dress. Not Rixo or me and em.' }, BRANDS)
    expect(n.maxPrice).toBe(600)
    expect(n.brands.sort()).toEqual(['meandem', 'rixo'])
    expect(n.noFussy).toBe(true)
  })
  it('prefers the price field and adds listed brands', () => {
    const n = readNevers({ nevers: '', max_price_gbp: '450', never_brands: ['ME+EM'] }, BRANDS)
    expect(n.maxPrice).toBe(450)
    expect(n.brands).toEqual(['meandem'])
    expect(n.noFussy).toBe(false)
  })
  it('keys brands however they are typed', () => {
    expect(brandKey('Me & Em')).toBe(brandKey('ME+EM'))
  })
})

describe('neverReason', () => {
  const n = readNevers({ nevers: 'nothing fussy, under £600, not Rixo' }, BRANDS)
  it('holds price, brand and fuss', () => {
    expect(neverReason({ product_name: 'Satin maxi', brand: { name: 'Joseph' } }, 875, n)).toBe('over £600')
    expect(neverReason({ product_name: 'Satin midi', brand: { name: 'RIXO' } }, 300, n)).toMatch(/brand/)
    expect(neverReason({ product_name: 'Embellished off-shoulder midi', brand: { name: 'Joseph' } }, 300, n)).toBe('too fussy')
    expect(neverReason({ product_name: 'Gathered satin midi', brand: { name: 'Joseph' } }, 300, n)).toBeNull()
  })
  it('says itself back', () => {
    expect(describeNevers(n, BRANDS)).toBe('up to £600 · not Rixo · nothing fussy')
  })
})

describe('pictureLeans', () => {
  it('z-scores and clamps', () => {
    const z = pictureLeans([0.9, 0.95, 1])
    expect(z[0]).toBeLessThan(0); expect(z[2]).toBeGreaterThan(0)
    expect(pictureLeans([0.9])).toEqual([0])
  })
})
