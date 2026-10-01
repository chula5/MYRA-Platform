import { describe, it, expect } from 'vitest'
import {
  runObjectiveChecks,
  checkStructure,
  checkMembership,
  checkSourceImages,
  checkRequiredItemData,
  checkSize,
  checkStock,
  type ObjectiveManifest,
  type ObjectiveEvidence,
} from '@/lib/outfit-quality/objective-checks'

function manifest(overrides: Partial<ObjectiveManifest> = {}): ObjectiveManifest {
  return {
    requiredSlots: ['top', 'bottom', 'shoe'],
    items: [
      { item_id: 'i-top', slot: 'top', source_image_url: 'https://cdn/t.jpg', item_snapshot: { item_type: 'shirt', brand: 'Arket' } },
      { item_id: 'i-bot', slot: 'bottom', source_image_url: 'https://cdn/b.jpg', item_snapshot: { item_type: 'trousers', brand: 'Toteme' } },
      { item_id: 'i-shoe', slot: 'shoe', source_image_url: 'https://cdn/s.jpg', item_snapshot: { item_type: 'flat', brand: 'The Row' } },
    ],
    ...overrides,
  }
}

function goodEvidence(): ObjectiveEvidence {
  return {
    size: { 'i-top': 'in_size', 'i-bot': 'in_size', 'i-shoe': 'in_size' },
    stock: { 'i-top': true, 'i-bot': true, 'i-shoe': true },
  }
}

describe('runObjectiveChecks — all pass', () => {
  it('passes when every rule passes', () => {
    const r = runObjectiveChecks(manifest(), goodEvidence())
    expect(r.passed).toBe(true)
    expect(r.status).toBe('passed')
    expect(r.outcomes).toHaveLength(6)
    expect(r.outcomes.every((o) => o.status === 'passed')).toBe(true)
  })
})

describe('structure / slots', () => {
  it('fails an empty outfit', () => {
    expect(checkStructure(manifest({ items: [] })).status).toBe('failed')
  })
  it('fails when a required slot is missing', () => {
    const m = manifest({ items: manifest().items.filter((i) => i.slot !== 'shoe') })
    const o = checkStructure(m)
    expect(o.status).toBe('failed')
    expect((o.detail as any).missing_slots).toContain('shoe')
  })
})

describe('duplicate membership / slot cardinality', () => {
  it('fails on a duplicate item id', () => {
    const items = manifest().items
    const o = checkMembership(manifest({ items: [...items, items[0]] }))
    expect(o.status).toBe('failed')
  })
  it('fails two items in a single-item slot', () => {
    const items = manifest().items.concat({ item_id: 'i-bot2', slot: 'bottom', source_image_url: 'https://cdn/b2.jpg', item_snapshot: { item_type: 'skirt', brand: 'X' } })
    expect(checkMembership(manifest({ items })).status).toBe('failed')
  })
  it('allows multiple jewellery items', () => {
    const items = manifest().items.concat(
      { item_id: 'j1', slot: 'jewellery', source_image_url: 'https://cdn/j1.jpg', item_snapshot: { item_type: 'earrings', brand: 'X' } },
      { item_id: 'j2', slot: 'jewellery', source_image_url: 'https://cdn/j2.jpg', item_snapshot: { item_type: 'necklace', brand: 'X' } },
    )
    expect(checkMembership(manifest({ items })).status).toBe('passed')
  })
})

describe('source images / references', () => {
  it('fails when any item lacks a source image', () => {
    const items = manifest().items.map((i, idx) => (idx === 1 ? { ...i, source_image_url: '' } : i))
    expect(checkSourceImages(manifest({ items })).status).toBe('failed')
  })
})

describe('required item data', () => {
  it('fails when required fields are missing', () => {
    const items = manifest().items.map((i, idx) => (idx === 0 ? { ...i, item_snapshot: { item_type: null, brand: 'X' } } : i))
    const o = checkRequiredItemData(manifest({ items }))
    expect(o.status).toBe('failed')
    expect((o.detail as any).items[0].missing).toContain('item_type')
  })
})

describe('size possibility — fail closed', () => {
  it('fails when an item is not in size', () => {
    const ev = { ...goodEvidence(), size: { 'i-top': 'in_size', 'i-bot': 'not_in_size', 'i-shoe': 'in_size' } } as ObjectiveEvidence
    expect(checkSize(manifest(), ev).status).toBe('failed')
  })
  it('is unavailable (not a pass) when size evidence is missing', () => {
    expect(checkSize(manifest(), { ...goodEvidence(), size: null }).status).toBe('unavailable')
  })
  it('is unavailable when any item is unconfirmed', () => {
    const ev = { ...goodEvidence(), size: { 'i-top': 'in_size', 'i-bot': 'unconfirmed', 'i-shoe': 'in_size' } } as ObjectiveEvidence
    expect(checkSize(manifest(), ev).status).toBe('unavailable')
  })
  it('is error (not a pass) when the size lookup errored', () => {
    expect(checkSize(manifest(), { ...goodEvidence(), size: { error: true } }).status).toBe('error')
  })
})

describe('size applicability — unsized categories do not gate', () => {
  // An outfit with sized garments/shoes plus a bag and jewellery.
  function withAccessories(): ObjectiveManifest {
    return manifest({
      requiredSlots: ['top', 'bottom', 'shoe'],
      items: [
        ...manifest().items,
        { item_id: 'i-bag', slot: 'bag', source_image_url: 'https://cdn/bag.jpg', item_snapshot: { item_type: 'tote', brand: 'Polene' } },
        { item_id: 'i-jewel', slot: 'jewellery', source_image_url: 'https://cdn/j.jpg', item_snapshot: { item_type: 'necklace', brand: 'Missoma' } },
      ],
    })
  }

  it('passes when sized pieces are in size and unsized bag/jewellery have no size evidence', () => {
    // Only the sized pieces carry a verdict; the bag and jewellery do not.
    const ev: ObjectiveEvidence = {
      size: { 'i-top': 'in_size', 'i-bot': 'in_size', 'i-shoe': 'in_size' },
      stock: {},
    }
    expect(checkSize(withAccessories(), ev).status).toBe('passed')
  })

  it('bags and jewellery pass even when explicitly marked not_applicable', () => {
    const ev: ObjectiveEvidence = {
      size: { 'i-top': 'in_size', 'i-bot': 'in_size', 'i-shoe': 'in_size', 'i-bag': 'not_applicable', 'i-jewel': 'not_applicable' },
      stock: {},
    }
    expect(checkSize(withAccessories(), ev).status).toBe('passed')
  })

  it('still fails closed when a sized garment lacks size evidence, despite unsized pieces', () => {
    const ev: ObjectiveEvidence = {
      size: { 'i-top': 'in_size', 'i-shoe': 'in_size', 'i-bag': 'not_applicable' },
      stock: {},
    }
    // i-bot (trousers) is sized and missing — unavailable, not passed.
    expect(checkSize(withAccessories(), ev).status).toBe('unavailable')
  })

  it('passes an all-accessory look (nothing to size) even with no size evidence', () => {
    const m = manifest({
      requiredSlots: ['bag'],
      items: [
        { item_id: 'i-bag', slot: 'bag', source_image_url: 'https://cdn/bag.jpg', item_snapshot: { item_type: 'tote', brand: 'Polene' } },
        { item_id: 'i-jewel', slot: 'jewellery', source_image_url: 'https://cdn/j.jpg', item_snapshot: { item_type: 'necklace', brand: 'Missoma' } },
      ],
    })
    expect(checkSize(m, { size: null, stock: {} }).status).toBe('passed')
  })
})

describe('sellable stock — fail closed', () => {
  it('fails when an item is not sellable', () => {
    const ev = { ...goodEvidence(), stock: { 'i-top': true, 'i-bot': false, 'i-shoe': true } } as ObjectiveEvidence
    expect(checkStock(manifest(), ev).status).toBe('failed')
  })
  it('is unavailable when stock is unknown or missing', () => {
    expect(checkStock(manifest(), { ...goodEvidence(), stock: null }).status).toBe('unavailable')
    const ev = { ...goodEvidence(), stock: { 'i-top': true, 'i-bot': 'unknown', 'i-shoe': true } } as ObjectiveEvidence
    expect(checkStock(manifest(), ev).status).toBe('unavailable')
  })
  it('is error when the stock lookup errored', () => {
    expect(checkStock(manifest(), { ...goodEvidence(), stock: { error: true } }).status).toBe('error')
  })
})

describe('aggregate fail-closed ranking', () => {
  it('an errored dependency makes the whole result error (never a pass)', () => {
    const r = runObjectiveChecks(manifest(), { size: { error: true }, stock: goodEvidence().stock })
    expect(r.passed).toBe(false)
    expect(r.status).toBe('error')
  })
  it('a plain failure outranks nothing but still blocks', () => {
    const items = manifest().items.filter((i) => i.slot !== 'shoe')
    const r = runObjectiveChecks(manifest({ items }), goodEvidence())
    expect(r.passed).toBe(false)
    expect(r.status).toBe('failed')
  })
  it('unavailable (missing evidence) is non-pass', () => {
    const r = runObjectiveChecks(manifest(), { size: null, stock: null })
    expect(r.passed).toBe(false)
    expect(r.status).toBe('unavailable')
  })
})
