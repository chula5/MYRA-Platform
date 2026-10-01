'use server'

// Browser-callable surface of the Outfit Quality Batches view — admin only.
// Every export checks the admin via assertAdmin() before any service-role work,
// matching the existing gated-wrapper convention. Reviewer/actor identity comes
// from the verified session, never from request input.

import { assertAdmin, requireAdminUser } from '@/lib/admin-audit'
import {
  createBatch,
  startBatch,
  pauseBatch,
  resumeBatch,
  generateChunk,
  type CreateBatchArgs,
} from '@/lib/outfit-quality/batch-store'
import {
  listStylists,
  listRealMembers,
  listEvaluationProfiles,
  previewStylistRulesOnly,
  listBatches,
  listBatchCandidates,
  type BatchView,
  type StylistOption,
  type RealMemberOption,
  type EvaluationProfileOption,
} from '@/lib/outfit-quality/batch-read'
import type { PreDecisionCandidate } from '@/lib/outfit-quality/queue-read-model'

export interface QualityData {
  stylists: StylistOption[]
  members: RealMemberOption[]
  profiles: EvaluationProfileOption[]
  batches: BatchView[]
}

export async function loadQualityData(): Promise<QualityData> {
  await assertAdmin()
  const [stylists, members, profiles, batches] = await Promise.all([
    listStylists(),
    listRealMembers(),
    listEvaluationProfiles(),
    listBatches(),
  ])
  return { stylists, members, profiles, batches }
}

export async function previewStylist(stylistId: string) {
  await assertAdmin()
  if (!stylistId) return { error: 'select a stylist' }
  return previewStylistRulesOnly(stylistId)
}

export async function createQualityBatch(input: CreateBatchArgs) {
  const { ok, userId } = await requireAdminUser()
  if (!ok) throw new Error('Not authorised')
  const res = await createBatch({ ...input, createdBy: userId })
  if (!res.ok) return { error: res.message ?? res.code ?? 'create failed' }
  return { batchId: res.batchId }
}

export async function startQualityBatch(batchId: string) {
  await assertAdmin()
  const res = await startBatch(batchId)
  if (!res.ok) return { error: res.message ?? res.code ?? 'start failed' }
  return { ok: true }
}

export async function pauseQualityBatch(batchId: string) {
  await assertAdmin()
  const res = await pauseBatch(batchId)
  if (!res.ok) return { error: res.message ?? res.code ?? 'pause failed' }
  return { ok: true }
}

export async function resumeQualityBatch(batchId: string) {
  await assertAdmin()
  const res = await resumeBatch(batchId)
  if (!res.ok) return { error: res.message ?? res.code ?? 'resume failed' }
  return { ok: true }
}

export async function generateQualityChunk(batchId: string, requested: number) {
  await assertAdmin()
  const res = await generateChunk({ batchId, requested })
  if (!res.ok) return { error: res.message ?? res.code ?? 'generation failed' }
  return res
}

export async function loadBatchCandidates(batchId: string): Promise<PreDecisionCandidate[]> {
  await assertAdmin()
  return listBatchCandidates(batchId)
}
