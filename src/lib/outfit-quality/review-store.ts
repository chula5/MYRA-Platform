// Server-only review mutations for the Outfit Quality workbench.
//
// Every function here is reached only through the gated wrapper (which calls
// the admin check first) and receives the VERIFIED admin user id — client
// input can never supply reviewer, holder, releaser, undoer, or withdrawer
// identity. All mutations are keyed by a UUID idempotency key: a replay
// returns the original event and appends nothing.
//
// Write ordering: the append-only event row is the authoritative record. The
// candidate_version.state pointer and render-job cancellations are derived
// writes applied around it; the state claim is a conditional update
// (state = 'awaiting_human') so two concurrent decisions cannot both succeed.

import 'server-only'
import { createAdminClient } from '@/lib/supabase-server'
import {
  planDecide,
  planUndo,
  planWithdraw,
  planHold,
  planRelease,
  type DecideInput,
  type PlanContext,
} from '@/lib/outfit-quality/review-plan'
import { latestActiveDecision, type ReviewEventRow } from '@/lib/outfit-quality/review-state'

type Admin = ReturnType<typeof createAdminClient>

export interface ReviewActor {
  /** The verified admin session user id. Never request-derived. */
  userId: string
}

export interface MutationFailure {
  ok: false
  code: string
  message: string
}

function failure(code: string, message: string): MutationFailure {
  return { ok: false, code, message }
}

function isUniqueViolation(err: { code?: string; message?: string } | null): boolean {
  return !!err && (err.code === '23505' || /duplicate key/i.test(err.message ?? ''))
}

// ── Loading the planner context ───────────────────────────────────────────────

async function loadContext(db: any, candidateVersionId: string): Promise<{ ctx?: PlanContext; error?: MutationFailure }> {
  const { data: version, error: vErr } = await db
    .from('outfit_quality_candidate_version')
    .select('candidate_version_id, case_id, version_no, state')
    .eq('candidate_version_id', candidateVersionId)
    .maybeSingle()
  if (vErr) return { error: failure('read_failed', vErr.message) }
  if (!version) return { ctx: { version: null, kase: null, itemIds: [], events: [], holds: [], renderJobs: [] } }

  const [{ data: kase, error: cErr }, { data: items, error: iErr }, { data: events, error: eErr }, { data: holds, error: hErr }, { data: jobs, error: jErr }] =
    await Promise.all([
      db.from('outfit_quality_case').select('case_id, current_version_id, status').eq('case_id', version.case_id).maybeSingle(),
      db.from('outfit_quality_candidate_item').select('candidate_item_id').eq('candidate_version_id', candidateVersionId),
      db.from('outfit_quality_review_event').select('*').eq('candidate_version_id', candidateVersionId).order('created_at', { ascending: true }),
      db.from('outfit_quality_queue_hold').select('*').eq('candidate_version_id', candidateVersionId),
      db.from('outfit_quality_render_job').select('render_job_id, candidate_version_id, approval_event_id, cycle_no, status, lease_token').eq('candidate_version_id', candidateVersionId),
    ])
  const firstErr = cErr ?? iErr ?? eErr ?? hErr ?? jErr
  if (firstErr) return { error: failure('read_failed', firstErr.message) }

  return {
    ctx: {
      version,
      kase: kase ?? null,
      itemIds: ((items ?? []) as any[]).map((i) => i.candidate_item_id),
      events: (events ?? []) as ReviewEventRow[],
      holds: (holds ?? []) as any[],
      renderJobs: (jobs ?? []) as any[],
    },
  }
}

async function eventByIdempotencyKey(db: any, key: string): Promise<ReviewEventRow | null> {
  const { data } = await db.from('outfit_quality_review_event').select('*').eq('idempotency_key', key).maybeSingle()
  return (data as ReviewEventRow | null) ?? null
}

/** The decision a reversal event reversed (for replayed undo results). */
async function reversedDecisionOf(db: any, event: ReviewEventRow): Promise<'yes' | 'no' | null> {
  if (!event.reverses_event_id) return null
  const { data } = await db.from('outfit_quality_review_event').select('decision').eq('review_event_id', event.reverses_event_id).maybeSingle()
  return (data?.decision as 'yes' | 'no' | undefined) ?? null
}

// ── Machine-result disclosure ─────────────────────────────────────────────────

export type MachineResult =
  | { revealed: false }
  | { revealed: true; checks: any[] }

/**
 * The full subjective machine result for one exact version — disclosed ONLY
 * when an unreversed human decision for that version has persisted. Before
 * that, and after a reversal with no new decision, it is hidden again.
 */
export async function loadMachineResult(candidateVersionId: string, admin: Admin = createAdminClient()): Promise<MachineResult> {
  const db = admin as any
  const { data: events } = await db
    .from('outfit_quality_review_event')
    .select('*')
    .eq('candidate_version_id', candidateVersionId)
    .order('created_at', { ascending: true })
  if (!latestActiveDecision((events ?? []) as ReviewEventRow[])) return { revealed: false }
  const { data: checks } = await db
    .from('outfit_quality_machine_check')
    .select('check_id, kind, check_name, status, verdict, score, issues, model, prompt_version, attempt, created_at')
    .eq('candidate_version_id', candidateVersionId)
    .eq('kind', 'subjective')
    .order('created_at', { ascending: true })
  return { revealed: true, checks: checks ?? [] }
}

// ── Decide ────────────────────────────────────────────────────────────────────

export type DecideResult =
  | {
      ok: true
      reused: boolean
      event: ReviewEventRow
      nextState: 'approved' | 'rejected'
      /** Revealed only because the decision has now persisted. */
      machine: MachineResult
      renderJobId?: string | null
      warnings?: string[]
    }
  | MutationFailure

export async function decideCandidate(
  candidateVersionId: string,
  input: DecideInput,
  actor: ReviewActor,
  admin: Admin = createAdminClient(),
): Promise<DecideResult> {
  const db = admin as any

  // Idempotent replay: the same key returns the original persisted event.
  if (input.idempotencyKey) {
    const existing = await eventByIdempotencyKey(db, input.idempotencyKey)
    if (existing) {
      return {
        ok: true,
        reused: true,
        event: existing,
        nextState: existing.decision === 'yes' ? 'approved' : 'rejected',
        machine: await loadMachineResult(candidateVersionId, admin),
      }
    }
  }

  const { ctx, error } = await loadContext(db, candidateVersionId)
  if (error) return error
  const plan = planDecide(ctx!, input)
  if (!plan.ok) return plan

  // Claim the version: only one concurrent transition out of awaiting_human
  // can succeed, so a racing second decide loses here before writing an event.
  const { data: claimed, error: claimErr } = await db
    .from('outfit_quality_candidate_version')
    .update({ state: plan.nextState })
    .eq('candidate_version_id', candidateVersionId)
    .eq('state', 'awaiting_human')
    .select('candidate_version_id')
  if (claimErr) return failure('state_update_failed', claimErr.message)
  if (!claimed || claimed.length === 0) return failure('conflict', 'the version changed while you decided — reload the queue')

  const { data: event, error: evErr } = await db
    .from('outfit_quality_review_event')
    .insert({
      candidate_version_id: candidateVersionId,
      action: plan.event.action,
      decision: plan.event.decision,
      reason_code: plan.event.reason_code,
      candidate_item_id: plan.event.candidate_item_id,
      note: plan.event.note,
      reverses_event_id: null,
      reviewer_user_id: actor.userId,
      idempotency_key: input.idempotencyKey,
    })
    .select('*')
    .maybeSingle()
  if (evErr || !event) {
    // Best-effort rollback of the derived pointer; the event never landed.
    await db.from('outfit_quality_candidate_version').update({ state: 'awaiting_human' }).eq('candidate_version_id', candidateVersionId).eq('state', plan.nextState)
    if (isUniqueViolation(evErr)) {
      const existing = await eventByIdempotencyKey(db, input.idempotencyKey)
      if (existing) {
        return { ok: true, reused: true, event: existing, nextState: existing.decision === 'yes' ? 'approved' : 'rejected', machine: await loadMachineResult(candidateVersionId, admin) }
      }
    }
    return failure('event_insert_failed', evErr?.message ?? 'no row returned')
  }

  const warnings: string[] = []
  const { error: caseErr } = await db.from('outfit_quality_case').update({ status: plan.nextState }).eq('case_id', ctx!.version!.case_id)
  if (caseErr) warnings.push(`case status update failed: ${caseErr.message}`)

  let renderJobId: string | null = null
  if (plan.enqueueRender) {
    // Exactly one queued cycle-1 job for this approval. The unique constraint
    // (candidate_version_id, approval_event_id, cycle_no) makes this enqueue
    // replay-safe. No Higgsfield call happens here — the local drainer and its
    // approval gate belong to the render integration.
    const { data: job, error: jobErr } = await db
      .from('outfit_quality_render_job')
      .insert({ candidate_version_id: candidateVersionId, approval_event_id: event.review_event_id, cycle_no: 1, status: 'queued' })
      .select('render_job_id')
      .maybeSingle()
    if (jobErr) {
      if (!isUniqueViolation(jobErr)) warnings.push(`render enqueue failed: ${jobErr.message}`)
      const { data: existingJob } = await db
        .from('outfit_quality_render_job')
        .select('render_job_id')
        .eq('candidate_version_id', candidateVersionId)
        .eq('approval_event_id', event.review_event_id)
        .eq('cycle_no', 1)
        .maybeSingle()
      renderJobId = existingJob?.render_job_id ?? null
    } else {
      renderJobId = job?.render_job_id ?? null
    }
  }

  return {
    ok: true,
    reused: false,
    event: event as ReviewEventRow,
    nextState: plan.nextState,
    machine: await loadMachineResult(candidateVersionId, admin),
    renderJobId,
    ...(warnings.length ? { warnings } : {}),
  }
}

// ── Reversal plumbing shared by undo and withdraw ─────────────────────────────

async function applyReversal(
  admin: Admin,
  candidateVersionId: string,
  caseId: string,
  idempotencyKey: string,
  actor: ReviewActor,
  planEvent: { action: 'undo' | 'withdraw'; note: string | null; reverses_event_id: string },
  nextState: 'awaiting_human' | 'approval_withdrawn',
  fromStates: string[],
  cancelJobIds: string[],
): Promise<{ ok: true; reused: boolean; event: ReviewEventRow; nextState: string } | MutationFailure> {
  const db = admin as any

  const existing = await eventByIdempotencyKey(db, idempotencyKey)
  if (existing) return { ok: true, reused: true, event: existing, nextState }

  const { data: event, error: evErr } = await db
    .from('outfit_quality_review_event')
    .insert({
      candidate_version_id: candidateVersionId,
      action: planEvent.action,
      decision: null,
      reason_code: null,
      candidate_item_id: null,
      note: planEvent.note,
      reverses_event_id: planEvent.reverses_event_id,
      reviewer_user_id: actor.userId,
      idempotency_key: idempotencyKey,
    })
    .select('*')
    .maybeSingle()
  if (evErr || !event) {
    if (isUniqueViolation(evErr)) {
      const replay = await eventByIdempotencyKey(db, idempotencyKey)
      if (replay) return { ok: true, reused: true, event: replay, nextState }
    }
    return failure('event_insert_failed', evErr?.message ?? 'no row returned')
  }

  // Derived pointer: only move it from a decided state, so a stale caller
  // cannot resurrect a version that has since advanced.
  const { error: stateErr } = await db
    .from('outfit_quality_candidate_version')
    .update({ state: nextState })
    .eq('candidate_version_id', candidateVersionId)
    .in('state', fromStates)
  if (stateErr) return failure('state_update_failed', stateErr.message)

  // Cancel still-queued, unclaimed render jobs of the reversed approval. Jobs
  // already running/ready are untouched — the render gate rechecks approval
  // before submission and readiness.
  for (const jobId of cancelJobIds) {
    const { error: cancelErr } = await db
      .from('outfit_quality_render_job')
      .update({ status: 'cancelled' })
      .eq('render_job_id', jobId)
      .eq('status', 'queued')
      .is('lease_token', null)
    if (cancelErr) return failure('job_cancel_failed', cancelErr.message)
  }

  await db.from('outfit_quality_case').update({ status: nextState }).eq('case_id', caseId)

  return { ok: true, reused: false, event: event as ReviewEventRow, nextState }
}

// ── Undo ──────────────────────────────────────────────────────────────────────

export type UndoResult =
  | { ok: true; reused: boolean; event: ReviewEventRow; nextState: string; reversedDecision: 'yes' | 'no'; cancelledRenderJobIds: string[] }
  | MutationFailure

export async function undoCandidateDecision(
  candidateVersionId: string,
  input: { idempotencyKey: string },
  actor: ReviewActor,
  admin: Admin = createAdminClient(),
): Promise<UndoResult> {
  const db = admin as any
  // Replay first: a successful undo consumes the active decision, so the same
  // key can never plan again — it must return the original reversal.
  if (input.idempotencyKey) {
    const existing = await eventByIdempotencyKey(db, input.idempotencyKey)
    if (existing) {
      const reversed = await reversedDecisionOf(db, existing)
      return { ok: true, reused: true, event: existing, nextState: 'awaiting_human', reversedDecision: (reversed ?? 'no') as 'yes' | 'no', cancelledRenderJobIds: [] }
    }
  }
  const { ctx, error } = await loadContext(db, candidateVersionId)
  if (error) return error
  const plan = planUndo(ctx!, input)
  if (!plan.ok) return plan

  const res = await applyReversal(
    admin,
    candidateVersionId,
    ctx!.version!.case_id,
    input.idempotencyKey,
    actor,
    { action: 'undo', note: null, reverses_event_id: plan.event.reverses_event_id as string },
    'awaiting_human',
    ['approved', 'rejected'],
    plan.cancelJobIds,
  )
  if (!res.ok) return res
  return { ...res, reversedDecision: plan.reversedDecision, cancelledRenderJobIds: plan.cancelJobIds }
}

// ── Withdraw ──────────────────────────────────────────────────────────────────

export type WithdrawResult =
  | { ok: true; reused: boolean; event: ReviewEventRow; nextState: string; cancelledRenderJobIds: string[] }
  | MutationFailure

export async function withdrawCandidateApproval(
  candidateVersionId: string,
  input: { idempotencyKey: string; note?: string | null },
  actor: ReviewActor,
  admin: Admin = createAdminClient(),
): Promise<WithdrawResult> {
  const db = admin as any
  // Replay first: a persisted withdrawal leaves no active approval to plan
  // against, so the same key must return the original event.
  if (input.idempotencyKey) {
    const existing = await eventByIdempotencyKey(db, input.idempotencyKey)
    if (existing) return { ok: true, reused: true, event: existing, nextState: 'approval_withdrawn', cancelledRenderJobIds: [] }
  }
  const { ctx, error } = await loadContext(db, candidateVersionId)
  if (error) return error
  const plan = planWithdraw(ctx!, input)
  if (!plan.ok) return plan

  const res = await applyReversal(
    admin,
    candidateVersionId,
    ctx!.version!.case_id,
    input.idempotencyKey,
    actor,
    { action: 'withdraw', note: plan.event.note, reverses_event_id: plan.event.reverses_event_id as string },
    'approval_withdrawn',
    ['approved'],
    plan.cancelJobIds,
  )
  if (!res.ok) return res
  return { ...res, cancelledRenderJobIds: plan.cancelJobIds }
}

// ── Hold / release ────────────────────────────────────────────────────────────

export type HoldResult =
  | { ok: true; reused: boolean; hold: any }
  | MutationFailure

export async function holdCandidate(
  candidateVersionId: string,
  input: { reason?: string | null },
  actor: ReviewActor,
  admin: Admin = createAdminClient(),
): Promise<HoldResult> {
  const db = admin as any
  const { ctx, error } = await loadContext(db, candidateVersionId)
  if (error) return error
  const plan = planHold(ctx!, input)
  if (!plan.ok) return plan
  if (plan.reused) return { ok: true, reused: true, hold: plan.hold }

  const { data: hold, error: holdErr } = await db
    .from('outfit_quality_queue_hold')
    .insert({ candidate_version_id: candidateVersionId, held_by: actor.userId, reason: plan.hold.reason })
    .select('*')
    .maybeSingle()
  if (holdErr || !hold) return failure('hold_insert_failed', holdErr?.message ?? 'no row returned')
  return { ok: true, reused: false, hold }
}

export type ReleaseResult =
  | { ok: true; reused: boolean; hold: any }
  | MutationFailure

export async function releaseCandidate(
  candidateVersionId: string,
  actor: ReviewActor,
  admin: Admin = createAdminClient(),
): Promise<ReleaseResult> {
  const db = admin as any
  const { ctx, error } = await loadContext(db, candidateVersionId)
  if (error) return error
  const plan = planRelease(ctx!)
  if (!plan.ok) return plan
  if (plan.reused) return { ok: true, reused: true, hold: plan.hold }

  const { data: released, error: relErr } = await db
    .from('outfit_quality_queue_hold')
    .update({ released_by: actor.userId, released_at: new Date().toISOString() })
    .eq('hold_id', plan.releaseHoldId)
    .is('released_at', null)
    .select('*')
  if (relErr) return failure('release_failed', relErr.message)
  if (!released || released.length === 0) {
    // Lost a race with another releaser — the hold is released either way.
    const { data: hold } = await db.from('outfit_quality_queue_hold').select('*').eq('hold_id', plan.releaseHoldId).maybeSingle()
    return { ok: true, reused: true, hold }
  }
  return { ok: true, reused: false, hold: released[0] }
}
