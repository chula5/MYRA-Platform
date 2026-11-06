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
