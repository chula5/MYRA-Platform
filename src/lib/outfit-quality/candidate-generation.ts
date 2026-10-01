// Bounded candidate generation + fail-closed machine checking (orchestration).
//
// This is a pure orchestration layer around injected adapters: a composition
// generator, an objective-evidence provider, a subjective checker, and a
// persistence boundary. It never reads mutable stylist tables — generation and
// subjective checking both consume the *same* frozen snapshot id + payload hash.
//
// The ordering invariants are the contract:
//
//   1. For each claimed position, the case, the immutable candidate version, and
//      the complete ordered item manifest are COMMITTED BEFORE any check runs.
//   2. Objective checks run first and fail closed. A non-pass version moves to
//      `objective_failed`, the subjective checker is invoked ZERO times, and the
//      version stays out of the normal queue (but remains auditable).
//   3. Only an objective-pass version is subjectively checked, against the same
//      frozen snapshot. Every subjective outcome — pass, reject, unavailable,
//      error — routes to `awaiting_human`. None decides, suppresses, or learns.

import { compositionHash, type CompositionItemRef } from '@/lib/outfit-quality/candidate-hash'
import { runObjectiveChecks, type ObjectiveEvidence, type ObjectiveManifest, type RuleOutcome, type CheckStatus } from '@/lib/outfit-quality/objective-checks'

export type CandidateState =
  | 'generated'
  | 'objective_checking'
  | 'objective_failed'
  | 'subjective_checking'
  | 'awaiting_human'

export interface GeneratedItem {
  item_id: string
  slot: string
  sort_order: number
  item_snapshot: Record<string, unknown>
  source_image_url: string
  source_image_asset_version?: string | null
  source_image_hash?: string | null
}

export interface GeneratedCandidate {
  /** The slots a complete outfit must include, derived from the anchor. */
  requiredSlots: string[]
  items: GeneratedItem[]
}

export interface FrozenSnapshot {
  snapshotId: string
  payloadHash: string
  rulesOnly: boolean
  payload: unknown
  systemVersions: unknown
}

export interface GenerationContext {
  dataPartition: string
  realMemberId: string | null
  evaluationProfileId: string | null
  selectedStylistId: string
  /** The frozen context snapshot stored on every candidate version. */
  contextSnapshot: unknown
}

// ── Injected adapters ──────────────────────────────────────────────────────────

export interface CompositionGenerator {
  generate(args: { count: number; snapshot: FrozenSnapshot; context: GenerationContext }): Promise<GeneratedCandidate[]>
}

export interface ObjectiveEvidenceProvider {
  gather(args: { items: GeneratedItem[]; context: GenerationContext }): Promise<ObjectiveEvidence>
}

export interface SubjectiveOutcome {
  status: CheckStatus
  verdict?: string | null
  score?: number | null
  reasons?: unknown
  model?: string | null
  prompt_version?: string | null
  raw_response_hash?: string | null
}

export interface SubjectiveChecker {
  /** Receives the frozen snapshot id + hash — never a live stylist object. */
  check(args: {
    snapshotId: string
    payloadHash: string
    manifest: ObjectiveManifest
    context: GenerationContext
  }): Promise<SubjectiveOutcome>
}

export interface PersistCandidateInput {
  position: number
  generationRequestKey: string
  compositionHash: string
  rulesOnly: boolean
  snapshotId: string
  context: GenerationContext
  systemVersions: unknown
  candidate: GeneratedCandidate
}

export interface PersistedCandidate {
  caseId: string
  candidateVersionId: string
  items: { candidate_item_id: string; item_id: string; slot: string }[]
}

/**
 * The persistence boundary. The implementation writes to the immutable Quality
 * Lab tables; the orchestrator only guarantees the call ORDER (persist → record
 * objective → record subjective → advance state).
 */
export interface CandidatePersistence {
  persistCandidate(input: PersistCandidateInput): Promise<PersistedCandidate>
  recordObjectiveChecks(candidateVersionId: string, outcomes: RuleOutcome[]): Promise<void>
  recordSubjectiveCheck(candidateVersionId: string, outcome: SubjectiveOutcome): Promise<void>
  setVersionState(candidateVersionId: string, state: CandidateState): Promise<void>
  setCaseStatus(caseId: string, status: string, currentVersionId: string): Promise<void>
}

export interface GenerateChunkArgs {
  batchId: string
  runId: string
  claim: number
  snapshot: FrozenSnapshot
  context: GenerationContext
  generator: CompositionGenerator
  evidence: ObjectiveEvidenceProvider
  subjectiveChecker: SubjectiveChecker
  store: CandidatePersistence
  /** First version number assigned (positions after already-claimed work). */
  startPosition: number
}

export interface GeneratedCandidateResult {
  candidateVersionId: string
  caseId: string
  state: CandidateState
  objectiveStatus: CheckStatus
  subjectiveStatus: CheckStatus | null
}

export interface GenerateChunkResult {
  produced: number
  awaitingHuman: number
  objectiveFailed: number
  results: GeneratedCandidateResult[]
}

function toCompositionRefs(items: GeneratedItem[]): CompositionItemRef[] {
  return items.map((i) => ({
    slot: i.slot,
    item_id: i.item_id,
    source_image_version: i.source_image_asset_version ?? null,
    source_image_hash: i.source_image_hash ?? null,
  }))
}

function toObjectiveManifest(candidate: GeneratedCandidate): ObjectiveManifest {
  return {
    requiredSlots: candidate.requiredSlots,
    items: candidate.items.map((i) => ({
      item_id: i.item_id,
      slot: i.slot,
      source_image_url: i.source_image_url,
      source_image_asset_version: i.source_image_asset_version ?? null,
      source_image_hash: i.source_image_hash ?? null,
      item_snapshot: i.item_snapshot,
    })),
  }
}

/**
 * Generate and check one bounded chunk. The generator is asked for exactly
 * `claim` candidates; each is persisted before any check runs. Objective checks
 * fail closed; only objective-pass candidates are subjectively checked, and
 * every subjective outcome lands at `awaiting_human`.
 */
export async function generateAndCheckChunk(args: GenerateChunkArgs): Promise<GenerateChunkResult> {
  const { snapshot, context, generator, evidence, subjectiveChecker, store } = args
  const candidates = await generator.generate({ count: args.claim, snapshot, context })

  const results: GeneratedCandidateResult[] = []
  let awaitingHuman = 0
  let objectiveFailed = 0

  for (let idx = 0; idx < candidates.length; idx++) {
    const candidate = candidates[idx]
    const position = args.startPosition + idx
    const refs = toCompositionRefs(candidate.items)
    const hash = compositionHash({
      snapshotHash: snapshot.payloadHash,
      context: context.contextSnapshot,
      systemVersions: snapshot.systemVersions,
      items: refs,
    })

    // 1. Commit the case, the immutable version, and the ordered item manifest
    //    BEFORE any check. This is the auditable record even for a failure.
    const persisted = await store.persistCandidate({
      position,
      generationRequestKey: `${args.runId}:${args.batchId}:${position}`,
      compositionHash: hash,
      rulesOnly: snapshot.rulesOnly,
      snapshotId: snapshot.snapshotId,
      context,
      systemVersions: snapshot.systemVersions,
      candidate,
    })

    // 2. Objective checks first — fail closed.
    await store.setVersionState(persisted.candidateVersionId, 'objective_checking')
    const manifest = toObjectiveManifest(candidate)
    const ev = await evidence.gather({ items: candidate.items, context })
    const objective = runObjectiveChecks(manifest, ev)
    await store.recordObjectiveChecks(persisted.candidateVersionId, objective.outcomes)

    if (!objective.passed) {
      await store.setVersionState(persisted.candidateVersionId, 'objective_failed')
      await store.setCaseStatus(persisted.caseId, 'objective_failed', persisted.candidateVersionId)
      objectiveFailed++
      results.push({
        candidateVersionId: persisted.candidateVersionId,
        caseId: persisted.caseId,
        state: 'objective_failed',
        objectiveStatus: objective.status,
        subjectiveStatus: null,
      })
      continue
    }

    // 3. Subjective check against the SAME frozen snapshot. Every outcome →
    //    awaiting_human; none decides or suppresses.
    await store.setVersionState(persisted.candidateVersionId, 'subjective_checking')
    const subjective = await subjectiveChecker.check({
      snapshotId: snapshot.snapshotId,
      payloadHash: snapshot.payloadHash,
      manifest,
      context,
    })
    await store.recordSubjectiveCheck(persisted.candidateVersionId, subjective)
    await store.setVersionState(persisted.candidateVersionId, 'awaiting_human')
    await store.setCaseStatus(persisted.caseId, 'awaiting_human', persisted.candidateVersionId)
    awaitingHuman++
    results.push({
      candidateVersionId: persisted.candidateVersionId,
      caseId: persisted.caseId,
      state: 'awaiting_human',
      objectiveStatus: objective.status,
      subjectiveStatus: subjective.status,
    })
  }

  return { produced: results.length, awaitingHuman, objectiveFailed, results }
}

// ── Edit → fresh child version ──────────────────────────────────────────────────

export interface ChildVersionPlan {
  parentVersionId: string
  versionNo: number
  compositionHash: string
  generationRequestKey: string
  /** A child never inherits approval, checks, renders, or learning. */
  inheritsChecks: false
  inheritsApproval: false
}

/**
 * Prepare a fresh child version for an edited candidate. The child has a new
 * composition hash and generation request key, an incremented version number,
 * and inherits nothing from its parent. It never mutates the parent.
 */
export function prepareChildVersion(args: {
  parentVersionId: string
  parentVersionNo: number
  snapshotHash: string
  context: unknown
  systemVersions: unknown
  editedItems: CompositionItemRef[]
  editKey: string
}): ChildVersionPlan {
  const hash = compositionHash({
    snapshotHash: args.snapshotHash,
    context: args.context,
    systemVersions: args.systemVersions,
    items: args.editedItems,
  })
  return {
    parentVersionId: args.parentVersionId,
    versionNo: args.parentVersionNo + 1,
    compositionHash: hash,
    generationRequestKey: `edit:${args.parentVersionId}:${args.editKey}`,
    inheritsChecks: false,
    inheritsApproval: false,
  }
}
