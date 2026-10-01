// Boundary tests for the REAL Supabase snapshot adapter
// (createSupabaseStylistSnapshotLoader / createSupabaseStylistSnapshotStore)
// with an injected transport, plus the Start failure path in batch-store.
//
// Scrutiny round-1 invariants proven here against the production adapter code:
//  1. The learned model comes from `stylist_model` by exact stylist id only.
//     The fallback-aware `loadStyleModel` / `getStylistBySlug('chloe')` /
//     `resolveStylistId` path is never invoked (the spies throw if it is), no
//     query ever touches the legacy `style_model` singleton, and no query ever
//     resolves a stylist by slug.
//  2. Every Supabase read checks its error and fails closed.
//  3. Item-mask and inspiration reads paginate; a 20,000+ row mask is loaded
//     completely instead of silently truncating.
//  4. A source read failure fails batch Start, records `last_error` on the
//     batch, and persists no partial snapshot.

import { describe, it, expect, vi } from 'vitest'
import { StylistSnapshotError } from '@/lib/outfit-quality/stylist-snapshot'

// Fallback-aware loaders are forbidden in the snapshot path. They are replaced
// with spies that throw, so any regression that reintroduces the Chloe fallback
// fails loudly instead of silently borrowing Chloe's model.
const fallbackSpies = vi.hoisted(() => ({
  getStylistBySlug: vi.fn(() => {
    throw new Error('forbidden in the snapshot path: getStylistBySlug (Chloe fallback)')
  }),
  resolveStylistId: vi.fn(() => {
    throw new Error('forbidden in the snapshot path: resolveStylistId (default resolution)')
  }),
  loadStyleModel: vi.fn(() => {
    throw new Error('forbidden in the snapshot path: fallback-aware loadStyleModel')
  }),
}))

vi.mock('@/lib/stylist-store', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/stylist-store')>()),
  getStylistBySlug: fallbackSpies.getStylistBySlug,
  resolveStylistId: fallbackSpies.resolveStylistId,
}))

vi.mock('@/lib/style-brain-store', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/style-brain-store')>()),
  loadStyleModel: fallbackSpies.loadStyleModel,
}))

import {
  createSupabaseStylistSnapshotLoader,
  createSupabaseStylistSnapshotStore,
} from '@/lib/outfit-quality/stylist-snapshot-store'
import { startBatch } from '@/lib/outfit-quality/batch-store'
import { CHLOE_STYLIST_ID } from '@/lib/outfit-quality/identities'

const STYLIST_ID = 'aaaaaaaa-0000-4000-8000-0000000000aa'

// ── Injectable transport fake ────────────────────────────────────────────────

interface FakeQuery {
  table: string
  op: 'select' | 'insert' | 'update'
  filters: Record<string, unknown>
  rangeArgs?: [number, number]
  orderBy?: string
  limitN?: number
  payload?: unknown
  single: boolean
}

type Respond = (q: FakeQuery) => { data: unknown; error: { code?: string; message: string } | null }

function createFakeAdmin(respond: Respond) {
  const queries: FakeQuery[] = []
  const admin = {
    queries,
    from(table: string) {
      const q: FakeQuery = { table, op: 'select', filters: {}, single: false }
      const builder: Record<string, unknown> = {}
      const chain = () => builder
      builder.select = () => chain()
      builder.insert = (payload: unknown) => {
        q.op = 'insert'
        q.payload = payload
        return chain()
      }
      builder.update = (payload: unknown) => {
        q.op = 'update'
        q.payload = payload
        return chain()
      }
      builder.eq = (col: string, val: unknown) => {
        q.filters[col] = val
        return chain()
      }
      builder.is = (col: string, val: unknown) => {
        q.filters[`${col}__is`] = val
        return chain()
      }
      builder.order = (col: string) => {
        q.orderBy = col
        return chain()
      }
      builder.limit = (n: number) => {
        q.limitN = n
        return chain()
      }
      builder.range = (from: number, to: number) => {
        q.rangeArgs = [from, to]
        return chain()
      }
      builder.maybeSingle = () => {
        q.single = true
        return chain()
      }
      builder.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => {
        queries.push(q)
        return Promise.resolve(respond(q)).then(resolve, reject)
      }
      return builder
    },
  }
  return admin
}

function okRespond(map: Record<string, (q: FakeQuery) => unknown>): Respond {
  return (q) => {
    const fn = map[q.table]
    if (!fn) throw new Error(`unexpected query to table ${q.table}`)
    return { data: fn(q), error: null }
  }
}

function paged(all: unknown[]): (q: FakeQuery) => unknown[] {
  return (q) => {
    if (!q.rangeArgs) return all
    const [from, to] = q.rangeArgs
    return all.slice(from, to + 1)
  }
}

function maskRow(i: number) {
  return { item_id: `item-${String(i).padStart(6, '0')}`, eligibility: 'eligible', source: 'auto', updated_at: '2026-01-01T00:00:00.000Z' }
}

function inspirationRow(i: number) {
  return {
    image_id: `img-${String(i).padStart(6, '0')}`,
    image_url: `https://cdn.example/${i}.jpg`,
    source_url: null,
    status: 'confirmed',
    source: 'curator_seed',
    scores: null,
    scores_original: null,
    corrected_fields: [],
    corrected_at: null,
    score_confidence: null,
    vector: new Array(34).fill(0.4),
    occasion_read: null,
    created_at: '2026-01-01T00:00:00.000Z',
  }
}

function expectNoChloeFallback(queries: FakeQuery[]) {
  expect(fallbackSpies.getStylistBySlug).not.toHaveBeenCalled()
  expect(fallbackSpies.resolveStylistId).not.toHaveBeenCalled()
  expect(fallbackSpies.loadStyleModel).not.toHaveBeenCalled()
  // Behavioural proof at the transport boundary: the legacy singleton table is
  // never read, and no query resolves a stylist by slug (the Chloe lookup).
  expect(queries.some((q) => q.table === 'style_model')).toBe(false)
  expect(queries.some((q) => q.table === 'stylist' && 'slug' in q.filters)).toBe(false)
}

// ── loadStylist ──────────────────────────────────────────────────────────────

describe('real adapter: loadStylist', () => {
  it('fails closed when the stylist read errors', async () => {
    const admin = createFakeAdmin((q) => {
      if (q.table === 'stylist') return { data: null, error: { message: 'stylist read blew up' } }
      throw new Error(`unexpected query to ${q.table}`)
    })
    const loader = createSupabaseStylistSnapshotLoader(admin as never)
    await expect(loader.loadStylist(STYLIST_ID)).rejects.toMatchObject({ code: 'source_read_failed' })
    expectNoChloeFallback(admin.queries)
  })

  it('returns null for an unknown id (queried by exact stylist_id only)', async () => {
    const admin = createFakeAdmin(okRespond({ stylist: () => null }))
    const loader = createSupabaseStylistSnapshotLoader(admin as never)
    await expect(loader.loadStylist('bbbbbbbb-0000-4000-8000-0000000000bb')).resolves.toBeNull()
    const q = admin.queries.find((x) => x.table === 'stylist')!
    expect(q.filters).toMatchObject({ stylist_id: 'bbbbbbbb-0000-4000-8000-0000000000bb' })
    expectNoChloeFallback(admin.queries)
  })
})

// ── loadLearnedModel ─────────────────────────────────────────────────────────

describe('real adapter: loadLearnedModel', () => {
  it('loads the stylist_model row by exact stylist id and marks it loaded', async () => {
    const model = { version: 7, decisions: 41, singles: { a: [1, 0] } }
    const admin = createFakeAdmin(okRespond({ stylist_model: () => ({ model, decisions: 41 }) }))
    const loader = createSupabaseStylistSnapshotLoader(admin as never)
    const loaded = await loader.loadLearnedModel(STYLIST_ID)
    expect(loaded.present).toBe(true)
    expect(loaded.payload).toEqual(model)
    expect(loaded.version).toBe(7)
    expect(loaded.decisionCount).toBe(41)
    const q = admin.queries.find((x) => x.table === 'stylist_model')!
    expect(q.filters).toMatchObject({ stylist_id: STYLIST_ID })
    expectNoChloeFallback(admin.queries)
  })

  it('represents an absent own model explicitly — no Chloe model, no empty substitute', async () => {
    const admin = createFakeAdmin(okRespond({ stylist_model: () => null }))
    const loader = createSupabaseStylistSnapshotLoader(admin as never)
    const loaded = await loader.loadLearnedModel(STYLIST_ID)
    expect(loaded).toEqual({ present: false, payload: null, version: null, decisionCount: 0 })
    // Exactly one query: stylist_model by the exact id. No legacy singleton.
    expect(admin.queries).toHaveLength(1)
    expect(admin.queries[0].table).toBe('stylist_model')
    expect(admin.queries[0].filters).toMatchObject({ stylist_id: STYLIST_ID })
    expectNoChloeFallback(admin.queries)
  })

  it('fails closed when the stylist_model read errors', async () => {
    const admin = createFakeAdmin((q) => {
      if (q.table === 'stylist_model') return { data: null, error: { message: 'model read blew up' } }
      throw new Error(`unexpected query to ${q.table}`)
    })
    const loader = createSupabaseStylistSnapshotLoader(admin as never)
    await expect(loader.loadLearnedModel(STYLIST_ID)).rejects.toBeInstanceOf(StylistSnapshotError)
    await expect(loader.loadLearnedModel(STYLIST_ID)).rejects.toMatchObject({ code: 'source_read_failed' })
    expectNoChloeFallback(admin.queries)
  })
})

// ── loadItemMask / loadConfirmedInspiration pagination ───────────────────────

describe('real adapter: paginated source reads', () => {
  it('loads a 21,000-row item mask completely — no silent 20,000 truncation', async () => {
    const all = Array.from({ length: 21000 }, (_, i) => maskRow(i))
    const admin = createFakeAdmin(okRespond({ stylist_item_mask: paged(all) }))
    const loader = createSupabaseStylistSnapshotLoader(admin as never)
    const mask = await loader.loadItemMask(STYLIST_ID)
    expect(mask).toHaveLength(21000)
    expect(mask[0]).toMatchObject({ item_id: 'item-000000', eligibility: 'eligible', source: 'auto' })
    const pages = admin.queries.filter((q) => q.table === 'stylist_item_mask')
    // 21 full pages plus one final short (empty) page that terminates the scan.
    expect(pages.length).toBe(22)
    expect(pages[0].rangeArgs).toEqual([0, 999])
    expect(pages[20].rangeArgs).toEqual([20000, 20999])
    expect(pages[21].rangeArgs).toEqual([21000, 21999])
    for (const p of pages) expect(p.filters).toMatchObject({ stylist_id: STYLIST_ID })
  })

  it('paginates confirmed inspiration reads past the first page', async () => {
    const all = Array.from({ length: 1200 }, (_, i) => inspirationRow(i))
    const admin = createFakeAdmin(okRespond({ inspiration_image: paged(all) }))
    const loader = createSupabaseStylistSnapshotLoader(admin as never)
    const images = await loader.loadConfirmedInspiration(STYLIST_ID)
    expect(images).toHaveLength(1200)
    const pages = admin.queries.filter((q) => q.table === 'inspiration_image')
    expect(pages.length).toBe(2)
    for (const p of pages) {
      expect(p.filters).toMatchObject({ persona_id: STYLIST_ID, status: 'confirmed', user_id__is: null })
    }
  })

  it('fails closed when a later item-mask page errors — no partial result', async () => {
    const all = Array.from({ length: 1500 }, (_, i) => maskRow(i))
    const admin = createFakeAdmin((q) => {
      if (q.table !== 'stylist_item_mask') throw new Error(`unexpected query to ${q.table}`)
      if (q.rangeArgs && q.rangeArgs[0] >= 1000) return { data: null, error: { message: 'page 2 blew up' } }
      return { data: paged(all)(q), error: null }
    })
    const loader = createSupabaseStylistSnapshotLoader(admin as never)
    await expect(loader.loadItemMask(STYLIST_ID)).rejects.toMatchObject({ code: 'source_read_failed' })
  })

  it('fails closed when the inspiration read errors', async () => {
    const admin = createFakeAdmin((q) => {
      if (q.table === 'inspiration_image') return { data: null, error: { message: 'inspiration read blew up' } }
      throw new Error(`unexpected query to ${q.table}`)
    })
    const loader = createSupabaseStylistSnapshotLoader(admin as never)
    await expect(loader.loadConfirmedInspiration(STYLIST_ID)).rejects.toMatchObject({ code: 'source_read_failed' })
  })
})

// ── store error handling ─────────────────────────────────────────────────────

describe('real adapter: snapshot store', () => {
  it('findByIdempotencyKey fails closed on a read error', async () => {
    const admin = createFakeAdmin((q) => {
      if (q.table === 'outfit_quality_stylist_snapshot') return { data: null, error: { message: 'snapshot read blew up' } }
      throw new Error(`unexpected query to ${q.table}`)
    })
    const store = createSupabaseStylistSnapshotStore(admin as never)
    await expect(store.findByIdempotencyKey('k1')).rejects.toThrow(/snapshot read blew up/)
  })

  it('insert returns the existing row on an idempotency-key conflict without overwriting', async () => {
    const existing = {
      snapshot_id: 'snap-existing',
      payload_hash: 'a'.repeat(64),
      rules_only: false,
      confirmed_inspiration_count: 16,
      payload: { rules_only: false },
    }
    const admin = createFakeAdmin((q) => {
      if (q.table !== 'outfit_quality_stylist_snapshot') throw new Error(`unexpected query to ${q.table}`)
      if (q.op === 'insert') return { data: null, error: { code: '23505', message: 'duplicate key value' } }
      return { data: existing, error: null }
    })
    const store = createSupabaseStylistSnapshotStore(admin as never)
    const res = await store.insert({
      stylist_id: STYLIST_ID,
      constitution_version: 1,
      payload: { rules_only: false } as never,
      payload_hash: 'b'.repeat(64),
      confirmed_inspiration_count: 16,
      rules_only: false,
      generation_model: 'g',
      prompt_version: 'p',
      objective_rules_version: 'o',
      subjective_check_model: 's',
      subjective_prompt_version: 'sp',
      composer_version: 'c',
      item_query_version: 'iq',
      idempotency_key: 'k1',
    })
    expect(res.created).toBe(false)
    expect(res.snapshot.snapshot_id).toBe('snap-existing')
  })

  it('insert throws on any non-conflict error', async () => {
    const admin = createFakeAdmin((q) => {
      if (q.table === 'outfit_quality_stylist_snapshot') return { data: null, error: { message: 'disk on fire' } }
      throw new Error(`unexpected query to ${q.table}`)
    })
    const store = createSupabaseStylistSnapshotStore(admin as never)
    await expect(
      store.insert({
        stylist_id: STYLIST_ID,
        constitution_version: 1,
        payload: { rules_only: true } as never,
        payload_hash: 'b'.repeat(64),
        confirmed_inspiration_count: 0,
        rules_only: true,
        generation_model: 'g',
        prompt_version: 'p',
        objective_rules_version: 'o',
        subjective_check_model: 's',
        subjective_prompt_version: 'sp',
        composer_version: 'c',
        item_query_version: 'iq',
        idempotency_key: 'k2',
      }),
    ).rejects.toThrow(/disk on fire/)
  })
})

// ── Start fails closed with a recorded error ─────────────────────────────────

describe('startBatch: snapshot read failure', () => {
  const batch = {
    batch_id: 'cccccccc-0000-4000-8000-0000000000cc',
    run_id: 'dddddddd-0000-4000-8000-0000000000dd',
    data_partition: 'test',
    real_member_id: 'eeeeeeee-0000-4000-8000-0000000000ee',
    evaluation_profile_id: null,
    selected_stylist_id: STYLIST_ID,
    stylist_snapshot_id: null,
    target_count: 10,
    chunk_limit: 25,
    status: 'draft',
    last_error: null,
  }

  it('fails Start, records last_error on the batch, and persists no snapshot', async () => {
    const admin = createFakeAdmin((q) => {
      switch (q.table) {
        case 'outfit_quality_batch':
          if (q.op === 'select') return { data: batch, error: null }
          return { data: null, error: null } // update
        case 'outfit_quality_stylist_snapshot':
          return { data: null, error: null } // no existing snapshot for the key
        case 'stylist':
          return { data: null, error: { message: 'stylist table unavailable' } }
        default:
          throw new Error(`unexpected query to ${q.table}`)
      }
    })

    const res = await startBatch(batch.batch_id, admin as never)

    expect(res.ok).toBe(false)
    expect(res.code).toBe('snapshot_failed')
    expect(res.message).toContain('stylist table unavailable')

    // The failure is recorded on the batch row.
    const updates = admin.queries.filter((q) => q.table === 'outfit_quality_batch' && q.op === 'update')
    expect(updates).toHaveLength(1)
    const recorded = updates[0].payload as Record<string, unknown>
    expect(String(recorded.last_error)).toContain('stylist table unavailable')
    // The batch is not activated.
    expect(recorded.status).toBeUndefined()

    // No partial snapshot persists: nothing was ever inserted.
    expect(admin.queries.some((q) => q.table === 'outfit_quality_stylist_snapshot' && q.op === 'insert')).toBe(false)
    expectNoChloeFallback(admin.queries)
  })
})
