import { describe, it, expect, vi } from 'vitest'

// The pieces the keep path would otherwise reach for. Stubbed so the test is
// about the run's progress reporting, not about a shop.
vi.mock('@/lib/brand-watch-bans', () => ({ houseBanOf: (p: any) => (p.title === 'Banned Fuchsia Top' ? 'fuchsia' : null) }))
vi.mock('@/lib/brand-watch', () => ({
  // Only names its piece when the title says so — the same shape as the real
  // read, and enough to exercise the untyped branch.
  typeFromStoredRow: (q: any) => (/\b(pant|pants)\b/i.test(q.product_name) ? 'trousers' : null),
}))
vi.mock('@/app/admin/ai/classify-item-type', () => ({ classifyItemTypeFromImage: async () => ({ itemType: null }) }))
vi.mock('@/app/admin/items/stock-check', () => ({ checkStockDetailed: async () => ({ status: 'unknown', sizes: [], source: 'test' }) }))
vi.mock('@/lib/size-availability', () => ({ upsertSizeAvailability: async () => undefined }))
vi.mock('@/lib/style-brain-store', () => ({ recordStyleDecision: async () => undefined }))

import { keepQueueRows, type KeepReport } from '../brand-watch-keep'

const row = (name: string, over: Record<string, unknown> = {}) => ({
  queue_id: `q-${name}`, product_name: name, item_type: null, brand_id: 'b1',
  retailer_url: null, image_url: null, stock_status: 'in_stock', admin_notes: null, ...over,
})

/** Just enough of the Supabase client for this path: one select, one insert, one update. */
function fakeAdmin(rows: any[]) {
  let items = 0
  const updates: { id: string; patch: any }[] = []
  const admin = {
    from(table: string) {
      if (table === 'brand_watch_queue') {
        return {
          select: () => ({ in: () => ({ eq: async () => ({ data: rows, error: null }) }) }),
          update: (patch: any) => ({ eq: async (_col: string, id: string) => { updates.push({ id, patch }); return { error: null } } }),
        }
      }
      if (table === 'item') {
        return { insert: () => ({ select: () => ({ single: async () => ({ data: { item_id: `item-${++items}` }, error: null }) }) }) }
      }
      throw new Error(`unexpected table ${table}`)
    },
  }
  return { admin, updates }
}

describe('keepQueueRows progress', () => {
  it('reports every piece, and ends on the total', async () => {
    const rows = [row('Linen Pant'), row('Silk Pant'), row('Wool Pant')]
    const { admin } = fakeAdmin(rows)
    const seen: number[] = []
    const created = await keepQueueRows(admin, rows.map((r) => r.queue_id), { onProgress: (done) => seen.push(done) })
    expect(created).toBe(3)
    expect(seen).toEqual([1, 2, 3])
  })

  it('counts a refused piece too, so a run that refuses cannot look stuck', async () => {
    // One banned, one with no type anywhere, one keepable.
    const rows = [row('Banned Fuchsia Top'), row('Nameless Thing'), row('Linen Pant')]
    const { admin } = fakeAdmin(rows)
    const seen: number[] = []
    const report: KeepReport = { outOfStock: [], lowStock: [], untyped: [] }
    const created = await keepQueueRows(admin, rows.map((r) => r.queue_id), { onProgress: (done) => seen.push(done), report })
    expect(created).toBe(1)
    expect(report.untyped).toEqual(['Nameless Thing'])
    // Three pieces walked, three progress reports — the refusal is not a stall.
    expect(seen).toEqual([1, 2, 3])
  })

  it('reports nothing when there is nothing to do', async () => {
    const { admin } = fakeAdmin([])
    const seen: number[] = []
    expect(await keepQueueRows(admin, [], { onProgress: (done) => seen.push(done) })).toBe(0)
    expect(seen).toEqual([])
  })

  it('passes the total, so a card can say 40/214 rather than just 40', async () => {
    const rows = [row('Linen Pant'), row('Silk Pant')]
    const { admin } = fakeAdmin(rows)
    const pairs: string[] = []
    await keepQueueRows(admin, rows.map((r) => r.queue_id), { onProgress: (done, total) => pairs.push(`${done}/${total}`) })
    expect(pairs).toEqual(['1/2', '2/2'])
  })
})
