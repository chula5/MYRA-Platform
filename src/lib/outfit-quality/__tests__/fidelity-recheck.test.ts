// The fidelity-only re-evaluation path against the in-memory fake and
// deterministic checker adapters. Covers: an attempt stuck in
// attention_required because the fidelity checker was unavailable/errored
// while its durable Cloudinary image persisted can be re-checked WITHOUT any
// renderer involvement — zero submissions, generation_count untouched, no new
// attempt rows. A pass marks the EXISTING attempt ready; a conclusive failure
// follows the unchanged corrective-retry policy; unavailable/error stays
// fail-closed and persists nothing so a later explicit re-check can run.
// No real Higgsfield or Anthropic call happens anywhere in this file.

import { describe, it, expect } from 'vitest'
import { recheckPersistedAttemptFidelity, type FidelityRecheckDeps } from '@/lib/outfit-quality/fidelity-recheck'
import { drainQualityRenderQueue, type RenderAdapters } from '@/lib/outfit-quality/render-worker'
import { createFakeAdmin, type FakeAdmin } from './fake-admin'
import type { StrictFidelityResult } from '@/lib/outfit-quality/fidelity'

const STYLIST = '0d535772-8a4f-440f-9e46-f8d637bed0d3'
const DURABLE = 'https://res.cloudinary.com/x/higgsfield-shoots/oq-ra1.jpg'

interface SeedOpts {
  jobStatus?: string
  generationCount?: number
  attempt?: Record<string, unknown> | null
  fidelityStatus?: 'passed' | 'failed' | 'unavailable' | 'error' | null
  events?: any[]
  recheckRow?: boolean
}

function seedStuck(opts: SeedOpts = {}): FakeAdmin {
  const fidelityStatus = opts.fidelityStatus === undefined ? 'error' : opts.fidelityStatus
  const attempt =
    opts.attempt === null
      ? []
      : [
          {
            render_attempt_id: 'ra1',
            render_job_id: 'j1',
            attempt_no: 1,
            prompt: 'base prompt',
            generation_status: 'generated',
            image_url: DURABLE,
            cloudinary_asset: 'oq-ra1',
            fidelity_check_id: fidelityStatus ? 'chk-f1' : null,
            ready_at: null,
            ...(opts.attempt ?? {}),
          },
        ]
  const checks: any[] = [
    { check_id: 'chk-obj', candidate_version_id: 'v1', kind: 'objective', check_name: 'required_source_images', status: 'passed', attempt: 1, idempotency_key: 'v1:objective:required_source_images' },
  ]
  if (fidelityStatus) {
    checks.push({
      check_id: 'chk-f1',
      candidate_version_id: 'v1',
      kind: 'fidelity',
      check_name: 'render_fidelity',
      status: fidelityStatus,
      verdict: fidelityStatus === 'passed' ? 'pass' : fidelityStatus === 'failed' ? 'fail' : null,
      score: null,
      issues: { items: [], corrective_notes: null, detail: 'checker could not conclude' },
      model: 'claude-opus-4-6',
      prompt_version: 'oq-fidelity-1',
      attempt: 1,
      idempotency_key: 'fidelity:ra1',
    })
  }
  if (opts.recheckRow) {
    checks.push({
      check_id: 'chk-rc1',
      candidate_version_id: 'v1',
      kind: 'fidelity',
      check_name: 'render_fidelity_recheck',
      status: 'passed',
      verdict: 'pass',
      score: 0.88,
      issues: { items: [], corrective_notes: null, detail: null },
      model: 'claude-opus-4-6',
      prompt_version: 'oq-fidelity-1',
      attempt: 1,
      idempotency_key: 'fidelity-recheck:ra1',
    })
  }
  return createFakeAdmin({
    outfit_quality_candidate_version: [
      { candidate_version_id: 'v1', case_id: 'c1', version_no: 1, state: 'approved', created_at: '2026-01-01T00:00:00.000Z' },
    ],
    outfit_quality_case: [
      { case_id: 'c1', current_version_id: 'v1', selected_stylist_id: STYLIST, stylist_snapshot_id: 'snap-1', status: 'approved', data_partition: 'test' },
    ],
    outfit_quality_candidate_item: [
      { candidate_item_id: 'ci-1', candidate_version_id: 'v1', item_id: 'i1', slot: 'top', sort_order: 0, source_image_url: 'https://res.cloudinary.com/x/top.jpg', source_image_asset_version: 'v1', source_image_hash: 'h1', item_snapshot: { item_type: 'shirt', brand: 'A Brand' } },
      { candidate_item_id: 'ci-2', candidate_version_id: 'v1', item_id: 'i2', slot: 'bottom', sort_order: 1, source_image_url: 'https://res.cloudinary.com/x/bottom.jpg', source_image_asset_version: 'v2', source_image_hash: 'h2', item_snapshot: { item_type: 'trouser', brand: 'B Brand' } },
    ],
    outfit_quality_review_event:
      opts.events === undefined
        ? [
            {
              review_event_id: 'e1',
              candidate_version_id: 'v1',
              action: 'decide',
              decision: 'yes',
              reason_code: null,
              candidate_item_id: null,
              note: null,
              reverses_event_id: null,
              reviewer_user_id: 'admin-1',
              idempotency_key: 'k1',
              created_at: '2026-01-01T00:00:01.000Z',
            },
          ]
        : opts.events,
    outfit_quality_machine_check: checks,
    outfit_quality_render_job: [
      {
        render_job_id: 'j1',
        candidate_version_id: 'v1',
        approval_event_id: 'e1',
        cycle_no: 1,
        status: opts.jobStatus ?? 'attention_required',
        generation_count: opts.generationCount ?? 1,
        last_error: 'fidelity check error — fail closed',
        created_at: '2026-01-01T00:00:02.000Z',
      },
    ],
    outfit_quality_render_attempt: attempt,
    outfit_quality_promotion: [{ promotion_id: 'p1', candidate_version_id: 'v1', outfit_id: 'o1', status: 'active' }],
    outfit: [{ outfit_id: 'o1', image_url: 'https://res.cloudinary.com/x/top.jpg', status: 'draft', stylist_id: STYLIST, published_at: null }],
    outfit_item: [],
    // Trap tables: the re-check must never read mutable sources.
    item: [{ item_id: 'i1', image_url: 'https://MUTATED.example/changed.jpg' }],
    stylist: [{ stylist_id: STYLIST, name: 'Chloe' }],
  })
}

const PASSED: StrictFidelityResult = { status: 'passed', score: 0.91, issues: [], correctiveNotes: null, detail: null, model: 'claude-opus-4-6' }
const UNAVAILABLE: StrictFidelityResult = { status: 'unavailable', score: null, issues: [], correctiveNotes: null, detail: 'credit exhausted', model: 'claude-opus-4-6' }
const FAILED_WITH_NOTES: StrictFidelityResult = {
  status: 'failed',
  score: 0.4,
  issues: [{ item: 'Trouser', field: 'silhouette', expected: 'wide-leg', seen: 'cargo' }],
  correctiveNotes: 'keep the trousers wide-leg',
  detail: null,
  model: 'claude-opus-4-6',
}

function fakeDeps(behaviour?: (url: string, n: number) => Promise<StrictFidelityResult>): {
  deps: FidelityRecheckDeps
  calls: { url: string; items: { label: string; image_url: string }[] }[]
} {
  const calls: { url: string; items: { label: string; image_url: string }[] }[] = []
  return {
    calls,
    deps: {
      checkFidelity: async (url, items) => {
        calls.push({ url, items })
        if (behaviour) return behaviour(url, calls.length)
        return PASSED
      },
    },
  }
}

function jobOf(db: FakeAdmin): any {
  return db.tables.outfit_quality_render_job[0]
}
function attemptOf(db: FakeAdmin): any {
  return db.tables.outfit_quality_render_attempt[0]
}

// ── Eligibility (fail closed, checker never called) ───────────────────────────

describe('re-check eligibility', () => {
  it('refuses an unknown attempt without calling the checker', async () => {
    const db = seedStuck()
    const { deps, calls } = fakeDeps()
    const r = await recheckPersistedAttemptFidelity(db.admin, 'nope', deps)
    expect(r).toMatchObject({ ok: false, code: 'not_found' })
    expect(calls).toHaveLength(0)
  })

  it('refuses an attempt whose job is not attention_required', async () => {
    const db = seedStuck({ jobStatus: 'ready' })
    const { deps, calls } = fakeDeps()
    const r = await recheckPersistedAttemptFidelity(db.admin, 'ra1', deps)
    expect(r).toMatchObject({ ok: false, code: 'job_not_attention' })
    expect(calls).toHaveLength(0)
  })

  it('refuses an attempt that is already ready', async () => {
    const db = seedStuck({ attempt: { ready_at: '2026-01-01T01:00:00.000Z' } })
    const { deps, calls } = fakeDeps()
    const r = await recheckPersistedAttemptFidelity(db.admin, 'ra1', deps)
    expect(r).toMatchObject({ ok: false, code: 'already_ready' })
    expect(calls).toHaveLength(0)
  })

  it('refuses an attempt with no durable persisted image — the checker is never pointed at nothing', async () => {
    const db = seedStuck({ attempt: { image_url: null, cloudinary_asset: null, fidelity_check_id: null }, fidelityStatus: null })
    const { deps, calls } = fakeDeps()
    const r = await recheckPersistedAttemptFidelity(db.admin, 'ra1', deps)
    expect(r).toMatchObject({ ok: false, code: 'no_durable_image' })
    expect(calls).toHaveLength(0)
  })

  it.each(['passed', 'failed'] as const)('refuses an attempt whose recorded fidelity already concluded (%s)', async (status) => {
    const db = seedStuck({ fidelityStatus: status })
    const { deps, calls } = fakeDeps()
    const r = await recheckPersistedAttemptFidelity(db.admin, 'ra1', deps)
    expect(r).toMatchObject({ ok: false, code: 'not_eligible' })
    expect(calls).toHaveLength(0)
  })
})

// ── Pass path ─────────────────────────────────────────────────────────────────

describe('re-check pass', () => {
  it('marks the EXISTING attempt ready: zero renderer involvement, generation_count and attempt count untouched', async () => {
    const db = seedStuck()
    const { deps, calls } = fakeDeps()
    const r = await recheckPersistedAttemptFidelity(db.admin, 'ra1', deps)
    expect(r).toMatchObject({ ok: true, outcome: 'ready', replayed: false })

    // The checker ran against the durable Cloudinary image and frozen items only.
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe(DURABLE)
    expect(calls[0].items.map((i) => i.image_url)).toEqual(['https://res.cloudinary.com/x/top.jpg', 'https://res.cloudinary.com/x/bottom.jpg'])
    expect(db.queried).not.toContain('item')
    expect(db.queried).not.toContain('stylist')

    // The SAME attempt became ready; no new attempt was created.
    expect(db.tables.outfit_quality_render_attempt).toHaveLength(1)
    expect(attemptOf(db).ready_at).toBeTruthy()
    expect(jobOf(db)).toMatchObject({ status: 'ready', generation_count: 1 })

    // The re-check is a persisted append-only machine_check correlated to the attempt.
    const recheck = db.tables.outfit_quality_machine_check.find((c: any) => c.check_name === 'render_fidelity_recheck')
    expect(recheck).toMatchObject({ kind: 'fidelity', status: 'passed', idempotency_key: 'fidelity-recheck:ra1', attempt: 1 })
    expect(attemptOf(db).fidelity_check_id).toBe(recheck.check_id)

    // The promoted internal outfit received the durable image.
    expect(db.tables.outfit[0].image_url).toBe(DURABLE)
    expect(db.tables.outfit[0].status).toBe('draft')
  })

  it('replay: a second invocation does not call the checker again and changes nothing', async () => {
    const db = seedStuck()
    const { deps, calls } = fakeDeps()
    const first = await recheckPersistedAttemptFidelity(db.admin, 'ra1', deps)
    expect(first).toMatchObject({ ok: true, outcome: 'ready', replayed: false })
    const snapshot = JSON.stringify(db.tables)

    // Reset job back to attention to simulate an operator re-running the action
    // before noticing the first succeeded — replay must still not re-check.
    const db2 = seedStuck({ recheckRow: true })
    db2.tables.outfit_quality_render_attempt[0].fidelity_check_id = 'chk-rc1'
    const { deps: deps2, calls: calls2 } = fakeDeps()
    const second = await recheckPersistedAttemptFidelity(db2.admin, 'ra1', deps2)
    expect(second).toMatchObject({ ok: true, outcome: 'ready', replayed: true })
    expect(calls2).toHaveLength(0)
    expect(db2.tables.outfit_quality_machine_check.filter((c: any) => c.check_name === 'render_fidelity_recheck')).toHaveLength(1)
    expect(db2.tables.outfit_quality_render_attempt).toHaveLength(1)
    expect(jobOf(db2)).toMatchObject({ status: 'ready', generation_count: 1 })

    // And the first world's state was stable after its single call.
    expect(JSON.stringify(db.tables)).toBe(snapshot)
  })

  it('a pass with a withdrawn approval never marks the attempt ready — the job is cancelled', async () => {
    const db = seedStuck({
      events: [
        { review_event_id: 'e1', candidate_version_id: 'v1', action: 'decide', decision: 'yes', reason_code: null, candidate_item_id: null, note: null, reverses_event_id: null, reviewer_user_id: 'a', idempotency_key: 'k1', created_at: '2026-01-01T00:00:01.000Z' },
        { review_event_id: 'e2', candidate_version_id: 'v1', action: 'withdraw', decision: null, reason_code: null, candidate_item_id: null, note: null, reverses_event_id: 'e1', reviewer_user_id: 'a', idempotency_key: 'k2', created_at: '2026-01-01T00:00:09.000Z' },
      ],
    })
    const { deps } = fakeDeps()
    const r = await recheckPersistedAttemptFidelity(db.admin, 'ra1', deps)
    expect(r).toMatchObject({ ok: true, outcome: 'cancelled' })
    expect(attemptOf(db).ready_at).toBeNull()
    expect(jobOf(db).status).toBe('cancelled')
    expect(jobOf(db).generation_count).toBe(1)
    expect(db.tables.outfit[0].image_url).not.toBe(DURABLE)
  })
})

// ── Conclusive failure: unchanged corrective-retry policy ─────────────────────

describe('re-check conclusive failure', () => {
  it('a first-attempt failure with corrective evidence re-queues the job for the existing corrective retry — no submission by the re-check itself', async () => {
    const db = seedStuck()
    const { deps, calls } = fakeDeps(async () => FAILED_WITH_NOTES)
    const r = await recheckPersistedAttemptFidelity(db.admin, 'ra1', deps)
    expect(r).toMatchObject({ ok: true, outcome: 'corrective_retry_authorized' })
    expect(calls).toHaveLength(1)
    expect(attemptOf(db).ready_at).toBeNull()
    expect(db.tables.outfit_quality_render_attempt).toHaveLength(1) // no attempt 2 from the re-check
    expect(jobOf(db)).toMatchObject({ status: 'queued', generation_count: 1, lease_token: null, worker_id: null })
    const recheck = db.tables.outfit_quality_machine_check.find((c: any) => c.check_name === 'render_fidelity_recheck')
    expect(recheck).toMatchObject({ status: 'failed', verdict: 'fail' })
  })

  it('the re-queued job then follows the unchanged drain policy: exactly one corrective attempt with the issue-derived prompt', async () => {
    const db = seedStuck()
    const { deps } = fakeDeps(async () => FAILED_WITH_NOTES)
    await recheckPersistedAttemptFidelity(db.admin, 'ra1', deps)
    expect(jobOf(db).status).toBe('queued')

    const generateCalls: string[] = []
    const adapters: RenderAdapters = {
      rendererAvailable: () => true,
      generate: async (prompt) => {
        generateCalls.push(prompt)
        return { submitted: true, imageUrl: 'https://cdn.higgsfield.example/ephemeral-2.png' }
      },
      persist: async (_url, opts) => `https://res.cloudinary.com/x/quality-lab-renders/${opts.publicId}.png`,
      checkFidelity: async () => PASSED,
    }
    const d = await drainQualityRenderQueue(db.admin, { workerId: 'local-test-worker', adapters, maxJobs: 1 })
    expect(d.ready).toBe(1)
    expect(generateCalls).toHaveLength(1)
    expect(generateCalls[0]).toContain('keep the trousers wide-leg')
    const attempts = db.tables.outfit_quality_render_attempt
    expect(attempts).toHaveLength(2)
    expect(attempts[1].attempt_no).toBe(2)
    expect(jobOf(db)).toMatchObject({ status: 'ready', generation_count: 2 })
  })

  it('a first-attempt failure WITHOUT corrective evidence stays attention_required (no blind retry)', async () => {
    const db = seedStuck()
    const { deps } = fakeDeps(async () => ({ ...FAILED_WITH_NOTES, correctiveNotes: null }))
    const r = await recheckPersistedAttemptFidelity(db.admin, 'ra1', deps)
    expect(r).toMatchObject({ ok: true, outcome: 'attention' })
    expect(jobOf(db).status).toBe('attention_required')
    expect(db.tables.outfit_quality_render_attempt).toHaveLength(1)
    expect(jobOf(db).generation_count).toBe(1)
  })

  it('a second-attempt conclusive failure stays attention_required — no attempt 3 exists', async () => {
    const db = seedStuck({ attempt: { attempt_no: 2, render_attempt_id: 'ra2' } })
    db.tables.outfit_quality_machine_check = db.tables.outfit_quality_machine_check.map((c: any) =>
      c.check_id === 'chk-f1' ? { ...c, attempt: 2, idempotency_key: 'fidelity:ra2' } : c,
    )
    const { deps } = fakeDeps(async () => FAILED_WITH_NOTES)
    const r = await recheckPersistedAttemptFidelity(db.admin, 'ra2', deps)
    expect(r).toMatchObject({ ok: true, outcome: 'attention' })
    expect(jobOf(db).status).toBe('attention_required')
    expect(jobOf(db).last_error).toContain('second conclusive fidelity failure')
    expect(db.tables.outfit_quality_render_attempt).toHaveLength(1)
  })
})

// ── Unavailable/error stays fail-closed and re-runnable ───────────────────────

describe('re-check unavailable/error', () => {
  it.each(['unavailable', 'error'] as const)('checker %s persists nothing, changes nothing, and never becomes a pass', async (status) => {
    const db = seedStuck()
    const { deps, calls } = fakeDeps(async () => ({ ...UNAVAILABLE, status }))
    const r = await recheckPersistedAttemptFidelity(db.admin, 'ra1', deps)
    expect(r).toMatchObject({ ok: true, outcome: 'unresolved', status })
    expect(calls).toHaveLength(1)
    expect(attemptOf(db).ready_at).toBeNull()
    expect(jobOf(db)).toMatchObject({ status: 'attention_required', generation_count: 1 })
    // No conclusive evidence is fabricated: no re-check machine_check row.
    expect(db.tables.outfit_quality_machine_check.some((c: any) => c.check_name === 'render_fidelity_recheck')).toBe(false)
  })

  it('a throwing checker fails closed the same way', async () => {
    const db = seedStuck()
    const calls: unknown[] = []
    const deps: FidelityRecheckDeps = {
      checkFidelity: async () => {
        calls.push(1)
        throw new Error('socket hang up')
      },
    }
    const r = await recheckPersistedAttemptFidelity(db.admin, 'ra1', deps)
    expect(r).toMatchObject({ ok: true, outcome: 'unresolved', status: 'error' })
    expect(attemptOf(db).ready_at).toBeNull()
    expect(jobOf(db).status).toBe('attention_required')
  })

  it('an unresolved re-check can be explicitly re-run later and then conclude', async () => {
    const db = seedStuck()
    const { deps, calls } = fakeDeps(async (_url, n) => (n === 1 ? UNAVAILABLE : PASSED))
    const first = await recheckPersistedAttemptFidelity(db.admin, 'ra1', deps)
    expect(first).toMatchObject({ ok: true, outcome: 'unresolved', status: 'unavailable' })
    const second = await recheckPersistedAttemptFidelity(db.admin, 'ra1', deps)
    expect(second).toMatchObject({ ok: true, outcome: 'ready', replayed: false })
    expect(calls).toHaveLength(2) // the unresolved pass persisted nothing, so the checker ran again
    expect(attemptOf(db).ready_at).toBeTruthy()
    expect(jobOf(db).generation_count).toBe(1)
  })
})
