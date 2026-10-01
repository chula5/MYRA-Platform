// Connected proof, against the REAL database adapter and the connected MYRA
// Platform project, with uniquely tagged data_partition='test' rows and
// exact-ID cleanup:
//
//   1. ATOMIC CLAIMS. Two overlapping oq_claim_positions calls on one batch
//      serialize on the batch row lock: the claimed ranges are disjoint and
//      their sum never exceeds target_count. A full batch and a paused batch
//      reject the claim. Released reservations become claimable again, so a
//      failed chunk never leaves orphan capacity.
//
//   2. CASE CAPACITY GUARD. A case insert past the batch target is rejected at
//      the database boundary.
//
//   3. ERROR-CHECKED PERSISTENCE. Against the real adapter: a failed items
//      insert (FK violation), a duplicate objective idempotency key, and
//      malformed-uuid state writes all throw — the flow aborts instead of
//      silently advancing the candidate. A happy-path persistCandidate and a
//      parent-linked persistChildVersion commit and are verifiable.
//
// The suite self-skips when Supabase env is unavailable.

import { describe, it, expect, afterAll } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { randomUUID, createHash } from 'node:crypto'

function ensureEnv(): boolean {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    try {
      const text = readFileSync(path.resolve(process.cwd(), '.env.local'), 'utf8')
      for (const line of text.split('\n')) {
        const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
        if (!m) continue
        if (!(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
      }
    } catch {
      // No env file — the suite skips below.
    }
  }
  return !!(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)
}

const CONNECTED = ensureEnv()

import { createAdminClient } from '@/lib/supabase-server'
import { createCandidatePersistence } from '@/lib/outfit-quality/candidate-store'
import { SNAPSHOT_SYSTEM_VERSIONS } from '@/lib/outfit-quality/stylist-snapshot'
import { CHLOE_STYLIST_ID, REAL_MEMBER_IDS } from '@/lib/outfit-quality/identities'

const T = { timeout: 60000 }

// Every exact id this run inserted, per table, cleaned in dependency order.
const insertedSets: Record<string, Set<string>> = {}
function record(table: string, ...ids: (string | null | undefined)[]) {
  insertedSets[table] = insertedSets[table] ?? new Set()
  for (const id of ids) if (id) insertedSets[table].add(id)
}
function recordedIds(table: string): string[] {
  return Array.from(insertedSets[table] ?? [])
}
const CLEANUP_ORDER = [
  'outfit_quality_machine_check',
  'outfit_quality_candidate_item',
  'outfit_quality_candidate_version',
  'outfit_quality_case',
  'outfit_quality_batch',
]

async function cleanup(admin: any) {
  for (const table of CLEANUP_ORDER) {
    const ids = recordedIds(table)
    if (ids.length === 0) continue
    const { data, error } = await admin.rpc('oq_test_cleanup', { p_table: table, p_ids: ids })
    if (error) throw new Error(`cleanup failed for ${table}: ${error.message}`)
    expect(data).toBe(ids.length)
  }
}

describe.skipIf(!CONNECTED)('chunk claims + persistence errors — connected proof (test partition)', () => {
  const admin: any = createAdminClient()

  afterAll(async () => {
    await cleanup(admin)
    // Verify zero residue: no recorded id survives.
    for (const table of CLEANUP_ORDER) {
      const ids = recordedIds(table)
      if (!ids.length) continue
      const pk =
        table === 'outfit_quality_batch' ? 'batch_id'
        : table === 'outfit_quality_case' ? 'case_id'
        : table === 'outfit_quality_candidate_version' ? 'candidate_version_id'
        : table === 'outfit_quality_candidate_item' ? 'candidate_item_id'
        : 'check_id'
      const { data } = await admin.from(table).select(pk).in(pk, ids)
      expect(data ?? []).toHaveLength(0)
    }
  })

  async function makeBatch(opts: { target: number; status?: string }): Promise<string> {
    const { data, error } = await admin
      .from('outfit_quality_batch')
      .insert({
        run_id: randomUUID(), // run_id is UNIQUE: one per batch, all tagged test
        data_partition: 'test',
        real_member_id: REAL_MEMBER_IDS.chloe,
        evaluation_profile_id: null,
        selected_stylist_id: CHLOE_STYLIST_ID,
        target_count: opts.target,
        chunk_limit: 25,
        status: opts.status ?? 'active',
      })
      .select('batch_id')
      .maybeSingle()
    expect(error).toBeNull()
    record('outfit_quality_batch', data.batch_id)
    return data.batch_id
  }

  it('two overlapping chunk claims cannot claim the same positions or exceed the target', T, async () => {
    const batchId = await makeBatch({ target: 4 })

    // Two overlapping explicit actions, each asking for 3 of 4 positions.
    const [a, b] = await Promise.all([
      admin.rpc('oq_claim_positions', { p_batch_id: batchId, p_requested: 3 }),
      admin.rpc('oq_claim_positions', { p_batch_id: batchId, p_requested: 3 }),
    ])
    expect(a.error).toBeNull()
    expect(b.error).toBeNull()
    const ra = a.data[0]
    const rb = b.data[0]

    // Disjoint ranges, each bounded by the request and the remaining capacity.
    expect(ra.claim + rb.claim).toBe(4)
    const ranges = [
      [ra.start_position, ra.start_position + ra.claim],
      [rb.start_position, rb.start_position + rb.claim],
    ].sort((x, y) => x[0] - y[0])
    expect(ranges[0][0]).toBe(0)
    expect(ranges[0][1]).toBeLessThanOrEqual(ranges[1][0])
    expect(ranges[1][1]).toBe(4)

    // A third claim finds no remaining positions.
    const third = await admin.rpc('oq_claim_positions', { p_batch_id: batchId, p_requested: 1 })
    expect(third.error?.message).toMatch(/no remaining positions/)

    const { data: row } = await admin.from('outfit_quality_batch').select('claimed_count').eq('batch_id', batchId).maybeSingle()
    expect(row.claimed_count).toBe(4)
  })

  it('a paused batch rejects a claim; nothing is reserved', T, async () => {
    const batchId = await makeBatch({ target: 2, status: 'paused' })
    const res = await admin.rpc('oq_claim_positions', { p_batch_id: batchId, p_requested: 1 })
    expect(res.error?.message).toMatch(/cannot claim new work/)
    const { data: row } = await admin.from('outfit_quality_batch').select('claimed_count').eq('batch_id', batchId).maybeSingle()
    expect(row.claimed_count).toBe(0)
  })

  it('releasing unproduced reservations makes the positions claimable again (no orphan capacity)', T, async () => {
    const batchId = await makeBatch({ target: 2 })
    const first = await admin.rpc('oq_claim_positions', { p_batch_id: batchId, p_requested: 2 })
    expect(first.error).toBeNull()
    expect(first.data[0]).toMatchObject({ claim: 2, start_position: 0 })

    // The chunk failed before producing anything: both reservations come back.
    const rel = await admin.rpc('oq_release_positions', { p_batch_id: batchId, p_count: 2 })
    expect(rel.error).toBeNull()

    const second = await admin.rpc('oq_claim_positions', { p_batch_id: batchId, p_requested: 1 })
    expect(second.error).toBeNull()
    expect(second.data[0]).toMatchObject({ claim: 1, start_position: 0 })
  })

  it('the case guard rejects an insert past the batch target, even outside the claim path', T, async () => {
    const batchId = await makeBatch({ target: 2 })
    const base = {
      batch_id: batchId,
      data_partition: 'test',
      real_member_id: REAL_MEMBER_IDS.chloe,
      evaluation_profile_id: null,
      selected_stylist_id: CHLOE_STYLIST_ID,
      stylist_snapshot_id: null,
      source: 'generated',
      status: 'open',
    }
    for (let i = 0; i < 2; i++) {
      const { data, error } = await admin.from('outfit_quality_case').insert(base).select('case_id').maybeSingle()
      expect(error).toBeNull()
      record('outfit_quality_case', data.case_id)
    }
    const third = await admin.from('outfit_quality_case').insert(base).select('case_id').maybeSingle()
    expect(third.error?.message).toMatch(/no remaining candidate capacity/)
    expect(third.data).toBeNull()
  })

  it('persistence against the real adapter: happy path commits; every failing write throws', T, async () => {
    const batchId = await makeBatch({ target: 10 })
    const { data: batch } = await admin.from('outfit_quality_batch').select('*').eq('batch_id', batchId).maybeSingle()

    // A real item for the FK-bound candidate items.
    const { data: itemRows, error: itemReadErr } = await admin
      .from('item')
      .select('item_id, image_url')
      .not('image_url', 'is', null)
      .limit(1)
    expect(itemReadErr).toBeNull()
    const realItem = itemRows[0]

    const store = createCandidatePersistence({ admin, batch, systemVersions: SNAPSHOT_SYSTEM_VERSIONS })
    const candidate = {
      requiredSlots: ['top'],
      items: [
        {
          item_id: realItem.item_id,
          slot: 'top',
          sort_order: 0,
          item_snapshot: { item_type: 'shirt', brand: 'Test Brand' },
          source_image_url: realItem.image_url,
          source_image_asset_version: null,
          source_image_hash: null,
        },
      ],
    }

    // Happy path: case + version + items commit and are verifiable.
    const persisted = await store.persistCandidate({
      position: 0,
      generationRequestKey: `${randomUUID()}:${batchId}:0`,
      compositionHash: createHash('sha256').update(`${batchId}:v1`).digest('hex'),
      rulesOnly: false,
      snapshotId: 'snap',
      context: {
        dataPartition: 'test',
        realMemberId: REAL_MEMBER_IDS.chloe,
        evaluationProfileId: null,
        selectedStylistId: CHLOE_STYLIST_ID,
        contextSnapshot: { type: 'real_member', member_id: REAL_MEMBER_IDS.chloe },
      },
      systemVersions: SNAPSHOT_SYSTEM_VERSIONS,
      candidate,
    })
    record('outfit_quality_case', persisted.caseId)
    record('outfit_quality_candidate_version', persisted.candidateVersionId)
    record('outfit_quality_candidate_item', ...persisted.items.map((i) => i.candidate_item_id))

    const { data: storedItems } = await admin
      .from('outfit_quality_candidate_item')
      .select('item_id, slot, sort_order')
      .eq('candidate_version_id', persisted.candidateVersionId)
    expect(storedItems).toHaveLength(1)
    expect(storedItems[0]).toMatchObject({ item_id: realItem.item_id, slot: 'top', sort_order: 0 })

    // Objective checks record once; a duplicate idempotency key now THROWS
    // (previously the error was silently dropped and the flow advanced).
    const outcomes = [{ check_name: 'valid_structure', status: 'passed' as const }]
    await store.recordObjectiveChecks(persisted.candidateVersionId, outcomes)
    const { data: checks } = await admin
      .from('outfit_quality_machine_check')
      .select('check_id')
      .eq('candidate_version_id', persisted.candidateVersionId)
    record('outfit_quality_machine_check', ...(checks ?? []).map((c: any) => c.check_id))
    await expect(store.recordObjectiveChecks(persisted.candidateVersionId, outcomes)).rejects.toThrow(/objective check insert failed/)

    // Malformed-id writes surface their Supabase error instead of succeeding
    // silently.
    await expect(store.recordSubjectiveCheck('not-a-uuid', { status: 'passed' })).rejects.toThrow(/subjective check insert failed/)
    await expect(store.setVersionState('not-a-uuid', 'awaiting_human')).rejects.toThrow(/version state update failed/)
    await expect(store.setCaseStatus('not-a-uuid', 'awaiting_human', persisted.candidateVersionId)).rejects.toThrow(/case status update failed/)

    // A failed items insert (FK violation) aborts persistCandidate: it throws,
    // and the caller can see the failure instead of advancing the candidate.
    await expect(
      store.persistCandidate({
        position: 1,
        generationRequestKey: `${randomUUID()}:${batchId}:1`,
        compositionHash: createHash('sha256').update(`${batchId}:v2`).digest('hex'),
        rulesOnly: false,
        snapshotId: 'snap',
        context: {
          dataPartition: 'test',
          realMemberId: REAL_MEMBER_IDS.chloe,
          evaluationProfileId: null,
          selectedStylistId: CHLOE_STYLIST_ID,
          contextSnapshot: {},
        },
        systemVersions: SNAPSHOT_SYSTEM_VERSIONS,
        candidate: {
          requiredSlots: ['top'],
          items: [
            {
              item_id: randomUUID(), // no such item — FK violation
              slot: 'top',
              sort_order: 0,
              item_snapshot: { item_type: 'shirt', brand: 'Ghost' },
              source_image_url: 'https://cdn.invalid/x.jpg',
            },
          ],
        },
      }),
    ).rejects.toThrow(/candidate items insert failed/)
    // The partial case/version rows from the aborted persist are this run's own
    // tagged rows; find them by the exact batch and record them for cleanup.
    const { data: orphanCases } = await admin.from('outfit_quality_case').select('case_id').eq('batch_id', batchId)
    record('outfit_quality_case', ...(orphanCases ?? []).map((c: any) => c.case_id))
    const { data: orphanVersions } = await admin
      .from('outfit_quality_candidate_version')
      .select('candidate_version_id')
      .in('case_id', (orphanCases ?? []).map((c: any) => c.case_id))
    record('outfit_quality_candidate_version', ...(orphanVersions ?? []).map((v: any) => v.candidate_version_id))

    // The edit path's persistence: a parent-linked child commits with its
    // ordered items and moves the case pointer.
    const child = await store.persistChildVersion({
      caseId: persisted.caseId,
      plan: {
        parentVersionId: persisted.candidateVersionId,
        versionNo: 2,
        compositionHash: createHash('sha256').update(`${batchId}:v3`).digest('hex'),
        generationRequestKey: `edit:${persisted.candidateVersionId}:${randomUUID()}`,
        inheritsChecks: false,
        inheritsApproval: false,
      },
      contextSnapshot: { type: 'real_member', member_id: REAL_MEMBER_IDS.chloe },
      systemVersions: SNAPSHOT_SYSTEM_VERSIONS,
      candidate,
    })
    record('outfit_quality_candidate_version', child.candidateVersionId)
    record('outfit_quality_candidate_item', ...child.items.map((i) => i.candidate_item_id))

    const { data: childRow } = await admin
      .from('outfit_quality_candidate_version')
      .select('parent_version_id, version_no, state')
      .eq('candidate_version_id', child.candidateVersionId)
      .maybeSingle()
    expect(childRow).toMatchObject({ parent_version_id: persisted.candidateVersionId, version_no: 2, state: 'generated' })

    const { data: caseRow } = await admin
      .from('outfit_quality_case')
      .select('current_version_id')
      .eq('case_id', persisted.caseId)
      .maybeSingle()
    expect(caseRow.current_version_id).toBe(child.candidateVersionId)
  })
})
