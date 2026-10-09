import { describe, it, expect } from 'vitest'
import {
  signatureOf, idsOf, sellableWays, orderWays, warmupAllowed, judgedCost, toStyledLook, WAYS,
} from '../styled-ways-core'

const row = (id: string, ids: string[], extra: Partial<Record<string, unknown>> = {}) => ({
  styled_way_id: id,
  member_id: 'm',
  hero_item_id: ids[0],
  mode: 'blend' as const,
  items: ids.map((item_id) => ({ item_id, brand: 'B', product_name: item_id, owned: false })),
  item_ids: ids,
  items_signature: [...ids].sort().join('|'),
  verdict: 'works' as const,
  confidence: 0.8,
  why: '',
  occasion_id: null,
  occasion_label: null,
  source: 'tap' as const,
  judged_at: '2026-10-08T10:00:00Z',
  stale: false,
  ...extra,
})

describe('signatureOf — the same look is the same row', () => {
  it('ignores order and pieces without an id', () => {
    expect(signatureOf([{ item_id: 'b' }, { item_id: 'a' }, { item_id: null }])).toBe('a|b')
    expect(signatureOf([{ item_id: 'a' }, { item_id: 'b' }])).toBe(signatureOf([{ item_id: 'b' }, { item_id: 'a' }]))
    expect(idsOf([{ item_id: 'a' }, { item_id: 'a' }])).toEqual(['a'])
  })
})

describe('sellableWays — a look dies with the first piece that cannot be bought', () => {
  const stock = new Map([
    ['hero', { stock_status: 'in_stock', status: 'live' }],
    ['ok', { stock_status: null, status: 'ready' }],
    ['gone', { stock_status: 'out_of_stock', status: 'out_of_stock' }],
    ['unread', { stock_status: 'unknown', status: 'live' }],
    ['archived', { stock_status: 'in_stock', status: 'archived' }],
  ])

  it('keeps looks whose retail pieces are sellable or never checked', () => {
    const { keep, dead } = sellableWays([row('1', ['hero', 'ok'])], stock)
    expect(keep.map((r) => r.styled_way_id)).toEqual(['1'])
    expect(dead).toEqual([])
  })

  it('retires on out of stock, unknown, archived and deleted pieces, naming the killer', () => {
    const { keep, dead } = sellableWays([
      row('a', ['hero', 'gone']),
      row('b', ['hero', 'unread']),
      row('c', ['hero', 'archived']),
      row('d', ['hero', 'vanished']),
    ], stock)
    expect(keep).toEqual([])
    expect(dead.map((d) => [d.row.styled_way_id, d.itemId, d.reason])).toEqual([
      ['a', 'gone', 'out_of_stock'],
      ['b', 'unread', 'unknown'],
      ['c', 'archived', 'archived'],
      ['d', 'vanished', 'missing'],
    ])
  })

  it('never lets one of her own pieces kill a look', () => {
    const r = row('o', ['hero', 'mine'])
    r.items[1].owned = true
    const { keep } = sellableWays([r], stock)
    expect(keep).toHaveLength(1)
  })
})

describe('orderWays — works before borderline, newest first within', () => {
  it('sorts by verdict then date', () => {
    const rows = [
      row('old-works', ['h', 'a'], { judged_at: '2026-10-01T00:00:00Z' }),
      row('new-border', ['h', 'b'], { verdict: 'borderline', judged_at: '2026-10-08T00:00:00Z' }),
      row('new-works', ['h', 'c'], { judged_at: '2026-10-08T00:00:00Z' }),
    ]
    expect(orderWays(rows).map((r) => r.styled_way_id)).toEqual(['new-works', 'old-works', 'new-border'])
  })
})

describe('warm-up cap and cost', () => {
  it('allows warm-ups under the cap only', () => {
    expect(warmupAllowed(0, 40)).toBe(true)
    expect(warmupAllowed(39, 40)).toBe(true)
    expect(warmupAllowed(40, 40)).toBe(false)
    expect(warmupAllowed(0, 0)).toBe(false)
  })
  it('prices judged looks at the look check estimate', () => {
    expect(judgedCost(5)).toBe(0.1)
    expect(judgedCost(0)).toBe(0)
  })
  it('shows three ways', () => {
    expect(WAYS).toBe(3)
  })
})

describe('toStyledLook — what the cards draw', () => {
  it('carries the items, the why and the verdict with no image of its own', () => {
    const l = toStyledLook(row('x', ['h', 'a']))
    expect(l.look_id).toBeNull()
    expect(l.image_url).toBeNull()
    expect(l.items).toHaveLength(2)
    expect(l.verdict).toBe('works')
    expect(l.styled_way_id).toBe('x')
  })
})
