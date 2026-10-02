// VAL-SEC-001 — every Quality Lab browser surface is admin-only.
//
// Parameterized proof over EVERY export of EVERY gated Quality Lab module
// (batches, review, gallery/render, coverage): a denied session rejects before
// any implementation or database mock is touched, and an authorized session
// reaches the implementation with the VERIFIED actor identity. A forged actor
// id smuggled in request input is ignored — the persisted event is stamped
// from the verified session only (proven against the real review store with
// the in-memory adapter in learning-projection.test.ts::forged-actor).

import { describe, it, expect, vi, beforeEach } from 'vitest'

// The session the admin gate will observe; flipped per test.
const session = vi.hoisted(() => ({ ok: false, userId: null as string | null }))
const VERIFIED = '22222222-aaaa-4bbb-8ccc-dddddddddddd'

vi.mock('@/lib/admin-audit', () => ({
  assertAdmin: async () => {
    if (!session.ok) throw new Error('Not authorised')
  },
  requireAdminUser: async () => ({ ok: session.ok, userId: session.userId }),
}))

// Every implementation module behind the gated wrappers is a spy: a denied
// call must leave all of them untouched.
const impl = vi.hoisted(() => ({
  createBatch: vi.fn(async () => ({ ok: true, batchId: 'b' })),
  startBatch: vi.fn(async () => ({ ok: true })),
  pauseBatch: vi.fn(async () => ({ ok: true })),
  resumeBatch: vi.fn(async () => ({ ok: true })),
  generateChunk: vi.fn(async () => ({ ok: true })),
  listStylists: vi.fn(async () => []),
  listRealMembers: vi.fn(async () => []),
  listEvaluationProfiles: vi.fn(async () => []),
  previewStylistRulesOnly: vi.fn(async () => ({})),
  listBatches: vi.fn(async () => []),
  listBatchCandidates: vi.fn(async () => []),
  editCandidateVersion: vi.fn(async () => ({ ok: true })),
  decideCandidate: vi.fn(async () => ({ ok: true })),
  undoCandidateDecision: vi.fn(async () => ({ ok: true })),
  withdrawCandidateApproval: vi.fn(async () => ({ ok: true })),
  holdCandidate: vi.fn(async () => ({ ok: true })),
  releaseCandidate: vi.fn(async () => ({ ok: true })),
  loadMachineResult: vi.fn(async () => ({ revealed: false })),
  loadReviewQueue: vi.fn(async () => []),
  loadCaseHistory: vi.fn(async () => []),
  loadAcceptedImages: vi.fn(async () => []),
  loadRemovedImages: vi.fn(async () => []),
  loadRenderAttention: vi.fn(async () => []),
  loadRenderQueueCounts: vi.fn(async () => ({})),
  markNotGoodEnough: vi.fn(async () => ({ ok: true })),
  regenerateRenderCycle: vi.fn(async () => ({ ok: true })),
  withdrawUnderlyingOutfit: vi.fn(async () => ({ ok: true })),
  drainQualityRenderQueue: vi.fn(async () => ({ claimed: 0 })),
  realQualityRenderAdapters: vi.fn(() => ({ rendererAvailable: () => false })),
  loadCoverageReport: vi.fn(async () => ({ blocks: [] })),
}))

vi.mock('@/lib/outfit-quality/batch-store', () => ({
  createBatch: impl.createBatch,
  startBatch: impl.startBatch,
  pauseBatch: impl.pauseBatch,
  resumeBatch: impl.resumeBatch,
  generateChunk: impl.generateChunk,
}))
vi.mock('@/lib/outfit-quality/batch-read', () => ({
  listStylists: impl.listStylists,
  listRealMembers: impl.listRealMembers,
  listEvaluationProfiles: impl.listEvaluationProfiles,
  previewStylistRulesOnly: impl.previewStylistRulesOnly,
  listBatches: impl.listBatches,
  listBatchCandidates: impl.listBatchCandidates,
}))
vi.mock('@/lib/outfit-quality/candidate-store', () => ({ editCandidateVersion: impl.editCandidateVersion }))
vi.mock('@/lib/outfit-quality/review-store', () => ({
  decideCandidate: impl.decideCandidate,
  undoCandidateDecision: impl.undoCandidateDecision,
  withdrawCandidateApproval: impl.withdrawCandidateApproval,
  holdCandidate: impl.holdCandidate,
  releaseCandidate: impl.releaseCandidate,
  loadMachineResult: impl.loadMachineResult,
}))
vi.mock('@/lib/outfit-quality/review-read', () => ({
  loadReviewQueue: impl.loadReviewQueue,
  loadCaseHistory: impl.loadCaseHistory,
}))
vi.mock('@/lib/outfit-quality/gallery', () => ({
  loadAcceptedImages: impl.loadAcceptedImages,
  loadRemovedImages: impl.loadRemovedImages,
  loadRenderAttention: impl.loadRenderAttention,
  loadRenderQueueCounts: impl.loadRenderQueueCounts,
  markNotGoodEnough: impl.markNotGoodEnough,
  regenerateRenderCycle: impl.regenerateRenderCycle,
  withdrawUnderlyingOutfit: impl.withdrawUnderlyingOutfit,
}))
vi.mock('@/lib/outfit-quality/render-worker', () => ({
  drainQualityRenderQueue: impl.drainQualityRenderQueue,
  realQualityRenderAdapters: impl.realQualityRenderAdapters,
}))
vi.mock('@/lib/outfit-quality/coverage-read', () => ({ loadCoverageReport: impl.loadCoverageReport }))
vi.mock('@/lib/supabase-server', () => ({
  createAdminClient: () => ({ from: () => { throw new Error('service role must not be reached in these tests') } }),
  createServerClient: vi.fn(),
}))

import * as batchActions from '@/app/admin/private-stylist/quality/actions.gated'
import * as reviewActions from '@/app/admin/private-stylist/quality/review-actions.gated'
import * as galleryActions from '@/app/admin/private-stylist/quality/gallery-actions.gated'
import * as coverageActions from '@/app/admin/private-stylist/quality/coverage-actions.gated'

const GATED_MODULES = [
  ['batches (actions.gated)', batchActions],
  ['review (review-actions.gated)', reviewActions],
  ['gallery/render (gallery-actions.gated)', galleryActions],
  ['coverage (coverage-actions.gated)', coverageActions],
] as const

const UUID = '0a69d798-82f7-4afc-b847-97695735bb16'

function allSpies() {
  return Object.values(impl)
}

describe('Quality Lab gated surfaces are admin-only (VAL-SEC-001)', () => {
  beforeEach(() => {
    for (const spy of allSpies()) spy.mockClear()
  })

  for (const [name, mod] of GATED_MODULES) {
    it(`${name}: every export rejects a denied session and touches no implementation`, async () => {
      session.ok = false
      session.userId = null
      const exports = Object.entries(mod).filter(([, v]) => typeof v === 'function')
      expect(exports.length, `${name} exposes at least one action`).toBeGreaterThan(0)
      for (const [exportName, fn] of exports) {
        let rejected = false
        try {
          // Generic plausible arguments; denial must happen before they matter.
          await (fn as any)('v1', { idempotencyKey: UUID, decision: 'yes', reason: 'x' })
        } catch (e) {
          rejected = e instanceof Error && /not authorised/i.test(e.message)
        }
        expect(rejected, `${name}.${exportName} must reject a denied session`).toBe(true)
      }
      for (const spy of allSpies()) {
        expect(spy, `${name} reached an implementation without authorization`).not.toHaveBeenCalled()
      }
    })
  }

  it('an authorized session reaches the implementation with the VERIFIED actor, ignoring forged input identity', async () => {
    session.ok = true
    session.userId = VERIFIED
    await reviewActions.decideCandidateAction('v1', {
      decision: 'yes',
      idempotencyKey: UUID,
      // Forged identity fields a hostile client might add — the wrapper must
      // never forward them as the actor.
      reviewer_user_id: 'mallory',
      userId: 'mallory',
      actor: { userId: 'mallory' },
    } as any)
    expect(impl.decideCandidate).toHaveBeenCalledTimes(1)
    const decideArgs = impl.decideCandidate.mock.calls[0] as unknown[]
    const actor = decideArgs[2]
    expect(actor).toEqual({ userId: VERIFIED })
    expect(JSON.stringify(actor)).not.toContain('mallory')

    await reviewActions.undoCandidateDecisionAction('v1', { idempotencyKey: UUID })
    expect((impl.undoCandidateDecision.mock.calls[0] as unknown[])[2]).toEqual({ userId: VERIFIED })
    await galleryActions.markNotGoodEnoughAction('ra1', { reason: 'image_quality', idempotencyKey: UUID })
    expect((impl.markNotGoodEnough.mock.calls[0] as unknown[])[3]).toEqual({ userId: VERIFIED })
    await galleryActions.regenerateRenderCycleAction('ra1', { idempotencyKey: UUID })
    expect((impl.regenerateRenderCycle.mock.calls[0] as unknown[])[3]).toEqual({ userId: VERIFIED })
    await galleryActions.withdrawUnderlyingOutfitAction('ra1', { idempotencyKey: UUID })
    expect((impl.withdrawUnderlyingOutfit.mock.calls[0] as unknown[])[3]).toEqual({ userId: VERIFIED })
  })

  it('read-only Quality Lab surfaces (queue, history, machine result, gallery, coverage) are also gated', async () => {
    session.ok = false
    await expect(batchActions.loadQualityData()).rejects.toThrow(/not authorised/i)
    await expect(batchActions.loadBatchCandidates('b1')).rejects.toThrow(/not authorised/i)
    await expect(reviewActions.loadReviewQueueAction({})).rejects.toThrow(/not authorised/i)
    await expect(reviewActions.loadCaseHistoryAction('c1')).rejects.toThrow(/not authorised/i)
    await expect(reviewActions.loadMachineResultAction('v1')).rejects.toThrow(/not authorised/i)
    await expect(galleryActions.loadAcceptedImagesAction()).rejects.toThrow(/not authorised/i)
    await expect(galleryActions.loadRemovedImagesAction()).rejects.toThrow(/not authorised/i)
    await expect(galleryActions.loadRenderAttentionAction()).rejects.toThrow(/not authorised/i)
    await expect(galleryActions.loadRenderQueueCountsAction()).rejects.toThrow(/not authorised/i)
    await expect(coverageActions.loadCoverageAction()).rejects.toThrow(/not authorised/i)
    for (const spy of allSpies()) expect(spy).not.toHaveBeenCalled()

    session.ok = true
    session.userId = VERIFIED
    await coverageActions.loadCoverageAction()
    expect(impl.loadCoverageReport).toHaveBeenCalledTimes(1)
    await reviewActions.loadReviewQueueAction({})
    expect(impl.loadReviewQueue).toHaveBeenCalledTimes(1)
  })

  it('the admin layout itself requires the verified admin user for every /admin page', async () => {
    const { readFileSync } = await import('node:fs')
    const layout = readFileSync(require('node:path').resolve(process.cwd(), 'src/app/admin/layout.tsx'), 'utf8')
    expect(layout).toContain('process.env.ADMIN_USER_ID')
    expect(layout).toContain("redirect('/')")
  })
})
