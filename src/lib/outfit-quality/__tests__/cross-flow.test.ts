// VAL-CROSS-001 — one deterministic evaluation-profile TRAINING flow carrying
// identical immutable attribution from batch → snapshot → case → version →
// items → machine check → human review → learning projections → internal
// promotion → render eligibility → coverage, with zero member-taste or
// real-user-trust outputs, and provenance unchanged by later mutable source
// edits. No connected `training` row is ever created: all semantics are
// modeled against the in-memory adapter.

import { describe, it, expect } from 'vitest'
import { createHash, randomUUID } from 'node:crypto'
import { createFakeAdmin } from './fake-admin'
import { createCandidatePersistence } from '@/lib/outfit-quality/candidate-store'
import { SNAPSHOT_SYSTEM_VERSIONS } from '@/lib/outfit-quality/stylist-snapshot'
import { decideCandidate, undoCandidateDecision, type ReviewActor } from '@/lib/outfit-quality/review-store'
import { netLearningEffect } from '@/lib/outfit-quality/learning-projection'
import { buildCoverageReport } from '@/lib/outfit-quality/coverage'

const SCANDI_STYLIST = '11111111-2222-4333-8444-555555555555'
const PROFILE_P = '22222222-3333-4444-8555-666666666666'
const RUN_ID = randomUUID()
const SNAPSHOT_ID = 'snap-flow-1'
const ACTOR: ReviewActor = { userId: 'admin-cross-flow' }

const MEMBER_FEEDBACK_TABLES = ['pilot_look_feedback', 'taste_event', 'member_taste', 'member_affinity']

describe('evaluation-profile training flow keeps exact immutable attribution (VAL-CROSS-001)', () => {
  it('carries one run/partition/context/stylist/snapshot/version thread through review, learning, promotion, render eligibility, and coverage', async () => {
    const compositionHash = createHash('sha256').update('cross-flow-composition').digest('hex')
    const db = createFakeAdmin({
      outfit_quality_batch: [
        {
          batch_id: 'b1',
          run_id: RUN_ID,
          data_partition: 'training',
          real_member_id: null,
          evaluation_profile_id: PROFILE_P,
          selected_stylist_id: SCANDI_STYLIST,
          stylist_snapshot_id: SNAPSHOT_ID,
          target_count: 10,
          chunk_limit: 25,
          status: 'active',
        },
      ],
      outfit_quality_stylist_snapshot: [
        { snapshot_id: SNAPSHOT_ID, stylist_id: SCANDI_STYLIST, payload_hash: 'hash-1', rules_only: false, payload: { slug: 'scandi' } },
      ],
      stylist: [{ stylist_id: SCANDI_STYLIST, name: 'Scandi Stylist', status: 'active' }],
      outfit_quality_evaluation_profile: [
        { profile_id: PROFILE_P, name: 'Profile P', active: true, style_families: ['minimal'], brand_groups: ['luxury'], occasions: ['everyday'] },
      ],
      pilot_member: [{ member_id: 'df918c45-3063-484e-b83b-dc41d25ac804', name: 'Alison', is_synthetic: false }],
      outfit_quality_promotion: [],
      outfit: [],
      outfit_item: [],
      outfit_quality_review_event: [],
      outfit_quality_queue_hold: [],
      outfit_quality_render_job: [],
      outfit_quality_machine_check: [],
      outfit_quality_learning_projection: [],
    })

    // ── Persist the candidate before any check (immutable version + items).
    const batch = db.tables.outfit_quality_batch[0]
    const store = createCandidatePersistence({ admin: db.admin, batch, systemVersions: SNAPSHOT_SYSTEM_VERSIONS })
    const persisted = await store.persistCandidate({
      position: 0,
      generationRequestKey: `cross-flow:${RUN_ID}:0`,
      compositionHash,
      rulesOnly: false,
      snapshotId: SNAPSHOT_ID,
      context: {
        dataPartition: 'training',
        realMemberId: null,
        evaluationProfileId: PROFILE_P,
        selectedStylistId: SCANDI_STYLIST,
        contextSnapshot: { type: 'evaluation_profile', profile_id: PROFILE_P },
      },
      systemVersions: SNAPSHOT_SYSTEM_VERSIONS,
      candidate: {
        requiredSlots: ['top', 'bottom'],
        items: [
          { item_id: 'item-top', slot: 'top', sort_order: 0, item_snapshot: { brand: 'A' }, source_image_url: 'https://res.cloudinary.com/x/top.jpg' },
          { item_id: 'item-bottom', slot: 'bottom', sort_order: 1, item_snapshot: { brand: 'B' }, source_image_url: 'https://res.cloudinary.com/x/bottom.jpg' },
        ],
      },
    })

    // Case repeats the batch attribution exactly, and the version hash is frozen.
    const caseRow = db.tables.outfit_quality_case.find((c) => c.case_id === persisted.caseId)
    expect(caseRow).toMatchObject({
      batch_id: 'b1',
      data_partition: 'training',
      real_member_id: null,
      evaluation_profile_id: PROFILE_P,
      selected_stylist_id: SCANDI_STYLIST,
      stylist_snapshot_id: SNAPSHOT_ID,
    })
    const versionRow = db.tables.outfit_quality_candidate_version.find((v) => v.candidate_version_id === persisted.candidateVersionId)
    expect(versionRow.composition_hash).toBe(compositionHash)
    const itemRows = db.tables.outfit_quality_candidate_item.filter((i) => i.candidate_version_id === persisted.candidateVersionId)
    expect(itemRows.map((i) => [i.slot, i.item_id, i.sort_order])).toEqual([
      ['top', 'item-top', 0],
      ['bottom', 'item-bottom', 1],
    ])

    // ── Machine check against the frozen snapshot; then human review.
    await store.recordSubjectiveCheck(persisted.candidateVersionId, { status: 'passed', verdict: 'works', score: 0.9, model: 'm1', prompt_version: 'p1' })
    await store.setVersionState(persisted.candidateVersionId, 'awaiting_human')

    const decide = await decideCandidate(persisted.candidateVersionId, { decision: 'yes', idempotencyKey: randomUUID() }, ACTOR, db.admin)
    expect(decide).toMatchObject({ ok: true, nextState: 'approved' })
    if (!decide.ok) throw new Error('decide failed')

    // ── Exactly the approved global + selected-stylist learning evidence.
    const projections = db.tables.outfit_quality_learning_projection
    expect(projections).toHaveLength(2)
    expect(projections).toContainEqual(
      expect.objectContaining({
        review_event_id: decide.event.review_event_id,
        candidate_version_id: persisted.candidateVersionId,
        scope: 'global_quality',
        target_stylist_id: null,
        polarity: 'positive',
      }),
    )
    expect(projections).toContainEqual(
      expect.objectContaining({ scope: 'stylist', target_stylist_id: SCANDI_STYLIST, polarity: 'positive' }),
    )
    for (const p of projections) {
      expect(p.payload).toMatchObject({ source: 'quality_lab_review', data_partition: 'training', context_type: 'evaluation_profile' })
      expect(p.payload).not.toHaveProperty('member_id')
    }
    // Zero member-taste writes anywhere in the flow.
    for (const table of db.queried) expect(MEMBER_FEEDBACK_TABLES).not.toContain(table)
    for (const ins of db.inserts) expect(MEMBER_FEEDBACK_TABLES).not.toContain(ins.table)

    // ── Internal, non-live promotion linked once to every frozen item.
    const promotion = db.tables.outfit_quality_promotion.find((p) => p.candidate_version_id === persisted.candidateVersionId)
    expect(promotion).toMatchObject({ status: 'active' })
    const outfit = db.tables.outfit.find((o) => o.outfit_id === promotion.outfit_id)
    expect(outfit).toMatchObject({ status: 'draft', published_at: null, stylist_id: SCANDI_STYLIST })
    const memberships = db.tables.outfit_item.filter((m) => m.outfit_id === outfit.outfit_id)
    expect(memberships.map((m) => [m.slot, m.item_id, m.sort_order])).toEqual([
      ['top', 'item-top', 0],
      ['bottom', 'item-bottom', 1],
    ])

    // ── Render eligibility: exactly one queued cycle for the exact approval.
    const jobs = db.tables.outfit_quality_render_job
    expect(jobs).toHaveLength(1)
    expect(jobs[0]).toMatchObject({
      candidate_version_id: persisted.candidateVersionId,
      approval_event_id: decide.event.review_event_id,
      cycle_no: 1,
      status: 'queued',
    })

    // ── Coverage: labeled training/development segment, excluded from
    //    real-user trust because the context is an evaluation profile.
    const report = buildCoverageReport({
      batches: db.tables.outfit_quality_batch,
      cases: db.tables.outfit_quality_case,
      versions: db.tables.outfit_quality_candidate_version,
      events: db.tables.outfit_quality_review_event,
      subjectiveChecks: db.tables.outfit_quality_machine_check.filter((c) => c.kind === 'subjective'),
      stylists: db.tables.stylist,
      profiles: db.tables.outfit_quality_evaluation_profile,
      members: db.tables.pilot_member,
    })
    const training = report.blocks.find((b) => b.partition === 'training')!
    expect(training.totals).toMatchObject({ sampleSize: 1, reviewed: 1, accepted: 1 })
    expect(training.dimensions.stylist.find((s) => s.key === SCANDI_STYLIST)).toMatchObject({ reviewed: 1, accepted: 1 })
    expect(training.dimensions.evaluationProfile.find((s) => s.key === PROFILE_P)).toMatchObject({ reviewed: 1, contextTypes: ['evaluation_profile'] })
    expect(training.dimensions.styleFamily.find((s) => s.key === 'minimal')).toMatchObject({ reviewed: 1 })
    // Real-user trust sees none of it.
    expect(report.realUserTrust.sampleSize).toBe(0)
    expect(report.realUserTrust.warning).toContain('NO DATA')

    // ── A later mutable source change cannot alter the frozen trace.
    db.tables.stylist[0].name = 'RENAMED STYLIST'
    db.tables.outfit_quality_evaluation_profile[0].name = 'RENAMED PROFILE'
    const after = buildCoverageReport({
      batches: db.tables.outfit_quality_batch,
      cases: db.tables.outfit_quality_case,
      versions: db.tables.outfit_quality_candidate_version,
      events: db.tables.outfit_quality_review_event,
      subjectiveChecks: [],
      stylists: db.tables.stylist,
      profiles: db.tables.outfit_quality_evaluation_profile,
      members: db.tables.pilot_member,
    })
    const seg = after.blocks.find((b) => b.partition === 'training')!.dimensions.stylist.find((s) => s.key === SCANDI_STYLIST)!
    expect(seg.key).toBe(SCANDI_STYLIST) // identity, not the mutable name
    expect(db.tables.outfit_quality_candidate_version[0].composition_hash).toBe(compositionHash)
    expect(db.tables.outfit_quality_case[0].stylist_snapshot_id).toBe(SNAPSHOT_ID)

    // ── Undo compensates learning; the full event/ledger history remains.
    const undo = await undoCandidateDecision(persisted.candidateVersionId, { idempotencyKey: randomUUID() }, ACTOR, db.admin)
    expect(undo).toMatchObject({ ok: true, reversedDecision: 'yes' })
    const ledger = db.tables.outfit_quality_learning_projection
    expect(ledger).toHaveLength(4)
    expect(netLearningEffect(ledger).get('global_quality:global')).toBe(0)
    expect(netLearningEffect(ledger).get(`stylist:${SCANDI_STYLIST}`)).toBe(0)
    expect(db.tables.outfit_quality_review_event.map((e) => e.action)).toEqual(['decide', 'undo'])
    const reopened = buildCoverageReport({
      batches: db.tables.outfit_quality_batch,
      cases: db.tables.outfit_quality_case,
      versions: db.tables.outfit_quality_candidate_version,
      events: db.tables.outfit_quality_review_event,
      subjectiveChecks: [],
      stylists: db.tables.stylist,
      profiles: db.tables.outfit_quality_evaluation_profile,
      members: db.tables.pilot_member,
    })
    expect(reopened.blocks.find((b) => b.partition === 'training')!.totals.reviewed).toBe(0)
  })
})
