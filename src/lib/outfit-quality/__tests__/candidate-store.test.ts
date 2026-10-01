// Unit proof that the REAL persistence wiring checks every Supabase error:
// each failing write throws, so the pipeline aborts instead of silently
// advancing the candidate. The connected suite proves the same against the
// live database adapter with tagged test rows.

import { describe, it, expect } from 'vitest'
import { createCandidatePersistence, editCandidateVersion } from '@/lib/outfit-quality/candidate-store'
import { SNAPSHOT_SYSTEM_VERSIONS } from '@/lib/outfit-quality/stylist-snapshot'
import type { GeneratedCandidate, GeneratedItem } from '@/lib/outfit-quality/candidate-generation'
import type { RuleOutcome } from '@/lib/outfit-quality/objective-checks'

// ── A minimal fake Supabase admin client ──────────────────────────────────────

type Result = { data?: any; error?: any; count?: number }
type Call = { kind: string; table?: string; fn?: string; op?: string; payload?: any; args?: any; filters: [string, unknown][] }

function chainable(result: Result, call: Call): any {
  const self: any = {
    then: (res: any, rej: any) => Promise.resolve(result).then(res, rej),
    catch: (rej: any) => Promise.resolve(result).catch(rej),
    select: () => self,
    eq: (col: string, val: unknown) => {
      call.filters.push([col, val])
      return self
    },
    in: () => self,
    is: () => self,
    not: () => self,
    order: () => self,
    limit: () => self,
    maybeSingle: () => Promise.resolve(result),
    single: () => Promise.resolve(result),
  }
  return self
}

function fakeAdmin(tables: Record<string, (op: string, payload?: any) => Result>) {
  const calls: Call[] = []
  const admin: any = {
    calls,
    from(table: string) {
      const run = (op: string, payload?: any) => {
        const call: Call = { kind: 'table', table, op, payload, filters: [] }
        calls.push(call)
        const h = tables[table]
        return chainable(h ? h(op, payload) : { data: null, error: null }, call)
      }
      return {
        select: (cols?: any, opts?: any) => run(`select:${typeof cols === 'string' ? cols : '*'}`, opts),
        insert: (payload: any) => run('insert', payload),
        update: (payload: any) => run('update', payload),
      }
    },
  }
  return admin
}

const BATCH = {
  batch_id: 'b1',
  data_partition: 'test',
  real_member_id: 'm-1',
  evaluation_profile_id: null,
  selected_stylist_id: 'sty-1',
  stylist_snapshot_id: 'snap-1',
}

function item(id: string, slot: string, sort_order: number): GeneratedItem {
  return {
    item_id: id,
    slot,
    sort_order,
    item_snapshot: { item_type: 'shirt', brand: 'Arket' },
    source_image_url: 'https://cdn/x.jpg',
    source_image_asset_version: null,
    source_image_hash: 'h',
  }
}

function candidate(): GeneratedCandidate {
  return { requiredSlots: ['top', 'bottom'], items: [item('i1', 'top', 0), item('i2', 'bottom', 1)] }
}

const PERSIST_INPUT = {
  position: 0,
  generationRequestKey: 'run:b1:0',
  compositionHash: 'h'.repeat(64),
  rulesOnly: false,
  snapshotId: 'snap-1',
  context: { dataPartition: 'test', realMemberId: 'm-1', evaluationProfileId: null, selectedStylistId: 'sty-1', contextSnapshot: {} },
  systemVersions: SNAPSHOT_SYSTEM_VERSIONS,
  candidate: candidate(),
}

const OBJECTIVE: RuleOutcome[] = [{ check_name: 'valid_structure', status: 'passed' }]

/** A db where every write succeeds and returns sensible rows. */
function happyAdmin() {
  return fakeAdmin({
    outfit_quality_case: (op) =>
      op === 'insert' ? { data: { case_id: 'case-1' }, error: null } : { data: null, error: null },
    outfit_quality_candidate_version: (op) =>
      op === 'insert' ? { data: { candidate_version_id: 'cv-1' }, error: null } : { data: null, error: null },
    outfit_quality_candidate_item: () => ({
      data: [
        { candidate_item_id: 'ci-1', item_id: 'i1', slot: 'top' },
        { candidate_item_id: 'ci-2', item_id: 'i2', slot: 'bottom' },
      ],
      error: null,
    }),
    outfit_quality_machine_check: () => ({ data: null, error: null }),
  })
}

describe('createCandidatePersistence — every Supabase error is checked', () => {
  it('persists case, version, and ordered items, then points the case at the version', async () => {
    const db = happyAdmin()
    const store = createCandidatePersistence({ admin: db, batch: BATCH, systemVersions: SNAPSHOT_SYSTEM_VERSIONS })
    const persisted = await store.persistCandidate(PERSIST_INPUT as any)
    expect(persisted).toMatchObject({ caseId: 'case-1', candidateVersionId: 'cv-1' })
    const order = db.calls.map((c: Call) => `${c.table}:${c.op}`)
    expect(order).toEqual([
      'outfit_quality_case:insert',
      'outfit_quality_candidate_version:insert',
      'outfit_quality_candidate_item:insert',
      'outfit_quality_case:update',
    ])
    // Ordered items carry their sort_order.
    const itemsPayload = db.calls.find((c: Call) => c.table === 'outfit_quality_candidate_item')?.payload
    expect(itemsPayload.map((r: any) => r.sort_order)).toEqual([0, 1])
  })

  it('a failed case insert throws', async () => {
    const db = fakeAdmin({ outfit_quality_case: () => ({ data: null, error: { message: 'case references an unknown batch' } }) })
    const store = createCandidatePersistence({ admin: db, batch: BATCH, systemVersions: SNAPSHOT_SYSTEM_VERSIONS })
    await expect(store.persistCandidate(PERSIST_INPUT as any)).rejects.toThrow(/case insert failed/)
  })

  it('a failed version insert throws', async () => {
    const db = fakeAdmin({
      outfit_quality_case: () => ({ data: { case_id: 'case-1' }, error: null }),
      outfit_quality_candidate_version: () => ({ data: null, error: { message: 'duplicate key value' } }),
    })
    const store = createCandidatePersistence({ admin: db, batch: BATCH, systemVersions: SNAPSHOT_SYSTEM_VERSIONS })
    await expect(store.persistCandidate(PERSIST_INPUT as any)).rejects.toThrow(/candidate version insert failed/)
  })

  it('a failed items insert throws', async () => {
    const db = fakeAdmin({
      outfit_quality_case: () => ({ data: { case_id: 'case-1' }, error: null }),
      outfit_quality_candidate_version: () => ({ data: { candidate_version_id: 'cv-1' }, error: null }),
      outfit_quality_candidate_item: () => ({ data: null, error: { message: 'violates foreign key constraint' } }),
    })
    const store = createCandidatePersistence({ admin: db, batch: BATCH, systemVersions: SNAPSHOT_SYSTEM_VERSIONS })
    await expect(store.persistCandidate(PERSIST_INPUT as any)).rejects.toThrow(/candidate items insert failed/)
  })

  it('a failed case-pointer update throws', async () => {
    const db = fakeAdmin({
      outfit_quality_case: (op) =>
        op === 'insert' ? { data: { case_id: 'case-1' }, error: null } : { data: null, error: { message: 'case attribution is immutable' } },
      outfit_quality_candidate_version: () => ({ data: { candidate_version_id: 'cv-1' }, error: null }),
      outfit_quality_candidate_item: () => ({ data: [], error: null }),
    })
    const store = createCandidatePersistence({ admin: db, batch: BATCH, systemVersions: SNAPSHOT_SYSTEM_VERSIONS })
    await expect(store.persistCandidate(PERSIST_INPUT as any)).rejects.toThrow(/case pointer update failed/)
  })

  it('a failed objective-check insert throws', async () => {
    const db = fakeAdmin({
      outfit_quality_machine_check: () => ({ data: null, error: { message: 'duplicate idempotency key' } }),
    })
    const store = createCandidatePersistence({ admin: db, batch: BATCH, systemVersions: SNAPSHOT_SYSTEM_VERSIONS })
    await expect(store.recordObjectiveChecks('cv-1', OBJECTIVE)).rejects.toThrow(/objective check insert failed/)
  })

  it('a failed subjective-check insert throws', async () => {
    const db = fakeAdmin({
      outfit_quality_machine_check: () => ({ data: null, error: { message: 'connection reset' } }),
    })
    const store = createCandidatePersistence({ admin: db, batch: BATCH, systemVersions: SNAPSHOT_SYSTEM_VERSIONS })
    await expect(store.recordSubjectiveCheck('cv-1', { status: 'passed', verdict: 'works' })).rejects.toThrow(/subjective check insert failed/)
  })

  it('a failed version-state update throws', async () => {
    const db = fakeAdmin({
      outfit_quality_candidate_version: () => ({ data: null, error: { message: 'invalid input syntax for type uuid' } }),
    })
    const store = createCandidatePersistence({ admin: db, batch: BATCH, systemVersions: SNAPSHOT_SYSTEM_VERSIONS })
    await expect(store.setVersionState('not-a-uuid', 'awaiting_human')).rejects.toThrow(/version state update failed/)
  })

  it('a failed case-status update throws', async () => {
    const db = fakeAdmin({
      outfit_quality_case: () => ({ data: null, error: { message: 'invalid input syntax for type uuid' } }),
    })
    const store = createCandidatePersistence({ admin: db, batch: BATCH, systemVersions: SNAPSHOT_SYSTEM_VERSIONS })
    await expect(store.setCaseStatus('not-a-uuid', 'awaiting_human', 'cv-1')).rejects.toThrow(/case status update failed/)
  })
})

describe('createCandidatePersistence — persistChildVersion', () => {
  const PLAN = {
    parentVersionId: 'cv-parent',
    versionNo: 2,
    compositionHash: 'c'.repeat(64),
    generationRequestKey: 'edit:cv-parent:k1',
    inheritsChecks: false as const,
    inheritsApproval: false as const,
  }

  it('inserts a parent-linked child version and its ordered items, then moves the case pointer', async () => {
    const db = happyAdmin()
    const store = createCandidatePersistence({ admin: db, batch: BATCH, systemVersions: SNAPSHOT_SYSTEM_VERSIONS })
    const persisted = await store.persistChildVersion({
      caseId: 'case-1',
      plan: PLAN,
      contextSnapshot: { ctx: 1 },
      systemVersions: SNAPSHOT_SYSTEM_VERSIONS,
      candidate: candidate(),
    })
    expect(persisted).toMatchObject({ caseId: 'case-1', candidateVersionId: 'cv-1' })
    const versionPayload = db.calls.find((c: Call) => c.table === 'outfit_quality_candidate_version' && c.op === 'insert')?.payload
    expect(versionPayload).toMatchObject({
      case_id: 'case-1',
      version_no: 2,
      parent_version_id: 'cv-parent',
      generation_request_key: 'edit:cv-parent:k1',
      state: 'generated',
    })
    // No case row is inserted for an edit — the child lives on the same case.
    expect(db.calls.some((c: Call) => c.table === 'outfit_quality_case' && c.op === 'insert')).toBe(false)
  })

  it('a failed child version insert throws', async () => {
    const db = fakeAdmin({
      outfit_quality_candidate_version: () => ({ data: null, error: { message: 'duplicate composition hash' } }),
    })
    const store = createCandidatePersistence({ admin: db, batch: BATCH, systemVersions: SNAPSHOT_SYSTEM_VERSIONS })
    await expect(
      store.persistChildVersion({ caseId: 'case-1', plan: PLAN, contextSnapshot: {}, systemVersions: SNAPSHOT_SYSTEM_VERSIONS, candidate: candidate() }),
    ).rejects.toThrow(/child version insert failed/)
  })
})

// ── The wired edit path (fake db, deterministic injected checks) ──────────────

const PARENT_VERSION_ID = '11111111-1111-4111-8111-111111111111'
const CHILD_VERSION_ID = '22222222-2222-4222-8222-222222222222'
const ITEM_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const ITEM_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const ITEM_C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'

function editAdmin(overrides: Record<string, (op: string, payload?: any) => Result> = {}) {
  return fakeAdmin({
    outfit_quality_candidate_version: (op, payload) => {
      if (op === 'insert') return { data: { candidate_version_id: CHILD_VERSION_ID }, error: null }
      if (op === 'select:*') return { data: { candidate_version_id: PARENT_VERSION_ID, case_id: 'case-1', version_no: 1, context_snapshot: { ctx: 'frozen' }, state: 'awaiting_human' }, error: null }
      // idempotency probe by generation_request_key → no existing child
      return { data: null, error: null }
    },
    outfit_quality_case: () => ({
      data: { case_id: 'case-1', batch_id: 'b1' },
      error: null,
    }),
    outfit_quality_batch: () => ({
      data: {
        batch_id: 'b1',
        data_partition: 'test',
        real_member_id: 'm-1',
        evaluation_profile_id: null,
        selected_stylist_id: 'sty-1',
        stylist_snapshot_id: 'snap-1',
      },
      error: null,
    }),
    outfit_quality_stylist_snapshot: () => ({
      data: { snapshot_id: 'snap-1', payload_hash: 'hash-1', rules_only: false, payload: { stylist: { stylist_id: 'sty-1' } } },
      error: null,
    }),
    outfit_quality_candidate_item: (op) =>
      op.startsWith('select')
        ? { data: [{ slot: 'top' }, { slot: 'bottom' }, { slot: 'shoe' }], error: null }
        : { data: [], error: null },
    item: () => ({
      data: [
        { item_id: ITEM_A, item_type: 'shirt', brand: { name: 'Arket' }, image_url: 'https://cdn/a.jpg', status: 'live', stock_status: 'in_stock' },
        { item_id: ITEM_B, item_type: 'trousers', brand: { name: 'Toteme' }, image_url: 'https://cdn/b.jpg', status: 'live', stock_status: 'in_stock' },
        { item_id: ITEM_C, item_type: 'flat', brand: { name: 'The Row' }, image_url: 'https://cdn/c.jpg', status: 'live', stock_status: 'in_stock' },
      ],
      error: null,
    }),
    outfit_quality_machine_check: () => ({ data: null, error: null }),
    ...overrides,
  })
}

const goodEvidence = {
  gather: async ({ items }: { items: { item_id: string }[] }) => ({
    size: Object.fromEntries(items.map((i) => [i.item_id, 'in_size' as const])),
    stock: Object.fromEntries(items.map((i) => [i.item_id, true])),
  }),
}

describe('editCandidateVersion — the operational edit path', () => {
  const editItems = [
    { item_id: ITEM_A, slot: 'top' },
    { item_id: ITEM_B, slot: 'bottom' },
    { item_id: ITEM_C, slot: 'shoe' },
  ]

  it('persists a checked child version end to end: parent link, ordered items, fresh checks, awaiting_human', async () => {
    const db = editAdmin()
    const check = { called: 0 }
    const res = await editCandidateVersion(
      { candidateVersionId: PARENT_VERSION_ID, items: editItems, editKey: 'k1' },
      db,
      { evidence: goodEvidence as any, subjectiveChecker: { check: async () => { check.called++; return { status: 'passed' as const, verdict: 'works' } } } },
    )
    expect(res).toMatchObject({ ok: true, candidateVersionId: CHILD_VERSION_ID, state: 'awaiting_human' })

    // Child version inserted with the parent link and the edit request key.
    const versionInsert = db.calls.find((c: Call) => c.table === 'outfit_quality_candidate_version' && c.op === 'insert')?.payload
    expect(versionInsert).toMatchObject({
      case_id: 'case-1',
      version_no: 2,
      parent_version_id: PARENT_VERSION_ID,
      generation_request_key: `edit:${PARENT_VERSION_ID}:k1`,
      state: 'generated',
    })
    // Ordered items written 0..n-1 in the edited order.
    const itemsPayload = db.calls.find((c: Call) => c.table === 'outfit_quality_candidate_item' && c.op === 'insert')?.payload
    expect(itemsPayload.map((r: any) => [r.item_id, r.slot, r.sort_order])).toEqual([
      [ITEM_A, 'top', 0],
      [ITEM_B, 'bottom', 1],
      [ITEM_C, 'shoe', 2],
    ])
    // Fresh machine checks recorded: objective rows then the subjective row.
    const checkInserts = db.calls.filter((c: Call) => c.table === 'outfit_quality_machine_check' && c.op === 'insert')
    expect(checkInserts.length).toBe(2)
    expect(check.called).toBe(1)
    // Case advanced to awaiting_human pointing at the child.
    const caseUpdates = db.calls.filter((c: Call) => c.table === 'outfit_quality_case' && c.op === 'update').map((c: Call) => c.payload)
    expect(caseUpdates.some((p: any) => p.status === 'awaiting_human' && p.current_version_id === CHILD_VERSION_ID)).toBe(true)
    // The parent version row itself was never updated: every state write
    // targets the child's id.
    const versionUpdates = db.calls.filter((c: Call) => c.table === 'outfit_quality_candidate_version' && c.op === 'update')
    expect(versionUpdates.length).toBeGreaterThan(0)
    for (const u of versionUpdates) {
      expect(u.filters).toContainEqual(['candidate_version_id', CHILD_VERSION_ID])
    }
  })

  it('is idempotent on editKey: a replay returns the existing child without writing', async () => {
    const db = editAdmin({
      outfit_quality_candidate_version: (op) => {
        if (op === 'select:candidate_version_id, state') {
          return { data: { candidate_version_id: CHILD_VERSION_ID, state: 'awaiting_human' }, error: null }
        }
        if (op === 'select:*') return { data: { candidate_version_id: PARENT_VERSION_ID, case_id: 'case-1', version_no: 1, context_snapshot: {}, state: 'awaiting_human' }, error: null }
        return { data: null, error: null }
      },
    })
    const res = await editCandidateVersion({ candidateVersionId: PARENT_VERSION_ID, items: editItems, editKey: 'k1' }, db, {
      evidence: goodEvidence as any,
      subjectiveChecker: { check: async () => ({ status: 'passed' as const }) },
    })
    expect(res).toMatchObject({ ok: true, reused: true, candidateVersionId: CHILD_VERSION_ID })
    expect(db.calls.filter((c: Call) => c.op === 'insert')).toHaveLength(0)
  })

  it('a failed machine-check insert aborts the edit and surfaces the error', async () => {
    const db = editAdmin({
      outfit_quality_machine_check: () => ({ data: null, error: { message: 'unique violation on idempotency_key' } }),
    })
    const res = await editCandidateVersion({ candidateVersionId: PARENT_VERSION_ID, items: editItems, editKey: 'k2' }, db, {
      evidence: goodEvidence as any,
      subjectiveChecker: { check: async () => ({ status: 'passed' as const }) },
    })
    expect(res.ok).toBe(false)
    expect(res.code).toBe('edit_failed')
    expect(res.message).toMatch(/objective check insert failed/)
    // The child was NOT advanced to awaiting_human.
    const caseUpdates = db.calls.filter((c: Call) => c.table === 'outfit_quality_case' && c.op === 'update').map((c: Call) => c.payload)
    expect(caseUpdates.some((p: any) => p.status === 'awaiting_human')).toBe(false)
  })

  it('rejects duplicate items, unknown items, and empty edits before any write', async () => {
    const db = editAdmin()
    const dupe = await editCandidateVersion({ candidateVersionId: PARENT_VERSION_ID, items: [editItems[0], editItems[0]] }, db, {})
    expect(dupe).toMatchObject({ ok: false, code: 'duplicate_item' })

    const unknown = await editCandidateVersion(
      { candidateVersionId: PARENT_VERSION_ID, items: [{ item_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', slot: 'top' }] },
      editAdmin(),
      {},
    )
    expect(unknown).toMatchObject({ ok: false, code: 'unknown_items' })

    const empty = await editCandidateVersion({ candidateVersionId: PARENT_VERSION_ID, items: [] }, editAdmin(), {})
    expect(empty).toMatchObject({ ok: false, code: 'empty_edit' })
  })
})
