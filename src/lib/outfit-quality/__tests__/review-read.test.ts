// Review queue read model: the ACTIVE queue is oldest-first (FIFO review) by
// candidate version created_at with a candidate_version_id tiebreak — the
// documented intent. decided_at is always null on an active card, so a
// decided_at comparison can never order the active queue; ordering by it fell
// through to random UUID order. Reviewed stays most-recently-decided first.

import { describe, it, expect } from 'vitest'
import { loadReviewQueue } from '@/lib/outfit-quality/review-read'
import { createFakeAdmin } from './fake-admin'

const STYLIST = '0d535772-8a4f-440f-9e46-f8d637bed0d3'
const PROFILE = '5ae7edb7-94db-4db0-9a47-aedcb3ef9003'

function kase(caseId: string, versionId: string) {
  return {
    case_id: caseId,
    batch_id: 'a29d7231-4c3c-47d3-bdd6-a16f8829469c',
    data_partition: 'test',
    selected_stylist_id: STYLIST,
    stylist_snapshot_id: null,
    real_member_id: null,
    evaluation_profile_id: PROFILE,
    current_version_id: versionId,
    status: 'awaiting_human',
    created_at: '2026-01-01T00:00:00.000Z',
  }
}

function decideEvent(eventId: string, versionId: string, decision: 'yes' | 'no', createdAt: string) {
  return {
    review_event_id: eventId,
    candidate_version_id: versionId,
    action: 'decide',
    decision,
    reviewer_user_id: '87c7d748-8f6d-458b-b024-a50b12ff4df4',
    idempotency_key: `k-${eventId}`,
    created_at: createdAt,
  }
}

function seed(cases: any[], versions: any[], extras: Record<string, any[]> = {}) {
  return createFakeAdmin({
    outfit_quality_case: cases,
    outfit_quality_candidate_version: versions,
    outfit_quality_candidate_item: [],
    outfit_quality_machine_check: [],
    outfit_quality_review_event: [],
    outfit_quality_queue_hold: [],
    outfit_quality_render_job: [],
    stylist: [{ stylist_id: STYLIST, name: 'Scandi' }],
    outfit_quality_stylist_snapshot: [],
    pilot_member: [],
    outfit_quality_evaluation_profile: [{ profile_id: PROFILE, name: 'Coverage profile' }],
    ...extras,
  })
}

describe('loadReviewQueue — active queue order', () => {
  it('orders the active queue oldest candidate version first (FIFO), not by random UUID', async () => {
    // UUID order deliberately disagrees with created order: a UUID tiebreak
    // (the old behaviour) puts `newer` first even though it arrived later.
    const older = 'ffffffff-ffff-4fff-bfff-ffffffffffff'
    const newer = '00000000-0000-4000-8000-000000000000'
    const db = seed(
      [kase('7d2e31a9-a7ef-4ac2-9691-336ff53f82b2', older), kase('91c5cc6d-0e4d-473c-ba12-f2119f499dbc', newer)],
      [
        { candidate_version_id: newer, case_id: '91c5cc6d-0e4d-473c-ba12-f2119f499dbc', version_no: 1, state: 'awaiting_human', created_at: '2026-01-02T00:00:00.000Z' },
        { candidate_version_id: older, case_id: '7d2e31a9-a7ef-4ac2-9691-336ff53f82b2', version_no: 1, state: 'awaiting_human', created_at: '2026-01-01T00:00:00.000Z' },
      ],
    )
    const q = await loadReviewQueue({ disposition: 'active' }, db.admin)
    expect(q.cards.map((c) => c.candidate_version_id)).toEqual([older, newer])
    // Active cards never carry a decision timestamp — that is exactly why the
    // order must come from the version created_at instead.
    expect(q.cards.every((c) => c.decided_at === null)).toBe(true)
  })

  it('breaks created_at ties by candidate_version_id so the order is deterministic', async () => {
    const low = '11111111-1111-4111-8111-111111111111'
    const high = '22222222-2222-4222-8222-222222222222'
    const db = seed(
      [kase('7d2e31a9-a7ef-4ac2-9691-336ff53f82b2', high), kase('91c5cc6d-0e4d-473c-ba12-f2119f499dbc', low)],
      [
        { candidate_version_id: high, case_id: '7d2e31a9-a7ef-4ac2-9691-336ff53f82b2', version_no: 1, state: 'awaiting_human', created_at: '2026-01-01T00:00:00.000Z' },
        { candidate_version_id: low, case_id: '91c5cc6d-0e4d-473c-ba12-f2119f499dbc', version_no: 1, state: 'awaiting_human', created_at: '2026-01-01T00:00:00.000Z' },
      ],
    )
    const q = await loadReviewQueue({ disposition: 'active' }, db.admin)
    expect(q.cards.map((c) => c.candidate_version_id)).toEqual([low, high])
  })
})

describe('loadReviewQueue — reviewed queue order (unchanged)', () => {
  it('keeps the reviewed queue most-recently-decided first', async () => {
    const decidedFirst = '33333333-3333-4333-8333-333333333333'
    const decidedLater = '44444444-4444-4444-8444-444444444444'
    const db = seed(
      [kase('7d2e31a9-a7ef-4ac2-9691-336ff53f82b2', decidedFirst), kase('91c5cc6d-0e4d-473c-ba12-f2119f499dbc', decidedLater)],
      [
        { candidate_version_id: decidedFirst, case_id: '7d2e31a9-a7ef-4ac2-9691-336ff53f82b2', version_no: 1, state: 'rejected', created_at: '2026-01-01T00:00:00.000Z' },
        { candidate_version_id: decidedLater, case_id: '91c5cc6d-0e4d-473c-ba12-f2119f499dbc', version_no: 1, state: 'approved', created_at: '2026-01-02T00:00:00.000Z' },
      ],
      {
        outfit_quality_review_event: [
          decideEvent('f53663f4-fd5d-4bde-a8f1-6d79cf2c28cd', decidedFirst, 'no', '2026-01-03T00:00:00.000Z'),
          decideEvent('0a69d798-82f7-4afc-b847-97695735bb16', decidedLater, 'yes', '2026-01-04T00:00:00.000Z'),
        ],
      },
    )
    const q = await loadReviewQueue({ disposition: 'reviewed' }, db.admin)
    expect(q.cards.map((c) => c.candidate_version_id)).toEqual([decidedLater, decidedFirst])
    expect(q.cards.map((c) => c.disposition)).toEqual(['reviewed', 'reviewed'])
  })
})
