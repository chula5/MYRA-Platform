// Server-only candidate persistence boundary for the Outfit Quality Lab.
//
// Every Supabase write here is ERROR-CHECKED: a failed insert or update throws
// immediately, so the orchestration above aborts instead of silently advancing
// a candidate past a write that never landed. This module owns:
//
//   * createCandidatePersistence — case/version/items commit + machine-check
//     and state writes for both fresh candidates and edit children;
//   * editCandidateVersion — the operational edit path: load the parent, insert
//     the parent-linked child with its ordered items, and run fresh
//     objective/subjective checks against the batch's frozen snapshot.

import 'server-only'
import { randomUUID } from 'node:crypto'
import { createAdminClient } from '@/lib/supabase-server'
import {
  SNAPSHOT_SYSTEM_VERSIONS,
  type SnapshotPayload,
  type SystemVersions,
} from '@/lib/outfit-quality/stylist-snapshot'
import {
  editAndCheckCandidate,
  type CandidatePersistence,
  type CandidateState,
  type ChildVersionPersistence,
  type FrozenSnapshot,
  type GeneratedCandidate,
  type GenerationContext,
  type PersistCandidateInput,
  type PersistedCandidate,
  type PersistChildVersionInput,
  type SubjectiveOutcome,
  type ObjectiveEvidenceProvider,
  type SubjectiveChecker,
} from '@/lib/outfit-quality/candidate-generation'
import { MULTI_ITEM_SLOTS, type RuleOutcome } from '@/lib/outfit-quality/objective-checks'
import { anchorOf, itemsSignature } from '@/lib/outfit-quality/scope-signature'
import { slotPlanForAnchor, type Slot } from '@/lib/composer'
import { isLearningEligible } from '@/lib/outfit-quality/learning-projection'
import { createStyleBrainSink, type QualityLearningSink } from '@/lib/outfit-quality/style-brain-bridge'
import {
  createObjectiveEvidenceProvider,
  createSubjectiveChecker,
  generatedItemFromRow,
} from '@/lib/outfit-quality/generation-adapters'

type Admin = ReturnType<typeof createAdminClient>

/** The batch attribution every case row must repeat exactly. */
export interface BatchAttribution {
  batch_id: string
  data_partition: string
  real_member_id: string | null
  evaluation_profile_id: string | null
  selected_stylist_id: string
  stylist_snapshot_id: string | null
}

/** Rebuild the frozen system versions from a persisted snapshot row. */
export function systemVersionsFromSnapshotRow(row: any): SystemVersions {
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

/** Rebuild the FrozenSnapshot the pipeline consumes from a persisted row. */
export function frozenSnapshotFromRow(row: any): FrozenSnapshot {
  return {
    snapshotId: row.snapshot_id,
    payloadHash: row.payload_hash,
    rulesOnly: !!row.rules_only,
    payload: row.payload as SnapshotPayload,
    systemVersions: systemVersionsFromSnapshotRow(row),
  }
}

function itemInsertRows(versionId: string, candidate: GeneratedCandidate) {
  return candidate.items.map((it) => ({
    candidate_version_id: versionId,
    item_id: it.item_id,
    slot: it.slot,
    sort_order: it.sort_order,
    item_snapshot: it.item_snapshot,
    source_image_url: it.source_image_url,
    source_image_asset_version: it.source_image_asset_version ?? null,
    source_image_hash: it.source_image_hash ?? null,
  }))
}

/**
 * The persistence boundary. Commits case/version/items before any check, and
 * checks/records/state writes throw on any Supabase error — a failed write
 * aborts the flow rather than silently advancing the candidate.
 */
/**
 * The scope-level dedupe columns (migration 0091): sorted item ids and the
 * lead garment. Taken from the generator when it supplied them, otherwise
 * derived from the manifest (the edit path).
 */
function scopeColumns(candidate: GeneratedCandidate): { items_signature: string; anchor_item_id: string | null } {
  return {
    items_signature: candidate.itemsSignature ?? itemsSignature(candidate.items.map((i) => i.item_id)),
    anchor_item_id: candidate.anchorItemId ?? anchorOf(candidate.items),
  }
}

export function createCandidatePersistence(args: {
  admin: Admin
  batch: BatchAttribution
  systemVersions: SystemVersions
}): CandidatePersistence & ChildVersionPersistence {
  const db = args.admin as any
  const { batch } = args

  async function insertItems(versionId: string, candidate: GeneratedCandidate) {
    const { data: items, error: itemErr } = await db
      .from('outfit_quality_candidate_item')
      .insert(itemInsertRows(versionId, candidate))
      .select('candidate_item_id, item_id, slot')
    if (itemErr) throw new Error(`candidate items insert failed: ${itemErr.message}`)
    return (items ?? []).map((r: any) => ({ candidate_item_id: r.candidate_item_id, item_id: r.item_id, slot: r.slot }))
  }

  async function pointCaseAt(caseId: string, versionId: string) {
    const { error } = await db
      .from('outfit_quality_case')
      .update({ current_version_id: versionId })
      .eq('case_id', caseId)
    if (error) throw new Error(`case pointer update failed: ${error.message}`)
  }

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
      if (!kase) throw new Error('case insert failed: no row returned')

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
          ...scopeColumns(input.candidate),
        })
        .select('candidate_version_id')
        .maybeSingle()
      if (versionErr) throw new Error(`candidate version insert failed: ${versionErr.message}`)
      if (!version) throw new Error('candidate version insert failed: no row returned')

      const items = await insertItems(version.candidate_version_id, input.candidate)
      await pointCaseAt(kase.case_id, version.candidate_version_id)

      return { caseId: kase.case_id, candidateVersionId: version.candidate_version_id, items }
    },

    async persistChildVersion(input: PersistChildVersionInput): Promise<PersistedCandidate> {
      const { data: version, error: versionErr } = await db
        .from('outfit_quality_candidate_version')
        .insert({
          case_id: input.caseId,
          version_no: input.plan.versionNo,
          parent_version_id: input.plan.parentVersionId,
          context_snapshot: input.contextSnapshot,
          composition_hash: input.plan.compositionHash,
          generation_request_key: input.plan.generationRequestKey,
          composer_version: args.systemVersions.composer_version,
          generator_model: args.systemVersions.generation_model,
          prompt_version: args.systemVersions.prompt_version,
          state: 'generated',
          ...scopeColumns(input.candidate),
        })
        .select('candidate_version_id')
        .maybeSingle()
      if (versionErr) throw new Error(`child version insert failed: ${versionErr.message}`)
      if (!version) throw new Error('child version insert failed: no row returned')

      const items = await insertItems(version.candidate_version_id, input.candidate)
      await pointCaseAt(input.caseId, version.candidate_version_id)

      return { caseId: input.caseId, candidateVersionId: version.candidate_version_id, items }
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
      const { error } = await db.from('outfit_quality_machine_check').insert(rows)
      if (error) throw new Error(`objective check insert failed: ${error.message}`)
    },

    async recordSubjectiveCheck(candidateVersionId: string, outcome: SubjectiveOutcome): Promise<void> {
      const { error } = await db.from('outfit_quality_machine_check').insert({
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
      if (error) throw new Error(`subjective check insert failed: ${error.message}`)
    },

    async setVersionState(candidateVersionId: string, state: CandidateState): Promise<void> {
      const { error } = await db
        .from('outfit_quality_candidate_version')
        .update({ state })
        .eq('candidate_version_id', candidateVersionId)
      if (error) throw new Error(`version state update failed: ${error.message}`)
    },

    async setCaseStatus(caseId: string, status: string, currentVersionId: string): Promise<void> {
      const { error } = await db
        .from('outfit_quality_case')
        .update({ status, current_version_id: currentVersionId })
        .eq('case_id', caseId)
      if (error) throw new Error(`case status update failed: ${error.message}`)
    },
  }
}

// ── The operational edit path ─────────────────────────────────────────────────

export interface EditCandidateInput {
  candidateVersionId: string
  /** The edited composition, in display order; sort_order is assigned 0..n-1. */
  items: { item_id: string; slot: string }[]
  /** Idempotency key: replaying the same edit returns the same child version. */
  editKey?: string
  /**
   * What the reviewer swapped out (to_item_id = the replacement) or removed
   * (to_item_id = null) to arrive at this edit. Each one teaches the house as
   * a swap, exactly like a swap in Outfit Review — training partition only.
   */
  swaps?: { from_item_id: string; to_item_id: string | null }[]
}

export interface EditCandidateResult {
  ok: boolean
  code?: string
  message?: string
  candidateVersionId?: string
  state?: CandidateState
  reused?: boolean
}

const MAX_EDIT_ITEMS = 12

/**
 * Edit a candidate as a fresh child version: load the parent + case + batch +
 * frozen snapshot, insert the parent-linked child with its ordered items, and
 * run fresh objective/subjective checks. The parent is never mutated and the
 * child inherits nothing. Idempotent on `editKey`. Any failed write aborts and
 * surfaces an error.
 */
export async function editCandidateVersion(
  input: EditCandidateInput,
  admin: Admin = createAdminClient(),
  deps: { evidence?: ObjectiveEvidenceProvider; subjectiveChecker?: SubjectiveChecker; learningSink?: QualityLearningSink } = {},
): Promise<EditCandidateResult> {
  const db = admin as any
  if (!input.candidateVersionId) return { ok: false, code: 'missing_version', message: 'a candidate version id is required' }
  if (!Array.isArray(input.items) || input.items.length === 0) {
    return { ok: false, code: 'empty_edit', message: 'an edit must contain at least one item' }
  }
  if (input.items.length > MAX_EDIT_ITEMS) {
    return { ok: false, code: 'too_many_items', message: `an edit may contain at most ${MAX_EDIT_ITEMS} items` }
  }
  if (input.items.some((it) => !it || typeof it.item_id !== 'string' || !it.item_id || typeof it.slot !== 'string' || !it.slot)) {
    return { ok: false, code: 'invalid_item', message: 'every edited item needs an item_id and a slot' }
  }
  const ids = input.items.map((it) => it.item_id)
  if (new Set(ids).size !== ids.length) {
    return { ok: false, code: 'duplicate_item', message: 'an edit cannot contain the same item twice' }
  }

  // Load the parent version — the edit anchors to this exact immutable row.
  const { data: parent, error: parentErr } = await db
    .from('outfit_quality_candidate_version')
    .select('*')
    .eq('candidate_version_id', input.candidateVersionId)
    .maybeSingle()
  if (parentErr) return { ok: false, code: 'read_failed', message: parentErr.message }
  if (!parent) return { ok: false, code: 'not_found', message: 'candidate version not found' }

  // Idempotent replay: the same edit key returns the already-created child.
  const editKey = input.editKey ?? randomUUID()
  const requestKey = `edit:${parent.candidate_version_id}:${editKey}`
  const { data: existing, error: existingErr } = await db
    .from('outfit_quality_candidate_version')
    .select('candidate_version_id, state')
    .eq('generation_request_key', requestKey)
    .maybeSingle()
  if (existingErr) return { ok: false, code: 'read_failed', message: existingErr.message }
  if (existing) return { ok: true, reused: true, candidateVersionId: existing.candidate_version_id, state: existing.state }

  const { data: kase, error: caseErr } = await db
    .from('outfit_quality_case')
    .select('*')
    .eq('case_id', parent.case_id)
    .maybeSingle()
  if (caseErr) return { ok: false, code: 'read_failed', message: caseErr.message }
  if (!kase) return { ok: false, code: 'not_found', message: 'case not found' }

  const { data: batch, error: batchErr } = await db
    .from('outfit_quality_batch')
    .select('*')
    .eq('batch_id', kase.batch_id)
    .maybeSingle()
  if (batchErr) return { ok: false, code: 'read_failed', message: batchErr.message }
  if (!batch) return { ok: false, code: 'not_found', message: 'batch not found' }
  if (!batch.stylist_snapshot_id) return { ok: false, code: 'snapshot_missing', message: 'the batch has no frozen snapshot' }

  const { data: snapRow, error: snapErr } = await db
    .from('outfit_quality_stylist_snapshot')
    .select('*')
    .eq('snapshot_id', batch.stylist_snapshot_id)
    .maybeSingle()
  if (snapErr) return { ok: false, code: 'read_failed', message: snapErr.message }
  if (!snapRow) return { ok: false, code: 'snapshot_missing', message: 'frozen snapshot not found' }

  // The structure the child must satisfy: the parent's anchor slot plus the
  // slots the composer requires for that anchor (the same rule generation
  // uses). Dropping one of THOSE fails the objective structure check; an
  // optional layer — outerwear, a bag, jewellery — may be removed freely.
  const { data: parentItems, error: parentItemsErr } = await db
    .from('outfit_quality_candidate_item')
    .select('item_id, slot, sort_order')
    .eq('candidate_version_id', parent.candidate_version_id)
  if (parentItemsErr) return { ok: false, code: 'read_failed', message: parentItemsErr.message }
  const parentManifest = ((parentItems ?? []) as any[]).map((r) => ({ item_id: r.item_id as string, slot: r.slot as string, sort_order: (r.sort_order ?? 0) as number }))
  const parentAnchorId = anchorOf(parentManifest)
  const parentAnchorSlot = (parentManifest.find((r) => r.item_id === parentAnchorId)?.slot ?? null) as Slot | null
  const requiredSlots = parentAnchorSlot
    ? Array.from(new Set([parentAnchorSlot, ...slotPlanForAnchor(parentAnchorSlot).required]))
    : Array.from(new Set(parentManifest.map((r) => r.slot).filter((s) => !MULTI_ITEM_SLOTS.has(s))))

  // Freeze the edited items' facts from the live item rows.
  const { data: itemRows, error: itemsErr } = await db.from('item').select('*, brand(*)').in('item_id', ids)
  if (itemsErr) return { ok: false, code: 'read_failed', message: itemsErr.message }
  const byId = new Map(((itemRows ?? []) as any[]).map((r) => [r.item_id, r]))
  const missing = ids.filter((id) => !byId.has(id))
  if (missing.length > 0) {
    return { ok: false, code: 'unknown_items', message: `unknown item ids: ${missing.join(', ')}` }
  }

  const candidate: GeneratedCandidate = {
    requiredSlots,
    items: input.items.map((it, idx) => generatedItemFromRow(byId.get(it.item_id), it.slot, idx)),
  }

  const context: GenerationContext = {
    dataPartition: batch.data_partition,
    realMemberId: batch.real_member_id,
    evaluationProfileId: batch.evaluation_profile_id,
    selectedStylistId: batch.selected_stylist_id,
    // The child carries the parent's frozen context snapshot unchanged.
    contextSnapshot: parent.context_snapshot,
  }

  const systemVersions = systemVersionsFromSnapshotRow(snapRow)
  const store = createCandidatePersistence({ admin, batch, systemVersions })

  try {
    const result = await editAndCheckCandidate({
      caseId: kase.case_id,
      parentVersionId: parent.candidate_version_id,
      parentVersionNo: parent.version_no,
      parentContextSnapshot: parent.context_snapshot,
      editKey,
      snapshot: frozenSnapshotFromRow(snapRow),
      context,
      candidate,
      evidence: deps.evidence ?? createObjectiveEvidenceProvider(admin),
      subjectiveChecker: deps.subjectiveChecker ?? createSubjectiveChecker(),
      store,
    })
    // Each swap/remove teaches the house like a swap in Outfit Review —
    // training partition only, and never a reason to fail the edit.
    const swaps = (input.swaps ?? []).filter((sw) => sw && typeof sw.from_item_id === 'string' && sw.from_item_id)
    if (swaps.length > 0 && isLearningEligible(batch.data_partition)) {
      const sink = deps.learningSink ?? createStyleBrainSink(admin)
      const look = { stylistId: batch.selected_stylist_id as string, itemIds: parentManifest.map((r) => r.item_id), anchorItemId: parentAnchorId }
      for (const sw of swaps.slice(0, MAX_EDIT_ITEMS)) {
        const taught = await sink.swap(look, sw.from_item_id, sw.to_item_id ?? null)
        if (!taught.ok) console.warn(`[outfit-quality] ${taught.warning}`)
      }
    }
    return { ok: true, candidateVersionId: result.candidateVersionId, state: result.state }
  } catch (err) {
    return { ok: false, code: 'edit_failed', message: err instanceof Error ? err.message : String(err) }
  }
}
