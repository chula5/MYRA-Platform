// Dataset partition and case-context rules for the Outfit Quality Lab.
//
// These are the pure, deterministic guards that mirror the database boundary
// constraints added by the Quality Lab foundation migration. Keeping them here
// lets service and UI code fail fast with a precise reason before touching the
// database, and lets the behaviour be proven with deterministic fixtures for
// every partition — including the ones (training/validation/holdout/synthetic)
// that must never be written to the connected project during tests.

/**
 * The five — and only five — accepted dataset partitions. Attribution to one of
 * these is immutable once a case exists for a batch.
 */
export const DATA_PARTITIONS = ['training', 'validation', 'holdout', 'synthetic', 'test'] as const
export type DataPartition = (typeof DATA_PARTITIONS)[number]

export function isDataPartition(value: unknown): value is DataPartition {
  return typeof value === 'string' && (DATA_PARTITIONS as readonly string[]).includes(value)
}

export type ValidationResult =
  | { ok: true }
  | { ok: false; code: ValidationErrorCode; message: string }

export type ValidationErrorCode =
  | 'unknown_partition'
  | 'no_context'
  | 'both_contexts'
  | 'missing_stylist'
  | 'partition_mismatch'
  | 'context_mismatch'
  | 'stylist_mismatch'
  | 'snapshot_mismatch'
  | 'partition_locked'

/** Exactly one of a real member or an evaluation profile must be the context. */
export interface ContextInput {
  realMemberId?: string | null
  evaluationProfileId?: string | null
}

export function validateContext(ctx: ContextInput): ValidationResult {
  const hasMember = !!ctx.realMemberId
  const hasProfile = !!ctx.evaluationProfileId
  if (hasMember && hasProfile) {
    return { ok: false, code: 'both_contexts', message: 'A case has exactly one context; both a real member and an evaluation profile were supplied' }
  }
  if (!hasMember && !hasProfile) {
    return { ok: false, code: 'no_context', message: 'A case has exactly one context; neither a real member nor an evaluation profile was supplied' }
  }
  return { ok: true }
}

export interface BatchAttribution extends ContextInput {
  dataPartition: string
  selectedStylistId?: string | null
  stylistSnapshotId?: string | null
}

/** A batch must have a known partition, exactly one context, and a stylist. */
export function validateBatchAttribution(batch: BatchAttribution): ValidationResult {
  if (!isDataPartition(batch.dataPartition)) {
    return { ok: false, code: 'unknown_partition', message: `Unknown data partition: ${String(batch.dataPartition)}` }
  }
  const ctx = validateContext(batch)
  if (!ctx.ok) return ctx
  if (!batch.selectedStylistId) {
    return { ok: false, code: 'missing_stylist', message: 'A batch requires an explicit selected stylist' }
  }
  return { ok: true }
}

export interface CaseAttribution extends BatchAttribution {}

/**
 * A case repeats its batch's attribution and may never drift from it. The
 * database enforces the same equality; this is the fast, testable mirror.
 */
export function validateCaseMatchesBatch(batch: BatchAttribution, kase: CaseAttribution): ValidationResult {
  const batchValid = validateBatchAttribution(batch)
  if (!batchValid.ok) return batchValid
  const caseValid = validateBatchAttribution(kase)
  if (!caseValid.ok) return caseValid

  if (kase.dataPartition !== batch.dataPartition) {
    return { ok: false, code: 'partition_mismatch', message: "A case partition must equal its batch partition" }
  }
  if ((kase.realMemberId ?? null) !== (batch.realMemberId ?? null) ||
      (kase.evaluationProfileId ?? null) !== (batch.evaluationProfileId ?? null)) {
    return { ok: false, code: 'context_mismatch', message: 'A case context must equal its batch context' }
  }
  if ((kase.selectedStylistId ?? null) !== (batch.selectedStylistId ?? null)) {
    return { ok: false, code: 'stylist_mismatch', message: 'A case stylist must equal its batch stylist' }
  }
  if ((kase.stylistSnapshotId ?? null) !== (batch.stylistSnapshotId ?? null)) {
    return { ok: false, code: 'snapshot_mismatch', message: 'A case snapshot must equal its batch snapshot' }
  }
  return { ok: true }
}

/**
 * A batch partition is immutable once its first case exists. A change is only
 * permitted while the batch has no cases.
 */
export function assertPartitionChangeAllowed(args: {
  currentPartition: string
  nextPartition: string
  hasCases: boolean
}): ValidationResult {
  if (args.currentPartition === args.nextPartition) return { ok: true }
  if (args.hasCases) {
    return { ok: false, code: 'partition_locked', message: 'A batch partition cannot change after its first case exists' }
  }
  if (!isDataPartition(args.nextPartition)) {
    return { ok: false, code: 'unknown_partition', message: `Unknown data partition: ${String(args.nextPartition)}` }
  }
  return { ok: true }
}
