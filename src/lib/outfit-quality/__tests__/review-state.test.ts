// Effective review state is DERIVED from the append-only event chain, never
// from a mutable verdict column: the latest unreversed `decide` is the current
// decision; undo/withdraw append reversals and never erase the original.
// Counts must not double count versions or reversed events.

import { describe, it, expect } from 'vitest'
import {
  orderEvents,
  latestActiveDecision,
  annotateEvents,
  activeHoldFor,
  deriveQueueDisposition,
  deriveQueueCounts,
  type ReviewEventRow,
  type QueueHoldRow,
} from '@/lib/outfit-quality/review-state'

let seq = 0
function ev(overrides: Partial<ReviewEventRow>): ReviewEventRow {
  seq += 1
  return {
    review_event_id: `e${seq}`,
    candidate_version_id: 'v1',
    action: 'decide',
    decision: 'yes',
    reason_code: null,
    candidate_item_id: null,
    note: null,
    reverses_event_id: null,
    reviewer_user_id: 'admin-1',
    idempotency_key: `k${seq}`,
    created_at: `2026-01-01T00:00:${String(seq).padStart(2, '0')}.000Z`,
    ...overrides,
  }
}

function hold(overrides: Partial<QueueHoldRow>): QueueHoldRow {
  return {
    hold_id: `h${Math.random()}`,
    candidate_version_id: 'v1',
    held_by: 'admin-1',
    reason: null,
    released_by: null,
    created_at: '2026-01-01T00:00:00.000Z',
    released_at: null,
    ...overrides,
  }
}

describe('orderEvents', () => {
  it('orders deterministically by created_at then id', () => {
    const a = ev({ review_event_id: 'b', created_at: '2026-01-01T00:00:01.000Z' })
    const b = ev({ review_event_id: 'a', created_at: '2026-01-01T00:00:01.000Z' })
    const c = ev({ review_event_id: 'c', created_at: '2026-01-01T00:00:00.000Z' })
    expect(orderEvents([a, b, c]).map((e) => e.review_event_id)).toEqual(['c', 'a', 'b'])
  })
})

describe('latestActiveDecision', () => {
  it('returns the only decision when nothing reverses it', () => {
    const d = ev({ decision: 'no', reason_code: 'global_composition' })
    expect(latestActiveDecision([d])?.review_event_id).toBe(d.review_event_id)
  })

  it('an undo reversal clears the decision it reverses', () => {
    const d = ev({ decision: 'no', reason_code: 'wrong_for_stylist' })
    const u = ev({ action: 'undo', decision: null, reverses_event_id: d.review_event_id })
    expect(latestActiveDecision([d, u])).toBeNull()
  })

  it('a withdrawal clears the approval it reverses', () => {
    const d = ev({ decision: 'yes' })
    const w = ev({ action: 'withdraw', decision: null, reverses_event_id: d.review_event_id })
    expect(latestActiveDecision([d, w])).toBeNull()
  })

  it('after undo, a fresh decide becomes the active decision', () => {
    const d1 = ev({ decision: 'no', reason_code: 'global_composition' })
    const u = ev({ action: 'undo', decision: null, reverses_event_id: d1.review_event_id })
    const d2 = ev({ decision: 'yes' })
    expect(latestActiveDecision([d1, u, d2])?.review_event_id).toBe(d2.review_event_id)
  })

  it('operates on one version’s chain — callers filter by candidate_version_id first', () => {
    const mine = ev({ candidate_version_id: 'v1' })
    const foreign = ev({ candidate_version_id: 'other' })
    const chain = [mine, foreign].filter((e) => e.candidate_version_id === 'v1')
    expect(latestActiveDecision(chain)?.review_event_id).toBe(mine.review_event_id)
  })
})

describe('annotateEvents', () => {
  it('labels effective and superseded events in deterministic order', () => {
    const d1 = ev({ decision: 'no', reason_code: 'global_composition' })
    const u = ev({ action: 'undo', decision: null, reverses_event_id: d1.review_event_id })
    const d2 = ev({ decision: 'yes' })
    const annotated = annotateEvents([d2, u, d1])
    const byId = new Map(annotated.map((a) => [a.event.review_event_id, a]))
    expect(byId.get(d1.review_event_id)?.effective).toBe(false)
    expect(byId.get(u.review_event_id)?.effective).toBe(true)
    expect(byId.get(d2.review_event_id)?.effective).toBe(true)
    expect(annotated.map((a) => a.event.review_event_id)).toEqual([d1.review_event_id, u.review_event_id, d2.review_event_id])
  })
})

describe('activeHoldFor', () => {
  it('returns the unreleased hold only', () => {
    const released = hold({ released_by: 'admin-1', released_at: '2026-01-02T00:00:00.000Z' })
    expect(activeHoldFor([released])).toBeNull()
    const active = hold({})
    expect(activeHoldFor([released, active])?.hold_id).toBe(active.hold_id)
  })
})

describe('deriveQueueDisposition', () => {
  it('active when awaiting with no decision and no hold', () => {
    expect(deriveQueueDisposition({ state: 'awaiting_human', events: [], holds: [] })).toBe('active')
  })
  it('held when an unreleased hold exists', () => {
    expect(deriveQueueDisposition({ state: 'awaiting_human', events: [], holds: [hold({})] })).toBe('held')
  })
  it('reviewed when an unreversed decision exists', () => {
    const d = ev({ decision: 'yes' })
    expect(deriveQueueDisposition({ state: 'approved', events: [d], holds: [] })).toBe('reviewed')
  })
  it('a reversed decision with no new decision returns to active, not reviewed', () => {
    const d = ev({ decision: 'no', reason_code: 'global_composition' })
    const u = ev({ action: 'undo', decision: null, reverses_event_id: d.review_event_id })
    expect(deriveQueueDisposition({ state: 'awaiting_human', events: [d, u], holds: [] })).toBe('active')
  })
  it('a withdrawn approval stays reviewed (it was decided; not double counted as active)', () => {
    const d = ev({ decision: 'yes' })
    const w = ev({ action: 'withdraw', decision: null, reverses_event_id: d.review_event_id })
    expect(deriveQueueDisposition({ state: 'approval_withdrawn', events: [d, w], holds: [] })).toBe('reviewed')
  })
  it('non-reviewable machine states stay out of the queue', () => {
    expect(deriveQueueDisposition({ state: 'objective_failed', events: [], holds: [] })).toBe('hidden')
    expect(deriveQueueDisposition({ state: 'generated', events: [], holds: [] })).toBe('hidden')
  })
})

describe('deriveQueueCounts', () => {
  it('counts each version once from effective state', () => {
    const dYes = ev({ candidate_version_id: 'v1', decision: 'yes' })
    const dNo = ev({ candidate_version_id: 'v2', decision: 'no', reason_code: 'global_composition' })
    const dNoUndone = ev({ candidate_version_id: 'v3', decision: 'no', reason_code: 'wrong_for_stylist' })
    const u3 = ev({ candidate_version_id: 'v3', action: 'undo', decision: null, reverses_event_id: dNoUndone.review_event_id })
    const counts = deriveQueueCounts([
      { candidate_version_id: 'v1', state: 'approved', events: [dYes], holds: [] },
      { candidate_version_id: 'v2', state: 'rejected', events: [dNo], holds: [] },
      { candidate_version_id: 'v3', state: 'awaiting_human', events: [dNoUndone, u3], holds: [] },
      { candidate_version_id: 'v4', state: 'awaiting_human', events: [], holds: [hold({ candidate_version_id: 'v4' })] },
      { candidate_version_id: 'v5', state: 'awaiting_human', events: [], holds: [] },
      { candidate_version_id: 'v6', state: 'objective_failed', events: [], holds: [] },
    ])
    expect(counts).toEqual({ active: 2, held: 1, reviewed: 2 })
  })
})
