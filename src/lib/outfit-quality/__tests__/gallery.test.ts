// Accepted Images gallery and its operator actions: derivation of ready
// images, the append-only Not good enough override, explicit bounded
// regeneration cycles, and underlying-outfit withdrawal. No routine second
// human approval exists; no override can promote a failed check into the
// gallery.

import { describe, it, expect } from 'vitest'
import {
  loadAcceptedImages,
  loadRenderAttention,
  markNotGoodEnough,
  regenerateRenderCycle,
  withdrawUnderlyingOutfit,
} from '@/lib/outfit-quality/gallery'
import { createFakeAdmin, type FakeAdmin } from './fake-admin'

const STYLIST = '0d535772-8a4f-440f-9e46-f8d637bed0d3'
const ACTOR = { userId: 'admin-verified-1' }
const KEY1 = '0a69d798-82f7-4afc-b847-97695735bb16'
const KEY2 = '1b70e899-93f8-4b0d-b858-08706846cc27'
const KEY3 = '2c81f9aa-a409-4c1e-c969-19817957dd38'
const KEY4 = '3d920abb-b51a-4d2f-da7a-2a828a68ee49'

function approvedEvents(): any[] {
  return [
    { review_event_id: 'e1', candidate_version_id: 'v1', action: 'decide', decision: 'yes', reason_code: null, candidate_item_id: null, note: null, reverses_event_id: null, reviewer_user_id: 'a', idempotency_key: 'k1', created_at: '2026-01-01T00:00:01.000Z' },
  ]
}

interface GallerySeed {
  attempts?: any[]
  jobs?: any[]
  events?: any[]
  overrides?: any[]
  checks?: any[]
}

function seedGallery(opts: GallerySeed = {}): FakeAdmin {
  return createFakeAdmin({
    outfit_quality_candidate_version: [
      { candidate_version_id: 'v1', case_id: 'c1', version_no: 1, state: 'approved', created_at: '2026-01-01T00:00:00.000Z' },
    ],
    outfit_quality_case: [
      { case_id: 'c1', current_version_id: 'v1', selected_stylist_id: STYLIST, stylist_snapshot_id: 'snap-1', data_partition: 'test', real_member_id: null, evaluation_profile_id: 'profile-1', status: 'approved' },
    ],
    outfit_quality_candidate_item: [
      { candidate_item_id: 'ci-1', candidate_version_id: 'v1', item_id: 'i1', slot: 'top', sort_order: 0, source_image_url: 'https://res.cloudinary.com/x/top.jpg', item_snapshot: { item_type: 'shirt', brand: 'A Brand' } },
      { candidate_item_id: 'ci-2', candidate_version_id: 'v1', item_id: 'i2', slot: 'bottom', sort_order: 1, source_image_url: 'https://res.cloudinary.com/x/bottom.jpg', item_snapshot: { item_type: 'trouser', brand: 'B Brand' } },
    ],
    outfit_quality_review_event: opts.events ?? approvedEvents(),
    outfit_quality_machine_check: opts.checks ?? [
      { check_id: 'chk-obj', candidate_version_id: 'v1', kind: 'objective', check_name: 'required_source_images', status: 'passed', attempt: 1, idempotency_key: 'v1:objective:x' },
      { check_id: 'chk-f1', candidate_version_id: 'v1', kind: 'fidelity', check_name: 'render_fidelity', status: 'passed', verdict: 'pass', score: 0.92, issues: { items: [], corrective_notes: null, detail: null }, model: 'm', attempt: 1, idempotency_key: 'fidelity:ra1' },
    ],
    outfit_quality_render_job: opts.jobs ?? [
      { render_job_id: 'j1', candidate_version_id: 'v1', approval_event_id: 'e1', cycle_no: 1, status: 'ready', promotion_id: 'p1', created_at: '2026-01-01T00:00:02.000Z' },
    ],
    outfit_quality_render_attempt: opts.attempts ?? [
      { render_attempt_id: 'ra1', render_job_id: 'j1', attempt_no: 1, image_url: 'https://res.cloudinary.com/x/quality-lab-renders/oq-ra1.png', cloudinary_asset: 'oq-ra1', generation_status: 'generated', fidelity_check_id: 'chk-f1', ready_at: '2026-01-01T00:05:00.000Z', renderer_model: 'seedream_v4_5' },
    ],
    outfit_quality_image_override: opts.overrides ?? [],
    outfit_quality_promotion: [{ promotion_id: 'p1', candidate_version_id: 'v1', outfit_id: 'o1', status: 'active' }],
    outfit: [{ outfit_id: 'o1', image_url: 'https://res.cloudinary.com/x/quality-lab-renders/oq-ra1.png', status: 'draft', stylist_id: STYLIST }],
    stylist: [{ stylist_id: STYLIST, name: 'Chloe' }],
  })
}

// ── Derivation ────────────────────────────────────────────────────────────────

describe('loadAcceptedImages', () => {
  it('returns the durable fidelity-passed image with its frozen sources, stylist, context, partition, and history — no second human approval needed', async () => {
    const db = seedGallery()
    const cards = await loadAcceptedImages(db.admin)
    expect(cards).toHaveLength(1)
    const card = cards[0]
    expect(card.render_attempt_id).toBe('ra1')
    expect(card.image_url).toContain('res.cloudinary.com')
    expect(card.stylist_name).toBe('Chloe')
    expect(card.context_type).toBe('evaluation_profile')
    expect(card.data_partition).toBe('test')
    expect(card.items.map((i: any) => i.slot)).toEqual(['top', 'bottom'])
    expect(card.fidelity).toMatchObject({ status: 'passed', score: 0.92 })
    expect(card.attempts).toHaveLength(1)
    expect(card.removed).toBe(false)
  })

  it('excludes attempts with an override, a withdrawn approval, or no ready marker', async () => {
    const overridden = seedGallery({
      overrides: [{ override_id: 'ov1', render_attempt_id: 'ra1', action: 'not_good_enough', reason: 'image_quality', reviewer_user_id: 'a', idempotency_key: KEY1, created_at: '2026-01-01T00:06:00.000Z' }],
    })
    expect(await loadAcceptedImages(overridden.admin)).toHaveLength(0)

    const withdrawn = seedGallery({
      events: [
        ...approvedEvents(),
        { review_event_id: 'e2', candidate_version_id: 'v1', action: 'withdraw', decision: null, reason_code: null, candidate_item_id: null, note: null, reverses_event_id: 'e1', reviewer_user_id: 'a', idempotency_key: 'k2', created_at: '2026-01-01T00:06:00.000Z' },
      ],
    })
    expect(await loadAcceptedImages(withdrawn.admin)).toHaveLength(0)

    const unready = seedGallery({ attempts: [{ render_attempt_id: 'ra1', render_job_id: 'j1', attempt_no: 1, image_url: 'https://res.cloudinary.com/x/quality-lab-renders/oq-ra1.png', fidelity_check_id: 'chk-f1', ready_at: null }] })
    expect(await loadAcceptedImages(unready.admin)).toHaveLength(0)
  })

  it('never derives readiness from a failed or unavailable fidelity check', async () => {
    const failed = seedGallery({
      checks: [{ check_id: 'chk-f1', candidate_version_id: 'v1', kind: 'fidelity', check_name: 'render_fidelity', status: 'failed', verdict: 'fail', score: 0.3, issues: { items: [], corrective_notes: null }, attempt: 1, idempotency_key: 'fidelity:ra1' }],
    })
    expect(await loadAcceptedImages(failed.admin)).toHaveLength(0)
  })
})

describe('loadRenderAttention', () => {
  it('lists attention_required jobs with their bounded error and no image exposure', async () => {
    const db = seedGallery({
      jobs: [{ render_job_id: 'j9', candidate_version_id: 'v1', approval_event_id: 'e1', cycle_no: 1, status: 'attention_required', last_error: 'second conclusive fidelity failure', generation_count: 2, created_at: '2026-01-01T00:00:02.000Z' }],
    })
    const rows = await loadRenderAttention(db.admin)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ render_job_id: 'j9', status: 'attention_required', generation_count: 2 })
  })
})

// ── Not good enough ───────────────────────────────────────────────────────────

describe('markNotGoodEnough', () => {
  it('appends the override with the verified actor and immediately removes the image from the gallery', async () => {
    const db = seedGallery()
    const r = await markNotGoodEnough(db.admin, 'ra1', { reason: 'image_quality', note: 'muddy colours', idempotencyKey: KEY1 }, ACTOR)
    expect(r).toMatchObject({ ok: true, reused: false, nextActions: ['regenerate'] })
    const ov = db.tables.outfit_quality_image_override[0]
    expect(ov).toMatchObject({ render_attempt_id: 'ra1', reason: 'image_quality', reviewer_user_id: 'admin-verified-1', action: 'not_good_enough' })
    // Immediate removal — readiness is derived, so the append is the removal.
    expect(await loadAcceptedImages(db.admin)).toHaveLength(0)
    // The ready attempt and its fidelity evidence are preserved, not rewritten.
    expect(db.tables.outfit_quality_render_attempt[0].ready_at).toBeTruthy()
  })

  it('requires exactly one approved reason', async () => {
    const db = seedGallery()
    expect(await markNotGoodEnough(db.admin, 'ra1', { reason: 'vibes', idempotencyKey: KEY1 }, ACTOR)).toMatchObject({ ok: false, code: 'invalid_reason' })
    expect(await markNotGoodEnough(db.admin, 'ra1', { reason: '', idempotencyKey: KEY1 }, ACTOR)).toMatchObject({ ok: false, code: 'invalid_reason' })
    expect(db.tables.outfit_quality_image_override).toHaveLength(0)
  })

  it('underlying_outfit offers withdrawal, image reasons offer regeneration', async () => {
    const db = seedGallery()
    const r = await markNotGoodEnough(db.admin, 'ra1', { reason: 'underlying_outfit', idempotencyKey: KEY1 }, ACTOR)
    expect(r).toMatchObject({ ok: true, nextActions: ['withdraw'] })
  })

  it('is idempotent by key and refuses a second override of the same attempt', async () => {
    const db = seedGallery()
    await markNotGoodEnough(db.admin, 'ra1', { reason: 'image_fidelity', idempotencyKey: KEY1 }, ACTOR)
    const replay = await markNotGoodEnough(db.admin, 'ra1', { reason: 'image_fidelity', idempotencyKey: KEY1 }, ACTOR)
    expect(replay).toMatchObject({ ok: true, reused: true })
    const second = await markNotGoodEnough(db.admin, 'ra1', { reason: 'image_quality', idempotencyKey: KEY2 }, ACTOR)
    expect(second).toMatchObject({ ok: false, code: 'already_overridden' })
    expect(db.tables.outfit_quality_image_override).toHaveLength(1)
  })

  it('refuses attempts that are not ready images with an active approval', async () => {
    const db = seedGallery({ attempts: [{ render_attempt_id: 'ra1', render_job_id: 'j1', attempt_no: 1, image_url: 'https://res.cloudinary.com/x/quality-lab-renders/oq-ra1.png', fidelity_check_id: 'chk-f1', ready_at: null }] })
    expect(await markNotGoodEnough(db.admin, 'ra1', { reason: 'image_quality', idempotencyKey: KEY1 }, ACTOR)).toMatchObject({ ok: false, code: 'not_ready' })
  })
})

// ── Explicit regeneration ─────────────────────────────────────────────────────

describe('regenerateRenderCycle', () => {
  function seedOverridden(): FakeAdmin {
    return seedGallery({
      overrides: [{ override_id: 'ov1', render_attempt_id: 'ra1', action: 'not_good_enough', reason: 'image_fidelity', reviewer_user_id: 'a', idempotency_key: KEY1, created_at: '2026-01-01T00:06:00.000Z' }],
    })
  }

  it('creates a new, separately keyed queued cycle after an image-reason override', async () => {
    const db = seedOverridden()
    const r = await regenerateRenderCycle(db.admin, 'ra1', { idempotencyKey: KEY2 }, ACTOR)
    expect(r).toMatchObject({ ok: true, reused: false, cycleNo: 2 })
    const jobs = db.tables.outfit_quality_render_job
    expect(jobs).toHaveLength(2)
    expect(jobs[1]).toMatchObject({ candidate_version_id: 'v1', approval_event_id: 'e1', cycle_no: 2, status: 'queued', promotion_id: 'p1' })
    // The prior cycle is preserved, not reset or hidden.
    expect(jobs[0].status).toBe('ready')
  })

  it('replaying the regeneration returns the same cycle without a duplicate job', async () => {
    const db = seedOverridden()
    await regenerateRenderCycle(db.admin, 'ra1', { idempotencyKey: KEY2 }, ACTOR)
    const replay = await regenerateRenderCycle(db.admin, 'ra1', { idempotencyKey: KEY3 }, ACTOR)
    expect(replay).toMatchObject({ ok: true, reused: true, cycleNo: 2 })
    expect(db.tables.outfit_quality_render_job).toHaveLength(2)
  })

  it('requires a prior image-reason override on that attempt', async () => {
    const db = seedGallery() // no override
    expect(await regenerateRenderCycle(db.admin, 'ra1', { idempotencyKey: KEY2 }, ACTOR)).toMatchObject({ ok: false, code: 'not_overridden' })

    const outfitReason = seedGallery({
      overrides: [{ override_id: 'ov1', render_attempt_id: 'ra1', action: 'not_good_enough', reason: 'underlying_outfit', reviewer_user_id: 'a', idempotency_key: KEY1, created_at: '2026-01-01T00:06:00.000Z' }],
    })
    expect(await regenerateRenderCycle(outfitReason.admin, 'ra1', { idempotencyKey: KEY2 }, ACTOR)).toMatchObject({ ok: false, code: 'not_image_reason' })
  })

  it('regeneration is only offered on the latest cycle and is bounded', async () => {
    const db = seedGallery({
      jobs: [
        { render_job_id: 'j1', candidate_version_id: 'v1', approval_event_id: 'e1', cycle_no: 1, status: 'ready', promotion_id: 'p1', created_at: '2026-01-01T00:00:02.000Z' },
        { render_job_id: 'j2', candidate_version_id: 'v1', approval_event_id: 'e1', cycle_no: 2, status: 'ready', promotion_id: 'p1', created_at: '2026-01-01T00:10:02.000Z' },
      ],
      attempts: [
        { render_attempt_id: 'ra1', render_job_id: 'j1', attempt_no: 1, image_url: 'https://res.cloudinary.com/x/quality-lab-renders/oq-ra1.png', fidelity_check_id: 'chk-f1', ready_at: '2026-01-01T00:05:00.000Z' },
        { render_attempt_id: 'ra2', render_job_id: 'j2', attempt_no: 1, image_url: 'https://res.cloudinary.com/x/quality-lab-renders/oq-ra2.png', fidelity_check_id: 'chk-f1', ready_at: '2026-01-01T00:15:00.000Z' },
      ],
      overrides: [{ override_id: 'ov1', render_attempt_id: 'ra1', action: 'not_good_enough', reason: 'image_quality', reviewer_user_id: 'a', idempotency_key: KEY1, created_at: '2026-01-01T00:06:00.000Z' }],
    })
    // ra1 belongs to cycle 1 but cycle 2 exists — stale action refused.
    expect(await regenerateRenderCycle(db.admin, 'ra1', { idempotencyKey: KEY2 }, ACTOR)).toMatchObject({ ok: false, code: 'not_latest_cycle' })
  })

  it('refuses beyond the cycle bound', async () => {
    const db = seedGallery({
      jobs: [1, 2, 3].map((n) => ({ render_job_id: `j${n}`, candidate_version_id: 'v1', approval_event_id: 'e1', cycle_no: n, status: 'ready', promotion_id: 'p1', created_at: `2026-01-01T00:0${n}:02.000Z` })),
      attempts: [{ render_attempt_id: 'ra3', render_job_id: 'j3', attempt_no: 1, image_url: 'https://res.cloudinary.com/x/quality-lab-renders/oq-ra3.png', fidelity_check_id: 'chk-f1', ready_at: '2026-01-01T00:20:00.000Z' }],
      overrides: [{ override_id: 'ov3', render_attempt_id: 'ra3', action: 'not_good_enough', reason: 'image_quality', reviewer_user_id: 'a', idempotency_key: KEY1, created_at: '2026-01-01T00:21:00.000Z' }],
    })
    expect(await regenerateRenderCycle(db.admin, 'ra3', { idempotencyKey: KEY2 }, ACTOR)).toMatchObject({ ok: false, code: 'cycle_limit' })
  })

  it('requires the approval to still be active', async () => {
    const db = seedGallery({
      events: [
        ...approvedEvents(),
        { review_event_id: 'e2', candidate_version_id: 'v1', action: 'withdraw', decision: null, reason_code: null, candidate_item_id: null, note: null, reverses_event_id: 'e1', reviewer_user_id: 'a', idempotency_key: 'k2', created_at: '2026-01-01T00:06:00.000Z' },
      ],
      overrides: [{ override_id: 'ov1', render_attempt_id: 'ra1', action: 'not_good_enough', reason: 'image_quality', reviewer_user_id: 'a', idempotency_key: KEY1, created_at: '2026-01-01T00:06:00.000Z' }],
    })
    expect(await regenerateRenderCycle(db.admin, 'ra1', { idempotencyKey: KEY2 }, ACTOR)).toMatchObject({ ok: false, code: 'no_active_approval' })
  })
})

// ── Removed images pending an explicit action ─────────────────────────────────

describe('loadRemovedImages', () => {
  it('a removed image-reason attempt on the latest cycle with active approval offers regeneration', async () => {
    const db = seedGallery({
      overrides: [{ override_id: 'ov1', render_attempt_id: 'ra1', action: 'not_good_enough', reason: 'image_fidelity', reviewer_user_id: 'a', note: 'colour drift', idempotency_key: KEY1, created_at: '2026-01-01T00:06:00.000Z' }],
    })
    const { loadRemovedImages } = await import('@/lib/outfit-quality/gallery')
    const rows = await loadRemovedImages(db.admin)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ render_attempt_id: 'ra1', reason: 'image_fidelity', note: 'colour drift', actions: ['regenerate'] })
  })

  it('an underlying-outfit override offers withdrawal; a withdrawn approval offers nothing', async () => {
    const db = seedGallery({
      overrides: [{ override_id: 'ov1', render_attempt_id: 'ra1', action: 'not_good_enough', reason: 'underlying_outfit', reviewer_user_id: 'a', idempotency_key: KEY1, created_at: '2026-01-01T00:06:00.000Z' }],
    })
    const { loadRemovedImages } = await import('@/lib/outfit-quality/gallery')
    expect((await loadRemovedImages(db.admin))[0].actions).toEqual(['withdraw'])

    const withdrawn = seedGallery({
      events: [
        ...approvedEvents(),
        { review_event_id: 'e2', candidate_version_id: 'v1', action: 'withdraw', decision: null, reason_code: null, candidate_item_id: null, note: null, reverses_event_id: 'e1', reviewer_user_id: 'a', idempotency_key: 'k2', created_at: '2026-01-01T00:07:00.000Z' },
      ],
      overrides: [{ override_id: 'ov1', render_attempt_id: 'ra1', action: 'not_good_enough', reason: 'underlying_outfit', reviewer_user_id: 'a', idempotency_key: KEY1, created_at: '2026-01-01T00:06:00.000Z' }],
    })
    expect((await loadRemovedImages(withdrawn.admin))[0].actions).toEqual([])
  })
})

// ── Underlying-outfit withdrawal ──────────────────────────────────────────────

describe('withdrawUnderlyingOutfit', () => {
  it('withdraws the approval and marks the promotion withdrawn, preserving all history', async () => {
    const db = seedGallery({
      overrides: [{ override_id: 'ov1', render_attempt_id: 'ra1', action: 'not_good_enough', reason: 'underlying_outfit', reviewer_user_id: 'a', idempotency_key: KEY1, created_at: '2026-01-01T00:06:00.000Z' }],
    })
    const r = await withdrawUnderlyingOutfit(db.admin, 'ra1', { idempotencyKey: KEY2, note: 'the outfit itself is wrong' }, ACTOR)
    expect(r).toMatchObject({ ok: true })
    const events = db.tables.outfit_quality_review_event
    expect(events).toHaveLength(2)
    expect(events[1]).toMatchObject({ action: 'withdraw', reverses_event_id: 'e1', reviewer_user_id: 'admin-verified-1' })
    expect(db.tables.outfit_quality_candidate_version[0].state).toBe('approval_withdrawn')
    expect(db.tables.outfit_quality_promotion[0].status).toBe('withdrawn')
    expect(await loadAcceptedImages(db.admin)).toHaveLength(0)
  })

  it('requires an underlying_outfit override first', async () => {
    const db = seedGallery()
    expect(await withdrawUnderlyingOutfit(db.admin, 'ra1', { idempotencyKey: KEY2 }, ACTOR)).toMatchObject({ ok: false, code: 'not_outfit_override' })
  })
})
