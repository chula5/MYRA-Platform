'use server'

// Browser-callable surface of the Outfit Quality review workbench — admin only.
// Every export verifies the admin session before any service-role work, and
// every mutation takes its actor identity from that verified session. Client
// input can supply a decision, reason, note, and idempotency key — never a
// reviewer, holder, releaser, undoer, or withdrawer identity.

import { assertAdmin, requireAdminUser } from '@/lib/admin-audit'
import {
  decideCandidate,
  undoCandidateDecision,
  withdrawCandidateApproval,
  holdCandidate,
  releaseCandidate,
  loadMachineResult,
  dismissCandidate,
  restoreCandidate,
} from '@/lib/outfit-quality/review-store'
import type { DecideInput } from '@/lib/outfit-quality/review-plan'
import { loadReviewQueue, loadCaseHistory, type ReviewFilters } from '@/lib/outfit-quality/review-read'

export async function loadReviewQueueAction(filters: ReviewFilters) {
  await assertAdmin()
  return loadReviewQueue(filters)
}

export async function decideCandidateAction(candidateVersionId: string, input: DecideInput) {
  const { ok, userId } = await requireAdminUser()
  if (!ok || !userId) throw new Error('Not authorised')
  return decideCandidate(candidateVersionId, input, { userId })
}

export async function undoCandidateDecisionAction(candidateVersionId: string, input: { idempotencyKey: string }) {
  const { ok, userId } = await requireAdminUser()
  if (!ok || !userId) throw new Error('Not authorised')
  return undoCandidateDecision(candidateVersionId, input, { userId })
}

export async function withdrawCandidateApprovalAction(candidateVersionId: string, input: { idempotencyKey: string; note?: string | null }) {
  const { ok, userId } = await requireAdminUser()
  if (!ok || !userId) throw new Error('Not authorised')
  return withdrawCandidateApproval(candidateVersionId, input, { userId })
}

export async function holdCandidateAction(candidateVersionId: string, input: { reason?: string | null }) {
  const { ok, userId } = await requireAdminUser()
  if (!ok || !userId) throw new Error('Not authorised')
  return holdCandidate(candidateVersionId, input, { userId })
}

export async function releaseCandidateAction(candidateVersionId: string) {
  const { ok, userId } = await requireAdminUser()
  if (!ok || !userId) throw new Error('Not authorised')
  return releaseCandidate(candidateVersionId, { userId })
}

export async function loadCaseHistoryAction(caseId: string) {
  await assertAdmin()
  return loadCaseHistory(caseId)
}

/**
 * Post-decision machine result for one exact version. The store reveals it
 * only when an unreversed decision has persisted for that version.
 */
export async function loadMachineResultAction(candidateVersionId: string) {
  await assertAdmin()
  return loadMachineResult(candidateVersionId)
}

/** DISMISS: out of the queue with no verdict and no learning; reversible. */
export async function dismissCandidateAction(candidateVersionId: string, input: { idempotencyKey: string; note?: string | null }) {
  const { ok, userId } = await requireAdminUser()
  if (!ok || !userId) throw new Error('Not authorised')
  return dismissCandidate(candidateVersionId, input, { userId })
}

/** RESTORE a dismissed candidate to the active queue. */
export async function restoreCandidateAction(candidateVersionId: string, input: { idempotencyKey: string }) {
  const { ok, userId } = await requireAdminUser()
  if (!ok || !userId) throw new Error('Not authorised')
  return restoreCandidate(candidateVersionId, input, { userId })
}
