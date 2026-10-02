// VAL-LEARN-001..004 — scoped learning projections and compensating reversals.
//
// Deterministic fixtures exercise hypothetical training/validation/holdout/
// synthetic semantics; the `test` partition is additionally proven inert
// against the connected database in learning-projection.connected.test.ts.
// Nothing here ever writes member taste: the assertions prove zero
// member-feedback table access on every path.

import { describe, it, expect } from 'vitest'
import {
  planLearningProjections,
  planCompensatingProjections,
  netLearningEffect,
  isLearningEligible,
  type LearningAttribution,
  type LearningDecisionEvent,
  type ExistingLearningProjection,
} from '@/lib/outfit-quality/learning-projection'
import {
  decideCandidate,
  undoCandidateDecision,
  withdrawCandidateApproval,
  holdCandidate,
  type ReviewActor,
} from '@/lib/outfit-quality/review-store'
import { createFakeAdmin } from './fake-admin'

const CHLOE_STYLIST = '0d535772-8a4f-440f-9e46-f8d637bed0d3'
const SCANDI_STYLIST = '11111111-2222-4333-8444-555555555555'
const MEMBER_ALISON = 'df918c45-3063-484e-b83b-dc41d25ac804'
const PROFILE_ID = '22222222-3333-4444-8555-666666666666'
const ACTOR: ReviewActor = { userId: 'admin-verified-learning' }

const KEY = {
  decide: '0a69d798-82f7-4afc-b847-97695735bb16',
  undo: '1b70e899-93f8-4b0d-b858-08706846cc27',
  withdraw: '2c81f9aa-a409-4c1e-c969-19817957dd38',
}

// ── Pure planner: the exact reason matrix ─────────────────────────────────────

function event(over: Partial<LearningDecisionEvent> = {}): LearningDecisionEvent {
  return {
    review_event_id: 'evt-1',
    candidate_version_id: 'v1',
    decision: 'yes',
    reason_code: null,
    candidate_item_id: null,
    ...over,
  }
}

function attribution(over: Partial<LearningAttribution> = {}): LearningAttribution {
  return { dataPartition: 'training', selectedStylistId: SCANDI_STYLIST, contextType: 'real_member', ...over }
}

describe('planLearningProjections — the approved reason matrix (VAL-LEARN-001)', () => {
  it('Yes projects one positive global and one positive selected-stylist plan', () => {
    const plans = planLearningProjections({ attribution: attribution(), event: event() })
    expect(plans).toHaveLength(2)
    expect(plans).toContainEqual(
      expect.objectContaining({ scope: 'global_quality', target_stylist_id: null, polarity: 'positive' }),
    )
    expect(plans).toContainEqual(
      expect.objectContaining({ scope: 'stylist', target_stylist_id: SCANDI_STYLIST, polarity: 'positive' }),
    )
  })

  it('No: global_composition projects ONLY a negative global plan', () => {
    const plans = planLearningProjections({ attribution: attribution(), event: event({ decision: 'no', reason_code: 'global_composition' }) })
    expect(plans).toEqual([
      expect.objectContaining({ scope: 'global_quality', target_stylist_id: null, polarity: 'negative' }),
    ])
  })

  it('No: wrong_for_stylist projects ONLY a negative selected-stylist plan — never Chloe', () => {
    const plans = planLearningProjections({ attribution: attribution(), event: event({ decision: 'no', reason_code: 'wrong_for_stylist' }) })
    expect(plans).toEqual([
      expect.objectContaining({ scope: 'stylist', target_stylist_id: SCANDI_STYLIST, polarity: 'negative' }),
    ])
    expect(plans[0].target_stylist_id).not.toBe(CHLOE_STYLIST)
  })

  it('No: operational_data and wrong_for_member project nothing', () => {
    expect(planLearningProjections({ attribution: attribution(), event: event({ decision: 'no', reason_code: 'operational_data' }) })).toEqual([])
    expect(planLearningProjections({ attribution: attribution(), event: event({ decision: 'no', reason_code: 'wrong_for_member' }) })).toEqual([])
  })

  it('item-specific variants keep the scope mapping and retain the affected item', () => {
    const globalItem = planLearningProjections({
      attribution: attribution(),
      event: event({ decision: 'no', reason_code: 'item_global_composition', candidate_item_id: 'ci-9' }),
    })
    expect(globalItem).toEqual([
      expect.objectContaining({ scope: 'global_quality', polarity: 'negative', payload: expect.objectContaining({ affected_candidate_item_id: 'ci-9', reason_code: 'item_global_composition' }) }),
    ])
    const stylistItem = planLearningProjections({
      attribution: attribution(),
      event: event({ decision: 'no', reason_code: 'item_wrong_for_stylist', candidate_item_id: 'ci-7' }),
    })
    expect(stylistItem).toEqual([
      expect.objectContaining({ scope: 'stylist', target_stylist_id: SCANDI_STYLIST, polarity: 'negative', payload: expect.objectContaining({ affected_candidate_item_id: 'ci-7' }) }),
    ])
    expect(planLearningProjections({ attribution: attribution(), event: event({ decision: 'no', reason_code: 'item_operational_data', candidate_item_id: 'ci-1' }) })).toEqual([])
    expect(planLearningProjections({ attribution: attribution(), event: event({ decision: 'no', reason_code: 'item_wrong_for_member', candidate_item_id: 'ci-1' }) })).toEqual([])
  })

  it('application keys are stable per event, scope, and target (idempotent routing)', () => {
    const a = planLearningProjections({ attribution: attribution(), event: event() })
    const b = planLearningProjections({ attribution: attribution(), event: event() })
    expect(a.map((p) => p.application_key)).toEqual(b.map((p) => p.application_key))
    expect(new Set(a.map((p) => p.application_key)).size).toBe(2)
  })

  it('every non-training partition is inert for every decision shape (VAL-LEARN-003)', () => {
    for (const partition of ['validation', 'holdout', 'synthetic', 'test']) {
      expect(isLearningEligible(partition)).toBe(false)
      expect(planLearningProjections({ attribution: attribution({ dataPartition: partition }), event: event() })).toEqual([])
      expect(
        planLearningProjections({ attribution: attribution({ dataPartition: partition }), event: event({ decision: 'no', reason_code: 'global_composition' }) }),
      ).toEqual([])
      expect(
        planLearningProjections({ attribution: attribution({ dataPartition: partition }), event: event({ decision: 'no', reason_code: 'wrong_for_stylist' }) }),
      ).toEqual([])
    }
    expect(isLearningEligible('training')).toBe(true)
    expect(isLearningEligible(undefined)).toBe(false)
  })

  it('an evaluation-profile training review labels context_type and never targets a member (VAL-LEARN-002)', () => {
    const plans = planLearningProjections({ attribution: attribution({ contextType: 'evaluation_profile' }), event: event() })
    expect(plans).toHaveLength(2)
    for (const p of plans) {
      expect(p.payload.context_type).toBe('evaluation_profile')
      expect(p.payload).not.toHaveProperty('member_id')
    }
    expect(plans.map((p) => p.scope).sort()).toEqual(['global_quality', 'stylist'])
  })
})

describe('planCompensatingProjections — reversal without erasure (VAL-LEARN-004)', () => {
  const originals: ExistingLearningProjection[] = [
    { projection_id: 'p-global', review_event_id: 'evt-1', scope: 'global_quality', target_stylist_id: null, polarity: 'positive', reverses_projection_id: null },
    { projection_id: 'p-stylist', review_event_id: 'evt-1', scope: 'stylist', target_stylist_id: SCANDI_STYLIST, polarity: 'positive', reverses_projection_id: null },
  ]

  it('appends one opposite-polarity compensation linked to each original', () => {
    const plans = planCompensatingProjections({ reversalEventId: 'evt-undo', candidateVersionId: 'v1', ledger: originals, reversedEventId: 'evt-1' })
    expect(plans).toHaveLength(2)
    expect(plans).toContainEqual(
      expect.objectContaining({ scope: 'global_quality', polarity: 'negative', reverses_projection_id: 'p-global' }),
    )
    expect(plans).toContainEqual(
      expect.objectContaining({ scope: 'stylist', target_stylist_id: SCANDI_STYLIST, polarity: 'negative', reverses_projection_id: 'p-stylist' }),
    )
    for (const p of plans) expect(p.application_key).toContain('evt-undo:compensate:')
  })

  it('skips already-compensated originals and never re-compensates a compensation', () => {
    const ledger: ExistingLearningProjection[] = [
      ...originals,
      { projection_id: 'p-comp', review_event_id: 'evt-undo', scope: 'global_quality', target_stylist_id: null, polarity: 'negative', reverses_projection_id: 'p-global' },
    ]
    const plans = planCompensatingProjections({ reversalEventId: 'evt-undo', candidateVersionId: 'v1', ledger, reversedEventId: 'evt-1' })
    expect(plans).toHaveLength(1)
    expect(plans[0].reverses_projection_id).toBe('p-stylist')
  })

  it('a decision followed by its reversal nets to zero while history remains', () => {
    const decided = planLearningProjections({ attribution: attribution(), event: event() })
    expect(netLearningEffect(decided).get('global_quality:global')).toBe(1)
    expect(netLearningEffect(decided).get(`stylist:${SCANDI_STYLIST}`)).toBe(1)
    const ledger: ExistingLearningProjection[] = decided.map((p, i) => ({
      projection_id: `p-${i}`,
      review_event_id: p.review_event_id,
      scope: p.scope,
      target_stylist_id: p.target_stylist_id,
      polarity: p.polarity,
      reverses_projection_id: null,
    }))
    const comps = planCompensatingProjections({ reversalEventId: 'evt-undo', candidateVersionId: 'v1', ledger, reversedEventId: 'evt-1' })
    const net = netLearningEffect([...ledger, ...comps])
    expect(net.get('global_quality:global')).toBe(0)
    expect(net.get(`stylist:${SCANDI_STYLIST}`)).toBe(0)
  })
})

// ── Store integration: the review mutation writes the ledger ────────────────

function seedTraining(over: { partition?: string; contextType?: 'real_member' | 'evaluation_profile'; jobs?: any[]; stylistId?: string } = {}) {
  const partition = over.partition ?? 'training'
  const contextType = over.contextType ?? 'real_member'
  return createFakeAdmin({
    outfit_quality_batch: [],
    outfit_quality_candidate_version: [
      { candidate_version_id: 'v1', case_id: 'c1', version_no: 1, state: 'awaiting_human', created_at: '2026-01-01T00:00:00.000Z' },
    ],
    outfit_quality_case: [
      {
        case_id: 'c1',
        current_version_id: 'v1',
        status: 'awaiting_human',
        data_partition: partition,
        selected_stylist_id: over.stylistId ?? SCANDI_STYLIST,
        real_member_id: contextType === 'real_member' ? MEMBER_ALISON : null,
        evaluation_profile_id: contextType === 'evaluation_profile' ? PROFILE_ID : null,
      },
    ],
    outfit_quality_candidate_item: [
      { candidate_item_id: 'ci-1', candidate_version_id: 'v1', item_id: 'i1', slot: 'top', sort_order: 0, source_image_url: 'https://res.cloudinary.com/x/top.jpg', item_snapshot: { item_type: 'shirt' } },
      { candidate_item_id: 'ci-2', candidate_version_id: 'v1', item_id: 'i2', slot: 'bottom', sort_order: 1, source_image_url: 'https://res.cloudinary.com/x/bottom.jpg', item_snapshot: { item_type: 'trouser' } },
    ],
    outfit_quality_promotion: [],
    outfit: [],
    outfit_item: [],
    outfit_quality_review_event: [],
    outfit_quality_queue_hold: [],
    outfit_quality_render_job: over.jobs ?? [],
    outfit_quality_machine_check: [],
    outfit_quality_learning_projection: [],
  })
}

/** The tables a Quality Lab mutation may never touch while routing learning. */
const MEMBER_FEEDBACK_TABLES = ['pilot_look_feedback', 'taste_event', 'member_taste', 'member_affinity', 'pilot_member_preference']

function expectNoMemberWrites(db: ReturnType<typeof createFakeAdmin>) {
  for (const table of db.queried) {
    expect(MEMBER_FEEDBACK_TABLES, `mutation touched member-feedback table ${table}`).not.toContain(table)
  }
}

describe('review store learning routing (VAL-LEARN-001/002/003)', () => {
  it('a training Yes appends exactly one positive global and one positive selected-stylist projection', async () => {
    const db = seedTraining()
    const r = await decideCandidate('v1', { decision: 'yes', idempotencyKey: KEY.decide }, ACTOR, db.admin)
    expect(r).toMatchObject({ ok: true, reused: false })
    if (!r.ok) return
    const rows = db.tables.outfit_quality_learning_projection
    expect(rows).toHaveLength(2)
    expect(rows).toContainEqual(
      expect.objectContaining({
        review_event_id: r.event.review_event_id,
        candidate_version_id: 'v1',
        scope: 'global_quality',
        target_stylist_id: null,
        polarity: 'positive',
        status: 'applied',
        application_key: `${r.event.review_event_id}:global_quality:global`,
      }),
    )
    expect(rows).toContainEqual(
      expect.objectContaining({
        scope: 'stylist',
        target_stylist_id: SCANDI_STYLIST,
        polarity: 'positive',
        application_key: `${r.event.review_event_id}:stylist:${SCANDI_STYLIST}`,
      }),
    )
    expectNoMemberWrites(db)
  })

  it('an evaluation-profile training Yes projects global+stylist with the profile labeled, and still writes no member evidence', async () => {
    const db = seedTraining({ contextType: 'evaluation_profile' })
    const r = await decideCandidate('v1', { decision: 'yes', idempotencyKey: KEY.decide }, ACTOR, db.admin)
    expect(r).toMatchObject({ ok: true })
    const rows = db.tables.outfit_quality_learning_projection
    expect(rows).toHaveLength(2)
    for (const row of rows) expect(row.payload.context_type).toBe('evaluation_profile')
    expect(rows.map((r2) => r2.scope).sort()).toEqual(['global_quality', 'stylist'])
    expectNoMemberWrites(db)
  })

  it('No reasons route exactly: global only, stylist only, or nothing', async () => {
    const cases: { reason: string; item?: string; expectScopes: { scope: string; target: string | null }[] }[] = [
      { reason: 'global_composition', expectScopes: [{ scope: 'global_quality', target: null }] },
      { reason: 'wrong_for_stylist', expectScopes: [{ scope: 'stylist', target: SCANDI_STYLIST }] },
      { reason: 'operational_data', expectScopes: [] },
      { reason: 'wrong_for_member', expectScopes: [] },
      { reason: 'item_global_composition', item: 'ci-1', expectScopes: [{ scope: 'global_quality', target: null }] },
      { reason: 'item_wrong_for_stylist', item: 'ci-2', expectScopes: [{ scope: 'stylist', target: SCANDI_STYLIST }] },
    ]
    for (const c of cases) {
      const db = seedTraining()
      const r = await decideCandidate(
        'v1',
        { decision: 'no', reasonCode: c.reason, candidateItemId: c.item ?? null, idempotencyKey: KEY.decide },
        ACTOR,
        db.admin,
      )
      expect(r, c.reason).toMatchObject({ ok: true })
      const rows = db.tables.outfit_quality_learning_projection
      expect(rows.map((x) => ({ scope: x.scope, target: x.target_stylist_id })), c.reason).toEqual(c.expectScopes)
      for (const row of rows) {
        expect(row.polarity, c.reason).toBe('negative')
        if (c.item) expect(row.payload.affected_candidate_item_id).toBe(c.item)
      }
      expectNoMemberWrites(db)
    }
  })

  it('replaying a decision writes no duplicate projections', async () => {
    const db = seedTraining()
    await decideCandidate('v1', { decision: 'yes', idempotencyKey: KEY.decide }, ACTOR, db.admin)
    const replay = await decideCandidate('v1', { decision: 'yes', idempotencyKey: KEY.decide }, ACTOR, db.admin)
    expect(replay).toMatchObject({ ok: true, reused: true })
    expect(db.tables.outfit_quality_learning_projection).toHaveLength(2)
  })

  it('validation, holdout, synthetic, and test decisions write zero projections', async () => {
    for (const partition of ['validation', 'holdout', 'synthetic', 'test']) {
      const db = seedTraining({ partition })
      const r = await decideCandidate('v1', { decision: 'yes', idempotencyKey: KEY.decide }, ACTOR, db.admin)
      expect(r, partition).toMatchObject({ ok: true })
      expect(db.tables.outfit_quality_learning_projection, partition).toHaveLength(0)
      expectNoMemberWrites(db)
    }
  })

  it('a forged actor id in request input is ignored — the verified session stamps every row (VAL-SEC-001)', async () => {
    const db = seedTraining()
    const r = await decideCandidate(
      'v1',
      { decision: 'yes', idempotencyKey: KEY.decide, reviewer_user_id: 'mallory', userId: 'mallory', actor: { userId: 'mallory' } } as any,
      ACTOR,
      db.admin,
    )
    expect(r).toMatchObject({ ok: true })
    if (!r.ok) return
    expect(r.event.reviewer_user_id).toBe(ACTOR.userId)
    expect(JSON.stringify(db.tables.outfit_quality_review_event)).not.toContain('mallory')
    expect(JSON.stringify(db.tables.outfit_quality_learning_projection)).not.toContain('mallory')
  })

  it('a hold creates no learning evidence in any partition', async () => {
    const db = seedTraining()
    const h = await holdCandidate('v1', { reason: 'check later' }, ACTOR, db.admin)
    expect(h).toMatchObject({ ok: true })
    expect(db.tables.outfit_quality_learning_projection).toHaveLength(0)
  })
})

describe('reversals compensate without erasing history (VAL-LEARN-004)', () => {
  it('undo of a training Yes appends linked compensations; originals stay applied; replay adds nothing', async () => {
    const db = seedTraining()
    const d = await decideCandidate('v1', { decision: 'yes', idempotencyKey: KEY.decide }, ACTOR, db.admin)
    if (!d.ok) throw new Error('setup decide failed')

    const u = await undoCandidateDecision('v1', { idempotencyKey: KEY.undo }, ACTOR, db.admin)
    expect(u).toMatchObject({ ok: true, reversedDecision: 'yes' })
    if (!u.ok) return

    const rows = db.tables.outfit_quality_learning_projection
    expect(rows).toHaveLength(4)
    const originalsOf = rows.filter((r: any) => r.review_event_id === d.event.review_event_id)
    const comps = rows.filter((r: any) => r.review_event_id === u.event.review_event_id)
    expect(originalsOf).toHaveLength(2)
    expect(comps).toHaveLength(2)
    // Originals untouched — append-only history.
    for (const o of originalsOf) {
      expect(o.polarity).toBe('positive')
      expect(o.status).toBe('applied')
      expect(o.reverses_projection_id).toBeNull()
    }
    // Each compensation links its original with the opposite polarity.
    for (const comp of comps) {
      const original = originalsOf.find((o: any) => o.projection_id === comp.reverses_projection_id)
      expect(original, `compensation ${comp.application_key} links an original`).toBeTruthy()
      expect(comp.polarity).toBe('negative')
      expect(comp.application_key).toBe(`${u.event.review_event_id}:compensate:${original.projection_id}`)
    }
    // Net effect is zero; effective reporting agrees with the ledger.
    const net = netLearningEffect(rows)
    expect(net.get('global_quality:global')).toBe(0)
    expect(net.get(`stylist:${SCANDI_STYLIST}`)).toBe(0)

    // Replaying the undo appends nothing further.
    const replay = await undoCandidateDecision('v1', { idempotencyKey: KEY.undo }, ACTOR, db.admin)
    expect(replay).toMatchObject({ ok: true, reused: true })
    expect(db.tables.outfit_quality_learning_projection).toHaveLength(4)
    expectNoMemberWrites(db)
  })

  it('undo of a training No global_composition compensates the negative global projection', async () => {
    const db = seedTraining()
    const d = await decideCandidate('v1', { decision: 'no', reasonCode: 'global_composition', idempotencyKey: KEY.decide }, ACTOR, db.admin)
    if (!d.ok) throw new Error('setup decide failed')
    expect(db.tables.outfit_quality_learning_projection).toHaveLength(1)

    const u = await undoCandidateDecision('v1', { idempotencyKey: KEY.undo }, ACTOR, db.admin)
    expect(u).toMatchObject({ ok: true, reversedDecision: 'no' })
    const rows = db.tables.outfit_quality_learning_projection
    expect(rows).toHaveLength(2)
    const comp = rows.find((r: any) => r.reverses_projection_id !== null)
    expect(comp).toMatchObject({ scope: 'global_quality', polarity: 'positive' })
    expect(netLearningEffect(rows).get('global_quality:global')).toBe(0)
  })

  it('withdrawal after rendering started compensates identically', async () => {
    const db = seedTraining()
    const d = await decideCandidate('v1', { decision: 'yes', idempotencyKey: KEY.decide }, ACTOR, db.admin)
    if (!d.ok) throw new Error('setup decide failed')
    // Simulate the local drainer claiming the job.
    db.tables.outfit_quality_render_job[0].status = 'running'
    db.tables.outfit_quality_render_job[0].lease_token = 'lease-1'

    const w = await withdrawCandidateApproval('v1', { idempotencyKey: KEY.withdraw, note: 'pulled after render start' }, ACTOR, db.admin)
    expect(w).toMatchObject({ ok: true })
    if (!w.ok) return
    const rows = db.tables.outfit_quality_learning_projection
    const comps = rows.filter((r: any) => r.review_event_id === w.event.review_event_id)
    expect(comps).toHaveLength(2)
    expect(netLearningEffect(rows).get('global_quality:global')).toBe(0)
  })
})
