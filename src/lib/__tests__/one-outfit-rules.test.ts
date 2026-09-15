import { describe, it, expect } from 'vitest'
import { evaluateHouseStyle, type HouseItem } from '@/lib/house-style'
import { judgeLook, rulesForMember } from '@/lib/style-rules'
import { classifyExternalProduct } from '@/lib/brand-watch'

// Rules about whether the pieces make ONE outfit — global, for every client
// and Chloe's Composer (2026-09-15, from Alison's looks).

const piece = (over: Partial<HouseItem> & { item_id: string; slot: string }): HouseItem => ({
  item_type: 'blouse', product_name: 'Piece', brand_name: 'Brand', colour_family: 'black',
  ...over,
})
const codes = (items: HouseItem[]) => evaluateHouseStyle(items).violations.map((v) => v.code)

describe('a sleeveless layer on a sleeveless piece', () => {
  it('catches a waistcoat-style gilet over a sleeveless maxi dress', () => {
    const look = [
      piece({ item_id: 'd', slot: 'dress', item_type: 'maxi_dress', product_name: 'Cotton Gauze Tiered Maxi Dress', sleeve: 1 }),
      piece({ item_id: 'g', slot: 'outerwear', item_type: 'gilet', product_name: 'Sheepskin Gilet' }),
    ]
    expect(codes(look)).toContain('layer.same_shape')
  })

  it('reads sleeveless from the name when the sleeve is not scored', () => {
    const look = [
      piece({ item_id: 't', slot: 'top', product_name: 'Linen Tank Top' }),
      piece({ item_id: 'g', slot: 'outerwear', item_type: 'gilet', product_name: 'Kestrel Sherpa Gilet' }),
    ]
    expect(codes(look)).toContain('layer.same_shape')
  })

  it('lets a gilet over sleeves through', () => {
    const look = [
      piece({ item_id: 's', slot: 'top', item_type: 'shirt', product_name: 'Poplin Shirt', sleeve: 5 }),
      piece({ item_id: 'g', slot: 'outerwear', item_type: 'gilet', product_name: 'Padded Gilet' }),
    ]
    expect(codes(look)).not.toContain('layer.same_shape')
  })

  it('lets a coat over a sleeveless dress through', () => {
    const look = [
      piece({ item_id: 'd', slot: 'dress', item_type: 'maxi_dress', product_name: 'Maxi Dress', sleeve: 1 }),
      piece({ item_id: 'c', slot: 'outerwear', item_type: 'coat', product_name: 'Philippa Peacoat', sleeve: 5 }),
    ]
    expect(codes(look)).not.toContain('layer.same_shape')
  })
})

describe('co-ords', () => {
  it('catches half of a set worn with other trousers', () => {
    const look = [
      piece({ item_id: 's', slot: 'top', item_type: 'shirt', product_name: 'Summer Shirt Co-ord', brand_name: 'ME+EM' }),
      piece({ item_id: 'p', slot: 'bottom', item_type: 'trousers', product_name: 'Johanna Pants - Navy', brand_name: 'Skall Studio' }),
    ]
    expect(codes(look)).toContain('set.coord_mismatch')
  })

  it('lets a set be worn with its own other half', () => {
    const look = [
      piece({ item_id: 's', slot: 'top', item_type: 'shirt', product_name: 'Summer Shirt Co-ord', brand_name: 'ME+EM' }),
      piece({ item_id: 'p', slot: 'bottom', item_type: 'trousers', product_name: 'Summer Stripe Co-ord', brand_name: 'ME+EM' }),
    ]
    expect(codes(look)).not.toContain('set.coord_mismatch')
  })

  it('does not match a set across brands', () => {
    const look = [
      piece({ item_id: 's', slot: 'top', item_type: 'shirt', product_name: 'Summer Shirt Co-ord', brand_name: 'ME+EM' }),
      piece({ item_id: 'p', slot: 'bottom', item_type: 'trousers', product_name: 'Summer Trouser Co-ord', brand_name: 'Other' }),
    ]
    expect(codes(look)).toContain('set.coord_mismatch')
  })
})

describe('both rules hold for every client', () => {
  it('blocks the look whatever her house style', () => {
    const rules = rulesForMember(null, false)
    expect(rules.codes.has('layer.same_shape')).toBe(true)
    expect(rules.codes.has('set.coord_mismatch')).toBe(true)
    const look = [
      piece({ item_id: 's', slot: 'top', item_type: 'shirt', product_name: 'Summer Shirt Co-ord', brand_name: 'ME+EM' }),
      piece({ item_id: 'p', slot: 'bottom', item_type: 'trousers', product_name: 'Johanna Pants', brand_name: 'Skall Studio' }),
    ]
    expect(judgeLook(look, rules).blocked).toBe(true)
  })
})

describe('waistcoats are tops, not layers', () => {
  const typeOf = (title: string) => classifyExternalProduct({
    url: 'https://shop.example/products/x', title, brand: 'Brand', description: '', category: '',
    price: 100, currency: 'GBP', images: ['https://x/i.jpg'], available: true,
  } as any).itemType

  it('files a waistcoat as a top', () => {
    expect(typeOf('Clementine Waistcoat - Natural')).toBe('blouse')
    expect(typeOf('Merino Lambswool Birdseye Waistcoat')).toBe('knitwear')
    expect(typeOf('Knitted Button Down Vest')).toBe('knitwear')
  })

  it('keeps warm and padded gilets as layers', () => {
    expect(typeOf('Chiara Padded Gilet')).toBe('gilet')
    expect(typeOf('Kestrel Sherpa Gilet')).toBe('gilet')
  })

  it('reads French knit names as knitwear, and pull-on trousers as trousers', () => {
    expect(typeOf('pull Ab en cachemire bleu')).toBe('knitwear')
    expect(typeOf('gilet Nacre en jersey de coton rayé blanc et noir')).toBe('knitwear')
    expect(typeOf('Pull-On Wide Leg Trousers')).toBe('trousers')
  })
})
