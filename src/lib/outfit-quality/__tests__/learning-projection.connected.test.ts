// Connected proof, against the REAL database adapter and the connected MYRA
// Platform project, with uniquely tagged data_partition='test' rows and
// exact-ID cleanup (oq_test_cleanup, dependency-safe order):
//
//   1. TEST PARTITION IS INERT (VAL-LEARN-003 at the database boundary): a
//      decided-then-undone test review writes ZERO learning projections and
//      ZERO compensations.
//   2. PROVENANCE + CLEANUP (VAL-DATA-005): one manually inserted ledger row
//      joins exactly to its event → version → case → batch run/partition, the
//      scope/target CHECK constraint rejects malformed rows, and exact-ID
//      cleanup removes only the recorded rows.
//   3. Non-test partitions, evaluation profiles, members, and the 444 legacy
//      evidence rows are observed read-only before/after and never touched.
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
import { decideCandidate, undoCandidateDecision } from '@/lib/outfit-quality/review-store'

const T = { timeout: 60000 }
const ACTOR = { userId: randomUUID() }

const insertedSets: Record<string, Set<string>> = {}
function record(table: string, ...ids: (string | null | undefined)[]) {
  insertedSets[table] = insertedSets[table] ?? new Set()
  for (const id of ids) if (id) insertedSets[table].add(id)
}
function recordedIds(table: string): string[] {
  return Array.from(insertedSets[table] ?? [])
}
const CLEANUP_ORDER = [
  'outfit_quality_learning_projection',
  'outfit_quality_render_job',
  'outfit_quality_promotion',
  'outfit_item',
  'outfit',
  'outfit_quality_review_event',
  'outfit_quality_machine_check',
  'outfit_quality_candidate_item',
  'outfit_quality_candidate_version',
  'outfit_quality_case',
  'outfit_quality_batch',
]
const DIRECT_DELETE_TABLES = new Set(['outfit_item', 'outfit'])
const PK: Record<string, string> = {
  outfit_quality_learning_projection: 'projection_id',
  outfit_quality_render_job: 'render_job_id',
  outfit_quality_promotion: 'promotion_id',
  outfit_item: 'outfit_item_id',
  outfit: 'outfit_id',
  outfit_quality_review_event: 'review_event_id',
  outfit_quality_machine_check: 'check_id',
  outfit_quality_candidate_item: 'candidate_item_id',
  outfit_quality_candidate_version: 'candidate_version_id',
  outfit_quality_case: 'case_id',
  outfit_quality_batch: 'batch_id',
}

describe.skipIf(!CONNECTED)('learning projections — connected proof (test partition)', () => {
  const admin: any = createAdminClient()
  const protectedCounts: Record<string, number> = {}
  // Rows created before this timestamp are pre-existing; connected suites run
  // in parallel against the live project, so global counts must exclude rows
  // another suite may insert mid-flight. This suite's own inserts are proven
  // removed by the exact-ID zero-residue check, not by global counts.
  const runStart = new Date().toISOString()

  async function countPreExisting(table: string, pk: string): Promise<number> {
    const { count, error } = await admin.from(table).select(pk, { count: 'exact', head: true }).lt('created_at', runStart)
    if (error) throw new Error(`protected count failed for ${table}: ${error.message}`)
    return count ?? -1
  }

  afterAll(async () => {
    for (const table of CLEANUP_ORDER) {
      const ids = recordedIds(table)
      if (ids.length === 0) continue
      if (DIRECT_DELETE_TABLES.has(table)) {
        const { error } = await admin.from(table).delete().in(PK[table], ids)
        if (error) throw new Error(`cleanup failed for ${table}: ${error.message}`)
        continue
      }
      const { data, error } = await admin.rpc('oq_test_cleanup', { p_table: table, p_ids: ids })
      if (error) throw new Error(`cleanup failed for ${table}: ${error.message}`)
      expect(data).toBe(ids.length)
    }
    // Zero residue for every recorded table.
    for (const table of CLEANUP_ORDER) {
      const ids = recordedIds(table)
      if (!ids.length) continue
      const { data } = await admin.from(table).select(PK[table]).in(PK[table], ids)
      expect(data ?? []).toHaveLength(0)
    }
    // Protected, pre-existing evidence is unchanged.
    expect(await countPreExisting('outfit_quality_legacy_evidence', 'outfit_id')).toBe(protectedCounts.legacy)
    expect(await countPreExisting('outfit', 'outfit_id')).toBe(protectedCounts.outfits)
    expect(await countPreExisting('pilot_member', 'member_id')).toBe(protectedCounts.members)
  })

  it('test-partition reviews are inert, the ledger is CHECK-guarded and provenance-joined, and cleanup is exact', T, async () => {
    // Read-only baseline of protected pre-existing rows.
    protectedCounts.legacy = await countPreExisting('outfit_quality_legacy_evidence', 'outfit_id')
    protectedCounts.outfits = await countPreExisting('outfit', 'outfit_id')
    protectedCounts.members = await countPreExisting('pilot_member', 'member_id')
    expect(protectedCounts.legacy).toBe(444)

    const { data: batch, error: bErr } = await admin
      .from('outfit_quality_batch')
      .insert({
        run_id: randomUUID(),
        data_partition: 'test',
        real_member_id: REAL_MEMBER_IDS.chloe,
        evaluation_profile_id: null,
        selected_stylist_id: CHLOE_STYLIST_ID,
        target_count: 5,
        chunk_limit: 25,
        status: 'active',
      })
      .select('*')
      .maybeSingle()
    expect(bErr).toBeNull()
    record('outfit_quality_batch', batch.batch_id)

    const { data: itemRows, error: iErr } = await admin.from('item').select('item_id, image_url').not('image_url', 'is', null).limit(1)
    expect(iErr).toBeNull()
    const realItem = itemRows[0]

    const store = createCandidatePersistence({ admin, batch, systemVersions: SNAPSHOT_SYSTEM_VERSIONS })
    const persisted = await store.persistCandidate({
      position: 0,
      generationRequestKey: `${randomUUID()}:${batch.batch_id}:0`,
      compositionHash: createHash('sha256').update(randomUUID()).digest('hex'),
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
      candidate: {
        requiredSlots: ['top'],
        items: [
          { item_id: realItem.item_id, slot: 'top', sort_order: 0, item_snapshot: { item_type: 'shirt' }, source_image_url: realItem.image_url },
        ],
      },
    })
    record('outfit_quality_case', persisted.caseId)
    record('outfit_quality_candidate_version', persisted.candidateVersionId)
    record('outfit_quality_candidate_item', ...persisted.items.map((i) => i.candidate_item_id))
    await store.setVersionState(persisted.candidateVersionId, 'awaiting_human')

    // Decide YES then UNDO — the test partition must produce no learning rows.
    const decide = await decideCandidate(persisted.candidateVersionId, { decision: 'yes', idempotencyKey: randomUUID() }, ACTOR, admin)
    expect(decide).toMatchObject({ ok: true, nextState: 'approved' })
    if (!decide.ok) throw new Error('decide failed')
    record('outfit_quality_review_event', decide.event.review_event_id)
    // Approval side effects (promotion + render job) exist even for test rows;
    // record them for exact cleanup.
    const { data: jobs } = await admin.from('outfit_quality_render_job').select('render_job_id').eq('candidate_version_id', persisted.candidateVersionId)
    record('outfit_quality_render_job', ...(jobs ?? []).map((j: any) => j.render_job_id))
    const { data: promotions } = await admin.from('outfit_quality_promotion').select('promotion_id, outfit_id').eq('candidate_version_id', persisted.candidateVersionId)
    record('outfit_quality_promotion', ...(promotions ?? []).map((p: any) => p.promotion_id))
    for (const p of promotions ?? []) {
      record('outfit', p.outfit_id)
      const { data: memberships } = await admin.from('outfit_item').select('outfit_item_id').eq('outfit_id', p.outfit_id)
      record('outfit_item', ...(memberships ?? []).map((m: any) => m.outfit_item_id))
    }

    let { data: projections } = await admin
      .from('outfit_quality_learning_projection')
      .select('projection_id')
      .eq('candidate_version_id', persisted.candidateVersionId)
    expect(projections ?? [], 'test partition must be learning-inert').toHaveLength(0)

    const undo = await undoCandidateDecision(persisted.candidateVersionId, { idempotencyKey: randomUUID() }, ACTOR, admin)
    expect(undo).toMatchObject({ ok: true, reversedDecision: 'yes' })
    if (!undo.ok) throw new Error('undo failed')
    record('outfit_quality_review_event', undo.event.review_event_id)
    ;({ data: projections } = await admin
      .from('outfit_quality_learning_projection')
      .select('projection_id')
      .eq('candidate_version_id', persisted.candidateVersionId))
    expect(projections ?? [], 'a test reversal creates no compensations').toHaveLength(0)

    // The ledger's scope/target CHECK rejects malformed rows at the boundary.
    const badStylist = await admin.from('outfit_quality_learning_projection').insert({
      review_event_id: decide.event.review_event_id,
      candidate_version_id: persisted.candidateVersionId,
      scope: 'stylist',
      target_stylist_id: null,
      polarity: 'positive',
      application_key: `probe-stylist-no-target:${randomUUID()}`,
    })
    expect(badStylist.error?.code).toBe('23514')
    const badGlobal = await admin.from('outfit_quality_learning_projection').insert({
      review_event_id: decide.event.review_event_id,
      candidate_version_id: persisted.candidateVersionId,
      scope: 'global_quality',
      target_stylist_id: CHLOE_STYLIST_ID,
      polarity: 'positive',
      application_key: `probe-global-with-target:${randomUUID()}`,
    })
    expect(badGlobal.error?.code).toBe('23514')

    // A well-formed ledger row joins exactly to run/partition provenance.
    const probeKey = `probe-valid:${randomUUID()}`
    const { data: inserted, error: insErr } = await admin
      .from('outfit_quality_learning_projection')
      .insert({
        review_event_id: decide.event.review_event_id,
        candidate_version_id: persisted.candidateVersionId,
        scope: 'global_quality',
        target_stylist_id: null,
        polarity: 'positive',
        payload: { source: 'connected_probe' },
        status: 'applied',
        application_key: probeKey,
      })
      .select('projection_id')
      .maybeSingle()
    expect(insErr).toBeNull()
    record('outfit_quality_learning_projection', inserted.projection_id)

    const { data: joined } = await admin
      .from('outfit_quality_learning_projection')
      .select('projection_id, review_event_id, candidate_version_id')
      .eq('projection_id', inserted.projection_id)
      .maybeSingle()
    expect(joined.review_event_id).toBe(decide.event.review_event_id)
    const { data: caseRow } = await admin.from('outfit_quality_case').select('batch_id, data_partition, selected_stylist_id').eq('case_id', persisted.caseId).maybeSingle()
    const { data: batchRow } = await admin.from('outfit_quality_batch').select('run_id, data_partition').eq('batch_id', caseRow.batch_id).maybeSingle()
    expect(caseRow).toMatchObject({ data_partition: 'test', selected_stylist_id: CHLOE_STYLIST_ID })
    expect(batchRow).toMatchObject({ run_id: batch.run_id, data_partition: 'test' })

    // Ledger rows are immutable: a direct update is refused by the trigger.
    const upd = await admin.from('outfit_quality_learning_projection').update({ polarity: 'negative' }).eq('projection_id', inserted.projection_id)
    expect(upd.error, 'projection UPDATE must be rejected').toBeTruthy()

    // afterAll performs the exact-ID cleanup and zero-residue proof.
  })
})
