// Scoped learning projections for the Outfit Quality Lab.
//
// A persisted human review in the `training` partition — and ONLY that —
// projects learning evidence, under this exact mapping (architecture.md):
//
//   | Human review              | Global quality | Selected stylist | Member taste |
//   |---------------------------|----------------|------------------|--------------|
//   | Yes                       | positive       | positive         | none         |
//   | No: global_composition    | negative       | neutral          | none         |
//   | No: wrong_for_stylist     | neutral        | negative         | none         |
//   | No: operational_data      | none           | none             | none         |
//   | No: wrong_for_member      | none (diagnostic only)            | none         |
//
// Item-specific reason variants keep the same scope mapping and additionally
// retain the affected candidate_item_id in the payload.
//
// Hard rules enforced here:
//   * `validation`, `holdout`, `synthetic`, and `test` reviews are INERT —
//     the planner returns no plans, so no ledger row can exist for them.
//   * A stylist projection targets exactly the candidate's explicitly selected
//     stylist. There is no fallback and no Chloe substitution.
//   * An evaluation-profile training review projects to global quality and the
//     selected stylist only; the profile never becomes a member and the
//     payload labels context_type so real-user trust metrics can exclude it.
//   * This module never writes member feedback: no pilot_look_feedback, no
//     taste_event, no member vectors or affinities. The ledger table is the
//     only destination.
//   * The ledger is append-only (a database trigger blocks UPDATE/DELETE), so
//     undo/withdraw compensate by APPENDING a linked projection with the
//     opposite polarity. Originals keep `status='applied'`; the compensating
//     row carries `reverses_projection_id`. Net effect is derived, never
//     rewritten. Both application and compensation are idempotent through the
//     unique `application_key`.

import { reasonCategory } from '@/lib/outfit-quality/review-reasons'

export type LearningScope = 'global_quality' | 'stylist'
export type LearningPolarity = 'positive' | 'negative'
export type LearningContextType = 'real_member' | 'evaluation_profile'

/** The only partition whose human reviews may teach anything. */
export const LEARNING_ELIGIBLE_PARTITION = 'training' as const

export function isLearningEligible(partition: string | null | undefined): boolean {
  return partition === LEARNING_ELIGIBLE_PARTITION
}

export interface LearningAttribution {
  /** The case/batch's immutable partition. Anything but 'training' is inert. */
  dataPartition: string | null | undefined
  /** The case/batch's explicitly selected stylist. */
  selectedStylistId: string | null | undefined
  contextType: LearningContextType
}

export interface LearningDecisionEvent {
  review_event_id: string
  candidate_version_id: string
  decision: 'yes' | 'no'
  reason_code: string | null
  candidate_item_id: string | null
}

export interface LearningProjectionPlan {
  review_event_id: string
  candidate_version_id: string
  scope: LearningScope
  target_stylist_id: string | null
  polarity: LearningPolarity
  application_key: string
  payload: Record<string, unknown>
  reverses_projection_id: string | null
}

function decisionPayload(attribution: LearningAttribution, event: LearningDecisionEvent): Record<string, unknown> {
  return {
    source: 'quality_lab_review',
    data_partition: LEARNING_ELIGIBLE_PARTITION,
    context_type: attribution.contextType,
    reason_code: event.reason_code,
    // Item-specific reasons preserve the affected candidate item; global
    // reasons carry null. Free-text notes are NEVER copied into evidence.
    affected_candidate_item_id: event.candidate_item_id,
  }
}

/**
 * The exact reason→scope mapping for one persisted human decision. Returns []
 * for inert partitions, operational/diagnostic reasons, and anything that is
 * not a persisted human `decide` event. A missing selected stylist on a
 * stylist-scoped plan drops THAT plan (the database guarantees the column, so
 * this is defence in depth); the caller surfaces it as a warning.
 */
export function planLearningProjections(args: {
  attribution: LearningAttribution
  event: LearningDecisionEvent
}): LearningProjectionPlan[] {
  const { attribution, event } = args
  if (!isLearningEligible(attribution.dataPartition)) return []

  const mk = (scope: LearningScope, target: string | null, polarity: LearningPolarity): LearningProjectionPlan => ({
    review_event_id: event.review_event_id,
    candidate_version_id: event.candidate_version_id,
    scope,
    target_stylist_id: target,
    polarity,
    application_key: `${event.review_event_id}:${scope}:${target ?? 'global'}`,
    payload: decisionPayload(attribution, event),
    reverses_projection_id: null,
  })

  if (event.decision === 'yes') {
    const plans = [mk('global_quality', null, 'positive')]
    if (attribution.selectedStylistId) plans.push(mk('stylist', attribution.selectedStylistId, 'positive'))
    return plans
  }

  const category = event.reason_code ? reasonCategory(event.reason_code) : null
  switch (category) {
    case 'global_composition':
      return [mk('global_quality', null, 'negative')]
    case 'wrong_for_stylist':
      return attribution.selectedStylistId ? [mk('stylist', attribution.selectedStylistId, 'negative')] : []
    // operational_data → no aesthetic evidence; wrong_for_member → diagnostic
    // only, never member taste; unknown → inert.
    default:
      return []
  }
}

export interface ExistingLearningProjection {
  projection_id: string
  review_event_id: string
  scope: LearningScope
  target_stylist_id: string | null
  polarity: LearningPolarity
  reverses_projection_id: string | null
}

/**
 * Compensating plans for a reversal (undo/withdraw): for every uncompensated
 * original projection of the reversed decision, one appended row with the
 * OPPOSITE polarity linked by reverses_projection_id. Already-compensated
 * originals are skipped, and compensation rows themselves are never
 * re-compensated, so replays and reprocessing cannot duplicate.
 */
export function planCompensatingProjections(args: {
  reversalEventId: string
  candidateVersionId: string
  /** Every projection row for the candidate version (originals + any compensations). */
  ledger: ExistingLearningProjection[]
  /** The decision event being reversed. */
  reversedEventId: string
}): LearningProjectionPlan[] {
  const { reversalEventId, candidateVersionId, ledger, reversedEventId } = args
  const compensatedIds = new Set(
    ledger.filter((p) => p.reverses_projection_id !== null).map((p) => p.reverses_projection_id as string),
  )
  return ledger
    .filter(
      (p) =>
        p.review_event_id === reversedEventId &&
        p.reverses_projection_id === null &&
        !compensatedIds.has(p.projection_id),
    )
    .map((p) => ({
      review_event_id: reversalEventId,
      candidate_version_id: candidateVersionId,
      scope: p.scope,
      target_stylist_id: p.target_stylist_id,
      polarity: (p.polarity === 'positive' ? 'negative' : 'positive') as LearningPolarity,
      application_key: `${reversalEventId}:compensate:${p.projection_id}`,
      payload: { source: 'quality_lab_reversal', compensates: p.projection_id },
      reverses_projection_id: p.projection_id,
    }))
}

/**
 * Net learning effect of a ledger, per scope/target: positive +1, negative -1,
 * compensations included. A decided-then-reversed review nets to zero while
 * both rows remain visible in history.
 */
export function netLearningEffect(
  ledger: Pick<ExistingLearningProjection, 'scope' | 'target_stylist_id' | 'polarity'>[],
): Map<string, number> {
  const net = new Map<string, number>()
  for (const p of ledger) {
    const key = `${p.scope}:${p.target_stylist_id ?? 'global'}`
    net.set(key, (net.get(key) ?? 0) + (p.polarity === 'positive' ? 1 : -1))
  }
  return net
}

// ── Database application (service-role only, reached via the admin-gated store) ──

export type LearningWriteResult =
  | { ok: true; applied: number; reused: number }
  | { ok: false; code: string; message: string }

function writeFailure(code: string, message: string): { ok: false; code: string; message: string } {
  return { ok: false, code, message }
}

function isUniqueViolation(err: { code?: string; message?: string } | null): boolean {
  return !!err && (err.code === '23505' || /duplicate key/i.test(err.message ?? ''))
}

/**
 * Append the planned projections for one persisted decision. Idempotent: the
 * unique application_key makes a replay (or a lost race) a no-op that reports
 * `reused`. Never touches any member-feedback table.
 */
export async function applyLearningProjections(
  db: any,
  args: { attribution: LearningAttribution; event: LearningDecisionEvent },
): Promise<LearningWriteResult> {
  const plans = planLearningProjections(args)
  if (plans.length === 0) return { ok: true, applied: 0, reused: 0 }
  if (isLearningEligible(args.attribution.dataPartition) && !args.attribution.selectedStylistId) {
    const needsStylist = args.event.decision === 'yes' || reasonCategory(args.event.reason_code ?? '') === 'wrong_for_stylist'
    if (needsStylist) return writeFailure('missing_stylist_target', 'a training review requires the selected stylist for learning routing')
  }

  let applied = 0
  let reused = 0
  for (const plan of plans) {
    const { error } = await db.from('outfit_quality_learning_projection').insert({
      review_event_id: plan.review_event_id,
      candidate_version_id: plan.candidate_version_id,
      scope: plan.scope,
      target_stylist_id: plan.target_stylist_id,
      polarity: plan.polarity,
      payload: plan.payload,
      status: 'applied',
      application_key: plan.application_key,
      reverses_projection_id: null,
    })
    if (error) {
      if (isUniqueViolation(error)) {
        reused += 1
        continue
      }
      return writeFailure('projection_insert_failed', error.message ?? 'projection insert failed')
    }
    applied += 1
  }
  return { ok: true, applied, reused }
}

/**
 * Append compensating projections for a persisted reversal event. The original
 * rows are never updated or deleted; net effect is derived from the ledger.
 * Idempotent through both the already-compensated skip and the unique key.
 */
export async function applyCompensatingProjections(
  db: any,
  args: { reversalEventId: string; reversedEventId: string; candidateVersionId: string },
): Promise<LearningWriteResult> {
  const { data: ledger, error: readErr } = await db
    .from('outfit_quality_learning_projection')
    .select('projection_id, review_event_id, scope, target_stylist_id, polarity, reverses_projection_id')
    .eq('candidate_version_id', args.candidateVersionId)
  if (readErr) return writeFailure('ledger_read_failed', readErr.message ?? 'ledger read failed')

  const plans = planCompensatingProjections({
    reversalEventId: args.reversalEventId,
    candidateVersionId: args.candidateVersionId,
    ledger: (ledger ?? []) as ExistingLearningProjection[],
    reversedEventId: args.reversedEventId,
  })
  if (plans.length === 0) return { ok: true, applied: 0, reused: 0 }

  let applied = 0
  let reused = 0
  for (const plan of plans) {
    const { error } = await db.from('outfit_quality_learning_projection').insert({
      review_event_id: plan.review_event_id,
      candidate_version_id: plan.candidate_version_id,
      scope: plan.scope,
      target_stylist_id: plan.target_stylist_id,
      polarity: plan.polarity,
      payload: plan.payload,
      status: 'applied',
      application_key: plan.application_key,
      reverses_projection_id: plan.reverses_projection_id,
    })
    if (error) {
      if (isUniqueViolation(error)) {
        reused += 1
        continue
      }
      return writeFailure('compensation_insert_failed', error.message ?? 'compensation insert failed')
    }
    applied += 1
  }
  return { ok: true, applied, reused }
}
