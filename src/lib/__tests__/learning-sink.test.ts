// ONE LEARNING BASE: everything Chloe accepts teaches the house base, and the
// stylist or persona layer in play — never the same model twice.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const decisions: any[] = []
const pairings: any[] = []
vi.mock('@/lib/style-brain-store', () => ({ recordStyleDecision: vi.fn(async (d: any) => { decisions.push(d) }) }))
vi.mock('@/lib/house-style-store', () => ({ recordMaterialPairings: vi.fn(async (items: any, outcome: any) => { pairings.push({ items, outcome }) }) }))

import { teachFromChloe } from '@/lib/learning-sink'
import { CHLOE_STYLIST_ID } from '@/lib/outfit-quality/identities'

const look = { items: [{ item_type: 'blouse' }, { item_type: 'trousers' }], decision: 'approve' as const, source: 'quality_lab' as const, itemIds: ['a', 'b'] }

beforeEach(() => { decisions.length = 0; pairings.length = 0 })

describe('teachFromChloe', () => {
  it('teaches the base and the layer when a persona is in play', async () => {
    await teachFromChloe({ ...look, layerStylistId: 'scandi-mum' })
    expect(decisions.map((d) => d.stylistId)).toEqual([CHLOE_STYLIST_ID, 'scandi-mum'])
  })

  it('teaches the base once when Chloe herself is the layer, or there is none', async () => {
    await teachFromChloe({ ...look, layerStylistId: CHLOE_STYLIST_ID })
    await teachFromChloe({ ...look, layerStylistId: null })
    expect(decisions.map((d) => d.stylistId)).toEqual([CHLOE_STYLIST_ID, CHLOE_STYLIST_ID])
  })

  it('records material pairings only when given the house items, and only on approve', async () => {
    const houseItems = [{ item_id: 'a', slot: 'top' }, { item_id: 'b', slot: 'bottom' }] as any
    await teachFromChloe({ ...look, houseItems })
    await teachFromChloe({ ...look, decision: 'skip', houseItems })
    await teachFromChloe({ ...look })
    expect(pairings).toHaveLength(1)
    expect(pairings[0].outcome).toBe('approve')
  })
})
