import { describe, it, expect } from 'vitest'
import { parseQuery, hasMaterial, estimateItemFormality } from '@/lib/search-taxonomy'
import { rankPieces, facetCount } from '@/lib/browse-rank'

const ctx = (brandIds: string[] = [], words: string[] = [], needle = '') => ({ brandIds: new Set(brandIds), words, needle })

describe('parseQuery reads the way the Edit search does', () => {
  it('silk slip skirt is a SKIRT in SILK, with slip as a descriptor', () => {
    const p = parseQuery('silk slip skirt')
    expect(p.itemTypes).toEqual(['skirt'])
    expect(p.materials).toEqual(['silk'])
    expect(p.intentTerms).toContain('slip')
  })

  it('a plain slip is still a slip dress', () => {
    expect(parseQuery('slip').itemTypes).toEqual(['slip_dress'])
    expect(parseQuery('slip dress').itemTypes).toEqual(['slip_dress'])
  })

  it('midi dress is exactly the midi, not every dress', () => {
    expect(parseQuery('black midi dress').itemTypes).toEqual(['midi_dress'])
    expect(parseQuery('black midi dress').colourFamilies).toEqual(['black'])
  })

  it('finds J.Crew however she types it', () => {
    for (const q of ['j.crew', 'J.Crew', 'j crew', 'jcrew', 'j.crew skirt']) {
      expect(parseQuery(q, ['J.Crew', 'Dissh']).brand, q).toBe('J.Crew')
    }
    expect(parseQuery('isabel marant', ['Isabel Marant']).brand).toBe('Isabel Marant')
    expect(parseQuery('a dissh dress', ['J.Crew', 'Dissh']).brand).toBe('Dissh')
  })

  it('a wedding means formal, read through the question she actually asks', () => {
    const p = parseQuery('what should I wear to a wedding')
    expect(p.formalityRange).toEqual([3, 4])
    expect(p.occasionGroups).toEqual([['wedding']])
    expect(p.intentTerms).toEqual([])
    expect(parseQuery('black tie wedding').formalityRange).toEqual([4, 5])
    expect(parseQuery('black tie').formalityRange).toEqual([4, 5])
  })

  it('cloth families: silk is charmeuse too, never cotton', () => {
    expect(hasMaterial({ material_primary: 'silk charmeuse', product_name: 'Nerly skirt' }, 'silk')).toBe(true)
    expect(hasMaterial({ material_primary: null, product_name: 'Crepe de chine slip skirt' }, 'silk')).toBe(true)
    expect(hasMaterial({ material_primary: 'organic cotton', product_name: 'Aubrey skirt' }, 'silk')).toBe(false)
    expect(hasMaterial({ material_primary: 'calfskin', product_name: 'Belt' }, 'leather')).toBe(true)
  })
})

describe('rankPieces holds every facet as a requirement', () => {
  const silkSkirt = { item_id: 'a', product_name: 'Nerly silk skirt', item_type: 'skirt', material_primary: 'silk', brand_id: 'im', brand: { name: 'Isabel Marant' }, status: 'live' }
  const cottonSkirt = { item_id: 'b', product_name: 'Aubrey organic cotton skirt', item_type: 'skirt', material_primary: 'organic cotton', brand_id: 'mb', brand: { name: 'By Malene Birger' } }
  const silkBlouse = { item_id: 'c', product_name: 'Aster silk blouse', item_type: 'blouse', material_primary: 'silk', brand_id: 'z', brand: { name: 'Zimmermann' } }
  const silkSlipSkirt = { item_id: 'd', product_name: 'Bias slip skirt', item_type: 'skirt', material_primary: 'silk charmeuse', brand_id: 'v', brand: { name: 'Vince' } }
  const woolTrousers = { item_id: 'e', product_name: 'Brera trouser', item_type: 'trousers', material_primary: 'wool', brand_id: 'x', brand: { name: 'Toteme' } }

  it('silk slip skirt: silk skirts exactly, the slip first; cotton skirts only as similar', () => {
    const p = parseQuery('silk slip skirt')
    const r = rankPieces([silkSkirt, cottonSkirt, silkBlouse, silkSlipSkirt, woolTrousers], p, ctx([], ['silk', 'slip', 'skirt'], 'silk slip skirt'))
    expect(r.exact.map((s) => s.it.item_id)).toEqual(['d', 'a'])
    expect(r.similar.map((s) => s.it.item_id).sort()).toEqual(['b', 'c'])
  })

  it('a brand search is that brand only; other labels are not even similar', () => {
    const jcrew = { item_id: 'j1', product_name: 'Cashmere crewneck', item_type: 'knitwear', brand_id: 'jc', brand: { name: 'J.Crew' } }
    const dissh = { item_id: 'd1', product_name: 'Sloane crew long sleeve', item_type: 'knitwear', brand_id: 'ds', brand: { name: 'Dissh' } }
    const p = parseQuery('j.crew', ['J.Crew', 'Dissh'])
    expect(facetCount(p)).toBe(1)
    const r = rankPieces([dissh, jcrew], p, ctx(['jc'], ['crew'], 'j.crew'))
    expect(r.exact.map((s) => s.it.item_id)).toEqual(['j1'])
    expect(r.similar).toEqual([])
  })

  it('brand + piece must hold on the same piece', () => {
    const jBag = { item_id: 'j2', product_name: 'Leather tote', item_type: 'tote', brand_id: 'jc', brand: { name: 'J.Crew' } }
    const jSkirt = { item_id: 'j3', product_name: 'Pleated skirt', item_type: 'skirt', brand_id: 'jc', brand: { name: 'J.Crew' } }
    const otherSkirt = { item_id: 'o1', product_name: 'Pleated skirt', item_type: 'skirt', brand_id: 'ds', brand: { name: 'Dissh' } }
    const p = parseQuery('j.crew skirt', ['J.Crew', 'Dissh'])
    const r = rankPieces([jBag, jSkirt, otherSkirt], p, ctx(['jc'], ['crew', 'skirt'], 'j.crew skirt'))
    expect(r.exact.map((s) => s.it.item_id)).toEqual(['j3'])
    expect(r.similar.map((s) => s.it.item_id).sort()).toEqual(['j2', 'o1'])
  })

  it('a wedding answers with dressed-up pieces, dresses first; a t-shirt never', () => {
    const gown = { item_id: 'g', product_name: 'Silk gown', item_type: 'maxi_dress', material_formality: 4 }
    const heel = { item_id: 'h', product_name: 'Satin heel', item_type: 'heel', material_formality: 4 }
    const tee = { item_id: 't', product_name: 'Jersey tee', item_type: 't-shirt', material_formality: 1 }
    const jeans = { item_id: 'je', product_name: 'Wide leg jeans', item_type: 'jeans', material_formality: 1 }
    expect(estimateItemFormality(tee)).toBeLessThan(2)
    const p = parseQuery('what to wear to a wedding')
    const r = rankPieces([tee, heel, jeans, gown], p, ctx())
    expect(r.exact.map((s) => s.it.item_id)).toEqual(['g', 'h'])
    expect(r.similar).toEqual([])
  })

  it('black dress: a yellow dress and a black bag are similar, never exact', () => {
    const black = { item_id: 'b1', product_name: 'Column dress', item_type: 'midi_dress', colour_family: 'black' }
    const yellow = { item_id: 'y1', product_name: 'Sun dress', item_type: 'midi_dress', colour_family: 'yellow' }
    const bag = { item_id: 'bg', product_name: 'Clutch', item_type: 'clutch', colour_family: 'black' }
    const p = parseQuery('black dress')
    const r = rankPieces([yellow, bag, black], p, ctx([], ['black', 'dress'], 'black dress'))
    expect(r.exact.map((s) => s.it.item_id)).toEqual(['b1'])
    expect(r.similar.map((s) => s.it.item_id).sort()).toEqual(['bg', 'y1'])
  })

  it('an unknown name falls back to the words themselves', () => {
    const a = { item_id: 'a', product_name: 'Brera trouser', item_type: 'trousers' }
    const b = { item_id: 'b', product_name: 'Brera coat', item_type: 'coat' }
    const c = { item_id: 'c', product_name: 'Nerly skirt', item_type: 'skirt' }
    const p = parseQuery('brera')
    expect(facetCount(p)).toBe(0)
    const r = rankPieces([a, b, c], p, ctx([], ['brera'], 'brera'))
    expect(r.exact.map((s) => s.it.item_id).sort()).toEqual(['a', 'b'])
    expect(r.similar).toEqual([])
  })
})
