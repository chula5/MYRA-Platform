import { describe, it, expect } from 'vitest'
import { parseBrief, briefPull, briefBlocks, paletteFamily } from '../stylist-brief'

const brief = parseBrief({
  brands: ['Vanessa Bruno', 'Toteme'],
  signature_pieces: ['wide-leg trouser'],
  fabrics: ['wool'],
  palette: ['oatmeal', 'soft sage', 'black'],
  nevers: [
    { kind: 'ban', text: 'No denim', match: ['denim', 'jean'] },
    { kind: 'preference', text: 'No neon', match: ['neon'] },
  ],
}, 'Test')

describe('briefPull — what a stylist reaches for', () => {
  it('reads the brand through the brand table\'s spelling', () => {
    expect(briefPull({ brand_name: 'Vanessabruno' }, brief)).toBe(2)
    expect(briefPull({ brand_name: 'ME+EM' }, brief)).toBe(0)
  })
  it('reads the palette onto the library\'s colour families', () => {
    expect(paletteFamily('oatmeal')).toBe('cream')
    expect(paletteFamily('soft sage')).toBe('green')
    expect(paletteFamily('camel')).toBe('camel')
    expect(briefPull({ colour_family: 'cream' }, brief)).toBeCloseTo(0.75)
    expect(briefPull({ colour_family: 'red' }, brief)).toBe(0)
  })
  it('signature pieces and fabrics lift; a preference-never lowers', () => {
    expect(briefPull({ product_name: 'Wide-leg trouser', material_primary: 'Wool' }, brief)).toBeCloseTo(1.5)
    expect(briefPull({ product_name: 'Neon vest' }, brief)).toBe(-1)
  })
  it('is nothing without a brief', () => {
    expect(briefPull({ brand_name: 'Toteme' }, null)).toBe(0)
  })
})

describe('briefBlocks — a ban keeps the piece out of the shortlist', () => {
  it('blocks the piece itself, not only a look containing it', () => {
    expect(briefBlocks({ item_type: 'jeans' }, brief)).toBe(true)
    expect(briefBlocks({ item_type: 'trousers' }, brief)).toBe(false)
    expect(briefBlocks({ product_name: 'Neon vest' }, brief)).toBe(false) // a preference is not a ban
    expect(briefBlocks({ item_type: 'jeans' }, null)).toBe(false)
  })
})
