// Server-only batch orchestration for the Outfit Quality Lab.
//
// Create writes a zero-candidate draft. Start only freezes the stylist snapshot
// and marks the batch active — it generates nothing. Each chunk is a separate
// explicit action bounded to at most 25 and the batch's remaining positions.
// Pause blocks new claims; neither resume nor completion schedules more work.

import 'server-only'
import { randomUUID } from 'node:crypto'
import { createAdminClient } from '@/lib/supabase-server'
import { freezeSelectedStylistSnapshot } from '@/lib/outfit-quality/stylist-snapshot-store'
import { StylistSnapshotError } from '@/lib/outfit-quality/stylist-snapshot'
import { validateBatchAttribution } from '@/lib/outfit-quality/partitions'
import { validateTargetCount, validateChunkRequest, canStart, canPause, canResume, type BatchStatus } from '@/lib/outfit-quality/batch-control'
import {
  resolveContext,
  toContextSnapshot,
} from '@/lib/outfit-quality/contexts'
import { createSupabaseRealMemberRepository, createSupabaseEvaluationProfileRepository } from '@/lib/outfit-quality/contexts-store'
import {
  generateAndCheckChunk,
  CandidatePipelineError,
  type GenerateChunkResult,
  type GenerationContext,
} from '@/lib/outfit-quality/candidate-generation'
import {
  createCandidatePersistence,
  frozenSnapshotFromRow,
  systemVersionsFromSnapshotRow,
} from '@/lib/outfit-quality/candidate-store'
import {
  createComposerGenerator,
  createObjectiveEvidenceProvider,
  createSubjectiveChecker,
} from '@/lib/outfit-quality/generation-adapters'

type Admin = ReturnType<typeof createAdminClient>

export interface CreateBatchArgs {
  dataPartition: string
  realMemberId?: string | null
  evaluationProfileId?: string | null
  selectedStylistId: string
  targetCount: number
  chunkLimit?: number
  createdBy?: string | null
}

export interface BatchResult {
  ok: boolean
  code?: string
  message?: string
  batchId?: string
}

export async function createBatch(args: CreateBatchArgs, admin: Admin = createAdminClient()): Promise<BatchResult> {
  const attribution = validateBatchAttribution({
    dataPartition: args.dataPartition,
    realMemberId: args.realMemberId ?? null,
    evaluationProfileId: args.evaluationProfileId ?? null,
    selectedStylistId: args.selectedStylistId,
  })
  if (!attribution.ok) return { ok: false, code: attribution.code, message: attribution.message }

  const target = validateTargetCount(args.targetCount)
  if (!target.ok) return { ok: false, code: target.code, message: target.message }

  if (args.chunkLimit != null) {
    const chunk = validateChunkRequest(args.chunkLimit)
    if (!chunk.ok) return { ok: false, code: chunk.code, message: chunk.message }
  }

  // Confirm the context actually resolves from the correct source before writing.
  const repos = {
    members: createSupabaseRealMemberRepository(admin),
    profiles: createSupabaseEvaluationProfileRepository(admin),
  }
  const ctx = await resolveContext(
    { realMemberId: args.realMemberId ?? null, evaluationProfileId: args.evaluationProfileId ?? null },
    repos,
  )
  if (!ctx.ok) return { ok: false, code: ctx.code, message: ctx.message }

  const db = admin as any
  const { data, error } = await db
    .from('outfit_quality_batch')
    .insert({
      run_id: randomUUID(),
      data_partition: args.dataPartition,
      real_member_id: args.realMemberId ?? null,
      evaluation_profile_id: args.evaluationProfileId ?? null,
      selected_stylist_id: args.selectedStylistId,
      target_count: args.targetCount,
      chunk_limit: args.chunkLimit ?? 25,
      status: 'draft',
      created_by: args.createdBy ?? null,
    })
    .select('batch_id')
    .maybeSingle()
  if (error) return { ok: false, code: 'insert_failed', message: error.message }
  return { ok: true, batchId: data.batch_id }
}

interface BatchRow {
  batch_id: string
  run_id: string
  data_partition: string
  real_member_id: string | null
  evaluation_profile_id: string | null
  selected_stylist_id: string
  stylist_snapshot_id: string | null
  target_count: number
  chunk_limit: number
  status: BatchStatus
  last_error: string | null
}

async function loadBatch(admin: Admin, batchId: string): Promise<BatchRow | null> {
  const db = admin as any
  const { data } = await db.from('outfit_quality_batch').select('*').eq('batch_id', batchId).maybeSingle()
  return data ?? null
}

async function producedCount(admin: Admin, batchId: string): Promise<number> {
  const db = admin as any
  const { count } = await db
    .from('outfit_quality_case')
    .select('case_id', { count: 'exact', head: true })
    .eq('batch_id', batchId)
  return count ?? 0
}

/** Start only freezes the selected-stylist snapshot and activates the batch. */
export async function startBatch(batchId: string, admin: Admin = createAdminClient()): Promise<BatchResult> {
  const batch = await loadBatch(admin, batchId)
  if (!batch) return { ok: false, code: 'not_found', message: 'batch not found' }
  if (batch.status === 'active') return { ok: true, batchId } // idempotent
  if (!canStart(batch.status)) return { ok: false, code: 'not_startable', message: `a ${batch.status} batch cannot be started` }

  // Fail closed: a missing/unloadable stylist or any source read failure
  // aborts Start. No snapshot row is persisted (the snapshot insert happens
  // only after every source load succeeds) and the batch is not activated;
  // the failure is recorded on the batch for the admin to see.
  let snap
  try {
    snap = await freezeSelectedStylistSnapshot({ batchId, stylistId: batch.selected_stylist_id, admin })
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    const code = err instanceof StylistSnapshotError ? err.code : 'snapshot_error'
    const message = `${code}: ${detail}`
    const db = admin as any
    await db
      .from('outfit_quality_batch')
      .update({ last_error: message, updated_at: new Date().toISOString() })
      .eq('batch_id', batchId)
    return { ok: false, code: 'snapshot_failed', message }
  }

  const db = admin as any
  const { error } = await db
    .from('outfit_quality_batch')
    .update({ stylist_snapshot_id: snap.snapshotId, status: 'active', updated_at: new Date().toISOString() })
    .eq('batch_id', batchId)
  if (error) return { ok: false, code: 'update_failed', message: error.message }
  return { ok: true, batchId }
}

export async function pauseBatch(batchId: string, admin: Admin = createAdminClient()): Promise<BatchResult> {
  const batch = await loadBatch(admin, batchId)
  if (!batch) return { ok: false, code: 'not_found', message: 'batch not found' }
  if (!canPause(batch.status)) return { ok: false, code: 'not_pausable', message: `a ${batch.status} batch cannot be paused` }
  const db = admin as any
  await db.from('outfit_quality_batch').update({ status: 'paused', updated_at: new Date().toISOString() }).eq('batch_id', batchId)
  return { ok: true, batchId }
}

export async function resumeBatch(batchId: string, admin: Admin = createAdminClient()): Promise<BatchResult> {
  const batch = await loadBatch(admin, batchId)
  if (!batch) return { ok: false, code: 'not_found', message: 'batch not found' }
  if (!canResume(batch.status)) return { ok: false, code: 'not_resumable', message: `a ${batch.status} batch cannot be resumed` }
  const db = admin as any
  // Resume only re-opens the batch for explicit claims; it schedules no work.
  await db.from('outfit_quality_batch').update({ status: 'active', updated_at: new Date().toISOString() }).eq('batch_id', batchId)
  return { ok: true, batchId }
}

// ── Atomic chunk claims (database row-lock reservation) ──────────────────────

export interface ChunkClaim {
  claim: number
  startPosition: number
  remainingAfter: number
}

export type ChunkClaimOutcome = ({ ok: true } & ChunkClaim) | { ok: false; code: string; message: string }

/** Map the claim RPC's raised message to a stable client-facing code. */
export function claimErrorCode(message: string): string {
  if (/between 1 and 25/.test(message)) return 'chunk_out_of_range'
  if (/cannot claim new work/.test(message)) return 'not_generatable'
  if (/no remaining positions/.test(message)) return 'batch_full'
  if (/batch not found/.test(message)) return 'not_found'
  return 'claim_failed'
}

/**
 * Reserve positions for one explicit processing action. The RPC locks the
 * batch row FOR UPDATE, so two overlapping requests serialize: claimed ranges
 * are disjoint and their sum never exceeds target_count. No case rows exist
 * yet for a reservation — a failed generation releases the unproduced
 * positions, so capacity is never consumed by work that never landed.
 */
export async function claimChunkPositions(admin: Admin, batchId: string, requested: number): Promise<ChunkClaimOutcome> {
  const db = admin as any
  const { data, error } = await db.rpc('oq_claim_positions', { p_batch_id: batchId, p_requested: requested })
  if (error) return { ok: false, code: claimErrorCode(error.message ?? ''), message: error.message ?? 'claim failed' }
  const row = Array.isArray(data) ? data[0] : data
  if (!row || typeof row.claim !== 'number' || row.claim < 1) {
    return { ok: false, code: 'claim_failed', message: 'the position claim returned no positions' }
  }
  return { ok: true, claim: row.claim, startPosition: row.start_position, remainingAfter: row.remaining_after }
}

/** Give back reservations that produced no case. Only called after a failure. */
export async function releaseChunkPositions(admin: Admin, batchId: string, count: number): Promise<void> {
  if (!Number.isInteger(count) || count <= 0) return
  const db = admin as any
  await db.rpc('oq_release_positions', { p_batch_id: batchId, p_count: count })
}

export interface GenerateChunkResponse {
  ok: boolean
  code?: string
  message?: string
  produced?: number
  awaitingHuman?: number
  objectiveFailed?: number
  remaining?: number
  completed?: boolean
}

/**
 * One explicit processing action: atomically reserve at most
 * `min(requested, 25, remaining)` positions at the database boundary, generate
 * and check them, and return. Nothing is scheduled after. A failure mid-chunk
 * aborts, releases only the reservations that produced no case, and records
 * the error on the batch — the candidate is never silently advanced.
 */
export async function generateChunk(
  args: { batchId: string; requested: number },
  admin: Admin = createAdminClient(),
): Promise<GenerateChunkResponse> {
  const batch = await loadBatch(admin, args.batchId)
  if (!batch) return { ok: false, code: 'not_found', message: 'batch not found' }
  if (!batch.stylist_snapshot_id) return { ok: false, code: 'not_started', message: 'start the batch to freeze its snapshot first' }

  const requestedCheck = validateChunkRequest(args.requested)
  if (!requestedCheck.ok) return { ok: false, code: requestedCheck.code, message: requestedCheck.message }

  const db = admin as any

  // Reserve positions with the batch row locked FOR UPDATE inside the RPC.
  // Two overlapping chunk requests therefore serialize at the database and
  // can never claim the same position or exceed target_count.
  const claimRes = await claimChunkPositions(admin, batch.batch_id, args.requested)
  if (!claimRes.ok) {
    const remaining = Math.max(0, batch.target_count - (await producedCount(admin, batch.batch_id)))
    return { ok: false, code: claimRes.code, message: claimRes.message, remaining }
  }
  const { claim, startPosition, remainingAfter } = claimRes

  // Load the frozen snapshot — generation and subjective checking consume this
  // same persisted id/hash/payload, never a fresh stylist read.
  const { data: snapRow, error: snapErr } = await db
    .from('outfit_quality_stylist_snapshot')
    .select('*')
    .eq('snapshot_id', batch.stylist_snapshot_id)
    .maybeSingle()
  if (snapErr) {
    await releaseChunkPositions(admin, batch.batch_id, claim)
    return { ok: false, code: 'snapshot_read_failed', message: snapErr.message }
  }
  if (!snapRow) {
    await releaseChunkPositions(admin, batch.batch_id, claim)
    return { ok: false, code: 'snapshot_missing', message: 'frozen snapshot not found' }
  }

  const systemVersions = systemVersionsFromSnapshotRow(snapRow)
  const frozen = frozenSnapshotFromRow(snapRow)

  const repos = {
    members: createSupabaseRealMemberRepository(admin),
    profiles: createSupabaseEvaluationProfileRepository(admin),
  }
  const ctxRes = await resolveContext(
    { realMemberId: batch.real_member_id, evaluationProfileId: batch.evaluation_profile_id },
    repos,
  )
  if (!ctxRes.ok) {
    await releaseChunkPositions(admin, batch.batch_id, claim)
    return { ok: false, code: ctxRes.code, message: ctxRes.message }
  }

  const genContext: GenerationContext = {
    dataPartition: batch.data_partition,
    realMemberId: batch.real_member_id,
    evaluationProfileId: batch.evaluation_profile_id,
    selectedStylistId: batch.selected_stylist_id,
    contextSnapshot: toContextSnapshot(ctxRes.context),
  }

  const store = createCandidatePersistence({ admin, batch, systemVersions })

  let result: GenerateChunkResult
  try {
    result = await generateAndCheckChunk({
      batchId: batch.batch_id,
      runId: batch.run_id,
      claim,
      startPosition,
      snapshot: frozen,
      context: genContext,
      generator: createComposerGenerator(admin),
      evidence: createObjectiveEvidenceProvider(admin),
      subjectiveChecker: createSubjectiveChecker(),
      store,
    })
  } catch (err) {
    // Abort: release only the reservations that definitely hold no case (a
    // position whose case may have committed is never reissued), record the
    // error on the batch, and surface it to the caller.
    const persisted = err instanceof CandidatePipelineError ? err.persistedCount : 0
    await releaseChunkPositions(admin, batch.batch_id, claim - persisted)
    const message = err instanceof Error ? err.message : String(err)
    await db
      .from('outfit_quality_batch')
      .update({ last_error: message, updated_at: new Date().toISOString() })
      .eq('batch_id', batch.batch_id)
    return { ok: false, code: 'generation_failed', message, remaining: batch.target_count - (startPosition + persisted) }
  }

  const produced = await producedCount(admin, batch.batch_id)
  const completed = produced >= batch.target_count
  if (completed) {
    // Mark terminal, but never start another chunk or batch.
    await db.from('outfit_quality_batch').update({ status: 'completed', updated_at: new Date().toISOString() }).eq('batch_id', batch.batch_id)
  }

  return {
    ok: true,
    produced: result.produced,
    awaitingHuman: result.awaitingHuman,
    objectiveFailed: result.objectiveFailed,
    remaining: remainingAfter,
    completed,
  }
}
