import { describe, it, expect } from 'vitest'
import { anchorOf, itemsSignature } from '@/lib/outfit-quality/scope-signature'

describe('scope signature', () => {
  it('is order-independent', () => {
    expect(itemsSignature(['b', 'a', 'c'])).toBe('a|b|c')
    expect(itemsSignature(['c', 'b', 'a'])).toBe(itemsSignature(['a', 'b', 'c']))
  })
  it('picks the lead garment: dress, else top, else bottom, by sort order', () => {
    expect(anchorOf([{ item_id: 's', slot: 'shoe', sort_order: 0 }, { item_id: 'b', slot: 'bottom', sort_order: 2 }, { item_id: 't', slot: 'top', sort_order: 1 }])).toBe('t')
    expect(anchorOf([{ item_id: 'd', slot: 'dress', sort_order: 5 }, { item_id: 't', slot: 'top', sort_order: 0 }])).toBe('d')
    expect(anchorOf([{ item_id: 's', slot: 'shoe', sort_order: 0 }])).toBeNull()
  })
})
