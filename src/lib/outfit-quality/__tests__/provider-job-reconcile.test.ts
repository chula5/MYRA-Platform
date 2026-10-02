// Read-only reconciliation of an ACCEPTED Higgsfield provider job after a
// transient post-submission wait/result-retrieval failure (VAL-RENDER-004).
//
// Covers: an attempt whose create was accepted (provider_job_id persisted) but
// whose result retrieval transiently failed can be recovered WITHOUT any new
// create/generate call — recovery reads the provider job read-only, persists
// the completed image durably exactly once, runs strict fidelity against the
// frozen sources, and marks the EXISTING attempt ready on a conclusive pass.
// Replay is idempotent (no duplicate assets, attempts, generation counts, or
// readiness transitions); pending jobs persist nothing; failed/not-found jobs
// fail closed; and the unchanged corrective-retry policy decides a conclusive
// fidelity failure. No real Higgsfield or Anthropic call happens in this file.

import { describe, it, expect } from 'vitest'
import {
  reconcileAcceptedProviderJob,
  type ProviderJobReconcileDeps,
} from '@/lib/outfit-quality/provider-job-reconcile'
import type { ProviderJobStatus } from '@/lib/outfit-quality/render-worker'
import { createFakeAdmin, type FakeAdmin } from './fake-admin'
import type { StrictFidelityResult } from '@/lib/outfit-quality/fidelity'

const STYLIST = '0d535772-8a4f-440f-9e46-f8d637bed0d3'
const PROVIDER_JOB = 'c71b4f96-f273-4929-9f86-f57e1379a4ce'
const EPHEMERAL = 'https://cdn.higgsfield.example/accepted-result.png'
const DURABLE = 'https://res.cloudinary.com/x/quality-lab-renders/oq-ra1.png'

interface SeedOpts {
  jobStatus?: string
  generationCount?: number
  attempt?: Record<string, unknown> | null
  events?: any[]
}

function seedAccepted(opts: SeedOpts = {}): FakeAdmin {
  const attempt =
    opts.attempt === null
      ? []
      : [
          {
            render_attempt_id: 'ra1',
            render_job_id: 'j1',
            attempt_no: 1,
            prompt: 'base prompt',
            provider_job_id: PROVIDER_JOB,
            provider_status: 'retrieval_failed',
            generation_status: 'accepted_retrieval_failed',
            generation_error: 'HTTP 403 while waiting for result',
            image_url: null,
            cloudinary_asset: null,
            fidelity_check_id: null,
            ready_at: null,
            ...(opts.attempt ?? {}),
          },
        ]
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
            { review_event_id: 'e1', candidate_version_id: 'v1', action: 'decide', decision: 'yes', reason_code: null, candidate_item_id: null, note: null, reverses_event_id: null, reviewer_user_id: 'admin-1', idempotency_key: 'k1', created_at: '2026-01-01T00:00:01.000Z' },
          ]
        : opts.events,
    outfit_quality_machine_check: [
      { check_id: 'chk-obj', candidate_version_id: 'v1', kind: 'objective', check_name: 'required_source_images', status: 'passed', attempt: 1, idempotency_key: 'v1:objective:required_source_images' },
    ],
    outfit_quality_render_job: [
      {
        render_job_id: 'j1',
        candidate_version_id: 'v1',
        approval_event_id: 'e1',
        cycle_no: 1,
        status: opts.jobStatus ?? 'attention_required',
        generation_count: opts.generationCount ?? 1,
        last_error: 'accepted provider job retrieval failed — reconcilable',
        promotion_id: 'p1',
        lease_token: null,
        leased_at: null,
        worker_id: null,
        created_at: '2026-01-01T00:00:02.000Z',
      },
    ],
    outfit_quality_render_attempt: attempt,
    outfit_quality_promotion: [{ promotion_id: 'p1', candidate_version_id: 'v1', outfit_id: 'o1', status: 'active' }],
    outfit: [{ outfit_id: 'o1', image_url: 'https://res.cloudinary.com/x/top.jpg', status: 'draft', stylist_id: STYLIST, published_at: null }],
    outfit_item: [],
    // Trap tables: reconciliation must never read mutable sources.
    item: [{ item_id: 'i1', image_url: 'https://MUTATED.example/changed.jpg' }],
    stylist: [{ stylist_id: STYLIST, name: 'Chloe' }],
  })
}

const PASSED: StrictFidelityResult = { status: 'passed', score: 0.91, issues: [], correctiveNotes: null, detail: null, model: 'claude-opus-4-6' }
const FAILED_WITH_NOTES: StrictFidelityResult = {
  status: 'failed',
  score: 0.4,
  issues: [{ item: 'Trouser', field: 'silhouette', expected: 'wide-leg', seen: 'cargo' }],
  correctiveNotes: 'keep the trousers wide-leg',
  detail: null,
  model: 'claude-opus-4-6',
}
const UNAVAILABLE: StrictFidelityResult = { status: 'unavailable', score: null, issues: [], correctiveNotes: null, detail: 'credit exhausted', model: 'claude-opus-4-6' }

interface Calls {
  get: string[]
  persist: { url: string; publicId: string }[]
  fidelity: { url: string; items: { label: string; image_url: string }[] }[]
}

function fakeDeps(behaviour: {
  get?: (id: string, n: number) => Promise<ProviderJobStatus>
  persist?: (url: string, publicId: string) => Promise<string | null>
  fidelity?: (url: string, n: number) => Promise<StrictFidelityResult>
} = {}): { deps: ProviderJobReconcileDeps; calls: Calls } {
  const calls: Calls = { get: [], persist: [], fidelity: [] }
  return {
    calls,
    deps: {
      getProviderJob: async (id) => {
        calls.get.push(id)
        if (behaviour.get) return behaviour.get(id, calls.get.length)
        return { state: 'completed', imageUrl: EPHEMERAL }
      },
      persist: async (url, opts) => {
        calls.persist.push({ url, publicId: opts.publicId })
        if (behaviour.persist) return behaviour.persist(url, opts.publicId)
        return DURABLE
      },
      checkFidelity: async (url, items) => {
        calls.fidelity.push({ url, items })
        if (behaviour.fidelity) return behaviour.fidelity(url, calls.fidelity.length)
        return PASSED
      },
    },
  }
}

const jobOf = (db: FakeAdmin) => db.tables.outfit_quality_render_job[0]
const attemptOf = (db: FakeAdmin) => db.tables.outfit_quality_render_attempt[0]

// ── Eligibility (fail closed, provider never contacted) ───────────────────────

describe('reconcile eligibility', () => {
  it('refuses an unknown attempt without contacting the provider', async () => {
    const db = seedAccepted()
    const { deps, calls } = fakeDeps()
    const r = await reconcileAcceptedProviderJob(db.admin, 'nope', deps)
    expect(r).toMatchObject({ ok: false, code: 'not_found' })
    expect(calls.get).toHaveLength(0)
  })

  it('refuses an attempt with no persisted provider job id', async () => {
    const db = seedAccepted({ attempt: { provider_job_id: null } })
    const { deps, calls } = fakeDeps()
    const r = await reconcileAcceptedProviderJob(db.admin, 'ra1', deps)
    expect(r).toMatchObject({ ok: false, code: 'no_provider_job' })
    expect(calls.get).toHaveLength(0)
  })

  it('refuses an attempt whose job is not reconcilable (e.g. ready)', async () => {
    const db = seedAccepted({ jobStatus: 'ready', attempt: { ready_at: '2026-01-01T01:00:00.000Z', image_url: DURABLE } })
    const { deps } = fakeDeps()
    const r = await reconcileAcceptedProviderJob(db.admin, 'ra1', deps)
    // Already ready → idempotent replay returns ready, never contacts provider.
    expect(r).toMatchObject({ ok: true, outcome: 'ready', replayed: true })
  })
})

// ── Recovery of a completed accepted job ──────────────────────────────────────

describe('recovery of a completed accepted job', () => {
  it('reads the provider job read-only, persists the completed image once, passes fidelity, and marks the EXISTING attempt ready', async () => {
    const db = seedAccepted()
    const { deps, calls } = fakeDeps()
    const r = await reconcileAcceptedProviderJob(db.admin, 'ra1', deps)
    expect(r).toMatchObject({ ok: true, outcome: 'ready', replayed: false })

    // Exactly one read-only get for the accepted provider job; one durable persist.
    expect(calls.get).toEqual([PROVIDER_JOB])
    expect(calls.persist).toHaveLength(1)
    expect(calls.persist[0].url).toBe(EPHEMERAL)

    // Fidelity ran against the durable image and the frozen sources only.
    expect(calls.fidelity).toHaveLength(1)
    expect(calls.fidelity[0].url).toBe(DURABLE)
    expect(calls.fidelity[0].items.map((i) => i.image_url)).toEqual(['https://res.cloudinary.com/x/top.jpg', 'https://res.cloudinary.com/x/bottom.jpg'])
    expect(db.queried).not.toContain('item')
    expect(db.queried).not.toContain('stylist')

    // The SAME attempt became ready; no new attempt; generation count untouched.
    expect(db.tables.outfit_quality_render_attempt).toHaveLength(1)
    const attempt = attemptOf(db)
    expect(attempt.image_url).toBe(DURABLE)
    expect(attempt.provider_status).toBe('completed')
    expect(attempt.ready_at).toBeTruthy()
    expect(jobOf(db)).toMatchObject({ status: 'ready', generation_count: 1 })

    // The recovered image is attached to the promoted (internal, non-live) outfit.
    expect(db.tables.outfit[0].image_url).toBe(DURABLE)
    expect(db.tables.outfit[0].status).toBe('draft')

    // Fidelity is a persisted machine_check correlated to the attempt.
    const check = db.tables.outfit_quality_machine_check.find((c: any) => c.kind === 'fidelity')
    expect(check).toMatchObject({ status: 'passed', attempt: 1 })
    expect(attempt.fidelity_check_id).toBe(check.check_id)
  })

  it('is idempotent: replaying returns the same correlated result with no duplicate get, persist, asset, attempt, or readiness transition', async () => {
    const db = seedAccepted()
    const first = fakeDeps()
    await reconcileAcceptedProviderJob(db.admin, 'ra1', first.deps)
    const readyAt = attemptOf(db).ready_at
    const imageUrl = attemptOf(db).image_url

    const second = fakeDeps()
    const r = await reconcileAcceptedProviderJob(db.admin, 'ra1', second.deps)
    expect(r).toMatchObject({ ok: true, outcome: 'ready', replayed: true })
    // No provider contact, no new persist, no new attempt or fidelity row.
    expect(second.calls.get).toHaveLength(0)
    expect(second.calls.persist).toHaveLength(0)
    expect(second.calls.fidelity).toHaveLength(0)
    expect(db.tables.outfit_quality_render_attempt).toHaveLength(1)
    expect(attemptOf(db).ready_at).toBe(readyAt)
    expect(attemptOf(db).image_url).toBe(imageUrl)
    expect(db.tables.outfit_quality_machine_check.filter((c: any) => c.kind === 'fidelity')).toHaveLength(1)
    expect(jobOf(db).generation_count).toBe(1)
  })

  it('never issues a create/generate call — the deps expose only a read-only get', async () => {
    const db = seedAccepted()
    const { deps } = fakeDeps()
    const keys = Object.keys(deps as unknown as Record<string, unknown>)
    expect(keys).not.toContain('generate')
    expect(keys).not.toContain('submit')
    await reconcileAcceptedProviderJob(db.admin, 'ra1', deps)
    expect(jobOf(db).generation_count).toBe(1) // unchanged — no new submission
  })
})

// ── Pending / failed / not-found provider states ──────────────────────────────

describe('non-completed provider states', () => {
  it('a still-pending job persists nothing and can be reconciled again later', async () => {
    const db = seedAccepted()
    const { deps, calls } = fakeDeps({ get: async () => ({ state: 'pending' }) })
    const r = await reconcileAcceptedProviderJob(db.admin, 'ra1', deps)
    expect(r).toMatchObject({ ok: true, outcome: 'pending' })
    expect(calls.persist).toHaveLength(0)
    expect(calls.fidelity).toHaveLength(0)
    expect(attemptOf(db).image_url).toBeNull()
    expect(jobOf(db).status).toBe('attention_required')
  })

  it.each(['failed', 'not_found', 'error'] as const)('a %s provider job fails closed and never marks the attempt ready', async (state) => {
    const db = seedAccepted()
    const { deps, calls } = fakeDeps({ get: async () => ({ state, error: 'provider says ' + state }) })
    const r = await reconcileAcceptedProviderJob(db.admin, 'ra1', deps)
    expect(r).toMatchObject({ ok: true, outcome: 'attention' })
    expect(calls.persist).toHaveLength(0)
    expect(attemptOf(db).image_url).toBeNull()
    expect(attemptOf(db).ready_at).toBeNull()
    expect(jobOf(db).status).toBe('attention_required')
  })

  it('a Cloudinary persist failure leaves the attempt non-ready and never stores the ephemeral URL', async () => {
    const db = seedAccepted()
    const { deps, calls } = fakeDeps({ persist: async () => null })
    const r = await reconcileAcceptedProviderJob(db.admin, 'ra1', deps)
    expect(r).toMatchObject({ ok: true, outcome: 'attention' })
    expect(calls.fidelity).toHaveLength(0) // never check an ephemeral URL
    expect(attemptOf(db).image_url).toBeNull()
    expect(attemptOf(db).ready_at).toBeNull()
  })
})

// ── Fidelity gates are preserved ──────────────────────────────────────────────

describe('fidelity and approval gates are preserved on recovery', () => {
  it('a conclusive first failure with corrective evidence re-queues for the explicit drain; it does NOT submit here', async () => {
    const db = seedAccepted()
    const { deps, calls } = fakeDeps({ fidelity: async () => FAILED_WITH_NOTES })
    const r = await reconcileAcceptedProviderJob(db.admin, 'ra1', deps)
    expect(r).toMatchObject({ ok: true, outcome: 'corrective_retry_authorized' })
    // The recovered durable image is kept; the job is re-queued for the one
    // corrective attempt under the unchanged policy — no submission happens here.
    expect(attemptOf(db).image_url).toBe(DURABLE)
    expect(jobOf(db).status).toBe('queued')
    expect(jobOf(db).generation_count).toBe(1)
  })

  it('an unavailable fidelity check fails closed, persists no conclusive check, and leaves the recovered image for a later re-check', async () => {
    const db = seedAccepted()
    const { deps } = fakeDeps({ fidelity: async () => UNAVAILABLE })
    const r = await reconcileAcceptedProviderJob(db.admin, 'ra1', deps)
    expect(r).toMatchObject({ ok: true, outcome: 'attention' })
    expect(attemptOf(db).image_url).toBe(DURABLE) // durable image recovered and kept
    expect(attemptOf(db).ready_at).toBeNull()
    expect(attemptOf(db).fidelity_check_id).toBeNull() // nothing conclusive persisted
    expect(jobOf(db).status).toBe('attention_required')
  })

  it('a withdrawn approval blocks readiness even when the recovered image passes fidelity', async () => {
    const db = seedAccepted({
      events: [
        { review_event_id: 'e1', candidate_version_id: 'v1', action: 'decide', decision: 'yes', reason_code: null, candidate_item_id: null, note: null, reverses_event_id: null, reviewer_user_id: 'a', idempotency_key: 'k1', created_at: '2026-01-01T00:00:01.000Z' },
        { review_event_id: 'e2', candidate_version_id: 'v1', action: 'withdraw', decision: null, reason_code: null, candidate_item_id: null, note: null, reverses_event_id: 'e1', reviewer_user_id: 'a', idempotency_key: 'k2', created_at: '2026-01-01T00:00:03.000Z' },
      ],
    })
    const { deps } = fakeDeps()
    const r = await reconcileAcceptedProviderJob(db.admin, 'ra1', deps)
    expect(r).toMatchObject({ ok: true, outcome: 'cancelled' })
    expect(attemptOf(db).ready_at).toBeNull()
    expect(db.tables.outfit[0].image_url).not.toBe(DURABLE)
  })
})
