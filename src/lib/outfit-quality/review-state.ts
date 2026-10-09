// Effective review state, derived from append-only evidence.
//
// Authoritative facts are event rows (decide / undo / withdraw) and queue-hold
// rows; `candidate_version.state` is only a derived pointer. Every read here
// recomputes from the chain so reversals never double count and superseded
// events stay visible but non-effective.

export interface ReviewEventRow {
  review_event_id: string
  candidate_version_id: string
  action: 'decide' | 'undo' | 'withdraw' | 'dismiss'
  decision: 'yes' | 'no' | null
  reason_code: string | null
  candidate_item_id: string | null
  note: string | null
  reverses_event_id: string | null
  reviewer_user_id: string
  idempotency_key: string
  created_at: string
}

export interface QueueHoldRow {
  hold_id: string
  candidate_version_id: string
  held_by: string
  reason: string | null
  released_by: string | null
  created_at: string
  released_at: string | null
}

export interface RenderJobRow {
  render_job_id: string
  candidate_version_id: string
  approval_event_id: string
  cycle_no: number
  status: 'queued' | 'running' | 'ready' | 'attention_required' | 'cancelled'
  lease_token: string | null
}

/** Deterministic event order: created_at, then id as a stable tiebreak. */
export function orderEvents<T extends { created_at: string; review_event_id: string }>(events: T[]): T[] {
  return events
    .slice()
    .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.review_event_id.localeCompare(b.review_event_id))
}

/** The latest `decide` that no undo/withdraw event reverses, or null. */
export function latestActiveDecision(events: ReviewEventRow[]): ReviewEventRow | null {
  const ordered = orderEvents(events)
  const reversed = new Set(
    ordered.filter((e) => (e.action === 'undo' || e.action === 'withdraw') && e.reverses_event_id).map((e) => e.reverses_event_id as string),
  )
  const active = ordered.filter((e) => e.action === 'decide' && !reversed.has(e.review_event_id))
  return active.length ? active[active.length - 1] : null
}

/**
 * The unreversed DISMISS for a version, if any. A dismissal takes a version out
 * of the queue with no verdict and no learning; an `undo` pointing at it
 * restores the version to review.
 */
export function latestActiveDismissal(events: ReviewEventRow[]): ReviewEventRow | null {
  const ordered = orderEvents(events)
  const reversed = new Set(
    ordered.filter((e) => e.action === 'undo' && e.reverses_event_id).map((e) => e.reverses_event_id as string),
  )
  const active = ordered.filter((e) => e.action === 'dismiss' && !reversed.has(e.review_event_id))
  return active.length ? active[active.length - 1] : null
}

export interface AnnotatedEvent {
  event: ReviewEventRow
  /** Effective events still describe current state; superseded ones were reversed. */
  effective: boolean
  label: string
}

/** Annotate one version's chain for history display, in deterministic order. */
export function annotateEvents(events: ReviewEventRow[]): AnnotatedEvent[] {
  const ordered = orderEvents(events)
  const reversed = new Set(
    ordered.filter((e) => (e.action === 'undo' || e.action === 'withdraw') && e.reverses_event_id).map((e) => e.reverses_event_id as string),
  )
  return ordered.map((event) => {
    const effective = event.action === 'decide' || event.action === 'dismiss' ? !reversed.has(event.review_event_id) : true
    const base =
      event.action === 'decide'
        ? event.decision === 'yes'
          ? 'DECIDED YES'
          : `DECIDED NO — ${(event.reason_code ?? '').replace(/_/g, ' ').toUpperCase()}`
        : event.action === 'dismiss'
          ? 'DISMISSED — NO VERDICT, NOTHING LEARNED'
          : event.action === 'undo'
            ? 'UNDO'
            : 'APPROVAL WITHDRAWN'
    return { event, effective, label: effective ? base : `${base} — SUPERSEDED` }
  })
}

/** The unreleased hold for a version, if any. */
export function activeHoldFor(holds: QueueHoldRow[]): QueueHoldRow | null {
  return holds.find((h) => h.released_at === null) ?? null
}

export type QueueDisposition = 'active' | 'held' | 'reviewed' | 'hidden'

/**
 * Where one candidate version sits in the review workbench, derived from its
 * state pointer plus its event chain and holds. `hidden` covers machine-stage
 * and objective-failed versions, which never enter the normal queue.
 */
export function deriveQueueDisposition(args: {
  state: string
  events: ReviewEventRow[]
  holds: QueueHoldRow[]
}): QueueDisposition {
  if (args.state === 'approved' || args.state === 'rejected' || args.state === 'approval_withdrawn') return 'reviewed'
  // `dismissed` (no verdict, out of the queue) lands here too: hidden, but
  // inspectable and restorable under ALL.
  if (args.state !== 'awaiting_human') return 'hidden'
  if (latestActiveDecision(args.events)) return 'reviewed'
  if (activeHoldFor(args.holds)) return 'held'
  return 'active'
}

/**
 * Whether a card offers EDIT AS NEW VERSION. Editing is allowed from any
 * reviewable or reviewed state — an active card awaiting a decision or a
 * reviewed (approved/rejected/withdrawn) one — because an edit creates a
 * fresh child version and never mutates the original. Held cards must be
 * released back into the active queue first; hidden machine-stage versions
 * are not editable.
 */
export function canEditAsNewVersion(disposition: QueueDisposition): boolean {
  return disposition === 'active' || disposition === 'reviewed'
}

export interface QueueCounts {
  active: number
  held: number
  reviewed: number
}

/** One version counted exactly once, from effective state. */
export function deriveQueueCounts(
  versions: { candidate_version_id: string; state: string; events: ReviewEventRow[]; holds: QueueHoldRow[] }[],
): QueueCounts {
  const counts: QueueCounts = { active: 0, held: 0, reviewed: 0 }
  for (const v of versions) {
    const d = deriveQueueDisposition(v)
    if (d === 'active') counts.active += 1
    else if (d === 'held') counts.held += 1
    else if (d === 'reviewed') counts.reviewed += 1
  }
  return counts
}
