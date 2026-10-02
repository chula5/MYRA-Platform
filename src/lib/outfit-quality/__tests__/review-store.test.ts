// Review store behaviour against an in-memory Supabase fake: exact-version
// decide, idempotent replay, hold/release, append-only undo/withdraw, queued
// render cancellation, withdrawal gating, and post-persistence machine reveal.
// The connected suite proves the same against the real database; here we prove
// the logic and the error-checked write ordering.

import { describe, it, expect, beforeEach } from 'vitest'
import {
  decideCandidate,
  undoCandidateDecision,
  withdrawCandidateApproval,
  holdCandidate,
  releaseCandidate,
  loadMachineResult,
  type ReviewActor,
} from '@/lib/outfit-quality/review-store'
import { netLearningEffect } from '@/lib/outfit-quality/learning-projection'
import { createFakeAdmin } from './fake-admin'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const ACTOR: ReviewActor = { userId: 'admin-verified-1' }
const KEY1 = '0a69d798-82f7-4afc-b847-97695735bb16'
const KEY2 = '1b70e899-93f8-4b0d-b858-08706846cc27'
const KEY3 = '2c81f9aa-a409-4c1e-c969-19817957dd38'
const KEY4 = '3d920abb-b51a-4d2f-da7a-2a828a68ee49'
const KEY5 = '4ea31bcc-c62b-4e30-eb8b-3b939b79ff5a'

function seedQueue(overrides: { versionState?: string; events?: any[]; holds?: any[]; jobs?: any[] } = {}) {
  return createFakeAdmin({
    outfit_quality_candidate_version: [
      { candidate_version_id: 'v1', case_id: 'c1', version_no: 1, state: overrides.versionState ?? 'awaiting_human', created_at: '2026-01-01T00:00:00.000Z' },
    ],
    outfit_quality_case: [{ case_id: 'c1', current_version_id: 'v1', status: 'awaiting_human', selected_stylist_id: '0d535772-8a4f-440f-9e46-f8d637bed0d3' }],
    outfit_quality_candidate_item: [
      { candidate_item_id: 'ci-1', candidate_version_id: 'v1', item_id: 'i1', slot: 'top', sort_order: 0, source_image_url: 'https://res.cloudinary.com/x/top.jpg', item_snapshot: { item_type: 'shirt', brand: 'A Brand' } },
      { candidate_item_id: 'ci-2', candidate_version_id: 'v1', item_id: 'i2', slot: 'bottom', sort_order: 1, source_image_url: 'https://res.cloudinary.com/x/bottom.jpg', item_snapshot: { item_type: 'trouser', brand: 'B Brand' } },
    ],
    outfit_quality_promotion: [],
    outfit: [],
    outfit_item: [],
    outfit_quality_review_event: overrides.events ?? [],
    outfit_quality_queue_hold: overrides.holds ?? [],
    outfit_quality_render_job: overrides.jobs ?? [],
    outfit_quality_machine_check: [
      {
        check_id: 'chk-1',
        candidate_version_id: 'v1',
        kind: 'subjective',
        check_name: 'selected_stylist_fit',
        status: 'passed',
        verdict: 'approve',
        score: 0.91,
        issues: null,
        model: 'm1',
        prompt_version: 'p1',
        raw_response_hash: 'h1',
        attempt: 1,
        idempotency_key: 'v1:subjective:1',
      },
    ],
  })
}

// ── Decide ────────────────────────────────────────────────────────────────────

describe('decideCandidate', () => {
  it('approves the exact version: stamps the verified actor, flips state, enqueues one render cycle, then reveals the machine result', async () => {
    const db = seedQueue()
    const r = await decideCandidate('v1', { decision: 'yes', idempotencyKey: KEY1 }, ACTOR, db.admin)
    expect(r).toMatchObject({ ok: true, reused: false, nextState: 'approved' })
    if (!r.ok) return
    expect(r.event.reviewer_user_id).toBe('admin-verified-1')
    expect(r.event.decision).toBe('yes')
    expect(db.tables.outfit_quality_candidate_version[0].state).toBe('approved')
    expect(db.tables.outfit_quality_render_job).toHaveLength(1)
    expect(db.tables.outfit_quality_render_job[0]).toMatchObject({ candidate_version_id: 'v1', approval_event_id: r.event.review_event_id, status: 'queued', cycle_no: 1 })
    // The machine result is present only in the successful post-persistence response.
    expect(r.machine).toMatchObject({ revealed: true })
    if (r.machine?.revealed) expect(r.machine.checks[0]).toMatchObject({ verdict: 'approve', score: 0.91 })
  })

  it('records a structured item-specific No with the affected item and no render job', async () => {
    const db = seedQueue()
    const r = await decideCandidate('v1', { decision: 'no', reasonCode: 'item_wrong_for_member', candidateItemId: 'ci-2', note: 'rise is wrong for this brief', idempotencyKey: KEY1 }, ACTOR, db.admin)
    expect(r).toMatchObject({ ok: true, nextState: 'rejected' })
    if (!r.ok) return
    expect(r.event).toMatchObject({ decision: 'no', reason_code: 'item_wrong_for_member', candidate_item_id: 'ci-2', note: 'rise is wrong for this brief' })
    expect(db.tables.outfit_quality_render_job).toHaveLength(0)
  })

  it('rejects missing reason, foreign item, stale version, held, double decision, and bad key without changing state', async () => {
    const db = seedQueue()
    const before = JSON.stringify(db.tables)

    expect(await decideCandidate('v1', { decision: 'no', note: 'no reason given', idempotencyKey: KEY1 }, ACTOR, db.admin)).toMatchObject({ ok: false, code: 'missing_reason' })
    expect(await decideCandidate('v1', { decision: 'no', reasonCode: 'item_wrong_for_stylist', candidateItemId: 'ci-foreign', idempotencyKey: KEY1 }, ACTOR, db.admin)).toMatchObject({ ok: false, code: 'foreign_item' })
    expect(await decideCandidate('v1', { decision: 'yes', idempotencyKey: 'not-a-key' }, ACTOR, db.admin)).toMatchObject({ ok: false, code: 'invalid_idempotency_key' })

    const stale = seedQueue()
    stale.tables.outfit_quality_case[0].current_version_id = 'v2-child'
    expect(await decideCandidate('v1', { decision: 'yes', idempotencyKey: KEY1 }, ACTOR, stale.admin)).toMatchObject({ ok: false, code: 'stale_version' })

    const heldDb = seedQueue({ holds: [{ hold_id: 'h1', candidate_version_id: 'v1', held_by: 'a', reason: 'x', released_by: null, created_at: 't', released_at: null }] })
    expect(await decideCandidate('v1', { decision: 'yes', idempotencyKey: KEY1 }, ACTOR, heldDb.admin)).toMatchObject({ ok: false, code: 'held' })

    expect(JSON.stringify(db.tables)).toBe(before)

    // A persisted decision blocks a second active one.
    const first = await decideCandidate('v1', { decision: 'yes', idempotencyKey: KEY2 }, ACTOR, db.admin)
    expect(first.ok).toBe(true)
    expect(await decideCandidate('v1', { decision: 'no', reasonCode: 'global_composition', idempotencyKey: KEY3 }, ACTOR, db.admin)).toMatchObject({ ok: false, code: 'already_decided' })
    expect(db.tables.outfit_quality_review_event).toHaveLength(1)
  })

  it('replays the same idempotency key as the original result with no duplicate event or job', async () => {
    const db = seedQueue()
    const first = await decideCandidate('v1', { decision: 'yes', idempotencyKey: KEY1 }, ACTOR, db.admin)
    const replay = await decideCandidate('v1', { decision: 'yes', idempotencyKey: KEY1 }, ACTOR, db.admin)
    expect(first.ok && replay.ok).toBe(true)
    if (first.ok && replay.ok) {
      expect(replay.reused).toBe(true)
      expect(replay.event.review_event_id).toBe(first.event.review_event_id)
    }
    expect(db.tables.outfit_quality_review_event).toHaveLength(1)
    expect(db.tables.outfit_quality_render_job).toHaveLength(1)
  })
})

// ── Promotion rides the approval ──────────────────────────────────────────────

describe('approval promotion integration', () => {
  it('a Yes promotes once: one internal/non-live outfit, one ordered membership per item, one promotion, job linked', async () => {
    const db = seedQueue()
    const r = await decideCandidate('v1', { decision: 'yes', idempotencyKey: KEY1 }, ACTOR, db.admin)
    expect(r.ok).toBe(true)

    expect(db.tables.outfit).toHaveLength(1)
    const outfit = db.tables.outfit[0]
    expect(outfit.status).toBe('draft')
    expect(outfit.published_at).toBeNull()
    expect(outfit.stylist_id).toBe('0d535772-8a4f-440f-9e46-f8d637bed0d3')

    expect(db.tables.outfit_item).toHaveLength(2)
    expect(db.tables.outfit_item.map((m: any) => [m.item_id, m.slot, m.sort_order])).toEqual([
      ['i1', 'top', 0],
      ['i2', 'bottom', 1],
    ])

    expect(db.tables.outfit_quality_promotion).toHaveLength(1)
    const promo = db.tables.outfit_quality_promotion[0]
    expect(promo).toMatchObject({ candidate_version_id: 'v1', outfit_id: outfit.outfit_id, status: 'active' })
    expect(db.tables.outfit_quality_render_job[0].promotion_id).toBe(promo.promotion_id)
  })

  it('a replayed Yes does not duplicate the outfit, memberships, promotion, or job', async () => {
    const db = seedQueue()
    await decideCandidate('v1', { decision: 'yes', idempotencyKey: KEY1 }, ACTOR, db.admin)
    await decideCandidate('v1', { decision: 'yes', idempotencyKey: KEY1 }, ACTOR, db.admin)
    expect(db.tables.outfit).toHaveLength(1)
    expect(db.tables.outfit_item).toHaveLength(2)
    expect(db.tables.outfit_quality_promotion).toHaveLength(1)
    expect(db.tables.outfit_quality_render_job).toHaveLength(1)
  })

  it('undo withdraws the promotion; re-approval reactivates the same outfit rather than duplicating', async () => {
    const db = seedQueue()
    await decideCandidate('v1', { decision: 'yes', idempotencyKey: KEY1 }, ACTOR, db.admin)
    const promoId = db.tables.outfit_quality_promotion[0].promotion_id

    await undoCandidateDecision('v1', { idempotencyKey: KEY2 }, ACTOR, db.admin)
    expect(db.tables.outfit_quality_promotion[0].status).toBe('withdrawn')

    const again = await decideCandidate('v1', { decision: 'yes', idempotencyKey: KEY3 }, ACTOR, db.admin)
    expect(again.ok).toBe(true)
    expect(db.tables.outfit_quality_promotion).toHaveLength(1)
    expect(db.tables.outfit_quality_promotion[0]).toMatchObject({ promotion_id: promoId, status: 'active', withdrawn_at: null })
    expect(db.tables.outfit).toHaveLength(1)
    // A NEW cycle-1 job rides the NEW approval event, linked to the same promotion.
    const jobs = db.tables.outfit_quality_render_job
    expect(jobs).toHaveLength(2)
    expect(jobs[0].status).toBe('cancelled')
    expect(jobs[1]).toMatchObject({ status: 'queued', promotion_id: promoId })
    expect(jobs[1].approval_event_id).not.toBe(jobs[0].approval_event_id)
  })

  it('withdrawal marks the promotion withdrawn without erasing the graph', async () => {
    const db = seedQueue()
    await decideCandidate('v1', { decision: 'yes', idempotencyKey: KEY1 }, ACTOR, db.admin)
    await withdrawCandidateApproval('v1', { idempotencyKey: KEY2 }, ACTOR, db.admin)
    expect(db.tables.outfit_quality_promotion[0].status).toBe('withdrawn')
    expect(db.tables.outfit_quality_promotion[0].withdrawn_at).toBeTruthy()
    expect(db.tables.outfit).toHaveLength(1)
    expect(db.tables.outfit_item).toHaveLength(2)
  })

  it('a No never promotes', async () => {
    const db = seedQueue()
    await decideCandidate('v1', { decision: 'no', reasonCode: 'global_composition', idempotencyKey: KEY1 }, ACTOR, db.admin)
    expect(db.tables.outfit).toHaveLength(0)
    expect(db.tables.outfit_quality_promotion).toHaveLength(0)
    expect(db.tables.outfit_quality_render_job).toHaveLength(0)
  })
})

// ── Hold / release ────────────────────────────────────────────────────────────

describe('holdCandidate / releaseCandidate', () => {
  it('hold records holder, reason and time, creates no review event, and a repeat hold reuses it', async () => {
    const db = seedQueue()
    const h1 = await holdCandidate('v1', { reason: 'check stock tomorrow' }, ACTOR, db.admin)
    expect(h1).toMatchObject({ ok: true, reused: false })
    const h2 = await holdCandidate('v1', { reason: 'different reason' }, ACTOR, db.admin)
    expect(h2).toMatchObject({ ok: true, reused: true })
    expect(db.tables.outfit_quality_queue_hold).toHaveLength(1)
    expect(db.tables.outfit_quality_queue_hold[0]).toMatchObject({ held_by: 'admin-verified-1', reason: 'check stock tomorrow', released_at: null })
    expect(db.tables.outfit_quality_review_event).toHaveLength(0)
  })

  it('release closes the active hold with the verified actor; replays are no-ops; never-held errors', async () => {
    const db = seedQueue()
    expect(await releaseCandidate('v1', ACTOR, db.admin)).toMatchObject({ ok: false, code: 'not_held' })

    await holdCandidate('v1', {}, ACTOR, db.admin)
    const rel = await releaseCandidate('v1', ACTOR, db.admin)
    expect(rel).toMatchObject({ ok: true, reused: false })
    const holdRow = db.tables.outfit_quality_queue_hold[0]
    expect(holdRow.released_by).toBe('admin-verified-1')
    expect(holdRow.released_at).toBeTruthy()

    const replay = await releaseCandidate('v1', ACTOR, db.admin)
    expect(replay).toMatchObject({ ok: true, reused: true })
    expect(db.tables.outfit_quality_queue_hold).toHaveLength(1)
    expect(db.tables.outfit_quality_review_event).toHaveLength(0)
  })

  it('a decided candidate cannot be held', async () => {
    const db = seedQueue()
    await decideCandidate('v1', { decision: 'yes', idempotencyKey: KEY1 }, ACTOR, db.admin)
    expect(await holdCandidate('v1', {}, ACTOR, db.admin)).toMatchObject({ ok: false, code: 'not_holdable' })
  })
})

// ── Undo / withdraw ───────────────────────────────────────────────────────────

describe('undoCandidateDecision', () => {
  it('undoes a No: appends a reversal, keeps the original, returns the version to review', async () => {
    const db = seedQueue()
    const d = await decideCandidate('v1', { decision: 'no', reasonCode: 'global_composition', idempotencyKey: KEY1 }, ACTOR, db.admin)
    if (!d.ok) throw new Error('setup decide failed')
    const u = await undoCandidateDecision('v1', { idempotencyKey: KEY2 }, ACTOR, db.admin)
    expect(u).toMatchObject({ ok: true, nextState: 'awaiting_human', reversedDecision: 'no' })
    const events = db.tables.outfit_quality_review_event
    expect(events).toHaveLength(2)
    expect(events[1]).toMatchObject({ action: 'undo', reverses_event_id: d.event.review_event_id, reviewer_user_id: 'admin-verified-1' })
    expect(events[0]).toMatchObject({ action: 'decide', decision: 'no', reason_code: 'global_composition' }) // preserved
    expect(db.tables.outfit_quality_candidate_version[0].state).toBe('awaiting_human')
  })

  it('undoes a queued approval and cancels the render job in the same mutation', async () => {
    const db = seedQueue()
    await decideCandidate('v1', { decision: 'yes', idempotencyKey: KEY1 }, ACTOR, db.admin)
    const u = await undoCandidateDecision('v1', { idempotencyKey: KEY2 }, ACTOR, db.admin)
    expect(u).toMatchObject({ ok: true, reversedDecision: 'yes' })
    expect(db.tables.outfit_quality_render_job[0].status).toBe('cancelled')
    expect(db.tables.outfit_quality_candidate_version[0].state).toBe('awaiting_human')
    // The approval can be re-decided after undo.
    const again = await decideCandidate('v1', { decision: 'yes', idempotencyKey: KEY3 }, ACTOR, db.admin)
    expect(again.ok).toBe(true)
  })

  it('refuses ordinary undo once rendering has started, requiring withdrawal', async () => {
    const db = seedQueue()
    await decideCandidate('v1', { decision: 'yes', idempotencyKey: KEY1 }, ACTOR, db.admin)
    db.tables.outfit_quality_render_job[0].status = 'running'
    db.tables.outfit_quality_render_job[0].lease_token = 'lease-1'
    const u = await undoCandidateDecision('v1', { idempotencyKey: KEY2 }, ACTOR, db.admin)
    expect(u).toMatchObject({ ok: false, code: 'withdrawal_required' })
    expect(db.tables.outfit_quality_review_event).toHaveLength(1) // nothing appended
  })

  it('refuses when there is no active decision and replays idempotently', async () => {
    const db = seedQueue()
    expect(await undoCandidateDecision('v1', { idempotencyKey: KEY1 }, ACTOR, db.admin)).toMatchObject({ ok: false, code: 'nothing_to_undo' })
    await decideCandidate('v1', { decision: 'no', reasonCode: 'wrong_for_stylist', idempotencyKey: KEY1 }, ACTOR, db.admin)
    const u1 = await undoCandidateDecision('v1', { idempotencyKey: KEY2 }, ACTOR, db.admin)
    const u2 = await undoCandidateDecision('v1', { idempotencyKey: KEY2 }, ACTOR, db.admin)
    expect(u1.ok && u2.ok).toBe(true)
    if (u1.ok && u2.ok) expect(u2.event.review_event_id).toBe(u1.event.review_event_id)
    expect(db.tables.outfit_quality_review_event).toHaveLength(2)
  })
})

describe('withdrawCandidateApproval', () => {
  it('withdraws a started approval: appends the event, hides the version, keeps all provenance', async () => {
    const db = seedQueue()
    await decideCandidate('v1', { decision: 'yes', idempotencyKey: KEY1 }, ACTOR, db.admin)
    db.tables.outfit_quality_render_job[0].status = 'running'
    db.tables.outfit_quality_render_job[0].lease_token = 'lease-1'
    const w = await withdrawCandidateApproval('v1', { idempotencyKey: KEY2, note: 'render drifted from source' }, ACTOR, db.admin)
    expect(w).toMatchObject({ ok: true, nextState: 'approval_withdrawn' })
    const events = db.tables.outfit_quality_review_event
    expect(events).toHaveLength(2)
    expect(events[1]).toMatchObject({ action: 'withdraw', note: 'render drifted from source' })
    expect(events[0].decision).toBe('yes') // original preserved
    expect(db.tables.outfit_quality_candidate_version[0].state).toBe('approval_withdrawn')
  })

  it('cancels still-queued jobs on withdrawal and refuses without an active approval', async () => {
    const db = seedQueue()
    expect(await withdrawCandidateApproval('v1', { idempotencyKey: KEY1 }, ACTOR, db.admin)).toMatchObject({ ok: false, code: 'not_approved' })
    await decideCandidate('v1', { decision: 'yes', idempotencyKey: KEY2 }, ACTOR, db.admin)
    const w = await withdrawCandidateApproval('v1', { idempotencyKey: KEY3 }, ACTOR, db.admin)
    expect(w.ok).toBe(true)
    expect(db.tables.outfit_quality_render_job[0].status).toBe('cancelled')
    const replay = await withdrawCandidateApproval('v1', { idempotencyKey: KEY3 }, ACTOR, db.admin)
    expect(replay).toMatchObject({ ok: true, reused: true })
    expect(db.tables.outfit_quality_review_event).toHaveLength(2)
  })

  it('a No decision cannot be withdrawn (undo is the reversal)', async () => {
    const db = seedQueue()
    await decideCandidate('v1', { decision: 'no', reasonCode: 'operational_data', idempotencyKey: KEY1 }, ACTOR, db.admin)
    expect(await withdrawCandidateApproval('v1', { idempotencyKey: KEY2 }, ACTOR, db.admin)).toMatchObject({ ok: false, code: 'not_approved' })
  })
})

// ── Learning replay backfill ──────────────────────────────────────────────────
//
// The event row is authoritative; its learning projections are derived writes
// that can fail transiently AFTER the event persisted (the caller saw a
// warning). Replaying the same idempotency key must re-attempt the missing
// projections — exactly once, keyed by the unique application_key.

describe('learning replay backfill', () => {
  function seedTrainingQueue() {
    const db = seedQueue()
    db.tables.outfit_quality_case[0].data_partition = 'training'
    db.tables.outfit_quality_case[0].real_member_id = null
    db.tables.outfit_quality_case[0].evaluation_profile_id = 'profile-1'
    return db
  }

  it('replaying a decision whose projection insert failed transiently applies the missing projections exactly once', async () => {
    const db = seedTrainingQueue()
    // Transient failure (not a unique violation): the event persists, no
    // projection lands, and the caller is warned.
    db.failNextInsert('outfit_quality_learning_projection', 'connection reset by peer', undefined, '08006')
    const first = await decideCandidate('v1', { decision: 'yes', idempotencyKey: KEY1 }, ACTOR, db.admin)
    expect(first.ok).toBe(true)
    if (!first.ok) return
    expect(first.warnings?.join(' ')).toContain('learning projection failed')
    expect(db.tables.outfit_quality_learning_projection).toHaveLength(0)

    // Replay backfills both missing projections instead of only returning the
    // stored event.
    const replay = await decideCandidate('v1', { decision: 'yes', idempotencyKey: KEY1 }, ACTOR, db.admin)
    expect(replay).toMatchObject({ ok: true, reused: true })
    if (replay.ok) expect(replay.event.review_event_id).toBe(first.event.review_event_id)
    const ledger = db.tables.outfit_quality_learning_projection
    expect(ledger).toHaveLength(2)
    expect(ledger.map((p: any) => [p.scope, p.polarity])).toEqual(
      expect.arrayContaining([
        ['global_quality', 'positive'],
        ['stylist', 'positive'],
      ]),
    )
    expect(ledger.find((p: any) => p.scope === 'stylist').target_stylist_id).toBe('0d535772-8a4f-440f-9e46-f8d637bed0d3')

    // A further replay cannot double-apply.
    const again = await decideCandidate('v1', { decision: 'yes', idempotencyKey: KEY1 }, ACTOR, db.admin)
    expect(again).toMatchObject({ ok: true, reused: true })
    expect(db.tables.outfit_quality_learning_projection).toHaveLength(2)
  })

  it('backfills only the missing application_key when one projection landed and the other did not', async () => {
    const db = seedTrainingQueue()
    db.failNextInsert('outfit_quality_learning_projection', 'connection reset by peer', undefined, '08006')
    const first = await decideCandidate('v1', { decision: 'yes', idempotencyKey: KEY1 }, ACTOR, db.admin)
    if (!first.ok) throw new Error('setup decide failed')
    const eventId = first.event.review_event_id

    // Simulate "insert committed, response lost": the global projection is
    // durable under its application_key while the stylist one never landed.
    db.tables.outfit_quality_learning_projection.push({
      projection_id: 'p-global-landed',
      review_event_id: eventId,
      candidate_version_id: 'v1',
      scope: 'global_quality',
      target_stylist_id: null,
      polarity: 'positive',
      payload: { source: 'quality_lab_review', data_partition: 'training', context_type: 'evaluation_profile' },
      status: 'applied',
      application_key: `${eventId}:global_quality:global`,
      reverses_projection_id: null,
    })

    const replay = await decideCandidate('v1', { decision: 'yes', idempotencyKey: KEY1 }, ACTOR, db.admin)
    expect(replay).toMatchObject({ ok: true, reused: true })
    const ledger = db.tables.outfit_quality_learning_projection
    expect(ledger).toHaveLength(2)
    // The already-applied row is keyed off, not duplicated or rewritten.
    const global = ledger.find((p: any) => p.scope === 'global_quality')
    expect(global.projection_id).toBe('p-global-landed')
    expect(ledger.filter((p: any) => p.scope === 'stylist')).toHaveLength(1)

    const again = await decideCandidate('v1', { decision: 'yes', idempotencyKey: KEY1 }, ACTOR, db.admin)
    expect(again).toMatchObject({ ok: true, reused: true })
    expect(db.tables.outfit_quality_learning_projection).toHaveLength(2)
  })

  it('replaying an undo whose compensation failed appends the missing compensations exactly once', async () => {
    const db = seedTrainingQueue()
    const d = await decideCandidate('v1', { decision: 'yes', idempotencyKey: KEY1 }, ACTOR, db.admin)
    if (!d.ok) throw new Error('setup decide failed')
    expect(db.tables.outfit_quality_learning_projection).toHaveLength(2)

    db.failNextInsert('outfit_quality_learning_projection', 'connection reset by peer', undefined, '08006')
    const u = await undoCandidateDecision('v1', { idempotencyKey: KEY2 }, ACTOR, db.admin)
    expect(u.ok).toBe(true)
    if (!u.ok) return
    expect(u.warnings?.join(' ')).toContain('learning compensation failed')
    // The reversal event persisted; its compensations did not. Net learning is
    // still +1/+1 until a replay backfills.
    expect(db.tables.outfit_quality_learning_projection).toHaveLength(2)

    const replay = await undoCandidateDecision('v1', { idempotencyKey: KEY2 }, ACTOR, db.admin)
    expect(replay).toMatchObject({ ok: true, reused: true })
    const ledger = db.tables.outfit_quality_learning_projection
    expect(ledger).toHaveLength(4)
    const compensations = ledger.filter((p: any) => p.reverses_projection_id !== null)
    expect(compensations).toHaveLength(2)
    // Append-only reversal semantics: originals keep their polarity, the
    // appended compensations net every scope/target to zero.
    netLearningEffect(ledger).forEach((net) => expect(net).toBe(0))

    const again = await undoCandidateDecision('v1', { idempotencyKey: KEY2 }, ACTOR, db.admin)
    expect(again).toMatchObject({ ok: true, reused: true })
    expect(db.tables.outfit_quality_learning_projection).toHaveLength(4)
  })

  it('replaying a withdraw whose compensation failed backfills it the same way', async () => {
    const db = seedTrainingQueue()
    await decideCandidate('v1', { decision: 'yes', idempotencyKey: KEY1 }, ACTOR, db.admin)
    db.tables.outfit_quality_render_job[0].status = 'running'
    db.tables.outfit_quality_render_job[0].lease_token = 'lease-1'

    db.failNextInsert('outfit_quality_learning_projection', 'connection reset by peer', undefined, '08006')
    const w = await withdrawCandidateApproval('v1', { idempotencyKey: KEY2 }, ACTOR, db.admin)
    expect(w.ok).toBe(true)
    expect(db.tables.outfit_quality_learning_projection).toHaveLength(2)

    const replay = await withdrawCandidateApproval('v1', { idempotencyKey: KEY2 }, ACTOR, db.admin)
    expect(replay).toMatchObject({ ok: true, reused: true })
    expect(db.tables.outfit_quality_learning_projection).toHaveLength(4)
    netLearningEffect(db.tables.outfit_quality_learning_projection).forEach((net) => expect(net).toBe(0))
  })
})

// ── Hold uniqueness at the database boundary ─────────────────────────────────

describe('one active hold per candidate version', () => {
  it('the fake mirrors the partial unique index: a second ACTIVE hold is rejected, a released hold frees the slot', async () => {
    const db = seedQueue()
    await db.admin.from('outfit_quality_queue_hold').insert({ candidate_version_id: 'v1', held_by: 'a' }).maybeSingle()
    const dup = await db.admin.from('outfit_quality_queue_hold').insert({ candidate_version_id: 'v1', held_by: 'b' }).maybeSingle()
    expect(dup.error?.message).toContain('oq_queue_hold_active_uq')
    await releaseCandidate('v1', ACTOR, db.admin)
    const after = await db.admin.from('outfit_quality_queue_hold').insert({ candidate_version_id: 'v1', held_by: 'b' }).maybeSingle()
    expect(after.error).toBeNull()
    expect(db.tables.outfit_quality_queue_hold).toHaveLength(2)
  })

  it('a lost hold race reuses the winning active hold instead of erroring', async () => {
    const db = seedQueue()
    db.failNextInsert('outfit_quality_queue_hold', 'duplicate key value violates unique constraint "oq_queue_hold_active_uq"', (tables) => {
      tables.outfit_quality_queue_hold.push({
        hold_id: 'h-winner',
        candidate_version_id: 'v1',
        held_by: 'admin-other',
        reason: 'winner reason',
        released_by: null,
        created_at: '2026-01-01T00:00:00.000Z',
        released_at: null,
      })
    })
    const h = await holdCandidate('v1', { reason: 'loser reason' }, ACTOR, db.admin)
    expect(h).toMatchObject({ ok: true, reused: true })
    if (h.ok) expect(h.hold.hold_id).toBe('h-winner')
    expect(db.tables.outfit_quality_queue_hold).toHaveLength(1)
  })
})

// ── Machine-result disclosure gate ────────────────────────────────────────────

describe('loadMachineResult', () => {
  it('stays hidden before a decision persists and reveals only after', async () => {
    const db = seedQueue()
    const before = await loadMachineResult('v1', db.admin)
    expect(before).toEqual({ revealed: false })
    await decideCandidate('v1', { decision: 'yes', idempotencyKey: KEY1 }, ACTOR, db.admin)
    const after = await loadMachineResult('v1', db.admin)
    expect(after.revealed).toBe(true)
    if (after.revealed) expect(after.checks[0]).toMatchObject({ verdict: 'approve', raw_response_hash: 'h1' })
  })

  it('hides again when the only decision was reversed and no new one exists', async () => {
    const db = seedQueue()
    await decideCandidate('v1', { decision: 'no', reasonCode: 'global_composition', idempotencyKey: KEY1 }, ACTOR, db.admin)
    await undoCandidateDecision('v1', { idempotencyKey: KEY2 }, ACTOR, db.admin)
    expect(await loadMachineResult('v1', db.admin)).toEqual({ revealed: false })
  })
})
