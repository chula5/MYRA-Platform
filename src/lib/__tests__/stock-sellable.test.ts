import { describe, it, expect } from 'vitest'
import { sellable, unknownStrike, UNKNOWN_STRIKES_REQUIRED } from '../stock-sellable'

describe('sellable — can MYRA vouch that it can be bought?', () => {
  it('sells what is in stock or low, and what has not been checked yet', () => {
    expect(sellable({ stock_status: 'in_stock' })).toBe(true)
    expect(sellable({ stock_status: 'low_stock' })).toBe(true)
    expect(sellable({ stock_status: null })).toBe(true)
    expect(sellable({})).toBe(true)
  })
  it('never sells what is out of stock or unverifiable', () => {
    expect(sellable({ stock_status: 'out_of_stock' })).toBe(false)
    expect(sellable({ stock_status: 'unknown' })).toBe(false)
  })
})

describe('unknownStrike — a blip is nothing, two days unsellable, a week dead', () => {
  const day = 86_400_000
  const now = new Date('2026-09-26T12:00:00Z')
  const ago = (ms: number) => new Date(now.getTime() - ms).toISOString()

  it('a first unreadable reading is one strike and changes nothing', () => {
    expect(unknownStrike({ oos_strikes: 0, stock_checked_at: ago(2 * day) }, now)).toEqual({ strikes: 1, unsellable: false, dead: false })
  })
  it('a second daily failure makes the piece unsellable', () => {
    expect(unknownStrike({ oos_strikes: 1, stock_checked_at: ago(day) }, now)).toEqual({ strikes: 2, unsellable: true, dead: false })
  })
  it('does not count half-hourly retries twice', () => {
    expect(unknownStrike({ oos_strikes: 1, stock_checked_at: ago(30 * 60_000) }, now)).toEqual({ strikes: 1, unsellable: false, dead: false })
  })
  it('is dead on the seventh', () => {
    const r = unknownStrike({ oos_strikes: UNKNOWN_STRIKES_REQUIRED - 1, stock_checked_at: ago(day) }, now)
    expect(r).toEqual({ strikes: UNKNOWN_STRIKES_REQUIRED, unsellable: true, dead: true })
  })
})
