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
