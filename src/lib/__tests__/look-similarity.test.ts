import { describe, it, expect } from 'vitest'
import { lookSimilarity, mostSimilar, relatedLooks, looksWearing } from '../look-similarity'

const look = (id: string, items: [string, string][], occasion = 'Casual day') => ({
  look_id: id,
  occasion_label: occasion,
  items: items.map(([item_id, brand]) => ({ item_id, brand })),
})

describe('lookSimilarity', () => {
  it('ranks a shared piece above a shared brand, overlap for overlap', () => {
    const base = look('a', [['i1', 'Varley'], ['i2', 'Posse']])
    const samePiece = look('b', [['i1', 'Toteme'], ['i9', 'Ganni']])   // half the pieces
    const sameBrand = look('c', [['i7', 'Varley'], ['i8', 'Ganni']])   // half the brands
    expect(lookSimilarity(base, samePiece)).toBeGreaterThan(lookSimilarity(base, sameBrand))
  })

  it('lets a fully shared brand pair match one shared piece', () => {
    // Worth pinning: one piece in two (0.3) and both brands in two (0.3) come
    // out level. That is the intended trade — a look in the same two labels is
    // as close as a look that reuses one thing — not an accident of weights.
    const base = look('a', [['i1', 'Varley'], ['i2', 'Posse']])
    const samePiece = look('b', [['i1', 'Toteme'], ['i9', 'Ganni']])
    const bothBrands = look('c', [['i7', 'Varley'], ['i8', 'Posse']])
    expect(lookSimilarity(base, samePiece)).toBeCloseTo(lookSimilarity(base, bothBrands), 10)
  })

  it('gives the occasion alone only a nudge, never a match', () => {
    const a = look('a', [['i1', 'Varley']], 'Travel')
    const b = look('b', [['i2', 'Ganni']], 'Travel')
    expect(lookSimilarity(a, b)).toBeCloseTo(0.1, 5)
  })

  it('is symmetric and self-similarity is total', () => {
    const a = look('a', [['i1', 'Varley'], ['i2', 'Posse']])
    const b = look('b', [['i1', 'Varley'], ['i3', 'Ganni']])
    expect(lookSimilarity(a, b)).toBeCloseTo(lookSimilarity(b, a), 10)
    expect(lookSimilarity(a, look('x', [['i1', 'Varley'], ['i2', 'Posse']]))).toBeCloseTo(1, 5)
  })

  it('does not reward a look with no pieces in common and no brand overlap', () => {
    const a = look('a', [['i1', 'Varley']], 'Travel')
    const b = look('b', [['i2', 'Ganni']], 'Dinner & drinks')
    expect(lookSimilarity(a, b)).toBe(0)
  })

  it('shared-brand overlap uses the larger look as the denominator', () => {
    // Two brands shared, but one look has four labels — a partial match, not a
    // full one, or a big look would look like every small one.
    const a = look('a', [['i1', 'Varley'], ['i2', 'Posse']])
    const b = look('b', [['i3', 'Varley'], ['i4', 'Posse'], ['i5', 'Ganni'], ['i6', 'Toteme']])
    expect(lookSimilarity(a, b)).toBeCloseTo(0.3 * (2 / 4) + 0.1, 5)
  })
})

describe('mostSimilar', () => {
  const pool = [
    look('a', [['i1', 'Varley'], ['i2', 'Posse']]),
    look('b', [['i1', 'Varley'], ['i3', 'Ganni']]),
    look('c', [['i4', 'Posse'], ['i5', 'Toteme']]),
    look('d', [['i6', 'Reiss'], ['i7', 'Whistles']], 'Travel'),
  ]

  it('never returns the look itself', () => {
    expect(mostSimilar(pool[0], pool).map((l) => l.look_id)).not.toContain('a')
  })

  it('drops looks with nothing in common rather than padding the row', () => {
    expect(mostSimilar(pool[0], pool).map((l) => l.look_id)).toEqual(['b', 'c'])
  })

  it('honours the count', () => {
    expect(mostSimilar(pool[0], pool, 1).map((l) => l.look_id)).toEqual(['b'])
  })
})

describe('relatedLooks — the feed rule, on her own looks', () => {
  const dressLong = (id: string, occ = 'Dinner & drinks') => ({
    look_id: id, occasion_label: occ,
    items: [{ item_id: `${id}-a`, brand: 'Ganni', item_type: 'maxi_dress' }],
  })
  const trousers = (id: string, occ = 'Dinner & drinks') => ({
    look_id: id, occasion_label: occ,
    items: [{ item_id: `${id}-a`, brand: 'Ganni', item_type: 'trousers' }],
  })

  const pool = [
    dressLong('a'), dressLong('b'), trousers('c'),
    trousers('d', 'Travel'), dressLong('e', 'Travel'),
  ]

  it('SIMILAR keeps the silhouette and the occasion', () => {
    expect(relatedLooks(pool[0], pool, 'similar').map((l) => l.look_id)).toEqual(['b'])
  })

  it('EXPLORE changes the silhouette but keeps the occasion', () => {
    expect(relatedLooks(pool[0], pool, 'explore').map((l) => l.look_id)).toEqual(['c'])
  })

  it('the two rows never overlap', () => {
    const sim = relatedLooks(pool[0], pool, 'similar').map((l) => l.look_id)
    const exp = relatedLooks(pool[0], pool, 'explore').map((l) => l.look_id)
    expect(sim.filter((id) => exp.includes(id))).toEqual([])
  })

  it('never returns the anchor itself', () => {
    for (const mode of ['similar', 'explore'] as const) {
      expect(relatedLooks(pool[0], pool, mode).map((l) => l.look_id)).not.toContain('a')
    }
  })
})

describe('looksWearing', () => {
  const pool = [
    { look_id: 'a', items: [{ item_id: 'i1', brand: 'Varley' }] },
    { look_id: 'b', items: [{ item_id: 'i1', brand: 'Ganni' }] },
    { look_id: 'c', items: [{ item_id: 'i2', brand: 'Ganni' }] },
  ]
  it('finds her other looks wearing the piece, not the one she is on', () => {
    expect(looksWearing('i1', pool, 'a').map((l) => l.look_id)).toEqual(['b'])
  })
  it('is empty when nothing else wears it', () => {
    expect(looksWearing('i2', pool, 'c')).toEqual([])
  })
})
