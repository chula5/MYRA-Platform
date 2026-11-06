import { describe, expect, it } from 'vitest'
import { percentOff, saleStats, isBrandOnSale, saleLine, inBlackFriday } from '@/lib/sales/detect'
import { brandSaleMessage, headsUpMessage, roundupMessage } from '@/lib/sales/notes'

describe('BLACK FRIDAY — is it on sale?', () => {
  it('a piece is marked down only when the shop says so, by 4% or more', () => {
    expect(percentOff(105, 150)).toBe(30)
    expect(percentOff(148, 150)).toBeNull()
    expect(percentOff(150, null)).toBeNull()
  })

  it('a brand is on sale with 3+ pieces and 5% of its catalogue, or 15 pieces', () => {
    expect(isBrandOnSale({ onSale: 2, total: 10 })).toBe(false)
    expect(isBrandOnSale({ onSale: 3, total: 50 })).toBe(true)
    expect(isBrandOnSale({ onSale: 6, total: 445 })).toBe(false)
    expect(isBrandOnSale({ onSale: 41, total: 445 })).toBe(true)
  })

  it('reads depth from the pieces', () => {
    const s = saleStats([{ now: 105, was: 150 }, { now: 50, was: 100 }, { now: 90, was: null }])
    expect(s).toEqual({ onSale: 2, total: 3, maxOff: 50, medianOff: 50 })
    expect(saleLine(50)).toBe('UP TO 50% OFF')
    expect(saleLine(null)).toBe('ON SALE')
  })

  it('the Black Friday weeks start early', () => {
    expect(inBlackFriday(new Date('2026-11-06T12:00:00Z'))).toBe(false)
    expect(inBlackFriday(new Date('2026-11-12T12:00:00Z'))).toBe(true)
    expect(inBlackFriday(new Date('2026-12-05T12:00:00Z'))).toBe(false)
  })

  it('says it plainly', () => {
    expect(brandSaleMessage({ brand_id: 'x', name: 'ME+EM', line: 'UP TO 30% OFF', count: 6, named: true, started_at: null }))
      .toBe('ME+EM is on sale — 6 pieces in your size, up to 30% off.')
    expect(headsUpMessage([{ slot: 'outerwear', owned: 1, target: 3, deficit: 2 }, { slot: 'shoe', owned: 2, target: 5, deficit: 3 }]))
      .toContain('Your wardrobe is short of a coat and shoes.')
    expect(headsUpMessage([])).not.toContain('short of')
    expect(roundupMessage(['A', 'B', 'C', 'D'].map((n) => ({ brand_id: n, name: n, line: 'ON SALE', count: 1, named: true, started_at: null }))))
      .toBe('Also on sale today: A, B, C and 1 more. Your picks are waiting in For You.')
  })
})

import { parseQuery } from '@/lib/search-taxonomy'
import { keepFromView, whyLine, instantMessage } from '@/lib/saved-search'

describe('SAVED SEARCHES, built out', () => {
  it('"midi" beside a skirt is its length, alone it is a dress', () => {
    expect(parseQuery('sequin embellished midi pencil skirt').itemTypes).toEqual(['skirt'])
    expect(parseQuery('midi').itemTypes).toEqual(['midi_dress'])
    expect(parseQuery('black maxi dress').itemTypes).toContain('maxi_dress')
  })

  it('says why in her words', () => {
    expect(whyLine(['DRIES VAN NOTEN', 'SNEAKER'], true)).toBe('DRIES VAN NOTEN · TRAINERS · YOUR SIZE')
  })

  it('keeps the closest kind, named as close, when a long ask has almost no answers', () => {
    const p = (id: string) => ({ item_id: id, product_name: id, brand: null, image_url: null, price_gbp: null, url: null })
    const kept = keepFromView({ pieces: [], similar: [p('a'), p('b'), p('c')], similarKind: 'close', similarGroups: [{ title: 'SEQUIN SKIRTS', ids: ['a', 'b'] }], read: ['SEQUIN'] }, true)
    expect(kept.map((k) => k.piece.item_id)).toEqual(['a', 'b'])
    expect(kept[0].why).toBe('CLOSE · SEQUIN SKIRTS · YOUR SIZE')
    const plenty = keepFromView({ pieces: [p('x'), p('y'), p('z')], similar: [p('a')], similarKind: 'close', similarGroups: [{ title: 'T', ids: ['a'] }], read: [] }, false)
    expect(plenty.length).toBe(3)
  })

  it('tells a strong find plainly', () => {
    expect(instantMessage('trainers', [{ item_id: '1', product_name: 'Leather sneakers', brand: 'Dries Van Noten', image_url: null, price_gbp: 470, url: null }])?.body)
      .toBe('Dries Van Noten Leather sneakers, £470.')
  })
})
