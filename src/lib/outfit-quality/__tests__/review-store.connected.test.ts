// Connected proof, against the REAL database adapter and the connected MYRA
// Platform project, with uniquely tagged data_partition='test' rows and
// exact-ID cleanup (oq_test_cleanup, dependency-safe order):
//
//   1. HOLD/RELEASE (VAL-REVIEW-003): one attributable hold, zero review
//      decisions caused by hold or release; release restores eligibility.
//   2. DECIDE (VAL-REVIEW-002): a structured No with a valid affected item
//      persists exactly one event; replaying the key returns it without a
//      duplicate; invalid payloads write nothing.
//   3. UNDO/WITHDRAW: undo of a No returns the candidate to review; undo of a
//      queued approval cancels the render job; once running, undo is refused
//      and explicit withdrawal appends the event and hides the version.
//   4. Machine-result disclosure tracks the persisted decision exactly.
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
import {
  decideCandidate,
  undoCandidateDecision,
  withdrawCandidateApproval,
  holdCandidate,
  releaseCandidate,
  loadMachineResult,
} from '@/lib/outfit-quality/review-store'

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
  'outfit_quality_render_job',
  'outfit_quality_review_event',
  'outfit_quality_queue_hold',
  'outfit_quality_machine_check',
  'outfit_quality_candidate_item',
  'outfit_quality_candidate_version',
  'outfit_quality_case',
  'outfit_quality_batch',
]

describe.skipIf(!CONNECTED)('review store — connected proof (test partition)', () => {
  const admin: any = createAdminClient()
  let batchId: string
  let batch: any
  let realItem: any

  afterAll(async () => {
    for (const table of CLEANUP_ORDER) {
      const ids = recordedIds(table)
      if (ids.length === 0) continue
      const { data, error } = await admin.rpc('oq_test_cleanup', { p_table: table, p_ids: ids })
      if (error) throw new Error(`cleanup failed for ${table}: ${error.message}`)
      expect(data).toBe(ids.length)
    }
    // Zero residue.
    for (const table of CLEANUP_ORDER) {
      const ids = recordedIds(table)
      if (!ids.length) continue
      const pk =
        table === 'outfit_quality_batch' ? 'batch_id'
        : table === 'outfit_quality_case' ? 'case_id'
        : table === 'outfit_quality_candidate_version' ? 'candidate_version_id'
        : table === 'outfit_quality_candidate_item' ? 'candidate_item_id'
        : table === 'outfit_quality_review_event' ? 'review_event_id'
        : table === 'outfit_quality_queue_hold' ? 'hold_id'
        : table === 'outfit_quality_render_job' ? 'render_job_id'
        : 'check_id'
      const { data } = await admin.from(table).select(pk).in(pk, ids)
      expect(data ?? []).toHaveLength(0)
    }
  })

  async function setup() {
    const { data: b, error: bErr } = await admin
      .from('outfit_quality_batch')
      .insert({
        run_id: randomUUID(), // run_id is UNIQUE: one per batch
        data_partition: 'test',
        real_member_id: REAL_MEMBER_IDS.chloe,
        evaluation_profile_id: null,
        selected_stylist_id: CHLOE_STYLIST_ID,
        target_count: 20,
        chunk_limit: 25,
        status: 'active',
      })
      .select('*')
      .maybeSingle()
    expect(bErr).toBeNull()
    batch = b
    batchId = b.batch_id
    record('outfit_quality_batch', batchId)

    const { data: itemRows, error: iErr } = await admin.from('item').select('item_id, image_url').not('image_url', 'is', null).limit(1)
    expect(iErr).toBeNull()
    realItem = itemRows[0]
  }

  /** Persist one fresh candidate in awaiting_human with one frozen item. */
  async function makeCandidate(): Promise<{ caseId: string; versionId: string; candidateItemId: string }> {
    const store = createCandidatePersistence({ admin, batch, systemVersions: SNAPSHOT_SYSTEM_VERSIONS })
    const persisted = await store.persistCandidate({
      position: 0,
      generationRequestKey: `${randomUUID()}:${batchId}:0`,
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
          {
            item_id: realItem.item_id,
            slot: 'top',
            sort_order: 0,
            item_snapshot: { item_type: 'shirt', brand: 'Test Brand' },
            source_image_url: realItem.image_url,
          },
        ],
      },
    })
    record('outfit_quality_case', persisted.caseId)
    record('outfit_quality_candidate_version', persisted.candidateVersionId)
    record('outfit_quality_candidate_item', ...persisted.items.map((i) => i.candidate_item_id))
    await store.setVersionState(persisted.candidateVersionId, 'awaiting_human')
    return { caseId: persisted.caseId, versionId: persisted.candidateVersionId, candidateItemId: persisted.items[0].candidate_item_id }
  }

  it('hold/release: one attributable hold, zero decisions or projections, release restores eligibility', T, async () => {
    await setup()
    const c = await makeCandidate()

    const h1 = await holdCandidate(c.versionId, { reason: 'connected proof hold' }, ACTOR, admin)
    expect(h1.ok).toBe(true)
    if (h1.ok) record('outfit_quality_queue_hold', h1.hold.hold_id)

    // A repeat hold reuses it — no second row.
    const h2 = await holdCandidate(c.versionId, { reason: 'again' }, ACTOR, admin)
    expect(h2).toMatchObject({ ok: true, reused: true })
    const { data: holds } = await admin.from('outfit_quality_queue_hold').select('*').eq('candidate_version_id', c.versionId)
    expect(holds).toHaveLength(1)
    expect(holds[0]).toMatchObject({ held_by: ACTOR.userId, reason: 'connected proof hold', released_at: null })

    // A held candidate refuses a decision.
    const refused = await decideCandidate(c.versionId, { decision: 'yes', idempotencyKey: randomUUID() }, ACTOR, admin)
    expect(refused).toMatchObject({ ok: false, code: 'held' })

    // Release restores eligibility; replaying the release is a no-op.
    const rel = await releaseCandidate(c.versionId, ACTOR, admin)
    expect(rel).toMatchObject({ ok: true, reused: false })
    const relReplay = await releaseCandidate(c.versionId, ACTOR, admin)
    expect(relReplay).toMatchObject({ ok: true, reused: true })

    const { data: afterHolds } = await admin.from('outfit_quality_queue_hold').select('*').eq('candidate_version_id', c.versionId)
    expect(afterHolds[0].released_by).toBe(ACTOR.userId)
    expect(afterHolds[0].released_at).toBeTruthy()

    // Neither hold nor release created a decision or any learning evidence.
    const { data: events } = await admin.from('outfit_quality_review_event').select('review_event_id').eq('candidate_version_id', c.versionId)
    expect(events ?? []).toHaveLength(0)
    const { data: projections } = await admin.from('outfit_quality_learning_projection').select('projection_id').eq('candidate_version_id', c.versionId)
    expect(projections ?? []).toHaveLength(0)
  })

  it('decide: structured No persists one attributable exact-version event; replay and invalid payloads add nothing', T, async () => {
    const c = await makeCandidate()

    // Invalid payloads write nothing.
    expect(await decideCandidate(c.versionId, { decision: 'no', note: 'note only', idempotencyKey: randomUUID() }, ACTOR, admin)).toMatchObject({ ok: false, code: 'missing_reason' })
    expect(await decideCandidate(c.versionId, { decision: 'no', reasonCode: 'item_wrong_for_member', candidateItemId: randomUUID(), idempotencyKey: randomUUID() }, ACTOR, admin)).toMatchObject({ ok: false, code: 'foreign_item' })
    expect(await decideCandidate(c.versionId, { decision: 'no', reasonCode: 'not_a_reason', idempotencyKey: randomUUID() }, ACTOR, admin)).toMatchObject({ ok: false, code: 'unknown_reason' })

    const key = randomUUID()
    const d1 = await decideCandidate(c.versionId, { decision: 'no', reasonCode: 'item_wrong_for_member', candidateItemId: c.candidateItemId, note: 'proof note', idempotencyKey: key }, ACTOR, admin)
    expect(d1).toMatchObject({ ok: true, reused: false, nextState: 'rejected' })
    if (!d1.ok) return
    record('outfit_quality_review_event', d1.event.review_event_id)
    expect(d1.event).toMatchObject({ decision: 'no', reason_code: 'item_wrong_for_member', candidate_item_id: c.candidateItemId, reviewer_user_id: ACTOR.userId })

    // Replay returns the original; the database holds exactly one event.
    const d2 = await decideCandidate(c.versionId, { decision: 'no', reasonCode: 'item_wrong_for_member', candidateItemId: c.candidateItemId, idempotencyKey: key }, ACTOR, admin)
    expect(d2).toMatchObject({ ok: true, reused: true })
    const { data: events } = await admin.from('outfit_quality_review_event').select('*').eq('candidate_version_id', c.versionId)
    expect(events).toHaveLength(1)

    // A second active decision is refused; the version state moved.
    const d3 = await decideCandidate(c.versionId, { decision: 'yes', idempotencyKey: randomUUID() }, ACTOR, admin)
    expect(d3).toMatchObject({ ok: false, code: 'already_decided' })

    // The machine result is revealed only now that the decision persisted.
    const revealed = await loadMachineResult(c.versionId, admin)
    expect(revealed.revealed).toBe(true)
  })

  it('undo of a No returns the candidate to review and preserves the original event', T, async () => {
    const c = await makeCandidate()
    const d = await decideCandidate(c.versionId, { decision: 'no', reasonCode: 'global_composition', idempotencyKey: randomUUID() }, ACTOR, admin)
    if (!d.ok) throw new Error('setup decide failed')
    record('outfit_quality_review_event', d.event.review_event_id)

    const undoKey = randomUUID()
    const u = await undoCandidateDecision(c.versionId, { idempotencyKey: undoKey }, ACTOR, admin)
    expect(u).toMatchObject({ ok: true, reversedDecision: 'no' })
    if (!u.ok) return
    record('outfit_quality_review_event', u.event.review_event_id)

    const { data: version } = await admin.from('outfit_quality_candidate_version').select('state').eq('candidate_version_id', c.versionId).maybeSingle()
    expect(version.state).toBe('awaiting_human')

    // Both rows remain — append-only provenance — and replay adds nothing.
    const replay = await undoCandidateDecision(c.versionId, { idempotencyKey: undoKey }, ACTOR, admin)
    expect(replay).toMatchObject({ ok: true, reused: true })
    const { data: events } = await admin.from('outfit_quality_review_event').select('action').eq('candidate_version_id', c.versionId).order('created_at')
    expect(events.map((e: any) => e.action)).toEqual(['decide', 'undo'])

    // After the reversal, the machine result hides again.
    expect(await loadMachineResult(c.versionId, admin)).toEqual({ revealed: false })
  })

  it('undo of a queued approval cancels the render job; a running job forces explicit withdrawal', T, async () => {
    const c = await makeCandidate()

    // Approve → one queued cycle-1 job.
    const d = await decideCandidate(c.versionId, { decision: 'yes', idempotencyKey: randomUUID() }, ACTOR, admin)
    if (!d.ok) throw new Error('setup decide failed')
    record('outfit_quality_review_event', d.event.review_event_id)
    const { data: jobs } = await admin.from('outfit_quality_render_job').select('*').eq('candidate_version_id', c.versionId)
    expect(jobs).toHaveLength(1)
    expect(jobs[0]).toMatchObject({ status: 'queued', approval_event_id: d.event.review_event_id, cycle_no: 1 })
    record('outfit_quality_render_job', jobs[0].render_job_id)

    // Undo while queued: job cancelled, zero attempts, back to review.
    const u = await undoCandidateDecision(c.versionId, { idempotencyKey: randomUUID() }, ACTOR, admin)
    expect(u).toMatchObject({ ok: true, reversedDecision: 'yes', cancelledRenderJobIds: [jobs[0].render_job_id] })
    if (!u.ok) return
    record('outfit_quality_review_event', u.event.review_event_id)
    const { data: cancelled } = await admin.from('outfit_quality_render_job').select('status').eq('render_job_id', jobs[0].render_job_id).maybeSingle()
    expect(cancelled.status).toBe('cancelled')
    const { data: attempts } = await admin.from('outfit_quality_render_attempt').select('render_attempt_id').eq('render_job_id', jobs[0].render_job_id)
    expect(attempts ?? []).toHaveLength(0)

    // Approve again, then simulate the drainer claiming the job.
    const d2 = await decideCandidate(c.versionId, { decision: 'yes', idempotencyKey: randomUUID() }, ACTOR, admin)
    if (!d2.ok) throw new Error('second decide failed')
    record('outfit_quality_review_event', d2.event.review_event_id)
    const { data: jobs2 } = await admin.from('outfit_quality_render_job').select('*').eq('approval_event_id', d2.event.review_event_id)
    expect(jobs2).toHaveLength(1)
    record('outfit_quality_render_job', jobs2[0].render_job_id)
    await admin.from('outfit_quality_render_job').update({ status: 'running', lease_token: 'lease-proof', leased_at: new Date().toISOString() }).eq('render_job_id', jobs2[0].render_job_id)

    // Ordinary undo is now refused.
    const refused = await undoCandidateDecision(c.versionId, { idempotencyKey: randomUUID() }, ACTOR, admin)
    expect(refused).toMatchObject({ ok: false, code: 'withdrawal_required' })

    // Explicit withdrawal appends the event and hides the version; the running
    // job row is left for the render gate, not rewritten by the workbench.
    const w = await withdrawCandidateApproval(c.versionId, { idempotencyKey: randomUUID(), note: 'proof withdrawal' }, ACTOR, admin)
    expect(w).toMatchObject({ ok: true, nextState: 'approval_withdrawn' })
    if (!w.ok) return
    record('outfit_quality_review_event', w.event.review_event_id)
    const { data: version } = await admin.from('outfit_quality_candidate_version').select('state').eq('candidate_version_id', c.versionId).maybeSingle()
    expect(version.state).toBe('approval_withdrawn')

    // Full provenance retained: decide, undo, decide, withdraw — all queryable.
    const { data: events } = await admin.from('outfit_quality_review_event').select('action').eq('candidate_version_id', c.versionId).order('created_at')
    expect(events.map((e: any) => e.action)).toEqual(['decide', 'undo', 'decide', 'withdraw'])
  })
})
