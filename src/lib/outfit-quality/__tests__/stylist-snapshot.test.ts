import { describe, it, expect, vi } from 'vitest'
import {
  canonicalize,
  sha256Hex,
  computePayloadHash,
  countValidConfirmedImages,
  isEnvelopeUsable,
  isValidVector,
  buildSnapshotPayload,
  buildStylistSnapshot,
  createStylistSnapshot,
  StylistSnapshotError,
  SNAPSHOT_SYSTEM_VERSIONS,
  MIN_CONFIRMED_IMAGES,
  type SelectedStylistInputs,
  type StylistSnapshotLoader,
  type StylistSnapshotStore,
  type StoredSnapshot,
  type StylistSnapshotInsert,
} from '@/lib/outfit-quality/stylist-snapshot'
import { CHLOE_STYLIST_ID } from '@/lib/outfit-quality/identities'

const STYLIST_ID = 'aaaaaaaa-0000-4000-8000-000000000001'

function brief() {
  return {
    public_name: 'Scandi Mum',
    tagline: 'Quiet, structured, Scandinavian',
    image_url: null,
    signature_pieces: ['wide-leg trouser', 'crisp shirt'],
    brands: ['Toteme', 'Arket'],
    palette: ['oatmeal', 'charcoal'],
    fabrics: ['wool', 'cotton'],
    day: 'tailored separates',
    evening: 'a column dress',
    weekend: 'denim and knit',
    nevers: [
      { text: 'no logos', kind: 'ban' as const, match: ['logo'] },
      { text: 'avoids neon', kind: 'preference' as const, match: ['neon'] },
    ],
    siblings: [],
    how_she_routes: undefined,
  }
}

function vec(fill: number): number[] {
  return new Array(34).fill(fill)
}

function confirmedImage(id: string, fill = 0.4) {
  return {
    image_id: id,
    image_url: `https://cdn.example/${id}.jpg`,
    source_url: `https://src.example/${id}`,
    status: 'confirmed',
    source: 'curator_seed',
    scores: { construction: 2, volume: 3, item_types: ['trouser'] },
    scores_original: { construction: 3, volume: 3, item_types: ['trouser'] },
    corrected_fields: ['construction'],
    corrected_at: '2026-01-01T00:00:00.000Z',
    score_confidence: 0.8,
    vector: vec(fill),
    occasion_read: ['work'],
    created_at: '2026-01-01T00:00:00.000Z',
  }
}

function usableEnvelope() {
  return {
    envelope: { mean: vec(0.4), spread: vec(0.1), n: 20, tightness: 0.1 },
    envelope_status: 'current' as const,
    envelope_computed_at: '2026-01-02T00:00:00.000Z',
  }
}

function inputs(overrides: Partial<SelectedStylistInputs> = {}): SelectedStylistInputs {
  const env = usableEnvelope()
  return {
    stylist: {
      stylist_id: STYLIST_ID,
      slug: 'scandi-mum',
      name: 'Scandi Mum',
      status: 'live',
      constitution_version: 4,
      constitution: { articles: [{ title: 'WHAT THIS PERSONA IS', rules: ['structured'] }] },
      brief: brief(),
      voice_notes: 'Speaks plainly.',
      envelope: env.envelope,
      envelope_status: env.envelope_status,
      envelope_computed_at: env.envelope_computed_at,
    },
    itemMask: [
      { item_id: 'item-c', eligibility: 'eligible', source: 'auto', updated_at: '2026-01-01T00:00:00.000Z' },
      { item_id: 'item-a', eligibility: 'excluded', source: 'manual', updated_at: '2026-01-01T00:00:00.000Z' },
      { item_id: 'item-b', eligibility: 'eligible', source: 'auto', updated_at: '2026-01-01T00:00:00.000Z' },
    ],
    learnedModel: { present: true, payload: { version: 2, decisions: 37, approves: 20, skips: 5 }, version: 2, decisionCount: 37 },
    confirmedInspiration: Array.from({ length: 16 }, (_, i) => confirmedImage(`img-${String(i).padStart(2, '0')}`)),
    systemVersions: SNAPSHOT_SYSTEM_VERSIONS,
    ...overrides,
  }
}

describe('canonicalize', () => {
  it('serialises object keys in a stable order regardless of insertion order', () => {
    const a = canonicalize({ b: 1, a: { d: 4, c: 3 } })
    const b = canonicalize({ a: { c: 3, d: 4 }, b: 1 })
    expect(a).toBe(b)
    expect(a).toBe('{"a":{"c":3,"d":4},"b":1}')
  })

  it('preserves array element order (arrays are inherently ordered)', () => {
    expect(canonicalize([3, 1, 2])).toBe('[3,1,2]')
    expect(canonicalize([3, 1, 2])).not.toBe(canonicalize([1, 2, 3]))
  })

  it('normalises null and undefined consistently', () => {
    expect(canonicalize({ a: null, b: undefined })).toBe('{"a":null,"b":null}')
  })
})

describe('sha256Hex', () => {
  it('is deterministic and 64 hex chars', () => {
    const h = sha256Hex('hello')
    expect(h).toBe(sha256Hex('hello'))
    expect(h).toMatch(/^[0-9a-f]{64}$/)
    expect(h).not.toBe(sha256Hex('world'))
  })
})

describe('computePayloadHash', () => {
  it('hashes semantically identical payloads identically irrespective of key order', () => {
    const p1 = buildSnapshotPayload(inputs())
    // Re-order source collections and object keys; semantics unchanged.
    const reordered = inputs({
      itemMask: [
        { item_id: 'item-b', eligibility: 'eligible', source: 'auto', updated_at: '2026-01-01T00:00:00.000Z' },
        { item_id: 'item-a', eligibility: 'excluded', source: 'manual', updated_at: '2026-01-01T00:00:00.000Z' },
        { item_id: 'item-c', eligibility: 'eligible', source: 'auto', updated_at: '2026-01-01T00:00:00.000Z' },
      ],
      confirmedInspiration: Array.from({ length: 16 }, (_, i) => confirmedImage(`img-${String(15 - i).padStart(2, '0')}`)),
    })
    const p2 = buildSnapshotPayload(reordered)
    expect(computePayloadHash(p1)).toBe(computePayloadHash(p2))
  })

  it('changes when a system/prompt version changes', () => {
    const base = computePayloadHash(buildSnapshotPayload(inputs()))
    const changed = computePayloadHash(
      buildSnapshotPayload(inputs({ systemVersions: { ...SNAPSHOT_SYSTEM_VERSIONS, prompt_version: 'different-v2' } })),
    )
    expect(changed).not.toBe(base)
  })

  it('changes when a stylist rule changes', () => {
    const base = computePayloadHash(buildSnapshotPayload(inputs()))
    const altBrief = brief()
    altBrief.palette = ['oatmeal', 'charcoal', 'olive']
    const changed = computePayloadHash(
      buildSnapshotPayload(inputs({ stylist: { ...inputs().stylist, brief: altBrief } })),
    )
    expect(changed).not.toBe(base)
  })

  it('changes when confirmed inspiration changes', () => {
    const base = computePayloadHash(buildSnapshotPayload(inputs()))
    const more = inputs().confirmedInspiration.concat(confirmedImage('img-99', 0.6))
    const changed = computePayloadHash(buildSnapshotPayload(inputs({ confirmedInspiration: more })))
    expect(changed).not.toBe(base)
  })

  it('changes when the learned model changes', () => {
    const base = computePayloadHash(buildSnapshotPayload(inputs()))
    const changed = computePayloadHash(
      buildSnapshotPayload(inputs({ learnedModel: { present: true, payload: { version: 3, decisions: 99 }, version: 3, decisionCount: 99 } })),
    )
    expect(changed).not.toBe(base)
  })
})

describe('countValidConfirmedImages / isEnvelopeUsable', () => {
  it('counts only confirmed images carrying a usable vector', () => {
    const imgs = [
      confirmedImage('a'),
      { ...confirmedImage('b'), status: 'scored' },
      { ...confirmedImage('c'), vector: null },
    ]
    expect(countValidConfirmedImages(imgs as any)).toBe(1)
  })

  it('recognises a usable envelope and rejects an empty/missing one', () => {
    expect(isEnvelopeUsable(usableEnvelope().envelope)).toBe(true)
    expect(isEnvelopeUsable(null)).toBe(false)
    expect(isEnvelopeUsable({ mean: [], spread: [], n: 0, tightness: 0 })).toBe(false)
  })
})

describe('34-dimension vector contract', () => {
  it('isValidVector accepts exactly 34 finite numerics and nothing else', () => {
    expect(isValidVector(vec(0.5))).toBe(true)
    expect(isValidVector(vec(0.5).slice(1))).toBe(false) // 33
    expect(isValidVector([...vec(0.5), 0.5])).toBe(false) // 35
    expect(isValidVector(null)).toBe(false)
    expect(isValidVector('0.1,0.2')).toBe(false)
    const withNaN = vec(0.5); withNaN[7] = Number.NaN
    expect(isValidVector(withNaN)).toBe(false)
    const withInf = vec(0.5); withInf[7] = Number.POSITIVE_INFINITY
    expect(isValidVector(withInf)).toBe(false)
    const withString = vec(0.5) as unknown[]; withString[7] = '0.5'
    expect(isValidVector(withString)).toBe(false)
  })

  it('a confirmed image with a malformed vector does not count toward the minimum', () => {
    const malformed = [
      { ...confirmedImage('a'), vector: vec(0.4).slice(1) }, // 33 dims
      { ...confirmedImage('b'), vector: [...vec(0.4), 0.4] }, // 35 dims
      { ...confirmedImage('c'), vector: vec(0.4).map((_, i) => (i === 3 ? Number.NaN : 0.4)) },
    ]
    expect(countValidConfirmedImages(malformed as any)).toBe(0)
  })

  it('rules_only stays true when 15 confirmed images all carry malformed vectors', () => {
    const bad = Array.from({ length: 15 }, (_, i) => ({ ...confirmedImage(`img-${i}`), vector: vec(0.4).slice(1) }))
    const p = buildSnapshotPayload(inputs({ confirmedInspiration: bad as any })) as any
    expect(p.rules_only).toBe(true)
    expect(p.inspiration.confirmed_count).toBe(0)
  })

  it('envelope mean/spread must be finite 34-dimension numerics of matching length', () => {
    const good = usableEnvelope().envelope as any
    expect(isEnvelopeUsable({ ...good, mean: good.mean.slice(1) })).toBe(false) // 33
    expect(isEnvelopeUsable({ ...good, spread: [...good.spread, 0.1] })).toBe(false) // 35
    expect(isEnvelopeUsable({ ...good, mean: good.mean.map((_: number, i: number) => (i === 0 ? Number.NaN : 0.4)) })).toBe(false)
    expect(isEnvelopeUsable({ ...good, spread: good.spread.map((_: number, i: number) => (i === 0 ? Number.POSITIVE_INFINITY : 0.1)) })).toBe(false)
    expect(isEnvelopeUsable({ ...good, n: Number.NaN })).toBe(false)
    expect(isEnvelopeUsable(good)).toBe(true)
  })

  it('a dimension-mismatched envelope keeps rules_only true and freezes no envelope', () => {
    const env = usableEnvelope().envelope as any
    const p = buildSnapshotPayload(
      inputs({ stylist: { ...inputs().stylist, envelope: { ...env, spread: env.spread.slice(1) } } }),
    ) as any
    expect(p.rules_only).toBe(true)
    expect(p.envelope).toBeNull()
  })

  it('valid 34-dimension evidence clears rules_only', () => {
    const p = buildSnapshotPayload(inputs()) as any
    expect(p.inspiration.confirmed_count).toBe(16)
    expect(p.rules_only).toBe(false)
    expect(p.envelope).not.toBeNull()
  })
})

describe('learned model representation', () => {
  it('represents an absent own model explicitly — never a borrowed or empty substitute', () => {
    const p = buildSnapshotPayload(
      inputs({ learnedModel: { present: false, payload: null, version: null, decisionCount: 0 } }),
    ) as any
    expect(p.learned_model).toEqual({ status: 'absent', payload: null, version: null, decision_count: 0 })
  })

  it('marks a loaded own model as loaded with its payload, version and decision count', () => {
    const p = buildSnapshotPayload(inputs()) as any
    expect(p.learned_model.status).toBe('loaded')
    expect(p.learned_model.decision_count).toBe(37)
  })
})

describe('buildSnapshotPayload', () => {
  it('freezes the full selected-stylist lens', () => {
    const p = buildSnapshotPayload(inputs()) as any
    expect(p.stylist).toMatchObject({ stylist_id: STYLIST_ID, slug: 'scandi-mum', display_name: 'Scandi Mum', status: 'live', constitution_version: 4 })
    expect(p.constitution).toBeTruthy()
    expect(p.brief.signature_pieces).toContain('wide-leg trouser')
    expect(p.brand_direction).toEqual(['Toteme', 'Arket'])
    expect(p.palette).toEqual(['oatmeal', 'charcoal'])
    expect(p.fabrics).toEqual(['wool', 'cotton'])
    expect(p.signature_pieces).toEqual(['wide-leg trouser', 'crisp shirt'])
    expect(p.exclusions.map((e: any) => e.text)).toEqual(['no logos', 'avoids neon'])
    expect(p.voice).toMatchObject({ voice_notes: 'Speaks plainly.', tagline: 'Quiet, structured, Scandinavian' })
    expect(p.learned_model).toMatchObject({ status: 'loaded', version: 2, decision_count: 37 })
    expect(p.learned_model.payload).toMatchObject({ decisions: 37 })
    expect(p.system_versions).toMatchObject(SNAPSHOT_SYSTEM_VERSIONS)
  })

  it('records every item-mask decision with its source, sorted deterministically', () => {
    const p = buildSnapshotPayload(inputs()) as any
    expect(p.item_mask.decisions.map((d: any) => d.item_id)).toEqual(['item-a', 'item-b', 'item-c'])
    const a = p.item_mask.decisions.find((d: any) => d.item_id === 'item-a')
    expect(a).toMatchObject({ eligibility: 'excluded', source: 'manual' })
  })

  it('records every confirmed inspiration image sorted by id with corrected scores and vector', () => {
    const p = buildSnapshotPayload(inputs()) as any
    expect(p.inspiration.confirmed_count).toBe(16)
    const ids = p.inspiration.images.map((i: any) => i.image_id)
    expect(ids).toEqual([...ids].sort())
    const first = p.inspiration.images[0]
    expect(first).toHaveProperty('vector')
    expect(first).toHaveProperty('scores')
    expect(first).toHaveProperty('scores_original')
    expect(first).toHaveProperty('corrected_fields')
    expect(first).toHaveProperty('image_url')
  })

  it('includes the usable envelope with its status and computed_at', () => {
    const p = buildSnapshotPayload(inputs()) as any
    expect(p.rules_only).toBe(false)
    expect(p.envelope).toBeTruthy()
    expect(p.envelope.status).toBe('current')
    expect(p.envelope.computed_at).toBe('2026-01-02T00:00:00.000Z')
    expect(p.envelope.payload.n).toBe(20)
  })
})

describe('rules-only mode', () => {
  it('is true when fewer than MIN_CONFIRMED_IMAGES valid confirmed images, keeping only the stylist own inspiration', () => {
    const few = Array.from({ length: MIN_CONFIRMED_IMAGES - 1 }, (_, i) => confirmedImage(`img-${i}`))
    const p = buildSnapshotPayload(inputs({ confirmedInspiration: few })) as any
    expect(p.rules_only).toBe(true)
    expect(p.inspiration.confirmed_count).toBe(MIN_CONFIRMED_IMAGES - 1)
    expect(p.inspiration.images).toHaveLength(MIN_CONFIRMED_IMAGES - 1)
    // Still carries the stylist's own rules.
    expect(p.brand_direction).toEqual(['Toteme', 'Arket'])
    expect(p.learned_model.decision_count).toBe(37)
  })

  it('is true when no usable envelope can be frozen, and omits any envelope (no substitution)', () => {
    const p = buildSnapshotPayload(
      inputs({ stylist: { ...inputs().stylist, envelope: null, envelope_status: null, envelope_computed_at: null } }),
    ) as any
    expect(p.rules_only).toBe(true)
    expect(p.envelope).toBeNull()
  })

  it('never borrows inspiration when the stylist has zero confirmed images', () => {
    const p = buildSnapshotPayload(inputs({ confirmedInspiration: [] })) as any
    expect(p.rules_only).toBe(true)
    expect(p.inspiration.confirmed_count).toBe(0)
    expect(p.inspiration.images).toEqual([])
  })
})

describe('buildStylistSnapshot', () => {
  it('produces indexed columns alongside the payload and hash', () => {
    const snap = buildStylistSnapshot(inputs())
    expect(snap.stylist_id).toBe(STYLIST_ID)
    expect(snap.constitution_version).toBe(4)
    expect(snap.confirmed_inspiration_count).toBe(16)
    expect(snap.rules_only).toBe(false)
    expect(snap.payload_hash).toMatch(/^[0-9a-f]{64}$/)
    expect(snap.generation_model).toBe(SNAPSHOT_SYSTEM_VERSIONS.generation_model)
    expect(snap.subjective_check_model).toBe(SNAPSHOT_SYSTEM_VERSIONS.subjective_check_model)
    expect(snap.payload_hash).toBe(computePayloadHash(snap.payload))
  })
})

// ── Orchestration ────────────────────────────────────────────────────────────

class FakeLoader implements StylistSnapshotLoader {
  loadStylist = vi.fn(async (id: string) => (id === STYLIST_ID ? inputs().stylist : null))
  loadItemMask = vi.fn(async (_id: string) => inputs().itemMask)
  loadLearnedModel = vi.fn(async (_id: string) => inputs().learnedModel)
  loadConfirmedInspiration = vi.fn(async (_id: string) => inputs().confirmedInspiration)
}

class FakeStore implements StylistSnapshotStore {
  rows: (StylistSnapshotInsert & { snapshot_id: string })[] = []
  findByIdempotencyKey = vi.fn(async (key: string): Promise<StoredSnapshot | null> => {
    const r = this.rows.find((x) => x.idempotency_key === key)
    return r ? this.toStored(r) : null
  })
  insert = vi.fn(async (row: StylistSnapshotInsert): Promise<{ snapshot: StoredSnapshot; created: boolean }> => {
    const existing = this.rows.find((x) => x.idempotency_key === row.idempotency_key)
    if (existing) return { snapshot: this.toStored(existing), created: false }
    const stored = { ...row, snapshot_id: `snap-${this.rows.length + 1}` }
    this.rows.push(stored)
    return { snapshot: this.toStored(stored), created: true }
  })
  private toStored(r: StylistSnapshotInsert & { snapshot_id: string }): StoredSnapshot {
    return {
      snapshot_id: r.snapshot_id,
      payload_hash: r.payload_hash,
      rules_only: r.rules_only,
      confirmed_inspiration_count: r.confirmed_inspiration_count,
      payload: r.payload,
    }
  }
}

describe('createStylistSnapshot', () => {
  it('rejects a missing stylist id without touching the loader or store', async () => {
    const loader = new FakeLoader()
    const store = new FakeStore()
    await expect(createStylistSnapshot({ stylistId: '', loader, store, idempotencyKey: 'k1' })).rejects.toBeInstanceOf(StylistSnapshotError)
    expect(loader.loadStylist).not.toHaveBeenCalled()
    expect(store.insert).not.toHaveBeenCalled()
  })

  it('fails closed when the explicit stylist cannot be loaded — no fallback, no downstream writes', async () => {
    const loader = new FakeLoader()
    const store = new FakeStore()
    const missingId = 'bbbbbbbb-0000-4000-8000-000000000002'
    await expect(createStylistSnapshot({ stylistId: missingId, loader, store, idempotencyKey: 'k1' })).rejects.toBeInstanceOf(StylistSnapshotError)
    // Only the explicit stylist was attempted.
    expect(loader.loadStylist).toHaveBeenCalledTimes(1)
    expect(loader.loadStylist).toHaveBeenCalledWith(missingId)
    // No Chloe fallback of any kind.
    expect(loader.loadStylist).not.toHaveBeenCalledWith(CHLOE_STYLIST_ID)
    expect(loader.loadItemMask).not.toHaveBeenCalled()
    expect(loader.loadLearnedModel).not.toHaveBeenCalled()
    expect(loader.loadConfirmedInspiration).not.toHaveBeenCalled()
    expect(store.insert).not.toHaveBeenCalled()
    expect(store.rows).toHaveLength(0)
  })

  it('a source read failure aborts before any snapshot insert', async () => {
    const loader = new FakeLoader()
    const store = new FakeStore()
    loader.loadItemMask = vi.fn(async () => {
      throw new StylistSnapshotError('source_read_failed', 'stylist_item_mask read failed', STYLIST_ID)
    })
    await expect(createStylistSnapshot({ stylistId: STYLIST_ID, loader, store, idempotencyKey: 'k1' })).rejects.toMatchObject({
      code: 'source_read_failed',
    })
    expect(store.insert).not.toHaveBeenCalled()
    expect(store.rows).toHaveLength(0)
  })

  it('persists exactly one snapshot with the hash and all indexed columns', async () => {
    const loader = new FakeLoader()
    const store = new FakeStore()
    const res = await createStylistSnapshot({ stylistId: STYLIST_ID, loader, store, idempotencyKey: 'k1' })
    expect(store.rows).toHaveLength(1)
    const row = store.rows[0]
    expect(row.stylist_id).toBe(STYLIST_ID)
    expect(row.payload_hash).toMatch(/^[0-9a-f]{64}$/)
    expect(row.confirmed_inspiration_count).toBe(16)
    expect(row.rules_only).toBe(false)
    expect(res.snapshotId).toBe(row.snapshot_id)
    expect(res.payloadHash).toBe(row.payload_hash)
    expect(res.reused).toBe(false)
  })

  it('is idempotent: a replay with the same key returns the same snapshot and inserts nothing new', async () => {
    const loader = new FakeLoader()
    const store = new FakeStore()
    const first = await createStylistSnapshot({ stylistId: STYLIST_ID, loader, store, idempotencyKey: 'k1' })
    loader.loadStylist.mockClear()
    const second = await createStylistSnapshot({ stylistId: STYLIST_ID, loader, store, idempotencyKey: 'k1' })
    expect(second.snapshotId).toBe(first.snapshotId)
    expect(second.payloadHash).toBe(first.payloadHash)
    expect(second.reused).toBe(true)
    expect(store.rows).toHaveLength(1)
    // Replay short-circuits before reloading mutable stylist state.
    expect(loader.loadStylist).not.toHaveBeenCalled()
  })

  it('generation and subjective checking consume the identical persisted snapshot id and hash', async () => {
    const loader = new FakeLoader()
    const store = new FakeStore()
    const created = await createStylistSnapshot({ stylistId: STYLIST_ID, loader, store, idempotencyKey: 'k1' })
    // Two independent consumers resolve the snapshot by key; both see the same id/hash/payload.
    const genView = await store.findByIdempotencyKey('k1')
    // Source stylist state mutates after the snapshot was frozen.
    loader.loadConfirmedInspiration.mockResolvedValueOnce([])
    const checkView = await store.findByIdempotencyKey('k1')
    expect(genView?.snapshot_id).toBe(created.snapshotId)
    expect(checkView?.snapshot_id).toBe(created.snapshotId)
    expect(genView?.payload_hash).toBe(checkView?.payload_hash)
    expect(genView?.payload).toEqual(checkView?.payload)
  })
})
