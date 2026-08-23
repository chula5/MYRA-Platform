import { describe, it, expect } from 'vitest'
import { slugColourway } from '@/lib/brand-watch'

// Real handle/title pairs from the catalogues this was built against.
describe('slugColourway', () => {
  it('reads the colourway a quiet feed only puts in the URL', () => {
    expect(slugColourway('maeve-long-sleeve-top-vintage-white', 'MAEVE LONG SLEEVE TOP')).toBe('vintage white')
    expect(slugColourway('lara-jumper-butter-cream', 'LARA JUMPER')).toBe('butter cream')
    expect(slugColourway('ma0368fcd3d02e23sd-djila-coat-sand', 'Djila Coat')).toBe('sand')
  })

  it('survives a handle carrying words the title leaves out', () => {
    // THE POSSE titles this "EMMA BUTTON DOWN DRESS" but slugs in a "mini" —
    // a plain prefix test misses a colour sitting in plain sight.
    expect(slugColourway('emma-button-down-mini-dress-black', 'EMMA BUTTON DOWN DRESS')).toBe('black')
    expect(slugColourway('bea-ls-top-cream-black-polka-dot', 'BEA LONG SLEEVE TOP')).toBe('cream black polka dot')
  })

  it('never reads a product name as a colour', () => {
    // OLIVIA is not olive and ROSIE is not rose: only what follows the title
    // counts, so a name can't colour the piece.
    expect(slugColourway('olivia-dress', 'OLIVIA DRESS')).toBe('')
    expect(slugColourway('rosie-tie-top', 'ROSIE TIE TOP')).toBe('')
    expect(slugColourway('furlana-velvet-bottiglia', 'FURLANA VELVET - BOTTIGLIA')).toBe('')
  })

  it('gives nothing when the handle and title share no ground', () => {
    expect(slugColourway('', 'MAEVE TOP')).toBe('')
    expect(slugColourway('some-other-thing', '')).toBe('')
    expect(slugColourway('p12345-xyz', 'MAEVE TOP')).toBe('')
  })
})
