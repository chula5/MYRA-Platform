// Connected render-flow proof against the connected MYRA Platform project.
// Every row is data_partition='test' under unique run ids; every inserted ID
// is recorded and cleaned by exact ID (oq_test_cleanup; direct exact-ID
// deletes for outfit/outfit_item, which carry no oq triggers).
//
// ALL external systems are deterministic fakes here — this file makes ZERO
// real Higgsfield calls and ZERO real Cloudinary uploads. It proves, at the
// real database boundary:
//   VAL-RENDER-001 — no claim/submission without a current exact-version Yes;
//                    parent approvals do not authorize children; withdrawn and
//                    stale versions are refused and cancelled unclaimed.
//   VAL-RENDER-002 — concurrent approvals produce one job/promotion; one lease
//                    owner; stale unsubmitted lease recovery keeps
//                    generation_count at 0.
//   VAL-RENDER-005 — one corrective retry in the same cycle; second failure →
//                    attention_required; no attempt 3.
//   VAL-RENDER-006 — persistence/checker failure fails closed (no ready).
//   VAL-RENDER-007 — gallery derivation, override removal, explicit
//                    regeneration cycle, underlying-outfit withdrawal, and the
//                    one-outfit/one-membership promotion graph.
//
// Run connected suites sequentially (npx vitest run <file>); they share the
// connected project. The suite self-skips when Supabase env is unavailable.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
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
      /* skip below */
    }
  }
  return !!(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)
}

const CONNECTED = ensureEnv()

import { createAdminClient } from '@/lib/supabase-server'
import { createCandidatePersistence } from '@/lib/outfit-quality/candidate-store'
import { SNAPSHOT_SYSTEM_VERSIONS } from '@/lib/outfit-quality/stylist-snapshot'
import { CHLOE_STYLIST_ID, REAL_MEMBER_IDS } from '@/lib/outfit-quality/identities'
import { decideCandidate, withdrawCandidateApproval } from '@/lib/outfit-quality/review-store'
import {
  drainQualityRenderQueue,
  processClaimedJob,
  verifyRenderableApproval,
  type RenderAdapters,
} from '@/lib/outfit-quality/render-worker'
import { loadAcceptedImages, markNotGoodEnough, regenerateRenderCycle, withdrawUnderlyingOutfit } from '@/lib/outfit-quality/gallery'
import type { StrictFidelityResult } from '@/lib/outfit-quality/fidelity'

const T = { timeout: 120000 }
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
  'outfit_quality_image_override',
  'outfit_quality_render_attempt',
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
const PK: Record<string, string> = {
  outfit_quality_image_override: 'override_id',
  outfit_quality_render_attempt: 'render_attempt_id',
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

const PASSED: StrictFidelityResult = { status: 'passed', score: 0.91, issues: [], correctiveNotes: null, detail: null, model: 'fake-fidelity' }

function fakeAdapters(behaviour: {
  generate?: (n: number) => Promise<{ submitted: boolean; imageUrl?: string; error?: string }>
  persist?: (n: number) => Promise<string | null>
  fidelity?: (n: number) => Promise<StrictFidelityResult>
} = {}) {
  const calls = { generate: 0, persist: 0, fidelity: 0 }
  const adapters: RenderAdapters = {
    rendererAvailable: () => true,
    generate: async () => {
      calls.generate += 1
      if (behaviour.generate) return behaviour.generate(calls.generate)
      return { submitted: true, imageUrl: `https://cdn.higgsfield.example/ephemeral-${randomUUID()}.png` }
    },
    persist: async (_url, opts) => {
      calls.persist += 1
      if (behaviour.persist) return behaviour.persist(calls.persist)
      return `https://res.cloudinary.com/testcloud/quality-lab-renders/${opts.publicId}.png`
    },
    checkFidelity: async () => {
      calls.fidelity += 1
      if (behaviour.fidelity) return behaviour.fidelity(calls.fidelity)
      return PASSED
    },
  }
  return { adapters, calls }
}

describe.skipIf(!CONNECTED)('render flow — connected proof (test partition, deterministic adapters)', () => {
  const admin: any = createAdminClient()
  let batch: any
  let realItems: any[]

  /** Cancel every test-partition queued/running job so no stale or foreign job can be drained. */
  async function quiesceQueue(exceptJobIds: string[] = []) {
    const { data: rows } = await admin
      .from('outfit_quality_render_job')
      .select('render_job_id, candidate_version_id')
      .in('status', ['queued', 'running'])
    for (const j of rows ?? []) {
      if (exceptJobIds.includes(j.render_job_id)) continue
      const { data: v } = await admin
        .from('outfit_quality_candidate_version')
        .select('data_partition')
        .eq('candidate_version_id', j.candidate_version_id)
        .maybeSingle()
      if (v?.data_partition !== 'test') continue
      await admin
        .from('outfit_quality_render_job')
        .update({ status: 'cancelled', lease_token: null, worker_id: null, leased_at: null })
        .eq('render_job_id', j.render_job_id)
        .in('status', ['queued', 'running'])
    }
  }

  /** Claim one specific job through the production conditional-claim update. */
  async function claimSpecificJob(jobId: string, workerId: string): Promise<any | null> {
    const lease = randomUUID()
    const { data, error } = await admin
      .from('outfit_quality_render_job')
      .update({ status: 'running', lease_token: lease, worker_id: workerId, leased_at: new Date().toISOString() })
      .eq('render_job_id', jobId)
      .eq('status', 'queued')
      .select('render_job_id, candidate_version_id, approval_event_id, cycle_no, generation_count, lease_token, promotion_id')
    if (error) throw new Error(`claim update failed: ${error.message}`)
    return data?.[0] ?? null
  }

  /** Process one specific job and normalize the outcome for assertions. */
  async function processMyJob(jobId: string, adapters: RenderAdapters, workerId = `connected-${randomUUID().slice(0, 8)}`) {
    const claimed = await claimSpecificJob(jobId, workerId)
    if (!claimed) return null
    const res = await processClaimedJob(admin, claimed, adapters)
    return { status: res.outcome === 'attention' ? 'attention_required' : res.outcome === 'cancelled' ? 'gate_failed' : 'ready', detail: res.detail }
  }

  beforeAll(async () => {
    await quiesceQueue()
  })

  afterAll(async () => {
    // Sweep every render artifact for THIS RUN's versions (covers rows created
    // after a mid-test failure skipped recordJobArtifacts).
    const versionIds = recordedIds('outfit_quality_candidate_version')
    if (versionIds.length) {
      const { data: jobs } = await admin.from('outfit_quality_render_job').select('render_job_id').in('candidate_version_id', versionIds)
      const jobIds = (jobs ?? []).map((j: any) => j.render_job_id)
      record('outfit_quality_render_job', ...jobIds)
      if (jobIds.length) {
        const { data: attempts } = await admin.from('outfit_quality_render_attempt').select('render_attempt_id').in('render_job_id', jobIds)
        record('outfit_quality_render_attempt', ...(attempts ?? []).map((a: any) => a.render_attempt_id))
      }
      const attemptIds = recordedIds('outfit_quality_render_attempt')
      if (attemptIds.length) {
        const { data: overrides } = await admin.from('outfit_quality_image_override').select('override_id').in('render_attempt_id', attemptIds)
        record('outfit_quality_image_override', ...(overrides ?? []).map((o: any) => o.override_id))
      }
      const { data: promos } = await admin.from('outfit_quality_promotion').select('promotion_id, outfit_id').in('candidate_version_id', versionIds)
      for (const p of promos ?? []) {
        record('outfit_quality_promotion', p.promotion_id)
        record('outfit', p.outfit_id)
        const { data: memberships } = await admin.from('outfit_item').select('outfit_item_id').eq('outfit_id', p.outfit_id)
        record('outfit_item', ...(memberships ?? []).map((m: any) => m.outfit_item_id))
      }
      const { data: checks } = await admin.from('outfit_quality_machine_check').select('check_id').in('candidate_version_id', versionIds)
      record('outfit_quality_machine_check', ...(checks ?? []).map((c: any) => c.check_id))
      const { data: events } = await admin.from('outfit_quality_review_event').select('review_event_id').in('candidate_version_id', versionIds)
      record('outfit_quality_review_event', ...(events ?? []).map((e: any) => e.review_event_id))
    }
    for (const table of CLEANUP_ORDER) {
      const ids = recordedIds(table)
      if (ids.length === 0) continue
      if (table === 'outfit_item' || table === 'outfit') {
        await admin.from(table).delete().in(PK[table], ids)
        continue
      }
      await admin.rpc('oq_test_cleanup', { p_table: table, p_ids: ids })
    }
    for (const table of CLEANUP_ORDER) {
      const ids = recordedIds(table)
      if (!ids.length) continue
      const { data } = await admin.from(table).select(PK[table]).in(PK[table], ids)
      expect(data ?? [], `residue in ${table}`).toHaveLength(0)
    }
  })

  async function setup() {
    await quiesceQueue()
    const { data: b, error: bErr } = await admin
      .from('outfit_quality_batch')
      .insert({
        run_id: randomUUID(),
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
    record('outfit_quality_batch', b.batch_id)

    const { data: itemRows, error: iErr } = await admin.from('item').select('item_id, image_url').not('image_url', 'is', null).limit(2)
    expect(iErr).toBeNull()
    expect(itemRows.length).toBeGreaterThan(0)
    realItems = itemRows
  }

  /** Persist an awaiting_human candidate with passing objective checks. */
  async function makeCandidate(): Promise<{ caseId: string; versionId: string }> {
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
        requiredSlots: ['top', 'bottom'],
        items: realItems.slice(0, 2).map((it: any, i: number) => ({
          item_id: it.item_id,
          slot: i === 0 ? 'top' : 'bottom',
          sort_order: i,
          item_snapshot: { item_type: i === 0 ? 'shirt' : 'trouser', brand: 'Connected Test Brand' },
          source_image_url: it.image_url,
        })),
      },
    })
    record('outfit_quality_case', persisted.caseId)
    record('outfit_quality_candidate_version', persisted.candidateVersionId)
    record('outfit_quality_candidate_item', ...persisted.items.map((i: any) => i.candidate_item_id))
    await store.recordObjectiveChecks(persisted.candidateVersionId, [
      { check_name: 'required_source_images', status: 'passed' },
      { check_name: 'valid_structure', status: 'passed' },
    ] as any)
    const { data: checks } = await admin.from('outfit_quality_machine_check').select('check_id').eq('candidate_version_id', persisted.candidateVersionId)
    record('outfit_quality_machine_check', ...(checks ?? []).map((c: any) => c.check_id))
    await store.setVersionState(persisted.candidateVersionId, 'awaiting_human')
    return { caseId: persisted.caseId, versionId: persisted.candidateVersionId }
  }

  /** Approve (idempotent) and record every side effect for cleanup. */
  async function approve(versionId: string) {
    const d = await decideCandidate(versionId, { decision: 'yes', idempotencyKey: randomUUID() }, ACTOR, admin)
    if (!d.ok && d.code !== 'already_decided') throw new Error(`approve failed: ${d.code}`)
    const { data: events } = await admin
      .from('outfit_quality_review_event')
      .select('review_event_id')
      .eq('candidate_version_id', versionId)
      .eq('action', 'decide')
    record('outfit_quality_review_event', ...(events ?? []).map((e: any) => e.review_event_id))
    const { data: jobs } = await admin.from('outfit_quality_render_job').select('*').eq('candidate_version_id', versionId)
    for (const j of jobs ?? []) record('outfit_quality_render_job', j.render_job_id)
    const { data: promotions } = await admin.from('outfit_quality_promotion').select('*').eq('candidate_version_id', versionId)
    for (const p of promotions ?? []) {
      record('outfit_quality_promotion', p.promotion_id)
      record('outfit', p.outfit_id)
      const { data: memberships } = await admin.from('outfit_item').select('outfit_item_id').eq('outfit_id', p.outfit_id)
      record('outfit_item', ...(memberships ?? []).map((m: any) => m.outfit_item_id))
    }
    const activeEventId = (events ?? []).length ? (events ?? [])[(events ?? []).length - 1].review_event_id : undefined
    return { eventId: activeEventId as string, job: (jobs ?? []).find((j: any) => j.status === 'queued') ?? jobs?.[0], promotion: (promotions ?? [])[0] }
  }

  async function recordJobArtifacts(versionId: string) {
    const { data: jobs } = await admin.from('outfit_quality_render_job').select('render_job_id').eq('candidate_version_id', versionId)
    for (const j of jobs ?? []) {
      record('outfit_quality_render_job', j.render_job_id)
      const { data: attempts } = await admin.from('outfit_quality_render_attempt').select('render_attempt_id').eq('render_job_id', j.render_job_id)
      record('outfit_quality_render_attempt', ...(attempts ?? []).map((a: any) => a.render_attempt_id))
    }
    const attemptIds = recordedIds('outfit_quality_render_attempt')
    if (attemptIds.length) {
      const { data: overrides } = await admin.from('outfit_quality_image_override').select('override_id').in('render_attempt_id', attemptIds)
      record('outfit_quality_image_override', ...(overrides ?? []).map((o: any) => o.override_id))
    }
    const { data: checks } = await admin.from('outfit_quality_machine_check').select('check_id').eq('candidate_version_id', versionId)
    record('outfit_quality_machine_check', ...(checks ?? []).map((c: any) => c.check_id))
    const { data: events } = await admin.from('outfit_quality_review_event').select('review_event_id').eq('candidate_version_id', versionId)
    record('outfit_quality_review_event', ...(events ?? []).map((e: any) => e.review_event_id))
  }

  async function galleryFor(versionId: string) {
    return (await loadAcceptedImages(admin)).filter((c) => c.candidate_version_id === versionId)
  }

  it('approval gate: preapproval, stale parent, and withdrawn versions never render; the renderer is never invoked for them', T, async () => {
    await setup()

    // 1. A job row whose version has NO human decision is cancelled unclaimed.
    //    The approval_event_id FK forces a real event, so we point the bogus
    //    job at an event that approved a DIFFERENT version — the worker gate,
    //    not just the app path, must refuse it.
    const c1 = await makeCandidate()
    const c2 = await makeCandidate()
    const approved2 = await approve(c2.versionId)
    const { data: bogusJob, error: bjErr } = await admin
      .from('outfit_quality_render_job')
      .insert({ candidate_version_id: c1.versionId, approval_event_id: approved2.eventId, cycle_no: 1, status: 'queued' })
      .select('render_job_id')
      .maybeSingle()
    expect(bjErr).toBeNull()
    record('outfit_quality_render_job', bogusJob.render_job_id)

    const { adapters, calls } = fakeAdapters()
    await drainQualityRenderQueue(admin, { workerId: `connected-${randomUUID().slice(0, 8)}`, maxJobs: 5, adapters })
    const { data: bogusAfter } = await admin.from('outfit_quality_render_job').select('status, lease_token').eq('render_job_id', bogusJob.render_job_id).maybeSingle()
    expect(bogusAfter.status).toBe('cancelled')
    expect(bogusAfter.lease_token).toBeNull()
    // The bogus job was processed by the gate only — its refusal cost zero
    // submissions; the one generate call belongs to the legitimate approval.
    expect(calls.generate).toBe(1)
    const { data: goodJob } = await admin.from('outfit_quality_render_job').select('*').eq('render_job_id', approved2.job.render_job_id).maybeSingle()
    expect(goodJob.status).toBe('ready')
    await recordJobArtifacts(c2.versionId)

    // 2. A parent approval does not authorize a child version, and the
    //    superseded parent's queued job is refused by the gate.
    const c3 = await makeCandidate()
    const approved3 = await approve(c3.versionId)
    const store = createCandidatePersistence({ admin, batch, systemVersions: SNAPSHOT_SYSTEM_VERSIONS })
    const child = await store.persistChildVersion({
      caseId: c3.caseId,
      plan: {
        versionNo: 2,
        parentVersionId: c3.versionId,
        compositionHash: createHash('sha256').update(randomUUID()).digest('hex'),
        generationRequestKey: `${randomUUID()}:${batch.batch_id}:1`,
      },
      contextSnapshot: { type: 'real_member', member_id: REAL_MEMBER_IDS.chloe },
      candidate: {
        requiredSlots: ['top', 'bottom'],
        items: realItems.slice(0, 2).map((it: any, i: number) => ({
          item_id: it.item_id,
          slot: i === 0 ? 'top' : 'bottom',
          sort_order: i,
          item_snapshot: { item_type: 'shirt' },
          source_image_url: it.image_url,
        })),
      },
    } as any)
    record('outfit_quality_candidate_version', child.candidateVersionId)
    record('outfit_quality_candidate_item', ...child.items.map((i: any) => i.candidate_item_id))

    const gateParent = await verifyRenderableApproval(admin, c3.versionId, approved3.eventId)
    expect(gateParent).toMatchObject({ ok: false, code: 'stale_version' })
    const gateChild = await verifyRenderableApproval(admin, child.candidateVersionId)
    expect(gateChild).toMatchObject({ ok: false, code: 'no_active_approval' })

    const claimed3 = await claimSpecificJob(approved3.job.render_job_id, `connected-${randomUUID().slice(0, 8)}`)
    expect(claimed3).not.toBeNull()
    const f3 = fakeAdapters()
    const r3 = await processClaimedJob(admin, claimed3!, f3.adapters)
    expect(r3.outcome).toBe('cancelled')
    expect(f3.calls.generate).toBe(0)
    const { data: parentJob } = await admin.from('outfit_quality_render_job').select('status').eq('render_job_id', approved3.job.render_job_id).maybeSingle()
    expect(parentJob.status).toBe('cancelled')
    await recordJobArtifacts(c3.versionId)

    // 3. Withdrawal before the drain: the job is cancelled by the withdrawal,
    //    and even a forced claim cannot submit it.
    const c4 = await makeCandidate()
    const approved4 = await approve(c4.versionId)
    const w = await withdrawCandidateApproval(c4.versionId, { idempotencyKey: randomUUID(), note: 'connected gate proof' }, ACTOR, admin)
    expect(w.ok).toBe(true)
    const { data: cancelledJob } = await admin.from('outfit_quality_render_job').select('status').eq('render_job_id', approved4.job.render_job_id).maybeSingle()
    expect(cancelledJob.status).toBe('cancelled')
    // Force-claim directly from the row (bypassing the queued-only claim) to
    // prove the pipeline-level gate still refuses a submission.
    const { data: rawJob } = await admin.from('outfit_quality_render_job').select('*').eq('render_job_id', approved4.job.render_job_id).maybeSingle()
    const f4 = fakeAdapters()
    const r4 = await processClaimedJob(
      admin,
      { render_job_id: rawJob.render_job_id, candidate_version_id: rawJob.candidate_version_id, approval_event_id: rawJob.approval_event_id, cycle_no: rawJob.cycle_no, generation_count: rawJob.generation_count, lease_token: randomUUID() },
      f4.adapters,
    )
    expect(r4.outcome).toBe('cancelled')
    expect(f4.calls.generate).toBe(0)
    await recordJobArtifacts(c4.versionId)
  })

  it('idempotency: concurrent approvals and claims converge to one job, one promotion, one lease owner', T, async () => {
    await setup()
    const c = await makeCandidate()

    // Two concurrent approvals with different keys: exactly one wins the
    // unique active-decision slot; the job/promotion graph stays singular.
    const [d1, d2] = await Promise.all([
      decideCandidate(c.versionId, { decision: 'yes', idempotencyKey: randomUUID() }, ACTOR, admin),
      decideCandidate(c.versionId, { decision: 'yes', idempotencyKey: randomUUID() }, ACTOR, admin),
    ])
    const okCount = [d1, d2].filter((d) => d.ok).length
    expect(okCount).toBeGreaterThanOrEqual(1)
    const { data: jobs } = await admin.from('outfit_quality_render_job').select('*').eq('candidate_version_id', c.versionId).eq('status', 'queued')
    expect(jobs).toHaveLength(1)
    const { data: promotions } = await admin.from('outfit_quality_promotion').select('*').eq('candidate_version_id', c.versionId)
    expect(promotions).toHaveLength(1)
    await approve(c.versionId) // replay path — records side effects, adds nothing

    // One lease owner: two concurrent claims on the same job, exactly one wins.
    const [claim1, claim2] = await Promise.all([
      claimSpecificJob(jobs[0].render_job_id, 'worker-a'),
      claimSpecificJob(jobs[0].render_job_id, 'worker-b'),
    ])
    const winners = [claim1, claim2].filter(Boolean)
    expect(winners).toHaveLength(1)
    const { data: jobRow } = await admin.from('outfit_quality_render_job').select('lease_token, worker_id').eq('render_job_id', jobs[0].render_job_id).maybeSingle()
    expect(jobRow.lease_token).toBeTruthy()

    // Stale UNSUBMITTED lease recovery returns the job without counting a generation.
    await admin
      .from('outfit_quality_render_job')
      .update({ leased_at: new Date(Date.now() - 60 * 60_000).toISOString() })
      .eq('render_job_id', jobs[0].render_job_id)
    const { recoverStaleLeases } = await import('@/lib/outfit-quality/render-worker')
    const rec = await recoverStaleLeases(admin)
    expect(rec.requeued).toBe(1)
    const { data: recovered } = await admin.from('outfit_quality_render_job').select('status, generation_count, lease_token').eq('render_job_id', jobs[0].render_job_id).maybeSingle()
    expect(recovered).toMatchObject({ status: 'queued', generation_count: 0, lease_token: null })

    await recordJobArtifacts(c.versionId)
  })

  it('retry budget: conclusive first failure retries once in-cycle; second failure requires attention; no attempt 3', T, async () => {
    await setup()
    const c = await makeCandidate()
    await approve(c.versionId)
    const { data: job } = await admin.from('outfit_quality_render_job').select('*').eq('candidate_version_id', c.versionId).maybeSingle()

    const failWithNotes: StrictFidelityResult = {
      status: 'failed',
      score: 0.4,
      issues: [{ item: 'Trouser', field: 'silhouette', expected: 'wide-leg', seen: 'cargo' }],
      correctiveNotes: 'keep the trousers wide-leg',
      detail: null,
      model: 'fake-fidelity',
    }
    const { adapters, calls } = fakeAdapters({ fidelity: async () => failWithNotes })
    const r = await processMyJob(job.render_job_id, adapters)
    expect(r?.status).toBe('attention_required')
    expect(calls.generate).toBe(2) // attempt 1 + exactly one corrective attempt

    const { data: jobAfter } = await admin.from('outfit_quality_render_job').select('*').eq('render_job_id', job.render_job_id).maybeSingle()
    expect(jobAfter).toMatchObject({ status: 'attention_required', generation_count: 2 })
    const { data: attempts } = await admin.from('outfit_quality_render_attempt').select('*').eq('render_job_id', job.render_job_id).order('attempt_no')
    expect(attempts).toHaveLength(2) // no attempt 3 exists
    expect(attempts[1].prompt).toContain('keep the trousers wide-leg')
    expect(attempts.every((a: any) => a.ready_at === null)).toBe(true)
    // Both fidelity outcomes persisted as correlated machine checks.
    const { data: fidChecks } = await admin.from('outfit_quality_machine_check').select('*').eq('candidate_version_id', c.versionId).eq('kind', 'fidelity').order('attempt')
    expect(fidChecks.map((f: any) => f.status)).toEqual(['failed', 'failed'])
    expect(attempts[0].fidelity_check_id).toBe(fidChecks[0].check_id)
    expect(attempts[1].fidelity_check_id).toBe(fidChecks[1].check_id)
    // Never in the gallery.
    expect(await galleryFor(c.versionId)).toHaveLength(0)

    await recordJobArtifacts(c.versionId)
  })

  it('fail closed: persistence failure and unavailable fidelity never produce a ready image', T, async () => {
    await setup()

    // Persistence failure: ephemeral URL is never stored, never checked.
    const c1 = await makeCandidate()
    const a1job = await approve(c1.versionId)
    const f1 = fakeAdapters({ persist: async () => null })
    const r1 = await processMyJob(a1job.job.render_job_id, f1.adapters)
    expect(r1?.status).toBe('attention_required')
    expect(f1.calls.fidelity).toBe(0)
    const { data: a1 } = await admin.from('outfit_quality_render_attempt').select('*').eq('render_job_id', a1job.job.render_job_id).maybeSingle()
    expect(a1.ready_at).toBeNull()
    expect(a1.image_url).toBeNull()
    await recordJobArtifacts(c1.versionId)

    // Unavailable fidelity: fail closed, no automatic retry.
    const c2 = await makeCandidate()
    const a2job = await approve(c2.versionId)
    const f2 = fakeAdapters({ fidelity: async () => ({ status: 'unavailable', score: null, issues: [], correctiveNotes: null, detail: 'checker not configured', model: 'fake-fidelity' }) })
    const r2 = await processMyJob(a2job.job.render_job_id, f2.adapters)
    expect(r2?.status).toBe('attention_required')
    expect(f2.calls.generate).toBe(1)
    const { data: job2 } = await admin.from('outfit_quality_render_job').select('status').eq('render_job_id', a2job.job.render_job_id).maybeSingle()
    expect(job2.status).toBe('attention_required')
    await recordJobArtifacts(c2.versionId)
  })

  it('gallery: accepted derivation, Not good enough removal, explicit regeneration cycle, and underlying-outfit withdrawal', T, async () => {
    await setup()
    const c = await makeCandidate()
    const approved = await approve(c.versionId)

    // Render cycle 1 to ready.
    const f1 = fakeAdapters()
    const r1 = await processMyJob(approved.job.render_job_id, f1.adapters)
    expect(r1?.status).toBe('ready')

    // Accepted Images shows it without any second human approval.
    let cards = await galleryFor(c.versionId)
    expect(cards).toHaveLength(1)
    const card = cards[0]
    expect(card.image_url).toContain('res.cloudinary.com')
    expect(card.items).toHaveLength(2)
    expect(card.fidelity.status).toBe('passed')
    expect(card.data_partition).toBe('test')

    // The promoted outfit carries the durable image and stays internal/non-live.
    const { data: promo } = await admin.from('outfit_quality_promotion').select('*').eq('candidate_version_id', c.versionId).maybeSingle()
    const { data: outfit } = await admin.from('outfit').select('status, published_at, image_url').eq('outfit_id', promo.outfit_id).maybeSingle()
    expect(outfit).toMatchObject({ status: 'draft', published_at: null })
    expect(outfit.image_url).toBe(card.image_url)
    const { data: memberships } = await admin.from('outfit_item').select('item_id, slot, sort_order').eq('outfit_id', promo.outfit_id).order('sort_order')
    expect(memberships).toHaveLength(2)
    expect(memberships.map((m: any) => m.slot)).toEqual(['top', 'bottom'])

    // Not good enough (image quality) removes it immediately.
    const ov = await markNotGoodEnough(admin, card.render_attempt_id, { reason: 'image_quality', note: 'connected proof', idempotencyKey: randomUUID() }, ACTOR)
    expect(ov).toMatchObject({ ok: true, nextActions: ['regenerate'] })
    expect(await galleryFor(c.versionId)).toHaveLength(0)

    // Explicit regeneration creates a separate bounded cycle.
    const regen = await regenerateRenderCycle(admin, card.render_attempt_id, { idempotencyKey: randomUUID() }, ACTOR)
    expect(regen).toMatchObject({ ok: true, cycleNo: 2 })
    const { data: jobs } = await admin.from('outfit_quality_render_job').select('*').eq('candidate_version_id', c.versionId).order('cycle_no')
    expect(jobs.map((j: any) => [j.cycle_no, j.status])).toEqual([[1, 'ready'], [2, 'queued']])
    record('outfit_quality_render_job', jobs[1].render_job_id)

    // Drain cycle 2 to ready; the new image enters the gallery.
    const f2 = fakeAdapters()
    const r2 = await processMyJob(jobs[1].render_job_id, f2.adapters)
    expect(r2?.status).toBe('ready')
    cards = await galleryFor(c.versionId)
    expect(cards).toHaveLength(1)
    expect(cards[0].cycle_no).toBe(2)
    expect(cards[0].attempts.length).toBeGreaterThanOrEqual(2)

    // Underlying-outfit override → explicit withdrawal → promotion withdrawn,
    // gallery empty, history preserved.
    const ov2 = await markNotGoodEnough(admin, cards[0].render_attempt_id, { reason: 'underlying_outfit', idempotencyKey: randomUUID() }, ACTOR)
    expect(ov2).toMatchObject({ ok: true, nextActions: ['withdraw'] })
    const wd = await withdrawUnderlyingOutfit(admin, cards[0].render_attempt_id, { idempotencyKey: randomUUID(), note: 'the combination is wrong' }, ACTOR)
    expect(wd.ok).toBe(true)
    expect(await galleryFor(c.versionId)).toHaveLength(0)
    const { data: promoAfter } = await admin.from('outfit_quality_promotion').select('status').eq('candidate_version_id', c.versionId).maybeSingle()
    expect(promoAfter.status).toBe('withdrawn')
    const { data: versionAfter } = await admin.from('outfit_quality_candidate_version').select('state').eq('candidate_version_id', c.versionId).maybeSingle()
    expect(versionAfter.state).toBe('approval_withdrawn')
    // The full event chain survives: decide, withdraw.
    const { data: events } = await admin.from('outfit_quality_review_event').select('action').eq('candidate_version_id', c.versionId).order('created_at')
    expect(events.map((e: any) => e.action)).toEqual(['decide', 'withdraw'])

    await recordJobArtifacts(c.versionId)
  })

  // VAL-RENDER-004: an accepted provider job whose result wasn't retrieved at
  // submission time (transient 403) is recovered READ-ONLY against the deployed
  // schema — provider_job_id round-trips, recovery persists the completed image
  // durably once, fidelity passes, the EXISTING attempt is marked ready, and
  // ZERO Higgsfield submissions occur during recovery.
  it('accepted provider job recovery: a post-acceptance retrieval failure is reconciled read-only with no new submission', T, async () => {
    await setup()
    const { reconcileAcceptedProviderJob } = await import('@/lib/outfit-quality/provider-job-reconcile')

    const c = await makeCandidate()
    const approved = await approve(c.versionId)

    // Phase 1 — SUBMISSION ACCEPTED, RETRIEVAL FAILED. The generate adapter
    // reports the provider accepted (returning a provider job id) but the
    // subsequent result retrieval failed transiently. The worker must persist
    // the provider job id and leave the job reconcilable (attention_required),
    // counting the one submission exactly once.
    const PROVIDER_JOB = `c71b4f96-prov-${randomUUID().slice(0, 8)}`
    let generateCalls = 0
    const acceptThenFail: RenderAdapters = {
      rendererAvailable: () => true,
      generate: async () => {
        generateCalls += 1
        return { submitted: true, providerJobId: PROVIDER_JOB, retrievalFailed: true, error: 'HTTP 403 while waiting for result' }
      },
      persist: async () => null,
      checkFidelity: async () => PASSED,
    }
    const r1 = await processMyJob(approved.job.render_job_id, acceptThenFail)
    expect(r1?.status).toBe('attention_required')
    expect(generateCalls).toBe(1)
    await recordJobArtifacts(c.versionId)

    const { data: jobAfter1 } = await admin.from('outfit_quality_render_job').select('status, generation_count').eq('render_job_id', approved.job.render_job_id).maybeSingle()
    expect(jobAfter1).toMatchObject({ status: 'attention_required', generation_count: 1 })
    const { data: attempt1 } = await admin.from('outfit_quality_render_attempt').select('*').eq('render_job_id', approved.job.render_job_id).eq('attempt_no', 1).maybeSingle()
    expect(attempt1.provider_job_id).toBe(PROVIDER_JOB)
    expect(attempt1.generation_status).toBe('accepted_retrieval_failed')
    expect(attempt1.provider_status).toBe('retrieval_failed')
    expect(attempt1.image_url).toBeNull()

    // Phase 2 — READ-ONLY RECONCILIATION. getProviderJob reports the accepted
    // job completed; recovery persists its image durably and passes fidelity.
    // The deps expose NO submit/generate slot, so no new submission is possible.
    let getCalls = 0
    let persistCalls = 0
    const durable = `https://res.cloudinary.com/testcloud/quality-lab-renders/recovered-${randomUUID().slice(0, 8)}.png`
    const r2 = await reconcileAcceptedProviderJob(admin, attempt1.render_attempt_id, {
      getProviderJob: async (id) => {
        getCalls += 1
        expect(id).toBe(PROVIDER_JOB)
        return { state: 'completed', imageUrl: 'https://cdn.higgsfield.example/accepted-result.png' }
      },
      persist: async () => {
        persistCalls += 1
        return durable
      },
      checkFidelity: async () => PASSED,
    })
    expect(r2).toMatchObject({ ok: true, outcome: 'ready', replayed: false })
    expect(getCalls).toBe(1)
    expect(persistCalls).toBe(1)

    const { data: attempt2 } = await admin.from('outfit_quality_render_attempt').select('*').eq('render_attempt_id', attempt1.render_attempt_id).maybeSingle()
    expect(attempt2.image_url).toBe(durable)
    expect(attempt2.provider_status).toBe('completed')
    expect(attempt2.ready_at).toBeTruthy()
    const { data: jobAfter2 } = await admin.from('outfit_quality_render_job').select('status, generation_count').eq('render_job_id', approved.job.render_job_id).maybeSingle()
    // Ready, and the generation count is UNCHANGED — recovery issued no submission.
    expect(jobAfter2).toMatchObject({ status: 'ready', generation_count: 1 })

    // The recovered image enters Accepted Images for the still-approved version.
    const cards = await galleryFor(c.versionId)
    expect(cards).toHaveLength(1)
    expect(cards[0].image_url).toBe(durable)

    // Phase 3 — IDEMPOTENT REPLAY. A second reconcile returns the same ready
    // result and contacts the provider zero more times.
    let getCalls2 = 0
    const r3 = await reconcileAcceptedProviderJob(admin, attempt1.render_attempt_id, {
      getProviderJob: async () => {
        getCalls2 += 1
        return { state: 'completed', imageUrl: 'https://cdn.higgsfield.example/accepted-result.png' }
      },
      persist: async () => `https://res.cloudinary.com/testcloud/quality-lab-renders/should-not-be-used.png`,
      checkFidelity: async () => PASSED,
    })
    expect(r3).toMatchObject({ ok: true, outcome: 'ready', replayed: true })
    expect(getCalls2).toBe(0)
    const { data: attempt3 } = await admin.from('outfit_quality_render_attempt').select('image_url').eq('render_attempt_id', attempt1.render_attempt_id).maybeSingle()
    expect(attempt3.image_url).toBe(durable) // unchanged; no duplicate asset

    await recordJobArtifacts(c.versionId)
  })
})
