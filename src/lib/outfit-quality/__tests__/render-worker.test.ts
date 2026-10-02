// The approval-gated Quality Lab render worker against the in-memory fake and
// deterministic adapters. Covers: exact-version approval gate (VAL-RENDER-001),
// idempotent claims/attempts (VAL-RENDER-002), frozen manifest + explicit local
// sequential drain (VAL-RENDER-003), the one-corrective-retry budget
// (VAL-RENDER-005), and fail-closed checker/persistence errors (VAL-RENDER-006).
// No real Higgsfield call happens anywhere in this file.

import { describe, it, expect } from 'vitest'
import {
  drainQualityRenderQueue,
  claimNextQualityRenderJob,
  recoverStaleLeases,
  verifyRenderableApproval,
  type RenderAdapters,
} from '@/lib/outfit-quality/render-worker'
import { createFakeAdmin, type FakeAdmin } from './fake-admin'
import type { StrictFidelityResult } from '@/lib/outfit-quality/fidelity'

const STYLIST = '0d535772-8a4f-440f-9e46-f8d637bed0d3'
const STALE = new Date(Date.now() - 60 * 60_000).toISOString() // 1h ago

interface SeedOpts {
  events?: any[]
  jobs?: any[]
  attempts?: any[]
  checks?: any[]
  casePointer?: string
  versionState?: string
  promotions?: any[]
}

function seedWorld(opts: SeedOpts = {}): FakeAdmin {
  return createFakeAdmin({
    outfit_quality_candidate_version: [
      { candidate_version_id: 'v1', case_id: 'c1', version_no: 1, state: opts.versionState ?? 'approved', created_at: '2026-01-01T00:00:00.000Z' },
    ],
    outfit_quality_case: [
      { case_id: 'c1', current_version_id: opts.casePointer ?? 'v1', selected_stylist_id: STYLIST, stylist_snapshot_id: 'snap-1', status: 'approved', data_partition: 'test' },
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
    outfit_quality_machine_check:
      opts.checks === undefined
        ? [
            { check_id: 'chk-obj', candidate_version_id: 'v1', kind: 'objective', check_name: 'required_source_images', status: 'passed', attempt: 1, idempotency_key: 'v1:objective:required_source_images' },
          ]
        : opts.checks,
    outfit_quality_render_job: (opts.jobs === undefined
      ? [{ render_job_id: 'j1', candidate_version_id: 'v1', approval_event_id: 'e1', cycle_no: 1, status: 'queued', created_at: '2026-01-01T00:00:02.000Z' }]
      : opts.jobs
    ).map((j: any) => ({ lease_token: null, leased_at: null, worker_id: null, generation_count: 0, last_error: null, promotion_id: null, ...j })),
    outfit_quality_render_attempt: opts.attempts ?? [],
    outfit_quality_promotion: opts.promotions ?? [{ promotion_id: 'p1', candidate_version_id: 'v1', outfit_id: 'o1', status: 'active' }],
    outfit: [{ outfit_id: 'o1', image_url: 'https://res.cloudinary.com/x/top.jpg', status: 'draft', stylist_id: STYLIST, published_at: null }],
    outfit_item: [],
    // Trap tables: the worker must never read mutable sources.
    item: [{ item_id: 'i1', image_url: 'https://MUTATED.example/changed.jpg' }],
    stylist: [{ stylist_id: STYLIST, name: 'Chloe' }],
  })
}

interface FakeAdapterCalls {
  generate: { prompt: string; refs: string[]; publicId: string }[]
  persist: { url: string; publicId: string }[]
  fidelity: { url: string; items: { label: string; image_url: string }[] }[]
}

function fakeAdapters(behaviour: {
  generate?: (call: { prompt: string; refs: string[]; publicId: string }, n: number) => Promise<{ submitted: boolean; imageUrl?: string; error?: string; providerJobId?: string; retrievalFailed?: boolean }>
  persist?: (url: string, publicId: string) => Promise<string | null>
  fidelity?: (url: string, n: number) => Promise<StrictFidelityResult>
  available?: boolean
} = {}): { adapters: RenderAdapters; calls: FakeAdapterCalls } {
  const calls: FakeAdapterCalls = { generate: [], persist: [], fidelity: [] }
  const passed: StrictFidelityResult = { status: 'passed', score: 0.9, issues: [], correctiveNotes: null, detail: null, model: 'claude-opus-4-6' }
  return {
    calls,
    adapters: {
      rendererAvailable: () => behaviour.available ?? true,
      generate: async (prompt, refs, publicId) => {
        calls.generate.push({ prompt, refs, publicId })
        if (behaviour.generate) return behaviour.generate({ prompt, refs, publicId }, calls.generate.length)
        return { submitted: true, imageUrl: 'https://cdn.higgsfield.example/ephemeral.png' }
      },
      persist: async (url, opts) => {
        calls.persist.push({ url, publicId: opts.publicId })
        if (behaviour.persist) return behaviour.persist(url, opts.publicId)
        return `https://res.cloudinary.com/x/quality-lab-renders/${opts.publicId}.png`
      },
      checkFidelity: async (url, items) => {
        calls.fidelity.push({ url, items })
        if (behaviour.fidelity) return behaviour.fidelity(url, calls.fidelity.length)
        return passed
      },
    },
  }
}

const WORKER = { workerId: 'local-test-worker' }

// ── The approval gate (VAL-RENDER-001) ────────────────────────────────────────

describe('the exact-version approval gate', () => {
  it('a current unreversed Yes for the exact version passes', async () => {
    const db = seedWorld()
    const r = await verifyRenderableApproval(db.admin, 'v1', 'e1')
    expect(r.ok).toBe(true)
  })

  it('no human decision → not renderable', async () => {
    const db = seedWorld({ events: [], jobs: [] })
    const r = await verifyRenderableApproval(db.admin, 'v1')
    expect(r).toMatchObject({ ok: false, code: 'no_active_approval' })
  })

  it('a parent approval does not authorize a child version', async () => {
    const db = seedWorld({ casePointer: 'v2-child' })
    const r = await verifyRenderableApproval(db.admin, 'v1', 'e1')
    expect(r).toMatchObject({ ok: false, code: 'stale_version' })
  })

  it('the job’s approval event must BE the current active approval', async () => {
    const db = seedWorld()
    const r = await verifyRenderableApproval(db.admin, 'v1', 'e-old')
    expect(r).toMatchObject({ ok: false, code: 'approval_mismatch' })
  })

  it('a withdrawn approval fails the gate', async () => {
    const db = seedWorld({
      events: [
        { review_event_id: 'e1', candidate_version_id: 'v1', action: 'decide', decision: 'yes', reason_code: null, candidate_item_id: null, note: null, reverses_event_id: null, reviewer_user_id: 'a', idempotency_key: 'k1', created_at: '2026-01-01T00:00:01.000Z' },
        { review_event_id: 'e2', candidate_version_id: 'v1', action: 'withdraw', decision: null, reason_code: null, candidate_item_id: null, note: null, reverses_event_id: 'e1', reviewer_user_id: 'a', idempotency_key: 'k2', created_at: '2026-01-01T00:00:02.000Z' },
      ],
    })
    const r = await verifyRenderableApproval(db.admin, 'v1', 'e1')
    expect(r).toMatchObject({ ok: false, code: 'no_active_approval' })
  })

  it('an objective failure fails the gate even with a Yes', async () => {
    const db = seedWorld({
      checks: [{ check_id: 'chk-obj', candidate_version_id: 'v1', kind: 'objective', check_name: 'required_source_images', status: 'failed', attempt: 1, idempotency_key: 'x' }],
    })
    const r = await verifyRenderableApproval(db.admin, 'v1', 'e1')
    expect(r).toMatchObject({ ok: false, code: 'objective_not_passed' })
  })

  it('an incomplete frozen manifest fails the gate', async () => {
    const db = seedWorld()
    db.tables.outfit_quality_candidate_item[1].source_image_url = ''
    const r = await verifyRenderableApproval(db.admin, 'v1', 'e1')
    expect(r).toMatchObject({ ok: false, code: 'incomplete_manifest' })
  })
})

// ── Claims, leases, recovery (VAL-RENDER-002) ─────────────────────────────────

describe('claims and leases', () => {
  it('a queued job without approval is never claimed — it is cancelled unleashed and the renderer is never called', async () => {
    const db = seedWorld({ events: [] })
    const { adapters, calls } = fakeAdapters()
    const r = await drainQualityRenderQueue(db.admin, { ...WORKER, adapters })
    expect(r.claimed).toBe(0)
    expect(calls.generate).toHaveLength(0)
    const job = db.tables.outfit_quality_render_job[0]
    expect(job.status).toBe('cancelled')
    expect(job.lease_token).toBeNull()
  })

  it('one claim has one owner; a second claimant gets nothing while the lease stands', async () => {
    const db = seedWorld()
    const first = await claimNextQualityRenderJob(db.admin, 'worker-a')
    expect(first?.render_job_id).toBe('j1')
    expect(first?.lease_token).toBeTruthy()
    const second = await claimNextQualityRenderJob(db.admin, 'worker-b')
    expect(second).toBeNull()
  })

  it('an expired UNSUBMITTED lease returns to queued without incrementing the generation count', async () => {
    const db = seedWorld({
      jobs: [{ render_job_id: 'j1', candidate_version_id: 'v1', approval_event_id: 'e1', cycle_no: 1, status: 'running', lease_token: 'old', leased_at: STALE, worker_id: 'dead', generation_count: 0, created_at: '2026-01-01T00:00:02.000Z' }],
    })
    const r = await recoverStaleLeases(db.admin)
    expect(r.requeued).toBe(1)
    const job = db.tables.outfit_quality_render_job[0]
    expect(job).toMatchObject({ status: 'queued', lease_token: null, generation_count: 0 })
  })

  it('an expired lease AFTER a submission is not silently rerun — it requires attention', async () => {
    const db = seedWorld({
      jobs: [{ render_job_id: 'j1', candidate_version_id: 'v1', approval_event_id: 'e1', cycle_no: 1, status: 'running', lease_token: 'old', leased_at: STALE, worker_id: 'dead', generation_count: 1, created_at: '2026-01-01T00:00:02.000Z' }],
    })
    const r = await recoverStaleLeases(db.admin)
    expect(r.requeued).toBe(0)
    expect(r.attention).toBe(1)
    expect(db.tables.outfit_quality_render_job[0].status).toBe('attention_required')
  })

  it('a live lease is not recovered', async () => {
    const db = seedWorld({
      jobs: [{ render_job_id: 'j1', candidate_version_id: 'v1', approval_event_id: 'e1', cycle_no: 1, status: 'running', lease_token: 'fresh', leased_at: new Date().toISOString(), worker_id: 'alive', generation_count: 0, created_at: '2026-01-01T00:00:02.000Z' }],
    })
    const r = await recoverStaleLeases(db.admin)
    expect(r.requeued + r.attention).toBe(0)
    expect(db.tables.outfit_quality_render_job[0].status).toBe('running')
  })

  it('a replayed submitted attempt is not submitted again', async () => {
    // Attempt 1 crashed after submission+persist+fidelity but before ready:
    // reprocessing must resume from persisted state with ZERO new generate calls.
    const db = seedWorld({
      jobs: [{ render_job_id: 'j1', candidate_version_id: 'v1', approval_event_id: 'e1', cycle_no: 1, status: 'queued', generation_count: 1, created_at: '2026-01-01T00:00:02.000Z' }],
      attempts: [
        { render_attempt_id: 'ra1', render_job_id: 'j1', attempt_no: 1, prompt: 'p', generation_status: 'generated', image_url: 'https://res.cloudinary.com/x/quality-lab-renders/oq-ra1.png', cloudinary_asset: 'oq-ra1' },
      ],
      checks: [
        { check_id: 'chk-obj', candidate_version_id: 'v1', kind: 'objective', check_name: 'required_source_images', status: 'passed', attempt: 1, idempotency_key: 'v1:objective:x' },
        { check_id: 'chk-f1', candidate_version_id: 'v1', kind: 'fidelity', check_name: 'render_fidelity', status: 'passed', verdict: 'pass', score: 0.9, attempt: 1, idempotency_key: 'fidelity:ra1' },
      ],
    })
    db.tables.outfit_quality_render_attempt[0].fidelity_check_id = 'chk-f1'
    const { adapters, calls } = fakeAdapters()
    const r = await drainQualityRenderQueue(db.admin, { ...WORKER, adapters })
    expect(calls.generate).toHaveLength(0)
    expect(calls.persist).toHaveLength(0)
    expect(calls.fidelity).toHaveLength(0)
    expect(r.ready).toBe(1)
    expect(db.tables.outfit_quality_render_attempt[0].ready_at).toBeTruthy()
    expect(db.tables.outfit_quality_render_job[0].status).toBe('ready')
  })
})

// ── Frozen manifest and the explicit local drain (VAL-RENDER-003) ─────────────

describe('frozen manifest and explicit drain', () => {
  it('the renderer receives only frozen rows — mutable item/outfit/stylist tables are never read', async () => {
    const db = seedWorld()
    const { adapters, calls } = fakeAdapters()
    await drainQualityRenderQueue(db.admin, { ...WORKER, adapters })
    expect(calls.generate).toHaveLength(1)
    expect(db.queried).not.toContain('item')
    expect(db.queried).not.toContain('stylist')
    expect(db.queried).not.toContain('inspiration_image')
    // The references sent are exactly the frozen source URLs (transformed), in order.
    const refs = calls.generate[0].refs
    expect(refs.some((u) => u.includes('top'))).toBe(true)
    expect(refs.some((u) => u.includes('bottom'))).toBe(true)
    expect(refs.some((u) => u.includes('MUTATED'))).toBe(false)
    // The persisted attempt carries the frozen manifest and renderer provenance.
    const attempt = db.tables.outfit_quality_render_attempt[0]
    expect(attempt.renderer_model).toBe('seedream_v4_5')
    expect(attempt.reference_manifest.items).toHaveLength(2)
    expect(attempt.reference_manifest.items[0]).toMatchObject({ candidate_item_id: 'ci-1', slot: 'top' })
    expect(attempt.reference_manifest.stylist_snapshot_id).toBe('snap-1')
  })

  it('drains sequentially, one job per claim, only when invoked', async () => {
    const db = seedWorld({
      jobs: [
        { render_job_id: 'j1', candidate_version_id: 'v1', approval_event_id: 'e1', cycle_no: 1, status: 'queued', created_at: '2026-01-01T00:00:02.000Z' },
        { render_job_id: 'j2', candidate_version_id: 'v1', approval_event_id: 'e1', cycle_no: 2, status: 'queued', created_at: '2026-01-01T00:00:03.000Z' },
      ],
    })
    const { adapters, calls } = fakeAdapters()
    const r1 = await drainQualityRenderQueue(db.admin, { ...WORKER, adapters, maxJobs: 1 })
    expect(r1.claimed).toBe(1)
    expect(calls.generate).toHaveLength(1)
    const r2 = await drainQualityRenderQueue(db.admin, { ...WORKER, adapters, maxJobs: 1 })
    expect(r2.claimed).toBe(1)
    expect(calls.generate).toHaveLength(2)
    expect(db.tables.outfit_quality_render_job.map((j: any) => j.status)).toEqual(['ready', 'ready'])
  })

  it('without a local renderer the queue is left completely untouched', async () => {
    const db = seedWorld()
    const { adapters, calls } = fakeAdapters({ available: false })
    const r = await drainQualityRenderQueue(db.admin, { ...WORKER, adapters })
    expect(r.claimed).toBe(0)
    expect(r.skipped).toBeTruthy()
    expect(calls.generate).toHaveLength(0)
    expect(db.tables.outfit_quality_render_job[0].status).toBe('queued')
  })
})

// ── The one-corrective-retry budget (VAL-RENDER-005) ──────────────────────────

describe('fidelity retry policy', () => {
  const failWithNotes: StrictFidelityResult = { status: 'failed', score: 0.4, issues: [{ item: 'Trouser', field: 'silhouette', expected: 'wide-leg', seen: 'cargo' }], correctiveNotes: 'keep the trousers wide-leg', detail: null, model: 'm' }

  it('a clean pass: one generation, durable image, ready, promoted outfit image attached', async () => {
    const db = seedWorld()
    const { adapters, calls } = fakeAdapters()
    const r = await drainQualityRenderQueue(db.admin, { ...WORKER, adapters })
    expect(r.ready).toBe(1)
    expect(calls.generate).toHaveLength(1)
    const attempt = db.tables.outfit_quality_render_attempt[0]
    expect(attempt.attempt_no).toBe(1)
    expect(attempt.image_url).toContain('res.cloudinary.com')
    expect(attempt.ready_at).toBeTruthy()
    expect(db.tables.outfit_quality_render_job[0]).toMatchObject({ status: 'ready', generation_count: 1 })
    expect(db.tables.outfit[0].image_url).toBe(attempt.image_url)
    expect(db.tables.outfit[0].status).toBe('draft') // never auto-published
    // The fidelity result is a persisted machine_check correlated to the attempt.
    const check = db.tables.outfit_quality_machine_check.find((c: any) => c.kind === 'fidelity')
    expect(check).toMatchObject({ status: 'passed', attempt: 1 })
    expect(attempt.fidelity_check_id).toBe(check.check_id)
  })

  it('conclusive first failure with corrective evidence → exactly one corrective attempt in the same cycle', async () => {
    const db = seedWorld()
    const { adapters, calls } = fakeAdapters({
      fidelity: async (_url, n) => (n === 1 ? failWithNotes : { status: 'passed', score: 0.9, issues: [], correctiveNotes: null, detail: null, model: 'm' }),
    })
    const r = await drainQualityRenderQueue(db.admin, { ...WORKER, adapters })
    expect(r.ready).toBe(1)
    expect(calls.generate.map((_, i) => i + 1)).toEqual([1, 2])
    // Attempt 2's prompt carries the corrective evidence; attempts have distinct ids.
    expect(calls.generate[1].prompt).toContain('keep the trousers wide-leg')
    const attempts = db.tables.outfit_quality_render_attempt
    expect(attempts).toHaveLength(2)
    expect(attempts[0].attempt_no).toBe(1)
    expect(attempts[1].attempt_no).toBe(2)
    expect(attempts[0].render_attempt_id).not.toBe(attempts[1].render_attempt_id)
    expect(db.tables.outfit_quality_render_job[0]).toMatchObject({ status: 'ready', generation_count: 2 })
    // Both fidelity outcomes are persisted in order.
    const fids = db.tables.outfit_quality_machine_check.filter((c: any) => c.kind === 'fidelity')
    expect(fids.map((f: any) => f.status)).toEqual(['failed', 'passed'])
  })

  it('a second conclusive failure becomes attention_required; no attempt 3 exists', async () => {
    const db = seedWorld()
    const { adapters, calls } = fakeAdapters({ fidelity: async () => failWithNotes })
    const r = await drainQualityRenderQueue(db.admin, { ...WORKER, adapters })
    expect(r.attention).toBe(1)
    expect(calls.generate).toHaveLength(2)
    expect(db.tables.outfit_quality_render_attempt).toHaveLength(2)
    expect(db.tables.outfit_quality_render_job[0].status).toBe('attention_required')
    expect(db.tables.outfit_quality_render_attempt.every((a: any) => !a.ready_at)).toBe(true)
  })

  it('a first failure WITHOUT corrective evidence does not retry', async () => {
    const db = seedWorld()
    const { adapters, calls } = fakeAdapters({ fidelity: async () => ({ ...failWithNotes, correctiveNotes: null }) })
    const r = await drainQualityRenderQueue(db.admin, { ...WORKER, adapters })
    expect(r.attention).toBe(1)
    expect(calls.generate).toHaveLength(1)
    expect(db.tables.outfit_quality_render_attempt).toHaveLength(1)
  })
})

// ── Accepted provider-job capture and retrieval-failure (VAL-RENDER-004) ──────

describe('accepted provider-job capture and retrieval failure', () => {
  it('persists the accepted provider job id immediately after submission', async () => {
    const db = seedWorld()
    const { adapters, calls } = fakeAdapters({
      generate: async () => ({ submitted: true, providerJobId: 'prov-abc-123', imageUrl: 'https://cdn.higgsfield.example/ephemeral.png' }),
    })
    const r = await drainQualityRenderQueue(db.admin, { ...WORKER, adapters })
    expect(r.ready).toBe(1)
    expect(calls.generate).toHaveLength(1)
    const attempt = db.tables.outfit_quality_render_attempt[0]
    expect(attempt.provider_job_id).toBe('prov-abc-123')
    expect(db.tables.outfit_quality_render_job[0]).toMatchObject({ status: 'ready', generation_count: 1 })
  })

  it('a transient retrieval failure after acceptance keeps the accepted job reconcilable and never re-submits', async () => {
    const db = seedWorld()
    const { adapters, calls } = fakeAdapters({
      generate: async () => ({ submitted: true, providerJobId: 'prov-xyz-789', retrievalFailed: true, error: 'HTTP 403 while waiting for result' }),
    })
    const r = await drainQualityRenderQueue(db.admin, { ...WORKER, adapters })
    // Accepted but not retrieved: the job needs attention and is reconcilable.
    expect(r.attention).toBe(1)
    expect(calls.generate).toHaveLength(1) // exactly one create — never a duplicate
    const job = db.tables.outfit_quality_render_job[0]
    const attempt = db.tables.outfit_quality_render_attempt[0]
    // The generation WAS submitted (and may have been charged), so it is counted
    // once; the accepted provider job id is durably retained for recovery.
    expect(job).toMatchObject({ status: 'attention_required', generation_count: 1 })
    expect(attempt.provider_job_id).toBe('prov-xyz-789')
    expect(attempt.generation_status).toBe('accepted_retrieval_failed')
    expect(attempt.provider_status).toBe('retrieval_failed')
    expect(attempt.image_url).toBeNull()
    expect(attempt.ready_at).toBeNull()
  })

  it('a retrieval-failure error never carries credential values', async () => {
    const sentinel = 'SENTINEL_ANTHROPIC_KEY_789'
    const prev = process.env.ANTHROPIC_API_KEY
    process.env.ANTHROPIC_API_KEY = sentinel
    try {
      const db = seedWorld()
      const { adapters } = fakeAdapters({
        generate: async () => ({ submitted: true, providerJobId: 'prov-1', retrievalFailed: true, error: `403 for token ${sentinel}` }),
      })
      await drainQualityRenderQueue(db.admin, { ...WORKER, adapters })
      const rows = JSON.stringify([...db.tables.outfit_quality_render_job, ...db.tables.outfit_quality_render_attempt])
      expect(rows).not.toContain(sentinel)
    } finally {
      if (prev === undefined) delete process.env.ANTHROPIC_API_KEY
      else process.env.ANTHROPIC_API_KEY = prev
    }
  })
})

// ── Fail-closed errors (VAL-RENDER-006) ───────────────────────────────────────

describe('fail-closed checker and persistence errors', () => {
  it.each(['unavailable', 'error'] as const)('fidelity %s is never a pass, never ready, never retried', async (status) => {
    const db = seedWorld()
    const { adapters, calls } = fakeAdapters({
      fidelity: async () => ({ status, score: null, issues: [], correctiveNotes: null, detail: 'checker could not conclude', model: 'm' }),
    })
    const r = await drainQualityRenderQueue(db.admin, { ...WORKER, adapters })
    expect(r.attention).toBe(1)
    expect(calls.generate).toHaveLength(1) // no unsupported automatic retry
    expect(db.tables.outfit_quality_render_attempt[0].ready_at).toBeNull()
    expect(db.tables.outfit_quality_render_job[0].status).toBe('attention_required')
  })

  it('a persistence failure leaves the attempt non-ready and never stores the ephemeral URL', async () => {
    const db = seedWorld()
    const { adapters, calls } = fakeAdapters({ persist: async () => null })
    const r = await drainQualityRenderQueue(db.admin, { ...WORKER, adapters })
    expect(r.attention).toBe(1)
    const attempt = db.tables.outfit_quality_render_attempt[0]
    expect(attempt.ready_at).toBeNull()
    expect(attempt.image_url).toBeNull()
    expect(calls.fidelity).toHaveLength(0) // no fidelity check against an ephemeral URL
    expect(db.tables.outfit_quality_render_job[0].last_error).toContain('persist')
  })

  it('a pre-submission renderer failure (e.g. CLI auth missing) submits nothing and fails closed', async () => {
    const db = seedWorld()
    const { adapters, calls } = fakeAdapters({ generate: async () => ({ submitted: false, error: 'Higgsfield CLI is not logged in' }) })
    const r = await drainQualityRenderQueue(db.admin, { ...WORKER, adapters })
    expect(r.attention).toBe(1)
    expect(db.tables.outfit_quality_render_job[0].generation_count).toBe(0) // never submitted
    expect(db.tables.outfit_quality_render_attempt[0].generation_status).toBe('pre_submission_failed')
    expect(calls.persist).toHaveLength(0)
  })

  it('a submitted generation that returned no image counts the generation and requires attention', async () => {
    const db = seedWorld()
    const { adapters } = fakeAdapters({ generate: async () => ({ submitted: true, error: 'No image returned (status: failed)' }) })
    const r = await drainQualityRenderQueue(db.admin, { ...WORKER, adapters })
    expect(r.attention).toBe(1)
    expect(db.tables.outfit_quality_render_job[0].generation_count).toBe(1)
  })

  it('recorded errors never carry credential values', async () => {
    const sentinel = 'SENTINEL_CLOUDINARY_SECRET_456'
    const prev = process.env.CLOUDINARY_API_SECRET
    process.env.CLOUDINARY_API_SECRET = sentinel
    try {
      const db = seedWorld()
      const { adapters } = fakeAdapters({
        persist: async () => {
          throw new Error(`upload rejected for secret ${sentinel}`)
        },
      })
      await drainQualityRenderQueue(db.admin, { ...WORKER, adapters })
      const rows = JSON.stringify([...db.tables.outfit_quality_render_job, ...db.tables.outfit_quality_render_attempt])
      expect(rows).not.toContain(sentinel)
    } finally {
      if (prev === undefined) delete process.env.CLOUDINARY_API_SECRET
      else process.env.CLOUDINARY_API_SECRET = prev
    }
  })

  it('approval withdrawn between submission and readiness: the image is never marked ready', async () => {
    const db = seedWorld()
    const { adapters } = fakeAdapters({
      fidelity: async () => {
        // The human withdraws while the fidelity check is in flight.
        db.tables.outfit_quality_review_event.push({
          review_event_id: 'e2', candidate_version_id: 'v1', action: 'withdraw', decision: null, reason_code: null,
          candidate_item_id: null, note: null, reverses_event_id: 'e1', reviewer_user_id: 'a', idempotency_key: 'k2',
          created_at: '2026-01-01T00:00:09.000Z',
        })
        return { status: 'passed', score: 0.95, issues: [], correctiveNotes: null, detail: null, model: 'm' }
      },
    })
    const r = await drainQualityRenderQueue(db.admin, { ...WORKER, adapters })
    expect(r.ready).toBe(0)
    const attempt = db.tables.outfit_quality_render_attempt[0]
    expect(attempt.ready_at).toBeNull()
    expect(db.tables.outfit_quality_render_job[0].status).toBe('cancelled')
    // The image was generated and persisted, but never exposed as ready.
    expect(attempt.image_url).toContain('res.cloudinary.com')
    expect(db.tables.outfit[0].image_url).not.toBe(attempt.image_url)
  })
})
