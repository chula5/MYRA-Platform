import { describe, it, expect, vi } from 'vitest'

vi.mock('@/app/admin/private-stylist/actions', () => ({ loadComposableLibrary: async () => [] }))

import { moreOfTheSame } from '@/lib/shop-brain/similar'

// MORE OF THE SAME answers from her taste graph, with one slot per saved piece
// kept for a label outside it — exactly the kind of piece she kept, inside her
// ceiling — and never a label she turned away.
const dress = (item_id: string, brand_id: string, brand: string) => ({
  item_id, brand_id, brand: { name: brand }, item_type: 'midi_dress', colour_family: 'black',
  product_name: `${brand} black dress ${item_id}`, image_url: 'x', price_gbp: 250,
})

function ctxFor(pool: any[]) {
  const anchor = { ...dress('liked', 'awake', 'A.W.A.K.E MODE'), price_gbp: 1054, __kind: 'saved' }
  return {
    admin: null, me: { memberId: 'm', authUserId: null },
    savedItems: [anchor], viewedItems: [], searches: [], anchors: [anchor], anchorIds: new Set(['liked']),
    pool, savedSlots: new Set(['dress']), overBudget: () => false,
    graph: { weights: new Map([['meem', 1], ['sandro', 0.6]]), blocked: new Set(['zara']), bands: {} },
    closeness: () => 0, brandNames: [], brandInQuery: () => null,
  } as any
}

describe('MORE OF THE SAME and her taste graph', () => {
  it('leads with her labels and keeps one slot for a discovery of the same kind', async () => {
    const pool = [dress('a', 'meem', 'ME+EM'), dress('b', 'meem', 'ME+EM'), dress('c', 'sandro', 'SANDRO'), dress('d', 'rixo-x', 'Outside Label')]
    const out = await moreOfTheSame(ctxFor(pool))
    expect(out.map((p) => p.brand)).toEqual(['ME+EM', 'ME+EM', 'Outside Label'])
  })

  it('never shows a label she turned away, even as a discovery', async () => {
    const pool = [dress('a', 'meem', 'ME+EM'), dress('b', 'meem', 'ME+EM'), dress('c', 'sandro', 'SANDRO'), dress('z', 'zara', 'Zara')]
    const out = await moreOfTheSame(ctxFor(pool))
    expect(out.map((p) => p.brand)).not.toContain('Zara')
    expect(out).toHaveLength(3)
  })

  it('a different kind of piece from outside her graph is not a discovery', async () => {
    const coat = { ...dress('k', 'outside', 'Outside Label'), item_type: 'coat' }
    const out = await moreOfTheSame(ctxFor([dress('a', 'meem', 'ME+EM'), coat]))
    expect(out.map((p) => p.brand)).toEqual(['ME+EM'])
  })
})
