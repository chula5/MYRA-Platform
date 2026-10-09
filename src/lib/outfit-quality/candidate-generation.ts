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
import { mapWithConcurrency } from '@/lib/outfit-quality/concurrency'

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
  /** The lead garment (dress, else top, else bottom) this look was built around. */
  anchorItemId?: string | null
  /** Sorted item ids joined with '|': the scope-level dedupe key. */
  itemsSignature?: string
}

/**
 * What has already been composed for this (stylist, member|profile) scope
 * across every batch: full item signatures and anchors already led. The
 * generator skips both so GENERATE NEXT CHUNK never re-serves a look.
 */
export interface GenerationExclusions {
  signatures: Set<string>
  anchorItemIds: Set<string>
  /**
   * How many looks in this scope each item already appears in (anchor or
   * supporting). Drives the variety cap: a piece that has supported its share
   * of looks is penalised, then excluded, so one neutral heel cannot carry
   * every look in a batch.
   */
  itemUses?: Map<string, number>
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
  generate(args: {
    count: number
    snapshot: FrozenSnapshot
    context: GenerationContext
    /** First position of this chunk (informational; exclusions do the dedupe). */
    startPosition?: number
    exclusions?: GenerationExclusions
  }): Promise<GeneratedCandidate[]>
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
  /**
   * Receives the frozen snapshot id + hash + PAYLOAD — never a live stylist
   * object. The checker builds its prompt from `snapshotPayload` so machine
   * review uses the identical frozen lens generation used.
   */
  check(args: {
    snapshotId: string
    payloadHash: string
    snapshotPayload: unknown
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

export interface PersistChildVersionInput {
  caseId: string
  plan: ChildVersionPlan
  /** The parent's frozen context snapshot, carried onto the child unchanged. */
  contextSnapshot: unknown
  systemVersions: unknown
  candidate: GeneratedCandidate
}

/**
 * The edit path's persistence boundary: everything in `CandidatePersistence`
 * plus inserting a parent-linked child version with its ordered item manifest.
 */
export interface ChildVersionPersistence extends CandidatePersistence {
  persistChildVersion(input: PersistChildVersionInput): Promise<PersistedCandidate>
}

/**
 * A persistence or check failure that aborted the pipeline. `persistedCount`
 * is the number of chunk positions that may already hold a committed case —
 * callers must NEVER reissue those positions (no double-claim) and may release
 * only the remaining `claim - persistedCount` reservations.
 */
/** How many candidates run their machine checks at once within one chunk. */
export const CHECK_CONCURRENCY = 6

export class CandidatePipelineError extends Error {
  readonly stage: 'persist' | 'objective' | 'subjective' | 'state' | 'case' | 'check'
  readonly persistedCount: number
  constructor(stage: CandidatePipelineError['stage'], cause: unknown, persistedCount: number) {
    super(`${stage} failed: ${cause instanceof Error ? cause.message : String(cause)}`)
    this.name = 'CandidatePipelineError'
    this.stage = stage
    this.persistedCount = persistedCount
  }
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
  /** Already-cased signatures/anchors for this scope; see GenerationExclusions. */
  exclusions?: GenerationExclusions
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
    sort_order: i.sort_order,
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
 * The machine-check pipeline for one ALREADY-persisted candidate: objective
 * checks first (fail closed), then — only on objective pass — the subjective
 * check against the same frozen snapshot. Every persistence write is
 * error-checked by the store; any failure aborts by throwing, wrapped in a
 * `CandidatePipelineError` so the caller knows exactly how far the chunk got.
 * The candidate is never silently advanced past a failed write.
 */
export async function checkPersistedCandidate(args: {
  persisted: PersistedCandidate
  candidate: GeneratedCandidate
  snapshot: FrozenSnapshot
  context: GenerationContext
  evidence: ObjectiveEvidenceProvider
  subjectiveChecker: SubjectiveChecker
  store: CandidatePersistence
  persistedCount: number
}): Promise<GeneratedCandidateResult> {
  const { persisted, candidate, snapshot, context, evidence, subjectiveChecker, store } = args
  const at = (stage: CandidatePipelineError['stage']) => (err: unknown): never => {
    throw new CandidatePipelineError(stage, err, args.persistedCount)
  }

  // 1. Objective checks first — fail closed.
  await store.setVersionState(persisted.candidateVersionId, 'objective_checking').catch(at('state'))
  const manifest = toObjectiveManifest(candidate)
  const ev = await evidence.gather({ items: candidate.items, context })
  const objective = runObjectiveChecks(manifest, ev)
  await store.recordObjectiveChecks(persisted.candidateVersionId, objective.outcomes).catch(at('objective'))

  if (!objective.passed) {
    await store.setVersionState(persisted.candidateVersionId, 'objective_failed').catch(at('state'))
    await store.setCaseStatus(persisted.caseId, 'objective_failed', persisted.candidateVersionId).catch(at('case'))
    return {
      candidateVersionId: persisted.candidateVersionId,
      caseId: persisted.caseId,
      state: 'objective_failed',
      objectiveStatus: objective.status,
      subjectiveStatus: null,
    }
  }

  // 2. Subjective check against the SAME frozen snapshot — id, hash AND the
  //    payload the prompt is built from. Every outcome → awaiting_human; none
  //    decides or suppresses.
  await store.setVersionState(persisted.candidateVersionId, 'subjective_checking').catch(at('state'))
  const subjective = await subjectiveChecker.check({
    snapshotId: snapshot.snapshotId,
    payloadHash: snapshot.payloadHash,
    snapshotPayload: snapshot.payload,
    manifest,
    context,
  })
  await store.recordSubjectiveCheck(persisted.candidateVersionId, subjective).catch(at('subjective'))
  await store.setVersionState(persisted.candidateVersionId, 'awaiting_human').catch(at('state'))
  await store.setCaseStatus(persisted.caseId, 'awaiting_human', persisted.candidateVersionId).catch(at('case'))
  return {
    candidateVersionId: persisted.candidateVersionId,
    caseId: persisted.caseId,
    state: 'awaiting_human',
    objectiveStatus: objective.status,
    subjectiveStatus: subjective.status,
  }
}

/**
 * Generate and check one bounded chunk. The generator is asked for exactly
 * `claim` candidates; each is persisted before any check runs. Objective checks
 * fail closed; only objective-pass candidates are subjectively checked, and
 * every subjective outcome lands at `awaiting_human`. A failed write aborts the
 * chunk immediately (CandidatePipelineError) — remaining candidates in the
 * chunk are not attempted.
 */
export async function generateAndCheckChunk(args: GenerateChunkArgs): Promise<GenerateChunkResult> {
  const { snapshot, context, generator, evidence, subjectiveChecker, store } = args
  const candidates = await generator.generate({
    count: args.claim,
    snapshot,
    context,
    startPosition: args.startPosition,
    exclusions: args.exclusions,
  })

  // Phase A — persist every candidate, in order, BEFORE any check. Each
  // position commits its case, immutable version and ordered item manifest so
  // the auditable record exists even for a later failure. A failed persist
  // still counts the position as consumed: the case row may exist, so the
  // position is never reissued to another request.
  const persistedList: { candidate: GeneratedCandidate; persisted: PersistedCandidate }[] = []
  let persistedCount = 0
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
    let persisted: PersistedCandidate
    try {
      persisted = await store.persistCandidate({
        position,
        generationRequestKey: `${args.runId}:${args.batchId}:${position}`,
        compositionHash: hash,
        rulesOnly: snapshot.rulesOnly,
        snapshotId: snapshot.snapshotId,
        context,
        systemVersions: snapshot.systemVersions,
        candidate,
      })
    } catch (err) {
      persistedCount++
      throw new CandidatePipelineError('persist', err, persistedCount)
    }
    persistedCount++
    persistedList.push({ candidate, persisted })
  }

  // Phase B — objective then subjective checks, several candidates at a time.
  // Each check still fails closed and still aborts the chunk on a write error;
  // running them in parallel only changes wall-clock time (one Claude vision
  // call per candidate was the slow part), never the per-candidate outcome.
  const settled = await mapWithConcurrency(persistedList, CHECK_CONCURRENCY, ({ candidate, persisted }) =>
    checkPersistedCandidate({
      persisted,
      candidate,
      snapshot,
      context,
      evidence,
      subjectiveChecker,
      store,
      // Every position was consumed above, so an abort releases nothing.
      persistedCount: candidates.length,
    }),
  )
  const firstFailure = settled.find((r): r is PromiseRejectedResult => r.status === 'rejected')
  if (firstFailure) {
    const reason = firstFailure.reason
    if (reason instanceof CandidatePipelineError) throw reason
    throw new CandidatePipelineError('check', reason, candidates.length)
  }

  const results: GeneratedCandidateResult[] = []
  let awaitingHuman = 0
  let objectiveFailed = 0
  for (const r of settled) {
    if (r.status !== 'fulfilled') continue
    if (r.value.state === 'objective_failed') objectiveFailed++
    else awaitingHuman++
    results.push(r.value)
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

export interface EditCandidateOrchestrationArgs {
  caseId: string
  parentVersionId: string
  parentVersionNo: number
  /** The parent's frozen context snapshot, carried onto the child unchanged. */
  parentContextSnapshot: unknown
  /** Caller-supplied idempotency key; the request key is `edit:<parent>:<key>`. */
  editKey: string
  snapshot: FrozenSnapshot
  context: GenerationContext
  /** The edited composition: ordered items + the slots a complete outfit needs. */
  candidate: GeneratedCandidate
  evidence: ObjectiveEvidenceProvider
  subjectiveChecker: SubjectiveChecker
  store: ChildVersionPersistence
}

/**
 * Persist an edit as a fresh, parent-linked child version and run the FULL
 * machine-check pipeline on it. The child carries a new composition hash (a
 * deliberate reorder included) and a new generation request key; it inherits no
 * checks, approval, renders, or learning. The parent is never mutated. Any
 * failed write aborts before the child is advanced.
 */
export async function editAndCheckCandidate(args: EditCandidateOrchestrationArgs): Promise<GeneratedCandidateResult> {
  const { snapshot, context, evidence, subjectiveChecker, store } = args
  const plan = prepareChildVersion({
    parentVersionId: args.parentVersionId,
    parentVersionNo: args.parentVersionNo,
    snapshotHash: snapshot.payloadHash,
    context: args.parentContextSnapshot,
    systemVersions: snapshot.systemVersions,
    editedItems: toCompositionRefs(args.candidate.items),
    editKey: args.editKey,
  })

  // Commit the child version and its ordered item manifest before any check.
  const persisted = await store.persistChildVersion({
    caseId: args.caseId,
    plan,
    contextSnapshot: args.parentContextSnapshot,
    systemVersions: snapshot.systemVersions,
    candidate: args.candidate,
  })

  return checkPersistedCandidate({
    persisted,
    candidate: args.candidate,
    snapshot,
    context,
    evidence,
    subjectiveChecker,
    store,
    persistedCount: 1,
  })
}
