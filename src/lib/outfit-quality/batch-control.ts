// Bounded, manually-controlled batch work for the Outfit Quality Lab.
//
// These are the pure, deterministic rules that mirror the database bounds and
// the batch state machine. Keeping them here lets server actions and the UI
// fail fast with a precise reason, and lets the behaviour be proven without a
// database. The hard limits are server/database truth — client validation alone
// is never sufficient.
//
//   * A batch targets 1–150 candidates total.
//   * One explicit processing action claims at most 25 candidates.
//   * Creating a batch generates nothing; Start only freezes the snapshot; each
//     chunk is a separate explicit action; Pause blocks new claims; and neither
//     Resume nor completion schedules more work.

/** The maximum candidates a single batch may ever hold. */
export const MAX_TARGET_COUNT = 150
export const MIN_TARGET_COUNT = 1

/** The maximum candidates one explicit processing action may claim. */
export const MAX_CHUNK = 25
export const MIN_CHUNK = 1

export type BatchStatus = 'draft' | 'active' | 'paused' | 'completed' | 'failed'

export type BatchControlResult =
  | { ok: true }
  | { ok: false; code: BatchControlErrorCode; message: string }

export type BatchControlErrorCode =
  | 'target_out_of_range'
  | 'target_not_integer'
  | 'chunk_out_of_range'
  | 'chunk_not_integer'
  | 'not_startable'
  | 'not_generatable'
  | 'not_pausable'
  | 'not_resumable'
  | 'batch_full'

/** `target_count` must be an integer in 1–150. Client input is never trusted. */
export function validateTargetCount(n: unknown): BatchControlResult {
  if (typeof n !== 'number' || !Number.isInteger(n)) {
    return { ok: false, code: 'target_not_integer', message: 'target_count must be an integer' }
  }
  if (n < MIN_TARGET_COUNT || n > MAX_TARGET_COUNT) {
    return { ok: false, code: 'target_out_of_range', message: `target_count must be between ${MIN_TARGET_COUNT} and ${MAX_TARGET_COUNT}` }
  }
  return { ok: true }
}

/** One processing request must be an integer in 1–25. */
export function validateChunkRequest(n: unknown): BatchControlResult {
  if (typeof n !== 'number' || !Number.isInteger(n)) {
    return { ok: false, code: 'chunk_not_integer', message: 'chunk request must be an integer' }
  }
  if (n < MIN_CHUNK || n > MAX_CHUNK) {
    return { ok: false, code: 'chunk_out_of_range', message: `a processing request must be between ${MIN_CHUNK} and ${MAX_CHUNK}` }
  }
  return { ok: true }
}

// ── State machine ─────────────────────────────────────────────────────────────

export function canStart(status: BatchStatus): boolean {
  return status === 'draft'
}

/** Only an active batch generates. A paused, draft, completed or failed batch does not. */
export function canGenerate(status: BatchStatus): boolean {
  return status === 'active'
}

export function canPause(status: BatchStatus): boolean {
  return status === 'active'
}

export function canResume(status: BatchStatus): boolean {
  return status === 'paused'
}

// ── Chunk claim planning ───────────────────────────────────────────────────────

export interface ChunkClaimInput {
  status: BatchStatus
  /** The explicitly requested number of candidates for this action. */
  requested: number
  /** How many of the batch's `target_count` positions remain unclaimed. */
  remaining: number
}

export type ChunkClaimResult =
  | { ok: true; claim: number }
  | { ok: false; code: BatchControlErrorCode; message: string }

/**
 * The number of positions this explicit action may claim:
 * `min(requested, MAX_CHUNK, remaining)`. A non-active batch (paused included)
 * claims nothing — Pause blocks new claims while already-claimed work finishes
 * elsewhere. A full batch (`remaining <= 0`) is rejected so completion never
 * silently rolls into another claim.
 */
export function planChunkClaim(input: ChunkClaimInput): ChunkClaimResult {
  const req = validateChunkRequest(input.requested)
  if (!req.ok) return req
  if (!canGenerate(input.status)) {
    return { ok: false, code: 'not_generatable', message: `a ${input.status} batch cannot claim new work` }
  }
  if (input.remaining <= 0) {
    return { ok: false, code: 'batch_full', message: 'the batch has no remaining positions' }
  }
  const claim = Math.min(input.requested, MAX_CHUNK, input.remaining)
  return { ok: true, claim }
}

/**
 * Whether a batch has reached a terminal, fully-processed state. This is a pure
 * predicate used to *report* completion; it never, by itself, starts more work.
 */
export function isBatchComplete(args: { produced: number; targetCount: number }): boolean {
  return args.produced >= args.targetCount
}
