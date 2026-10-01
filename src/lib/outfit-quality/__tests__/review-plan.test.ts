// Mutation planners: given the loaded version/case/events/holds/jobs, decide
// exactly what may happen. Pure, so the browser keyboard path, pointer path,
// and server action all enforce the identical rules.

import { describe, it, expect } from 'vitest'
import {
  planDecide,
  planUndo,
  planWithdraw,
  planHold,
  planRelease,
  isUuid,
  type PlanContext,
} from '@/lib/outfit-quality/review-plan'
import type { ReviewEventRow, QueueHoldRow, RenderJobRow } from '@/lib/outfit-quality/review-state'

const VERSION = { candidate_version_id: 'v1', case_id: 'c1', version_no: 1, state: 'awaiting_human' }
const KASE = { case_id: 'c1', current_version_id: 'v1', status: 'awaiting_human' }
// Test-only placeholder idempotency key (a valid but non-secret UUID shape).
const TEST_IDEMPOTENCY_KEY = '00000000-0000-4000-8000-000000000001'

function ctx(overrides: Partial<PlanContext> = {}): PlanContext {
  return {
    version: VERSION,
    kase: KASE,
    itemIds: ['ci-1', 'ci-2'],
    events: [],
    holds: [],
    renderJobs: [],
    ...overrides,
  }
}

function decideEvent(overrides: Partial<ReviewEventRow> = {}): ReviewEventRow {
  return {
    review_event_id: 'e1',
    candidate_version_id: 'v1',
    action: 'decide',
    decision: 'yes',
    reason_code: null,
    candidate_item_id: null,
    note: null,
    reverses_event_id: null,
    reviewer_user_id: 'admin-1',
    idempotency_key: TEST_IDEMPOTENCY_KEY,
    created_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function job(overrides: Partial<RenderJobRow> = {}): RenderJobRow {
  return {
    render_job_id: 'j1',
    candidate_version_id: 'v1',
    approval_event_id: 'e1',
    cycle_no: 1,
    status: 'queued',
    lease_token: null,
    ...overrides,
  }
}

describe('isUuid', () => {
  it('accepts canonical uuids and rejects other strings', () => {
    expect(isUuid(TEST_IDEMPOTENCY_KEY)).toBe(true)
    expect(isUuid('not-a-uuid')).toBe(false)
    expect(isUuid('')).toBe(false)
  })
})

describe('planDecide', () => {
  it('requires a uuid idempotency key', () => {
    const r = planDecide(ctx(), { decision: 'yes', idempotencyKey: 'nope' })
    expect(r).toMatchObject({ ok: false, code: 'invalid_idempotency_key' })
  })

  it('rejects an unknown version', () => {
    const r = planDecide(ctx({ version: null }), { decision: 'yes', idempotencyKey: TEST_IDEMPOTENCY_KEY })
    expect(r).toMatchObject({ ok: false, code: 'not_found' })
  })

  it('rejects a stale (non-current) version so a parent is never approved through its child', () => {
    const r = planDecide(ctx({ kase: { ...KASE, current_version_id: 'v2-child' } }), { decision: 'yes', idempotencyKey: TEST_IDEMPOTENCY_KEY })
    expect(r).toMatchObject({ ok: false, code: 'stale_version' })
  })

  it('rejects versions not awaiting review', () => {
    for (const state of ['generated', 'objective_checking', 'objective_failed', 'subjective_checking', 'approved', 'rejected', 'approval_withdrawn']) {
      const r = planDecide(ctx({ version: { ...VERSION, state } }), { decision: 'yes', idempotencyKey: TEST_IDEMPOTENCY_KEY })
      expect(r).toMatchObject({ ok: false, code: 'not_reviewable' })
    }
  })

  it('rejects a second active decision', () => {
    const r = planDecide(ctx({ events: [decideEvent()] }), { decision: 'no', reasonCode: 'global_composition', idempotencyKey: TEST_IDEMPOTENCY_KEY })
    expect(r).toMatchObject({ ok: false, code: 'already_decided' })
  })

  it('rejects deciding a held candidate — release it first', () => {
    const r = planDecide(ctx({ holds: [{ hold_id: 'h1', candidate_version_id: 'v1', held_by: 'a', reason: null, released_by: null, created_at: 'x', released_at: null }] }), { decision: 'yes', idempotencyKey: TEST_IDEMPOTENCY_KEY })
    expect(r).toMatchObject({ ok: false, code: 'held' })
  })

  it('plans a Yes on the exact version with one render cycle enqueued', () => {
    const r = planDecide(ctx(), { decision: 'yes', idempotencyKey: TEST_IDEMPOTENCY_KEY })
    expect(r).toMatchObject({ ok: true, nextState: 'approved', enqueueRender: true })
    if (r.ok) {
      expect(r.event.action).toBe('decide')
      expect(r.event.decision).toBe('yes')
      expect(r.event.reason_code).toBeNull()
      expect(r.event.candidate_item_id).toBeNull()
    }
  })

  it('plans a structured No without a render cycle', () => {
    const r = planDecide(ctx(), { decision: 'no', reasonCode: 'wrong_for_stylist', note: ' too sweet for her brief ', idempotencyKey: TEST_IDEMPOTENCY_KEY })
    expect(r).toMatchObject({ ok: true, nextState: 'rejected', enqueueRender: false })
    if (r.ok) {
      expect(r.event.reason_code).toBe('wrong_for_stylist')
      expect(r.event.note).toBe('too sweet for her brief')
    }
  })

  it('No without a reason is rejected; a note cannot substitute', () => {
    const r = planDecide(ctx(), { decision: 'no', note: 'just no', idempotencyKey: TEST_IDEMPOTENCY_KEY })
    expect(r).toMatchObject({ ok: false, code: 'missing_reason' })
  })

  it('item-specific No requires an item of this exact version', () => {
    expect(planDecide(ctx(), { decision: 'no', reasonCode: 'item_wrong_for_member', idempotencyKey: TEST_IDEMPOTENCY_KEY })).toMatchObject({ ok: false, code: 'missing_item' })
    expect(planDecide(ctx(), { decision: 'no', reasonCode: 'item_wrong_for_member', candidateItemId: 'ci-foreign', idempotencyKey: TEST_IDEMPOTENCY_KEY })).toMatchObject({ ok: false, code: 'foreign_item' })
    const ok = planDecide(ctx(), { decision: 'no', reasonCode: 'item_wrong_for_member', candidateItemId: 'ci-2', idempotencyKey: TEST_IDEMPOTENCY_KEY })
    expect(ok).toMatchObject({ ok: true })
    if (ok.ok) expect(ok.event.candidate_item_id).toBe('ci-2')
  })

  it('a Yes must not carry a reason or item', () => {
    expect(planDecide(ctx(), { decision: 'yes', reasonCode: 'global_composition', idempotencyKey: TEST_IDEMPOTENCY_KEY })).toMatchObject({ ok: false, code: 'unexpected_reason' })
    expect(planDecide(ctx(), { decision: 'yes', candidateItemId: 'ci-1', idempotencyKey: TEST_IDEMPOTENCY_KEY })).toMatchObject({ ok: false, code: 'unexpected_item' })
  })
})

describe('planUndo', () => {
  it('refuses when there is no active decision', () => {
    expect(planUndo(ctx(), { idempotencyKey: TEST_IDEMPOTENCY_KEY })).toMatchObject({ ok: false, code: 'nothing_to_undo' })
  })

  it('undoes a No back to review, preserving the original event', () => {
    const d = decideEvent({ decision: 'no', reason_code: 'global_composition' })
    const r = planUndo(ctx({ version: { ...VERSION, state: 'rejected' }, events: [d] }), { idempotencyKey: TEST_IDEMPOTENCY_KEY })
    expect(r).toMatchObject({ ok: true, nextState: 'awaiting_human', cancelJobIds: [] })
    if (r.ok) {
      expect(r.event.action).toBe('undo')
      expect(r.event.reverses_event_id).toBe('e1')
    }
  })

  it('undoes a queued, unclaimed approval and cancels its render job atomically in the plan', () => {
    const d = decideEvent({ decision: 'yes' })
    const r = planUndo(ctx({ version: { ...VERSION, state: 'approved' }, events: [d], renderJobs: [job()] }), { idempotencyKey: TEST_IDEMPOTENCY_KEY })
    expect(r).toMatchObject({ ok: true, nextState: 'awaiting_human', cancelJobIds: ['j1'] })
  })

  it('refuses to undo an approval once rendering has started or finished — withdrawal required', () => {
    const d = decideEvent({ decision: 'yes' })
    for (const status of ['running', 'ready', 'attention_required'] as const) {
      const r = planUndo(ctx({ version: { ...VERSION, state: 'approved' }, events: [d], renderJobs: [job({ status })] }), { idempotencyKey: TEST_IDEMPOTENCY_KEY })
      expect(r).toMatchObject({ ok: false, code: 'withdrawal_required' })
    }
  })

  it('refuses to undo an approval whose queued job is already claimed (leased)', () => {
    const d = decideEvent({ decision: 'yes' })
    const r = planUndo(ctx({ version: { ...VERSION, state: 'approved' }, events: [d], renderJobs: [job({ lease_token: 'lease-1' })] }), { idempotencyKey: TEST_IDEMPOTENCY_KEY })
    expect(r).toMatchObject({ ok: false, code: 'withdrawal_required' })
  })

  it('allows undo of an approval whose job never materialised (no render started)', () => {
    const d = decideEvent({ decision: 'yes' })
    const r = planUndo(ctx({ version: { ...VERSION, state: 'approved' }, events: [d], renderJobs: [] }), { idempotencyKey: TEST_IDEMPOTENCY_KEY })
    expect(r).toMatchObject({ ok: true, cancelJobIds: [] })
  })

  it('cannot reverse an already-reversed decision', () => {
    const d = decideEvent({ decision: 'no', reason_code: 'global_composition' })
    const u = decideEvent({ review_event_id: 'e2', action: 'undo', decision: null, reverses_event_id: 'e1', idempotency_key: 'k2', created_at: '2026-01-01T00:01:00.000Z' })
    const r = planUndo(ctx({ version: { ...VERSION, state: 'awaiting_human' }, events: [d, u] }), { idempotencyKey: TEST_IDEMPOTENCY_KEY })
    expect(r).toMatchObject({ ok: false, code: 'nothing_to_undo' })
  })
})

describe('planWithdraw', () => {
  it('requires an active approval', () => {
    expect(planWithdraw(ctx(), { idempotencyKey: TEST_IDEMPOTENCY_KEY })).toMatchObject({ ok: false, code: 'not_approved' })
    const dNo = decideEvent({ decision: 'no', reason_code: 'global_composition' })
    expect(planWithdraw(ctx({ events: [dNo] }), { idempotencyKey: TEST_IDEMPOTENCY_KEY })).toMatchObject({ ok: false, code: 'not_approved' })
  })

  it('withdraws an active approval, cancelling still-queued jobs and preserving provenance', () => {
    const d = decideEvent({ decision: 'yes' })
    const r = planWithdraw(ctx({ version: { ...VERSION, state: 'approved' }, events: [d], renderJobs: [job(), job({ render_job_id: 'j2', status: 'running', lease_token: 'L' })] }), { idempotencyKey: TEST_IDEMPOTENCY_KEY, note: 'not good enough' })
    expect(r).toMatchObject({ ok: true, nextState: 'approval_withdrawn', cancelJobIds: ['j1'] })
    if (r.ok) {
      expect(r.event.action).toBe('withdraw')
      expect(r.event.reverses_event_id).toBe('e1')
      expect(r.event.note).toBe('not good enough')
    }
  })

  it('is refused after the approval was already withdrawn', () => {
    const d = decideEvent({ decision: 'yes' })
    const w = decideEvent({ review_event_id: 'e2', action: 'withdraw', decision: null, reverses_event_id: 'e1', idempotency_key: 'k2', created_at: '2026-01-01T00:01:00.000Z' })
    expect(planWithdraw(ctx({ version: { ...VERSION, state: 'approval_withdrawn' }, events: [d, w] }), { idempotencyKey: TEST_IDEMPOTENCY_KEY })).toMatchObject({ ok: false, code: 'not_approved' })
  })
})

describe('planHold / planRelease', () => {
  it('holds an awaiting candidate with no decision', () => {
    const r = planHold(ctx(), { reason: 'check stock tomorrow' })
    expect(r).toMatchObject({ ok: true })
    if (r.ok) expect(r.hold.reason).toBe('check stock tomorrow')
  })

  it('a second hold on a held candidate reuses the active hold (no duplicate)', () => {
    const existing: QueueHoldRow = { hold_id: 'h1', candidate_version_id: 'v1', held_by: 'a', reason: 'r', released_by: null, created_at: 'x', released_at: null }
    const r = planHold(ctx({ holds: [existing] }), { reason: 'again' })
    expect(r).toMatchObject({ ok: true, reused: true })
    if (r.ok && r.reused) expect(r.hold.hold_id).toBe('h1')
  })

  it('refuses to hold a decided or non-reviewable candidate', () => {
    const d = decideEvent({ decision: 'yes' })
    expect(planHold(ctx({ version: { ...VERSION, state: 'approved' }, events: [d] }), {})).toMatchObject({ ok: false, code: 'not_holdable' })
    expect(planHold(ctx({ version: { ...VERSION, state: 'objective_failed' } }), {})).toMatchObject({ ok: false, code: 'not_holdable' })
  })

  it('release closes the active hold; a replay returns the released hold without error', () => {
    const active: QueueHoldRow = { hold_id: 'h1', candidate_version_id: 'v1', held_by: 'a', reason: null, released_by: null, created_at: 'x', released_at: null }
    const r = planRelease(ctx({ holds: [active] }))
    expect(r).toMatchObject({ ok: true, reused: false })
    if (r.ok && !r.reused) expect(r.releaseHoldId).toBe('h1')

    const released: QueueHoldRow = { ...active, released_by: 'a', released_at: 'y' }
    const replay = planRelease(ctx({ holds: [released] }))
    expect(replay).toMatchObject({ ok: true, reused: true })

    expect(planRelease(ctx({}))).toMatchObject({ ok: false, code: 'not_held' })
  })
})
