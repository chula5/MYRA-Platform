// VAL-RENDER-008 — the Quality Lab is composition-only: every Quality-Lab-specific
// render, reconcile, fidelity, regeneration, Accepted Images, and image-promotion
// server action fails closed on direct invocation, before any provider, storage,
// or database dependency is touched.
//
// Two complementary proofs:
//   1. Behavioural — every render-family export of gallery-actions.gated returns
//      the shared fail-closed result, under BOTH a denied and an authorized
//      session, and no implementation / Supabase / provider spy is ever called.
//   2. Structural — the gated module imports NONE of the render, storage, or
//      database dependency modules, so there is no wiring by which a provider,
//      storage, or database side effect could occur.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  QUALITY_LAB_RENDERING_DISABLED_CODE,
  qualityLabRenderingDisabled,
} from '@/lib/outfit-quality/render-disabled'

// Any session at all — a denied one AND an authorized one must both fail closed.
const session = vi.hoisted(() => ({ ok: true, userId: '22222222-aaaa-4bbb-8ccc-dddddddddddd' as string | null }))

vi.mock('@/lib/admin-audit', () => ({
  assertAdmin: vi.fn(async () => {
    if (!session.ok) throw new Error('Not authorised')
  }),
  requireAdminUser: vi.fn(async () => ({ ok: session.ok, userId: session.userId })),
}))

// Every provider / storage / database dependency a render path could reach is a
// throwing spy: reaching ANY of them is a fail-open regression.
const deps = vi.hoisted(() => ({
  from: vi.fn(() => {
    throw new Error('database must not be touched by a disabled render action')
  }),
  drainQualityRenderQueue: vi.fn(async () => {
    throw new Error('render worker must not run')
  }),
  realQualityRenderAdapters: vi.fn(() => {
    throw new Error('render adapters must not be constructed')
  }),
  loadAcceptedImages: vi.fn(async () => {
    throw new Error('gallery must not be read')
  }),
  loadRemovedImages: vi.fn(async () => {
    throw new Error('gallery must not be read')
  }),
  loadRenderAttention: vi.fn(async () => {
    throw new Error('gallery must not be read')
  }),
  loadRenderQueueCounts: vi.fn(async () => {
    throw new Error('gallery must not be read')
  }),
  markNotGoodEnough: vi.fn(async () => {
    throw new Error('gallery override must not run')
  }),
  regenerateRenderCycle: vi.fn(async () => {
    throw new Error('regeneration must not run')
  }),
  withdrawUnderlyingOutfit: vi.fn(async () => {
    throw new Error('gallery withdrawal must not run')
  }),
  recheckPersistedAttemptFidelity: vi.fn(async () => {
    throw new Error('fidelity recheck must not run')
  }),
  reconcileAcceptedProviderJob: vi.fn(async () => {
    throw new Error('provider-job reconcile must not run')
  }),
}))

vi.mock('@/lib/supabase-server', () => ({
  createAdminClient: () => ({ from: deps.from }),
  createServerClient: vi.fn(),
}))
vi.mock('@/lib/outfit-quality/render-worker', () => ({
  drainQualityRenderQueue: deps.drainQualityRenderQueue,
  realQualityRenderAdapters: deps.realQualityRenderAdapters,
}))
vi.mock('@/lib/outfit-quality/gallery', () => ({
  loadAcceptedImages: deps.loadAcceptedImages,
  loadRemovedImages: deps.loadRemovedImages,
  loadRenderAttention: deps.loadRenderAttention,
  loadRenderQueueCounts: deps.loadRenderQueueCounts,
  markNotGoodEnough: deps.markNotGoodEnough,
  regenerateRenderCycle: deps.regenerateRenderCycle,
  withdrawUnderlyingOutfit: deps.withdrawUnderlyingOutfit,
}))
vi.mock('@/lib/outfit-quality/fidelity-recheck', () => ({
  recheckPersistedAttemptFidelity: deps.recheckPersistedAttemptFidelity,
}))
vi.mock('@/lib/outfit-quality/provider-job-reconcile', () => ({
  reconcileAcceptedProviderJob: deps.reconcileAcceptedProviderJob,
}))

import * as gallery from '@/app/admin/private-stylist/quality/gallery-actions.gated'

const UUID = '0a69d798-82f7-4afc-b847-97695735bb16'

// Every render-family export and a representative direct-call argument list.
const RENDER_FAMILY_CALLS: Array<[string, () => Promise<unknown>]> = [
  ['loadAcceptedImagesAction', () => gallery.loadAcceptedImagesAction()],
  ['loadRemovedImagesAction', () => gallery.loadRemovedImagesAction()],
  ['loadRenderAttentionAction', () => gallery.loadRenderAttentionAction()],
  ['loadRenderQueueCountsAction', () => gallery.loadRenderQueueCountsAction()],
  ['markNotGoodEnoughAction', () => gallery.markNotGoodEnoughAction('ra1', { reason: 'image_quality', idempotencyKey: UUID })],
  ['regenerateRenderCycleAction', () => gallery.regenerateRenderCycleAction('ra1', { idempotencyKey: UUID })],
  ['withdrawUnderlyingOutfitAction', () => gallery.withdrawUnderlyingOutfitAction('ra1', { idempotencyKey: UUID })],
  ['drainQualityRendersAction', () => gallery.drainQualityRendersAction({ maxJobs: 1 })],
  ['recheckRenderFidelityAction', () => gallery.recheckRenderFidelityAction('ra1')],
  ['reconcileAcceptedProviderJobAction', () => gallery.reconcileAcceptedProviderJobAction('ra1')],
]

function allDepSpies() {
  return Object.values(deps)
}

describe('Quality Lab render-family server actions fail closed (VAL-RENDER-008)', () => {
  beforeEach(() => {
    for (const spy of allDepSpies()) spy.mockClear()
  })

  for (const authorized of [false, true]) {
    it(`every render-family action fails closed (${authorized ? 'authorized' : 'denied'} session) with zero dependency calls`, async () => {
      session.ok = authorized
      session.userId = authorized ? '22222222-aaaa-4bbb-8ccc-dddddddddddd' : null
      for (const [name, call] of RENDER_FAMILY_CALLS) {
        const result = (await call()) as { ok?: boolean; disabled?: boolean; code?: string }
        expect(result, `${name} returns a result`).toBeTruthy()
        expect(result.ok, `${name} is not ok`).toBe(false)
        expect(result.code, `${name} reports the disabled code`).toBe(QUALITY_LAB_RENDERING_DISABLED_CODE)
        expect(result).toEqual(qualityLabRenderingDisabled())
      }
      for (const spy of allDepSpies()) {
        expect(spy, 'no provider/storage/database dependency was reached').not.toHaveBeenCalled()
      }
    })
  }

  it('the gated module wires in no render, storage, or database dependency', () => {
    const src = readFileSync(
      resolve(process.cwd(), 'src/app/admin/private-stylist/quality/gallery-actions.gated.ts'),
      'utf8',
    )
    // None of these dependency modules may be imported — their absence is the
    // structural guarantee that no side effect can occur.
    for (const forbidden of [
      '@/lib/outfit-quality/render-worker',
      '@/lib/outfit-quality/gallery',
      '@/lib/outfit-quality/fidelity-recheck',
      '@/lib/outfit-quality/provider-job-reconcile',
      '@/lib/supabase-server',
    ]) {
      expect(src, `gallery-actions.gated must not import ${forbidden}`).not.toContain(forbidden)
    }
    // It fails closed through the shared switch.
    expect(src).toContain('render-disabled')
  })
})
