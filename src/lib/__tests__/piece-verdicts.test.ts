import { describe, it, expect } from 'vitest'
import { pieceVerdicts } from '../piece-verdicts'

const at = (m: number) => new Date(Date.UTC(2026, 8, 1, 12, m)).toISOString()

describe('pieceVerdicts — the most recent answer wins', () => {
  it('the Ivory 13 18 sneaker: kept twice, swapped out, then kept again → kept', () => {
    const v = pieceVerdicts([
      { action: 'accept', item_in: 'sneaker', created_at: at(1) },
      { action: 'accept', item_in: 'sneaker', created_at: at(2) },
      { action: 'swap', item_in: 'other', item_out: 'sneaker', created_at: at(10) },
      { action: 'accept', item_in: 'sneaker', created_at: at(11) },
    ])
    expect(v.kept.has('sneaker')).toBe(true)
    expect(v.rejected.has('sneaker')).toBe(false)
    expect(v.rejectedCounts.get('sneaker')).toBe(1)
    expect(v.keptCounts.get('sneaker')).toBe(3)
  })

  it('kept, then removed later → rejected', () => {
    const v = pieceVerdicts([
      { action: 'accept', item_in: 'coat', created_at: at(1) },
      { action: 'remove', item_out: 'coat', created_at: at(5) },
    ])
    expect(v.rejected.has('coat')).toBe(true)
    expect(v.kept.has('coat')).toBe(false)
  })

  it('reads old skip rows that stored the removed piece as item_in', () => {
    const v = pieceVerdicts([{ action: 'remove', item_in: 'skirt', created_at: at(1) }])
    expect(v.rejected.has('skirt')).toBe(true)
  })

  it('orders by time, not by the order rows arrive in', () => {
    const v = pieceVerdicts([
      { action: 'accept', item_in: 'bag', created_at: at(9) },
      { action: 'remove', item_out: 'bag', created_at: at(1) },
    ])
    expect(v.kept.has('bag')).toBe(true)
  })

  it('the piece swapped IN is neither kept nor rejected by the swap alone', () => {
    const v = pieceVerdicts([{ action: 'swap', item_in: 'new', item_out: 'old', created_at: at(1) }])
    expect(v.rejected.has('old')).toBe(true)
    expect(v.kept.has('new')).toBe(false)
    expect(v.rejected.has('new')).toBe(false)
  })
})
