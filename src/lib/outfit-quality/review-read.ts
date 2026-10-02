// Server-only read models for the Outfit Quality review workbench.
//
// The queue payload is built through the pre-decision read model, so a version
// without a persisted human decision carries NO machine verdict, score,
// reasons, rationale, or agreement — only the fact that a check exists. A
// defence-in-depth leak scan runs over every pre-decision card before it
// leaves the server. Decided versions may carry the revealed machine result.

import 'server-only'
import { createAdminClient } from '@/lib/supabase-server'
import { buildPreDecisionCandidate, findProtectedLeaks, type PreDecisionItem } from '@/lib/outfit-quality/queue-read-model'
import {
  deriveQueueDisposition,
  latestActiveDecision,
  annotateEvents,
  activeHoldFor,
  type AnnotatedEvent,
  type QueueDisposition,
  type QueueHoldRow,
  type RenderJobRow,
  type ReviewEventRow,
} from '@/lib/outfit-quality/review-state'

type Admin = ReturnType<typeof createAdminClient>

export interface ReviewFilters {
  partition?: string | null
  stylistId?: string | null
  contextType?: 'real_member' | 'evaluation_profile' | null
  disposition?: 'active' | 'held' | 'reviewed' | 'all' | null
}

export interface ReviewCard {
  candidate_version_id: string
  case_id: string
  batch_id: string
  version_no: number
  /** Raw immutable version state (awaiting_human, approved, approval_withdrawn, objective_failed, …). */
  state: string
  is_current: boolean
  disposition: QueueDisposition
  data_partition: string
  context_type: 'real_member' | 'evaluation_profile'
  context_label: string
  selected_stylist_id: string
  stylist_name: string | null
  rules_only: boolean
  has_subjective_check: boolean
  items: PreDecisionItem[]
  hold: { hold_id: string; reason: string | null; held_by: string; created_at: string } | null
  decision: 'yes' | 'no' | null
  reason_code: string | null
  decided_item_id: string | null
  reviewer_user_id: string | null
  decided_at: string | null
  /** Latest render job status for the active approval, when one exists. */
  render_status: string | null
  can_undo: boolean
  requires_withdrawal: boolean
  /** Present only when a decision for this exact version has persisted. */
  machine: { status: string; verdict: string | null; score: number | null; issues: unknown; model: string | null; prompt_version: string | null }[] | null
}

export interface ReviewQueueResult {
  cards: ReviewCard[]
  counts: { active: number; held: number; reviewed: number }
  stylists: { stylist_id: string; name: string }[]
}

const CASE_LIMIT = 200

export async function loadReviewQueue(filters: ReviewFilters = {}, admin: Admin = createAdminClient()): Promise<ReviewQueueResult> {
  const db = admin as any

  const { data: cases, error: caseErr } = await db
    .from('outfit_quality_case')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(CASE_LIMIT)
  if (caseErr) throw new Error(`queue load failed: ${caseErr.message}`)
  const caseRows = (cases ?? []) as any[]
  if (caseRows.length === 0) return { cards: [], counts: { active: 0, held: 0, reviewed: 0 }, stylists: [] }

  const caseIds = caseRows.map((c) => c.case_id)
  const { data: versions, error: vErr } = await db
    .from('outfit_quality_candidate_version')
    .select('candidate_version_id, case_id, version_no, state, created_at')
    .in('case_id', caseIds)
    .order('created_at', { ascending: true })
  if (vErr) throw new Error(`queue load failed: ${vErr.message}`)
  const versionRows = (versions ?? []) as any[]
  const versionIds = versionRows.map((v) => v.candidate_version_id)

  const stylistIds = Array.from(new Set(caseRows.map((c) => c.selected_stylist_id)))
  const snapshotIds = Array.from(new Set(caseRows.map((c) => c.stylist_snapshot_id).filter(Boolean)))
  const memberIds = Array.from(new Set(caseRows.map((c) => c.real_member_id).filter(Boolean)))
  const profileIds = Array.from(new Set(caseRows.map((c) => c.evaluation_profile_id).filter(Boolean)))

  const empty = Promise.resolve({ data: [] as any[], error: null })
  const [
    { data: items },
    { data: checks },
    { data: events },
    { data: holds },
    { data: jobs },
    { data: stylists },
    { data: snaps },
    { data: members },
    { data: profiles },
  ] = await Promise.all([
    versionIds.length
      ? db.from('outfit_quality_candidate_item').select('candidate_item_id, candidate_version_id, item_id, slot, sort_order, source_image_url, item_snapshot').in('candidate_version_id', versionIds)
      : empty,
    // Existence + status only here — verdict/score/reasons are selected solely
    // for versions with a persisted decision, below.
    versionIds.length
      ? db.from('outfit_quality_machine_check').select('check_id, candidate_version_id, kind, status').in('candidate_version_id', versionIds).eq('kind', 'subjective')
      : empty,
    versionIds.length ? db.from('outfit_quality_review_event').select('*').in('candidate_version_id', versionIds) : empty,
    versionIds.length ? db.from('outfit_quality_queue_hold').select('*').in('candidate_version_id', versionIds) : empty,
    versionIds.length ? db.from('outfit_quality_render_job').select('render_job_id, candidate_version_id, approval_event_id, cycle_no, status, lease_token, created_at').in('candidate_version_id', versionIds) : empty,
    db.from('stylist').select('stylist_id, name').in('stylist_id', stylistIds),
    snapshotIds.length ? db.from('outfit_quality_stylist_snapshot').select('snapshot_id, rules_only').in('snapshot_id', snapshotIds) : empty,
    memberIds.length ? db.from('pilot_member').select('member_id, name').in('member_id', memberIds) : empty,
    profileIds.length ? db.from('outfit_quality_evaluation_profile').select('profile_id, name').in('profile_id', profileIds) : empty,
  ])

  const itemsByVersion = groupBy((items ?? []) as any[], 'candidate_version_id')
  const checksByVersion = groupBy((checks ?? []) as any[], 'candidate_version_id')
  const eventsByVersion = groupBy((events ?? []) as any[], 'candidate_version_id')
  const holdsByVersion = groupBy((holds ?? []) as any[], 'candidate_version_id')
  const jobsByVersion = groupBy((jobs ?? []) as any[], 'candidate_version_id')
  const stylistName = new Map(((stylists ?? []) as any[]).map((s) => [s.stylist_id, s.name]))
  const snapRulesOnly = new Map(((snaps ?? []) as any[]).map((s) => [s.snapshot_id, !!s.rules_only]))
  const memberName = new Map(((members ?? []) as any[]).map((m) => [m.member_id, m.name]))
  const profileName = new Map(((profiles ?? []) as any[]).map((p) => [p.profile_id, p.name]))
  const caseById = new Map(caseRows.map((c) => [c.case_id, c]))
  const versionCreated = new Map(versionRows.map((v) => [v.candidate_version_id, String(v.created_at)]))

  // Decided versions get their full subjective result; pre-decision versions
  // are never even queried for it.
  const decidedVersionIds = versionRows
    .filter((v) => latestActiveDecision((eventsByVersion.get(v.candidate_version_id) ?? []) as ReviewEventRow[]))
    .map((v) => v.candidate_version_id)
  const machineByVersion = new Map<string, any[]>()
  if (decidedVersionIds.length > 0) {
    const { data: decidedChecks } = await db
      .from('outfit_quality_machine_check')
      .select('check_id, candidate_version_id, status, verdict, score, issues, model, prompt_version')
      .in('candidate_version_id', decidedVersionIds)
      .eq('kind', 'subjective')
      .order('created_at', { ascending: true })
    for (const c of (decidedChecks ?? []) as any[]) {
      const list = machineByVersion.get(c.candidate_version_id) ?? []
      list.push(c)
      machineByVersion.set(c.candidate_version_id, list)
    }
  }

  // ── Build cards and counts from effective state ────────────────────────────
  const allCards: ReviewCard[] = []
  for (const v of versionRows) {
    const kase = caseById.get(v.case_id)
    if (!kase) continue
    const vEvents = (eventsByVersion.get(v.candidate_version_id) ?? []) as ReviewEventRow[]
    const vHolds = (holdsByVersion.get(v.candidate_version_id) ?? []) as QueueHoldRow[]
    const vJobs = (jobsByVersion.get(v.candidate_version_id) ?? []) as (RenderJobRow & { created_at?: string })[]
    const isCurrent = kase.current_version_id === v.candidate_version_id

    let disposition = deriveQueueDisposition({ state: v.state, events: vEvents, holds: vHolds })
    // A superseded version with no decision of its own is lineage, not queue.
    if (!isCurrent && (disposition === 'active' || disposition === 'held')) disposition = 'hidden'

    const activeDecision = latestActiveDecision(vEvents)
    const activeHold = activeHoldFor(vHolds)
    const approvalJobs = activeDecision ? vJobs.filter((j) => j.approval_event_id === activeDecision.review_event_id && j.status !== 'cancelled') : []
    const started = approvalJobs.some((j) => j.status !== 'queued' || j.lease_token !== null)
    const latestJob = approvalJobs.slice().sort((a, b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')))[0] ?? null

    const base = buildPreDecisionCandidate({
      candidate_version_id: v.candidate_version_id,
      case_id: v.case_id,
      version_no: v.version_no,
      state: v.state,
      rules_only: snapRulesOnly.get(kase.stylist_snapshot_id) ?? false,
      real_member_id: kase.real_member_id,
      evaluation_profile_id: kase.evaluation_profile_id,
      selected_stylist_id: kase.selected_stylist_id,
      subjectiveChecks: ((checksByVersion.get(v.candidate_version_id) ?? []) as any[]).map((c) => ({
        check_id: c.check_id,
        kind: 'subjective' as const,
        status: c.status,
      })),
      items: (itemsByVersion.get(v.candidate_version_id) ?? []) as PreDecisionItem[],
    })

    // Defence in depth: an undecided card must carry nothing protected.
    if (!activeDecision) {
      const leaks = findProtectedLeaks(base)
      if (leaks.length > 0) throw new Error(`pre-decision payload leak: ${leaks.join(', ')}`)
    }

    allCards.push({
      candidate_version_id: base.candidate_version_id,
      case_id: base.case_id,
      batch_id: kase.batch_id,
      version_no: base.version_no,
      state: v.state,
      is_current: isCurrent,
      disposition,
      data_partition: kase.data_partition,
      context_type: base.context_type,
      context_label: kase.real_member_id ? memberName.get(kase.real_member_id) ?? 'member' : profileName.get(kase.evaluation_profile_id) ?? 'profile',
      selected_stylist_id: base.selected_stylist_id,
      stylist_name: stylistName.get(kase.selected_stylist_id) ?? null,
      rules_only: base.rules_only,
      has_subjective_check: base.has_subjective_check,
      items: base.items,
      hold: activeHold ? { hold_id: activeHold.hold_id, reason: activeHold.reason, held_by: activeHold.held_by, created_at: activeHold.created_at } : null,
      decision: activeDecision?.decision ?? null,
      reason_code: activeDecision?.reason_code ?? null,
      decided_item_id: activeDecision?.candidate_item_id ?? null,
      reviewer_user_id: activeDecision?.reviewer_user_id ?? null,
      decided_at: activeDecision?.created_at ?? null,
      render_status: latestJob?.status ?? null,
      can_undo: !!activeDecision && (activeDecision.decision === 'no' || !started),
      requires_withdrawal: !!activeDecision && activeDecision.decision === 'yes' && started,
      machine: activeDecision
        ? (machineByVersion.get(v.candidate_version_id) ?? []).map((c) => ({
            status: c.status,
            verdict: c.verdict ?? null,
            score: c.score ?? null,
            issues: c.issues ?? null,
            model: c.model ?? null,
            prompt_version: c.prompt_version ?? null,
          }))
        : null,
    })
  }

  // Counts come straight from the derived per-version dispositions: one
  // version counted once, reversals already resolved by the event chain.
  const counts = { active: 0, held: 0, reviewed: 0 }
  for (const c of allCards) {
    if (c.disposition === 'active') counts.active += 1
    else if (c.disposition === 'held') counts.held += 1
    else if (c.disposition === 'reviewed') counts.reviewed += 1
  }

  // ── Composable filters — none of them add machine fields to the payload ────
  const d = filters.disposition ?? 'active'
  const filtered = allCards.filter((c) => {
    // Hidden (machine-stage, objective-failed, withdrawn-superseded) versions
    // stay out of the normal queues but remain inspectable under ALL so a
    // case never vanishes from an operator's reach.
    if (c.disposition === 'hidden' && d !== 'all') return false
    if (filters.partition && c.data_partition !== filters.partition) return false
    if (filters.stylistId && c.selected_stylist_id !== filters.stylistId) return false
    if (filters.contextType && c.context_type !== filters.contextType) return false
    if (d !== 'all' && c.disposition !== d) return false
    return true
  })

  // Queue order: the active queue is oldest-first (FIFO review) by candidate
  // version created_at with a candidate_version_id tiebreak; held and
  // reviewed surfaces show the most recently touched first. decided_at is
  // always null on an active card, so it can never order this queue.
  const disposition = filters.disposition ?? 'active'
  filtered.sort((a, b) =>
    disposition === 'active'
      ? versionCreated.get(a.candidate_version_id)!.localeCompare(versionCreated.get(b.candidate_version_id)!) ||
        a.candidate_version_id.localeCompare(b.candidate_version_id)
      : String(b.decided_at ?? '').localeCompare(String(a.decided_at ?? '')) || a.candidate_version_id.localeCompare(b.candidate_version_id),
  )

  return {
    cards: filtered,
    counts,
    stylists: ((stylists ?? []) as any[]).map((s) => ({ stylist_id: s.stylist_id, name: s.name })),
  }
}

function groupBy(rows: any[], key: string): Map<string, any[]> {
  const m = new Map<string, any[]>()
  for (const r of rows) {
    const list = m.get(r[key]) ?? []
    list.push(r)
    m.set(r[key], list)
  }
  return m
}

// ── Case history: lineage + attributable events, deterministic order ──────────

export interface CaseHistoryVersion {
  candidate_version_id: string
  version_no: number
  parent_version_id: string | null
  state: string
  is_current: boolean
  created_at: string
}

export interface CaseHistory {
  case_id: string
  versions: CaseHistoryVersion[]
  events: AnnotatedEvent[]
  holds: QueueHoldRow[]
}

export async function loadCaseHistory(caseId: string, admin: Admin = createAdminClient()): Promise<CaseHistory | { error: string }> {
  const db = admin as any
  const { data: kase, error: cErr } = await db
    .from('outfit_quality_case')
    .select('case_id, current_version_id')
    .eq('case_id', caseId)
    .maybeSingle()
  if (cErr) return { error: cErr.message }
  if (!kase) return { error: 'case not found' }

  const { data: versions } = await db
    .from('outfit_quality_candidate_version')
    .select('candidate_version_id, version_no, parent_version_id, state, created_at')
    .eq('case_id', caseId)
    .order('version_no', { ascending: true })
  const versionRows = (versions ?? []) as any[]
  const versionIds = versionRows.map((v) => v.candidate_version_id)

  const [{ data: events }, { data: holds }] = await Promise.all([
    versionIds.length ? db.from('outfit_quality_review_event').select('*').in('candidate_version_id', versionIds) : Promise.resolve({ data: [] }),
    versionIds.length ? db.from('outfit_quality_queue_hold').select('*').in('candidate_version_id', versionIds) : Promise.resolve({ data: [] }),
  ])

  // Annotate per version, then interleave in deterministic global order.
  const byVersion = groupBy((events ?? []) as any[], 'candidate_version_id')
  const annotated = versionIds.flatMap((id) => annotateEvents((byVersion.get(id) ?? []) as ReviewEventRow[]))
  const orderedEvents = annotated.slice().sort(
    (a, b) => a.event.created_at.localeCompare(b.event.created_at) || a.event.review_event_id.localeCompare(b.event.review_event_id),
  )
  const orderedHolds = ((holds ?? []) as QueueHoldRow[]).slice().sort((a, b) => a.created_at.localeCompare(b.created_at) || a.hold_id.localeCompare(b.hold_id))

  return {
    case_id: caseId,
    versions: versionRows.map((v) => ({
      candidate_version_id: v.candidate_version_id,
      version_no: v.version_no,
      parent_version_id: v.parent_version_id,
      state: v.state,
      is_current: kase.current_version_id === v.candidate_version_id,
      created_at: v.created_at,
    })),
    events: orderedEvents,
    holds: orderedHolds,
  }
}
