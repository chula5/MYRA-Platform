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
import { SNAPSHOT_SYSTEM_VERSIONS, type SnapshotPayload, type SystemVersions } from '@/lib/outfit-quality/stylist-snapshot'
import { validateBatchAttribution } from '@/lib/outfit-quality/partitions'
import { validateTargetCount, validateChunkRequest, planChunkClaim, canStart, canPause, canResume, type BatchStatus } from '@/lib/outfit-quality/batch-control'
import {
  resolveContext,
  toContextSnapshot,
  type ResolvedContext,
} from '@/lib/outfit-quality/contexts'
import { createSupabaseRealMemberRepository, createSupabaseEvaluationProfileRepository } from '@/lib/outfit-quality/contexts-store'
import {
  generateAndCheckChunk,
  type CandidatePersistence,
  type PersistCandidateInput,
  type PersistedCandidate,
  type FrozenSnapshot,
  type GenerationContext,
  type CandidateState,
  type SubjectiveOutcome,
} from '@/lib/outfit-quality/candidate-generation'
import type { RuleOutcome } from '@/lib/outfit-quality/objective-checks'
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

  const snap = await freezeSelectedStylistSnapshot({ batchId, stylistId: batch.selected_stylist_id, admin })

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

function systemVersionsFromSnapshotRow(row: any): SystemVersions {
  return {
    generation_model: row.generation_model ?? SNAPSHOT_SYSTEM_VERSIONS.generation_model,
    prompt_version: row.prompt_version ?? SNAPSHOT_SYSTEM_VERSIONS.prompt_version,
    objective_rules_version: row.objective_rules_version ?? SNAPSHOT_SYSTEM_VERSIONS.objective_rules_version,
    subjective_check_model: row.subjective_check_model ?? SNAPSHOT_SYSTEM_VERSIONS.subjective_check_model,
    subjective_prompt_version: row.subjective_prompt_version ?? SNAPSHOT_SYSTEM_VERSIONS.subjective_prompt_version,
    composer_version: row.composer_version ?? SNAPSHOT_SYSTEM_VERSIONS.composer_version,
    item_query_version: row.item_query_version ?? SNAPSHOT_SYSTEM_VERSIONS.item_query_version,
  }
}

/** The persistence boundary — commits case/version/items before any check. */
function createPersistence(args: {
  admin: Admin
  batch: BatchRow
  context: ResolvedContext
  systemVersions: SystemVersions
}): CandidatePersistence {
  const db = args.admin as any
  const { batch } = args
  return {
    async persistCandidate(input: PersistCandidateInput): Promise<PersistedCandidate> {
      const { data: kase, error: caseErr } = await db
        .from('outfit_quality_case')
        .insert({
          batch_id: batch.batch_id,
          data_partition: batch.data_partition,
          real_member_id: batch.real_member_id,
          evaluation_profile_id: batch.evaluation_profile_id,
          selected_stylist_id: batch.selected_stylist_id,
          stylist_snapshot_id: batch.stylist_snapshot_id,
          source: 'generated',
          status: 'open',
        })
        .select('case_id')
        .maybeSingle()
      if (caseErr) throw new Error(`case insert failed: ${caseErr.message}`)

      const { data: version, error: versionErr } = await db
        .from('outfit_quality_candidate_version')
        .insert({
          case_id: kase.case_id,
          version_no: 1,
          context_snapshot: input.context.contextSnapshot,
          composition_hash: input.compositionHash,
          generation_request_key: input.generationRequestKey,
          composer_version: args.systemVersions.composer_version,
          generator_model: args.systemVersions.generation_model,
          prompt_version: args.systemVersions.prompt_version,
          state: 'generated',
        })
        .select('candidate_version_id')
        .maybeSingle()
      if (versionErr) throw new Error(`candidate version insert failed: ${versionErr.message}`)

      const itemRows = input.candidate.items.map((it) => ({
        candidate_version_id: version.candidate_version_id,
        item_id: it.item_id,
        slot: it.slot,
        sort_order: it.sort_order,
        item_snapshot: it.item_snapshot,
        source_image_url: it.source_image_url,
        source_image_asset_version: it.source_image_asset_version ?? null,
        source_image_hash: it.source_image_hash ?? null,
      }))
      const { data: items, error: itemErr } = await db
        .from('outfit_quality_candidate_item')
        .insert(itemRows)
        .select('candidate_item_id, item_id, slot')
      if (itemErr) throw new Error(`candidate items insert failed: ${itemErr.message}`)

      await db.from('outfit_quality_case').update({ current_version_id: version.candidate_version_id }).eq('case_id', kase.case_id)

      return {
        caseId: kase.case_id,
        candidateVersionId: version.candidate_version_id,
        items: (items ?? []).map((r: any) => ({ candidate_item_id: r.candidate_item_id, item_id: r.item_id, slot: r.slot })),
      }
    },

    async recordObjectiveChecks(candidateVersionId: string, outcomes: RuleOutcome[]): Promise<void> {
      const rows = outcomes.map((o) => ({
        candidate_version_id: candidateVersionId,
        kind: 'objective',
        check_name: o.check_name,
        status: o.status,
        issues: o.detail ?? null,
        attempt: 1,
        idempotency_key: `${candidateVersionId}:objective:${o.check_name}`,
      }))
      await db.from('outfit_quality_machine_check').insert(rows)
    },

    async recordSubjectiveCheck(candidateVersionId: string, outcome: SubjectiveOutcome): Promise<void> {
      await db.from('outfit_quality_machine_check').insert({
        candidate_version_id: candidateVersionId,
        kind: 'subjective',
        check_name: 'selected_stylist_fit',
        status: outcome.status,
        verdict: outcome.verdict ?? null,
        score: outcome.score ?? null,
        issues: outcome.reasons ?? null,
        model: outcome.model ?? null,
        prompt_version: outcome.prompt_version ?? null,
        raw_response_hash: outcome.raw_response_hash ?? null,
        attempt: 1,
        idempotency_key: `${candidateVersionId}:subjective:1`,
      })
    },

    async setVersionState(candidateVersionId: string, state: CandidateState): Promise<void> {
      await db.from('outfit_quality_candidate_version').update({ state }).eq('candidate_version_id', candidateVersionId)
    },

    async setCaseStatus(caseId: string, status: string, currentVersionId: string): Promise<void> {
      await db.from('outfit_quality_case').update({ status, current_version_id: currentVersionId }).eq('case_id', caseId)
    },
  }
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
 * One explicit processing action: claim at most `min(requested, 25, remaining)`
 * positions, generate and check them, and return. Nothing is scheduled after.
 */
export async function generateChunk(
  args: { batchId: string; requested: number },
  admin: Admin = createAdminClient(),
): Promise<GenerateChunkResponse> {
  const batch = await loadBatch(admin, args.batchId)
  if (!batch) return { ok: false, code: 'not_found', message: 'batch not found' }
  if (!batch.stylist_snapshot_id) return { ok: false, code: 'not_started', message: 'start the batch to freeze its snapshot first' }

  const produced = await producedCount(admin, args.batchId)
  const remaining = batch.target_count - produced
  const plan = planChunkClaim({ status: batch.status, requested: args.requested, remaining })
  if (!plan.ok) return { ok: false, code: plan.code, message: plan.message, remaining }

  // Load the frozen snapshot — generation and subjective checking consume this
  // same persisted id/hash, never a fresh stylist read.
  const db = admin as any
  const { data: snapRow } = await db
    .from('outfit_quality_stylist_snapshot')
    .select('*')
    .eq('snapshot_id', batch.stylist_snapshot_id)
    .maybeSingle()
  if (!snapRow) return { ok: false, code: 'snapshot_missing', message: 'frozen snapshot not found' }

  const systemVersions = systemVersionsFromSnapshotRow(snapRow)
  const frozen: FrozenSnapshot = {
    snapshotId: snapRow.snapshot_id,
    payloadHash: snapRow.payload_hash,
    rulesOnly: !!snapRow.rules_only,
    payload: snapRow.payload as SnapshotPayload,
    systemVersions,
  }

  const repos = {
    members: createSupabaseRealMemberRepository(admin),
    profiles: createSupabaseEvaluationProfileRepository(admin),
  }
  const ctxRes = await resolveContext(
    { realMemberId: batch.real_member_id, evaluationProfileId: batch.evaluation_profile_id },
    repos,
  )
  if (!ctxRes.ok) return { ok: false, code: ctxRes.code, message: ctxRes.message }

  const genContext: GenerationContext = {
    dataPartition: batch.data_partition,
    realMemberId: batch.real_member_id,
    evaluationProfileId: batch.evaluation_profile_id,
    selectedStylistId: batch.selected_stylist_id,
    contextSnapshot: toContextSnapshot(ctxRes.context),
  }

  const store = createPersistence({ admin, batch, context: ctxRes.context, systemVersions })

  const result = await generateAndCheckChunk({
    batchId: batch.batch_id,
    runId: batch.run_id,
    claim: plan.claim,
    startPosition: produced,
    snapshot: frozen,
    context: genContext,
    generator: createComposerGenerator(admin),
    evidence: createObjectiveEvidenceProvider(admin),
    subjectiveChecker: createSubjectiveChecker(),
    store,
  })

  const newProduced = produced + result.produced
  const completed = newProduced >= batch.target_count
  if (completed) {
    // Mark terminal, but never start another chunk or batch.
    await db.from('outfit_quality_batch').update({ status: 'completed', updated_at: new Date().toISOString() }).eq('batch_id', batch.batch_id)
  }

  return {
    ok: true,
    produced: result.produced,
    awaitingHuman: result.awaitingHuman,
    objectiveFailed: result.objectiveFailed,
    remaining: batch.target_count - newProduced,
    completed,
  }
}
