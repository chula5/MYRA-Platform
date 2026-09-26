import { describe, it, expect } from 'vitest'
import { neverCandidates, materialWords, nameWords, cleanWord } from '../never-words'
import { pieceText } from '../stylist-brief'

const cuff = { product_name: 'Marbled resin cuff bracelet', item_type: 'bracelet', colour_family: 'cream', brand_name: 'Sessùn', material_primary: 'Resin' }

describe('never-words — what a NO can become', () => {
  it('splits a material into words', () => {
    expect(materialWords('Gold, Black Marble')).toEqual(['gold', 'black', 'marble'])
    expect(materialWords('Gold and Black Onyx or Marble')).toEqual(['gold', 'black', 'onyx', 'marble'])
    expect(materialWords(null)).toEqual([])
  })

  it('keeps the telling words of a name and drops the noise', () => {
    expect(nameWords('EXCLUSIVE: Pheo Voile organic cotton maxi skirt', new Set(['skirt']))).toEqual(['pheo', 'voile', 'organic', 'cotton'])
    expect(nameWords('2-in-1 Drop Earrings', new Set(['earrings']))).toEqual(['drop'])
  })

  it('offers type, colour, brand, material and name words — no word twice', () => {
    const c = neverCandidates(cuff)
    expect(c.map((x) => `${x.attr}:${x.word}`)).toEqual([
      'item_type:bracelet', 'colour_family:cream', 'brand:sessùn', 'material:resin', 'word:marbled', 'word:cuff',
    ])
  })

  it('every offered word actually matches the piece it came from', () => {
    const text = pieceText(cuff)
    for (const c of neverCandidates(cuff)) expect(text.includes(c.word)).toBe(true)
  })

  it('cleans a word of her own the way pieceText writes it', () => {
    expect(cleanWord('  Marble! ')).toBe('marble')
    expect(cleanWord('structured_bag')).toBe('structured bag')
  })
})
