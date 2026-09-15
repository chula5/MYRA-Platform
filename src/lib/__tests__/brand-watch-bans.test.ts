import { describe, it, expect } from 'vitest'
import { houseBanOf } from '../brand-watch-bans'

describe('houseBanOf — pieces that never go on the site', () => {
  it('bans fuchsia and hot pink by name or by the feed colour', () => {
    expect(houseBanOf({ title: 'Fuchsia Silk Blouse' })).toBe('fuchsia / hot pink')
    expect(houseBanOf({ title: 'Wrap Dress', optionColours: ['Magenta'] })).toBe('fuchsia / hot pink')
    expect(houseBanOf({ title: 'Shocking Pink Knit' })).toBe('fuchsia / hot pink')
  })

  it('bans clearly performance sportswear', () => {
    expect(houseBanOf({ title: 'Kallin Running Short 1.5' })).toBe('sportswear')
    expect(houseBanOf({ title: 'Seamless Top', productType: 'Sports Bra' })).toBe('sportswear')
    expect(houseBanOf({ title: 'ReLoved - MMYoga Biker / 27', itemType: 'jeans' })).toBe('sportswear')
    expect(houseBanOf({ title: 'Always Warm Base Layer Legging', itemType: 'trousers' })).toBe('sportswear')
  })

  it('never bans what Chloe has kept', () => {
    for (const title of [
      'Wide-Leg Track Pant', 'Relaxed Track Pant', 'Polly capri leggings', 'Pollyna athletic skirt',
      'Leopard Print Ballet Flat', 'black Salsa petticoat skirt in cotton satin with polka dots',
      'Semi-sheer A-line skirt with leggings',
    ]) expect(houseBanOf({ title })).toBeNull()
  })

  it('never bans a trainer', () => {
    expect(houseBanOf({ title: 'Aleone Running Shoe', itemType: 'sneaker' })).toBeNull()
  })

  it('lets ordinary pieces through', () => {
    expect(houseBanOf({ title: 'Cotton Poplin Shirt', optionColours: ['Cream'], itemType: 'shirt' })).toBeNull()
    expect(houseBanOf({ title: 'Wide Leg Trouser', productType: 'Trousers', optionColours: ['Pink'] })).toBeNull()
    expect(houseBanOf({ title: null })).toBeNull()
  })
})
