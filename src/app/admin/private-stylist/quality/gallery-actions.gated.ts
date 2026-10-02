'use server'

// Browser-callable surface of the Accepted Images gallery and the local render
// drain — admin only. Every export verifies the admin session before any
// service-role work; reviewer identity comes from the verified session, never
// from client input.
//
// `drainQualityRendersAction` is the EXPLICIT operator drain: it runs at most
// the requested bounded number of jobs, sequentially, and only when the
// locally authenticated Higgsfield CLI exists in this environment. On Vercel
// (no CLI binary, no local credentials) it leaves the queue untouched, so the
// cloud can never drain Quality Lab renders.

import { assertAdmin, requireAdminUser } from '@/lib/admin-audit'
import { createAdminClient } from '@/lib/supabase-server'
import {
  loadAcceptedImages,
  loadRemovedImages,
  loadRenderAttention,
  loadRenderQueueCounts,
  markNotGoodEnough,
  regenerateRenderCycle,
  withdrawUnderlyingOutfit,
} from '@/lib/outfit-quality/gallery'
import { drainQualityRenderQueue, realQualityRenderAdapters } from '@/lib/outfit-quality/render-worker'
import { recheckPersistedAttemptFidelity } from '@/lib/outfit-quality/fidelity-recheck'
import { reconcileAcceptedProviderJob } from '@/lib/outfit-quality/provider-job-reconcile'

export async function loadAcceptedImagesAction() {
  await assertAdmin()
  return loadAcceptedImages()
}

export async function loadRemovedImagesAction() {
  await assertAdmin()
  return loadRemovedImages()
}

export async function loadRenderAttentionAction() {
  await assertAdmin()
  return loadRenderAttention()
}

export async function loadRenderQueueCountsAction() {
  await assertAdmin()
  return loadRenderQueueCounts()
}

export async function markNotGoodEnoughAction(
  renderAttemptId: string,
  input: { reason: string; note?: string | null; idempotencyKey: string },
) {
  const { ok, userId } = await requireAdminUser()
  if (!ok || !userId) throw new Error('Not authorised')
  return markNotGoodEnough(createAdminClient(), renderAttemptId, input, { userId })
}

export async function regenerateRenderCycleAction(renderAttemptId: string, input: { idempotencyKey: string }) {
  const { ok, userId } = await requireAdminUser()
  if (!ok || !userId) throw new Error('Not authorised')
  return regenerateRenderCycle(createAdminClient(), renderAttemptId, input, { userId })
}

export async function withdrawUnderlyingOutfitAction(renderAttemptId: string, input: { idempotencyKey: string; note?: string | null }) {
  const { ok, userId } = await requireAdminUser()
  if (!ok || !userId) throw new Error('Not authorised')
  return withdrawUnderlyingOutfit(createAdminClient(), renderAttemptId, input, { userId })
}

/**
 * Explicitly drain at most `maxJobs` (default 1, max 5) Quality Lab render
 * jobs, sequentially, through the local renderer. Returns per-job outcomes and
 * a `skipped` note when no local renderer exists.
 */
export async function drainQualityRendersAction(input?: { maxJobs?: number }) {
  const { ok, userId } = await requireAdminUser()
  if (!ok || !userId) throw new Error('Not authorised')
  const maxJobs = Math.min(Math.max(input?.maxJobs ?? 1, 1), 5)
  return drainQualityRenderQueue(createAdminClient(), {
    workerId: `admin-${userId.slice(0, 8)}`,
    maxJobs,
    adapters: realQualityRenderAdapters(),
  })
}

/**
 * Explicit fidelity-only re-check of ONE persisted attempt whose fidelity
 * checker was unavailable/errored while its durable Cloudinary image exists.
 * Never submits a render and never increments generation_count: the strict
 * fidelity adapter runs against the existing image, a pass marks the existing
 * attempt ready, and a conclusive failure follows the unchanged
 * corrective-retry policy. Idempotent and fail-closed.
 */
export async function recheckRenderFidelityAction(renderAttemptId: string) {
  const { ok, userId } = await requireAdminUser()
  if (!ok || !userId) throw new Error('Not authorised')
  return recheckPersistedAttemptFidelity(createAdminClient(), renderAttemptId)
}

/**
 * Reconcile ONE accepted provider job whose result wasn't retrieved at
 * submission time (e.g. a transient 403 after acceptance). Read-only recovery:
 * reads the accepted provider job, persists its completed image durably exactly
 * once, runs strict fidelity against the frozen sources, and marks the EXISTING
 * attempt ready on a conclusive pass. Never submits a render and never
 * increments generation_count. Idempotent and fail-closed.
 */
export async function reconcileAcceptedProviderJobAction(renderAttemptId: string) {
  const { ok, userId } = await requireAdminUser()
  if (!ok || !userId) throw new Error('Not authorised')
  return reconcileAcceptedProviderJob(createAdminClient(), renderAttemptId)
}
