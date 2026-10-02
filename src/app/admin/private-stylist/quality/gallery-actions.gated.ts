'use server'

// Composition-only release: the Outfit Quality Lab render family is DISABLED.
//
// Every export below is a Quality-Lab-specific render, reconcile, fidelity,
// regeneration, Accepted Images, or generated-image promotion boundary. In this
// release they all fail closed: each returns `qualityLabRenderingDisabled()`
// immediately, before any admin check, provider call, Cloudinary/storage write,
// or database access. This module therefore imports NO render worker, gallery,
// fidelity, provider-reconcile, Supabase, or admin dependency — a direct call
// has no wiring by which it could submit, poll, recover, or reconcile a provider
// job, or write a row.
//
// The restriction is narrow: it governs the Quality Lab only. Shared Higgsfield
// infrastructure and every non-Quality-Lab admin render surface are untouched.
// The underlying Quality Lab render modules remain in the tree as superseded
// history; nothing browser-callable reaches them.

import { qualityLabRenderingDisabled } from '@/lib/outfit-quality/render-disabled'

export async function loadAcceptedImagesAction() {
  return qualityLabRenderingDisabled()
}

export async function loadRemovedImagesAction() {
  return qualityLabRenderingDisabled()
}

export async function loadRenderAttentionAction() {
  return qualityLabRenderingDisabled()
}

export async function loadRenderQueueCountsAction() {
  return qualityLabRenderingDisabled()
}

export async function markNotGoodEnoughAction(
  _renderAttemptId: string,
  _input: { reason: string; note?: string | null; idempotencyKey: string },
) {
  return qualityLabRenderingDisabled()
}

export async function regenerateRenderCycleAction(_renderAttemptId: string, _input: { idempotencyKey: string }) {
  return qualityLabRenderingDisabled()
}

export async function withdrawUnderlyingOutfitAction(
  _renderAttemptId: string,
  _input: { idempotencyKey: string; note?: string | null },
) {
  return qualityLabRenderingDisabled()
}

export async function drainQualityRendersAction(_input?: { maxJobs?: number }) {
  return qualityLabRenderingDisabled()
}

export async function recheckRenderFidelityAction(_renderAttemptId: string) {
  return qualityLabRenderingDisabled()
}

export async function reconcileAcceptedProviderJobAction(_renderAttemptId: string) {
  return qualityLabRenderingDisabled()
}
