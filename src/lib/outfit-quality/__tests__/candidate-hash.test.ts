import { describe, it, expect } from 'vitest'
import { compositionHash, type CompositionItemRef } from '@/lib/outfit-quality/candidate-hash'

const BASE = {
  snapshotHash: 'snap-hash-1',
  context: { real_member_id: 'm1', style_families: ['scandi'] },
  systemVersions: { composer_version: 'pilot-composer-v1' },
}

function ref(slot: string, item_id: string, sort_order: number): CompositionItemRef {
  return { slot, item_id, sort_order, source_image_version: 'v1', source_image_hash: null }
}

describe('compositionHash — determinism', () => {
  it('hashes identically regardless of input array order (same ordered tuples)', () => {
    const items = [ref('top', 'item-a', 0), ref('bottom', 'item-b', 1), ref('jewellery', 'item-c', 2), ref('jewellery', 'item-d', 3)]
    const shuffled = [items[3], items[1], items[0], items[2]]
    expect(compositionHash({ ...BASE, items })).toBe(compositionHash({ ...BASE, items: shuffled }))
    expect(compositionHash({ ...BASE, items })).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('compositionHash — ordered tuple sequence is part of the identity', () => {
  it('a deliberate reorder inside a multi-item slot produces a DIFFERENT hash', () => {
    const original = [ref('top', 'item-a', 0), ref('jewellery', 'item-c', 1), ref('jewellery', 'item-d', 2)]
    const reordered = [ref('top', 'item-a', 0), ref('jewellery', 'item-d', 1), ref('jewellery', 'item-c', 2)]
    expect(compositionHash({ ...BASE, items: original })).not.toBe(compositionHash({ ...BASE, items: reordered }))
  })

  it('re-sorting the whole outfit (same items, new sort orders) produces a different hash', () => {
    const original = [ref('top', 'item-a', 0), ref('bottom', 'item-b', 1)]
    const resequenced = [ref('top', 'item-a', 1), ref('bottom', 'item-b', 0)]
    expect(compositionHash({ ...BASE, items: original })).not.toBe(compositionHash({ ...BASE, items: resequenced }))
  })

  it('changing membership, slot, or source reference still changes the hash', () => {
    const original = [ref('top', 'item-a', 0), ref('bottom', 'item-b', 1)]
    const newItem = [ref('top', 'item-a', 0), ref('bottom', 'item-x', 1)]
    const newSlot = [ref('top', 'item-a', 0), ref('dress', 'item-b', 1)]
    const newSource = [{ ...ref('top', 'item-a', 0), source_image_version: 'v2' }, ref('bottom', 'item-b', 1)]
    const h = compositionHash({ ...BASE, items: original })
    expect(compositionHash({ ...BASE, items: newItem })).not.toBe(h)
    expect(compositionHash({ ...BASE, items: newSlot })).not.toBe(h)
    expect(compositionHash({ ...BASE, items: newSource })).not.toBe(h)
  })

  it('changing the snapshot hash or context changes the composition hash', () => {
    const items = [ref('top', 'item-a', 0)]
    const h = compositionHash({ ...BASE, items })
    expect(compositionHash({ ...BASE, snapshotHash: 'snap-hash-2', items })).not.toBe(h)
    expect(compositionHash({ ...BASE, context: { real_member_id: 'm2' }, items })).not.toBe(h)
  })
})
