// Mutation planners for the review workbench.
//
// Each planner takes the freshly loaded state of one exact candidate version
// and returns either a rejection (with a stable code) or a plan the store
// applies with error-checked writes. Pure and side-effect free, so the pointer
// path, the keyboard path, and tests all enforce identical rules.
//
// Actor identity is never planned here from client input — the store receives
// the verified admin user id from the gated wrapper and stamps every row.

import { validateNoReason } from '@/lib/outfit-quality/review-reasons'
import { latestActiveDecision, activeHoldFor, type ReviewEventRow, type QueueHoldRow, type RenderJobRow } from '@/lib/outfit-quality/review-state'

export interface PlanVersion {
  candidate_version_id: string
  case_id: string
  version_no: number
  state: string
}

export interface PlanCase {
  case_id: string
  current_version_id: string | null
  status: string
}

export interface PlanContext {
  version: PlanVersion | null
  kase: PlanCase | null
  /** candidate_item_id values of THIS version's frozen manifest. */
  itemIds: string[]
  events: ReviewEventRow[]
  holds: QueueHoldRow[]
  renderJobs: RenderJobRow[]
}

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(value)
}

export interface PlannedEvent {
  action: 'decide' | 'undo' | 'withdraw'
  decision: 'yes' | 'no' | null
  reason_code: string | null
  candidate_item_id: string | null
  note: string | null
  reverses_event_id: string | null
}

export interface Rejection {
  ok: false
  code: string
  message: string
}

const MAX_NOTE = 2000

function reject(code: string, message: string): Rejection {
  return { ok: false, code, message }
}

function cleanNote(note: string | null | undefined): string | null {
  const n = (note ?? '').trim()
  return n ? n.slice(0, MAX_NOTE) : null
}

function checkKey(idempotencyKey: unknown): Rejection | null {
  if (!isUuid(idempotencyKey)) return reject('invalid_idempotency_key', 'a UUID idempotency key is required')
  return null
}

function checkReviewable(ctx: PlanContext): Rejection | null {
  if (!ctx.version || !ctx.kase) return reject('not_found', 'candidate version not found')
  if (ctx.kase.current_version_id !== ctx.version.candidate_version_id) {
    return reject('stale_version', 'a newer version of this candidate exists — review the current version')
  }
  // The event chain outranks the derived state pointer: an active decision is
  // reported as a conflict, not a bare state error.
  if (latestActiveDecision(ctx.events)) {
    return reject('already_decided', 'this version already has an active decision')
  }
  if (activeHoldFor(ctx.holds)) {
    return reject('held', 'this candidate is on hold — release it before deciding')
  }
  if (ctx.version.state !== 'awaiting_human') {
    return reject('not_reviewable', `version is ${ctx.version.state}, not awaiting human review`)
  }
  return null
}

// ── Decide ────────────────────────────────────────────────────────────────────

export interface DecideInput {
  decision: 'yes' | 'no'
  reasonCode?: string | null
  candidateItemId?: string | null
  note?: string | null
  idempotencyKey: string
}

export type DecidePlan =
  | {
      ok: true
      event: PlannedEvent
      nextState: 'approved' | 'rejected'
      /** A Yes enqueues exactly one render cycle for the exact approved version. */
      enqueueRender: boolean
    }
  | Rejection

export function planDecide(ctx: PlanContext, input: DecideInput): DecidePlan {
  const keyErr = checkKey(input.idempotencyKey)
  if (keyErr) return keyErr
  if (input.decision !== 'yes' && input.decision !== 'no') {
    return reject('invalid_decision', 'the decision is exactly Yes or No')
  }

  const reviewable = checkReviewable(ctx)
  if (reviewable) return reviewable

  const note = cleanNote(input.note)

  if (input.decision === 'yes') {
    if (input.reasonCode) return reject('unexpected_reason', 'a Yes carries no reason')
    if (input.candidateItemId) return reject('unexpected_item', 'a Yes carries no affected item')
    return {
      ok: true,
      nextState: 'approved',
      enqueueRender: true,
      event: { action: 'decide', decision: 'yes', reason_code: null, candidate_item_id: null, note, reverses_event_id: null },
    }
  }

  const reason = validateNoReason({
    reasonCode: input.reasonCode,
    candidateItemId: input.candidateItemId,
    versionItemIds: ctx.itemIds,
  })
  if (!reason.ok) return reject(reason.code, reason.message)

  return {
    ok: true,
    nextState: 'rejected',
    enqueueRender: false,
    event: {
      action: 'decide',
      decision: 'no',
      reason_code: input.reasonCode as string,
      candidate_item_id: input.candidateItemId ?? null,
      note,
      reverses_event_id: null,
    },
  }
}

// ── Undo ──────────────────────────────────────────────────────────────────────

export type UndoPlan =
  | {
      ok: true
      event: PlannedEvent
      nextState: 'awaiting_human'
      /** Queued, unclaimed render jobs cancelled in the same mutation. */
      cancelJobIds: string[]
      reversedDecision: 'yes' | 'no'
    }
  | Rejection

export function planUndo(ctx: PlanContext, input: { idempotencyKey: string }): UndoPlan {
  const keyErr = checkKey(input.idempotencyKey)
  if (keyErr) return keyErr
  if (!ctx.version) return reject('not_found', 'candidate version not found')

  const active = latestActiveDecision(ctx.events)
  if (!active) return reject('nothing_to_undo', 'there is no active decision to undo')

  let cancelJobIds: string[] = []
  if (active.decision === 'yes') {
    const jobs = ctx.renderJobs.filter((j) => j.approval_event_id === active.review_event_id && j.status !== 'cancelled')
    const started = jobs.filter((j) => j.status !== 'queued' || j.lease_token !== null)
    if (started.length > 0) {
      return reject('withdrawal_required', 'rendering has started or finished — use withdrawal, not undo')
    }
    cancelJobIds = jobs.map((j) => j.render_job_id)
  }

  return {
    ok: true,
    nextState: 'awaiting_human',
    cancelJobIds,
    reversedDecision: active.decision as 'yes' | 'no',
    event: { action: 'undo', decision: null, reason_code: null, candidate_item_id: null, note: null, reverses_event_id: active.review_event_id },
  }
}

// ── Withdraw ──────────────────────────────────────────────────────────────────

export type WithdrawPlan =
  | {
      ok: true
      event: PlannedEvent
      nextState: 'approval_withdrawn'
      cancelJobIds: string[]
    }
  | Rejection

/**
 * Explicit withdrawal of an active approval. Append-only: the original decide,
 * its reason context, render history, and lineage all remain queryable; still
 * queued render jobs are cancelled, running/ready work is left for the render
 * gate to refuse on its pre-submission approval recheck.
 */
export function planWithdraw(ctx: PlanContext, input: { idempotencyKey: string; note?: string | null }): WithdrawPlan {
  const keyErr = checkKey(input.idempotencyKey)
  if (keyErr) return keyErr
  if (!ctx.version) return reject('not_found', 'candidate version not found')

  const active = latestActiveDecision(ctx.events)
  if (!active || active.decision !== 'yes') {
    return reject('not_approved', 'withdrawal requires an active approval')
  }

  const cancelJobIds = ctx.renderJobs
    .filter((j) => j.approval_event_id === active.review_event_id && j.status === 'queued' && j.lease_token === null)
    .map((j) => j.render_job_id)

  return {
    ok: true,
    nextState: 'approval_withdrawn',
    cancelJobIds,
    event: { action: 'withdraw', decision: null, reason_code: null, candidate_item_id: null, note: cleanNote(input.note), reverses_event_id: active.review_event_id },
  }
}

// ── Hold / release ────────────────────────────────────────────────────────────

export type HoldPlan =
  | { ok: true; reused: false; hold: { reason: string | null } }
  | { ok: true; reused: true; hold: QueueHoldRow }
  | Rejection

export function planHold(ctx: PlanContext, input: { reason?: string | null }): HoldPlan {
  if (!ctx.version || !ctx.kase) return reject('not_found', 'candidate version not found')
  const existing = activeHoldFor(ctx.holds)
  if (existing) return { ok: true, reused: true, hold: existing }
  if (ctx.version.state !== 'awaiting_human' || latestActiveDecision(ctx.events)) {
    return reject('not_holdable', 'only an undecided candidate awaiting review can be held')
  }
  return { ok: true, reused: false, hold: { reason: cleanNote(input.reason) } }
}

export type ReleasePlan =
  | { ok: true; reused: false; releaseHoldId: string }
  | { ok: true; reused: true; hold: QueueHoldRow }
  | Rejection

export function planRelease(ctx: PlanContext): ReleasePlan {
  if (!ctx.version) return reject('not_found', 'candidate version not found')
  const active = activeHoldFor(ctx.holds)
  if (active) return { ok: true, reused: false, releaseHoldId: active.hold_id }
  const released = ctx.holds.filter((h) => h.released_at !== null).sort((a, b) => (b.released_at ?? '').localeCompare(a.released_at ?? ''))
  if (released.length > 0) return { ok: true, reused: true, hold: released[0] }
  return reject('not_held', 'this candidate is not on hold')
}
