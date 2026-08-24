import { describe, it, expect } from 'vitest'
import { readTrust, STAGE2_STREAK } from '@/lib/member-trust'
import { buildTraitModel, traitBlocked, traitPenalty, type TraitDecision } from '@/lib/member-traits'

const look = (i: number, edits: number, response: 'yes' | 'no' | null = 'yes') => ({
  look_id: `l${i}`, created_at: `2026-08-${String(i + 1).padStart(2, '0')}T10:00:00Z`,
  edits, approved: true, response,
})

describe('member trust gate', () => {
  it('holds a member whose looks still get edited', () => {
    // Alison's real shape: 16 looks, 1 clean.
    const looks = Array.from({ length: 16 }, (_, i) => look(i, i === 0 ? 0 : 5))
    const t = readTrust(looks)
    expect(t.stage).toBe(1)
    expect(t.cleanRate).toBeLessThan(0.2)
    expect(t.blockers.join(' ')).toMatch(/clean looks in a row/)
  })

  it('opens auto-send once both signals hold', () => {
    const looks = Array.from({ length: 12 }, (_, i) => look(i, 0))
    const t = readTrust(looks)
    expect(t.stage).toBe(2)
    expect(t.blockers).toEqual([])
    expect(t.streak).toBeGreaterThanOrEqual(STAGE2_STREAK)
  })

  it('will not graduate on clean composing alone when SHE keeps saying no', () => {
    // Chloe never edits, the member turns them down — a shared blind spot, and
    // the only signal that catches it is hers.
    const looks = Array.from({ length: 12 }, (_, i) => look(i, 0, 'no'))
    const t = readTrust(looks)
    expect(t.stage).toBe(1)
    expect(t.blockers.join(' ')).toMatch(/says yes/)
  })

  it('one edit breaks the streak', () => {
    const looks = [...Array.from({ length: 10 }, (_, i) => look(i, 0)), look(10, 1)]
    expect(readTrust(looks).streak).toBe(0)
    expect(readTrust(looks).stage).toBe(1)
  })
})

describe('trait learning', () => {
  const bag = (id: string, brand: string) => ({
    item_id: id, brand_id: brand, item_type: 'structured_bag', colour_family: 'black',
  })
  it('blocks the kind of piece she keeps rejecting, not the whole colour', () => {
    const decisions: TraitDecision[] = [
      ...['a', 'b', 'c', 'd', 'e'].map((id) => ({ item: bag(id, 'munthe'), kept: false })),
      { item: bag('f', 'munthe'), kept: true },
      // Black bags from elsewhere are fine and stay fine.
      ...['g', 'h', 'i'].map((id) => ({ item: bag(id, 'sessun'), kept: true })),
    ]
    const m = buildTraitModel(decisions)
    expect(traitBlocked(m, bag('new', 'munthe'))).toBe('brand:munthe+type:structured_bag')
    expect(traitBlocked(m, bag('new2', 'sessun'))).toBeNull()
    // and the colour itself is never blocked
    expect(Array.from(m.blocked).some((t) => t.startsWith('colour:'))).toBe(false)
  })

  it('needs real evidence before it penalises anything', () => {
    const m = buildTraitModel([{ item: bag('a', 'munthe'), kept: false }])
    expect(traitPenalty(m, bag('b', 'munthe'))).toBe(0)
  })
})

describe('tracking numbers', () => {
  const look = (i: number, swaps: number, removes: number, items = 5) => ({
    look_id: `t${i}`, created_at: `2026-08-${String(i + 1).padStart(2, '0')}T10:00:00Z`,
    edits: swaps + removes, swaps, removes, items, approved: true, response: null,
  })

  it('separates a swap from a removal, and rates pieces not looks', () => {
    // 4 looks, 5 pieces each: one look with 2 swaps, one with 1 removal.
    const t = readTrust([look(0, 0, 0), look(1, 2, 0), look(2, 0, 1), look(3, 0, 0)])
    expect(t.swapRate).toBeCloseTo(0.25)
    expect(t.removeRate).toBeCloseTo(0.25)
    expect(t.itemErrorRate).toBeCloseTo(3 / 20)   // 3 pieces pulled from 20 composed
    expect(t.cleanRate).toBeCloseTo(0.5)
  })

  it('reports the direction of travel once there is enough history', () => {
    const bad = Array.from({ length: 10 }, (_, i) => look(i, 2, 0))
    const good = Array.from({ length: 10 }, (_, i) => look(i + 10, 0, 0))
    const t = readTrust([...bad, ...good])
    expect(t.trend).not.toBeNull()
    expect(t.trend!.delta).toBeGreaterThan(0)
  })

  it('says nothing about a trend it cannot see', () => {
    expect(readTrust([look(0, 0, 0), look(1, 1, 0)]).trend).toBeNull()
  })
})
