import { describe, it, expect } from 'vitest'
import { stockSignal } from '@/lib/studio/stock-label'

describe('stockSignal', () => {
  it('flags out of stock regardless of any stale size list', () => {
    expect(stockSignal('out_of_stock', null)).toEqual({ tone: 'out', text: 'OUT OF STOCK' })
    // A size list left over from an earlier check must not mask an OOS status.
    expect(stockSignal('out_of_stock', ['S', 'M', 'L'])).toEqual({ tone: 'out', text: 'OUT OF STOCK' })
  })

  it('calls out a single remaining size (the case that prompted this)', () => {
    expect(stockSignal('in_stock', ['L'])).toEqual({ tone: 'low', text: 'ONLY L' })
  })

  it('treats two remaining sizes as low', () => {
    expect(stockSignal('in_stock', ['S', 'M'])).toEqual({ tone: 'low', text: 'LOW · S·M' })
  })

  it('shows a healthy size run as ok', () => {
    expect(stockSignal('in_stock', ['S', 'M', 'L'])).toEqual({ tone: 'ok', text: 'S·M·L' })
  })

  it('respects a retailer low_stock flag even with many sizes', () => {
    expect(stockSignal('low_stock', ['S', 'M', 'L', 'XL'])).toEqual({ tone: 'low', text: 'LOW · S·M·L·XL' })
  })

  it('falls back to the coarse status when no sizes were captured', () => {
    expect(stockSignal('low_stock', null)).toEqual({ tone: 'low', text: 'LOW STOCK' })
    expect(stockSignal('in_stock', [])).toEqual({ tone: 'ok', text: 'IN STOCK' })
  })

  it('stays silent when stock was never checked', () => {
    expect(stockSignal(null, null)).toEqual({ tone: 'none', text: '' })
    expect(stockSignal('unknown', [])).toEqual({ tone: 'none', text: '' })
    expect(stockSignal(undefined, undefined)).toEqual({ tone: 'none', text: '' })
  })

  // Accessories in the real library carry "O/S" / "ONE SIZE" markers. Treating
  // those as "one size left" would flag every bag amber — a false alarm.
  it('does not treat one-size accessory markers as low stock', () => {
    expect(stockSignal('in_stock', ['O/S'])).toEqual({ tone: 'ok', text: 'IN STOCK' })
    expect(stockSignal('in_stock', ['ONE SIZE'])).toEqual({ tone: 'ok', text: 'IN STOCK' })
    expect(stockSignal('in_stock', ['OS'])).toEqual({ tone: 'ok', text: 'IN STOCK' })
    expect(stockSignal('in_stock', ['one-size'])).toEqual({ tone: 'ok', text: 'IN STOCK' })
    expect(stockSignal('in_stock', ['TU'])).toEqual({ tone: 'ok', text: 'IN STOCK' })
    // …but a genuinely low accessory still reports low via its status.
    expect(stockSignal('low_stock', ['O/S'])).toEqual({ tone: 'low', text: 'LOW STOCK' })
    // …and out of stock still wins.
    expect(stockSignal('out_of_stock', ['ONE SIZE'])).toEqual({ tone: 'out', text: 'OUT OF STOCK' })
  })

  it('keeps real numeric sizes (FR/IT sizing) as sizes', () => {
    expect(stockSignal('low_stock', ['34'])).toEqual({ tone: 'low', text: 'ONLY 34' })
    expect(stockSignal('in_stock', ['36', '38', '40'])).toEqual({ tone: 'ok', text: '36·38·40' })
  })

  it('ignores blank/whitespace entries in the size list', () => {
    expect(stockSignal('in_stock', ['', '  ', 'L'])).toEqual({ tone: 'low', text: 'ONLY L' })
    expect(stockSignal('in_stock', ['  ', ''])).toEqual({ tone: 'ok', text: 'IN STOCK' })
  })
})
