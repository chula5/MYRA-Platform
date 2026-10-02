// The Accepted Images gallery and its operator actions.
//
// READ MODEL: a render attempt appears in Accepted Images exactly when it has
// a durable Cloudinary image, a PASSED fidelity check, a current unreversed
// approval for its exact candidate version, and no `Not good enough`
// override. Readiness is derived from append-only evidence — an override
// removes the image the moment it is written, without rewriting history.
// There is deliberately NO routine second human approval: the human approved
// the source outfit; the machine fidelity check gates the image.
//
// OVERRIDES: `Not good enough` is append-only and idempotent, and requires
// exactly one of the three approved reasons. Image reasons offer an explicit
// regeneration (a new, separately keyed, bounded render cycle); the
// underlying-outfit reason offers explicit approval withdrawal, which also
// marks the promotion withdrawn. An override can never convert a failed or
// unavailable fidelity result into an accepted image.
//
// Server-only: reached through admin-gated wrappers; actor identity always
// comes from the verified session.

import 'server-only'
import { createAdminClient } from '@/lib/supabase-server'
import { latestActiveDecision, orderEvents, type ReviewEventRow } from '@/lib/outfit-quality/review-state'
import { isOverrideReason, planNextCycle, boundError, MAX_RENDER_CYCLES, type OverrideReason } from '@/lib/outfit-quality/render-domain'
import { isUuid } from '@/lib/outfit-quality/review-plan'
import { verifyRenderableApproval } from '@/lib/outfit-quality/render-worker'
import { withdrawCandidateApproval, type ReviewActor } from '@/lib/outfit-quality/review-store'
import { markPromotionWithdrawn } from '@/lib/outfit-quality/promotion'

type Db = ReturnType<typeof createAdminClient>

export type GalleryFailure = { ok: false; code: string; message: string }

function failure(code: string, message: string): GalleryFailure {
  return { ok: false, code, message }
}

function isUniqueViolation(err: { code?: string; message?: string } | null): boolean {
  return !!err && (err.code === '23505' || /duplicate key/i.test(err.message ?? ''))
}

// ── Accepted Images read model ────────────────────────────────────────────────

export interface AcceptedImageCard {
  render_attempt_id: string
  render_job_id: string
  candidate_version_id: string
  case_id: string
  image_url: string
  ready_at: string
  cycle_no: number
  attempt_no: number
  data_partition: string
  context_type: 'real_member' | 'evaluation_profile'
  stylist_id: string
  stylist_name: string | null
  items: { candidate_item_id: string; slot: string; label: string; source_image_url: string }[]
  fidelity: { status: string; score: number | null; issueCount: number }
  attempts: { render_attempt_id: string; cycle_no: number; attempt_no: number; ready_at: string | null; generation_status: string | null }[]
  removed: boolean
}

export async function loadAcceptedImages(admin: Db = createAdminClient()): Promise<AcceptedImageCard[]> {
  const db = admin as any
  const { data: readyAttempts } = await db
    .from('outfit_quality_render_attempt')
    .select('*')
    .not('ready_at', 'is', null)
    .order('ready_at', { ascending: false })
    .limit(60)
  const attempts = (readyAttempts ?? []) as any[]
  if (attempts.length === 0) return []

  const attemptIds = attempts.map((a) => a.render_attempt_id)
  const { data: jobs } = await db.from('outfit_quality_render_job').select('*').in('render_job_id', attempts.map((a) => a.render_job_id))
  const jobById = new Map(((jobs ?? []) as any[]).map((j) => [j.render_job_id, j]))
  const versionIds = Array.from(new Set(((jobs ?? []) as any[]).map((j) => j.candidate_version_id)))

  const [{ data: versions }, { data: cases }, { data: events }, { data: items }, { data: overrides }, { data: allJobs }, { data: allAttempts }] =
    await Promise.all([
      db.from('outfit_quality_candidate_version').select('candidate_version_id, case_id').in('candidate_version_id', versionIds),
      db.from('outfit_quality_case').select('*').in('case_id', [] as string[]), // replaced below
      db.from('outfit_quality_review_event').select('*').in('candidate_version_id', versionIds),
      db.from('outfit_quality_candidate_item').select('*').in('candidate_version_id', versionIds),
      db.from('outfit_quality_image_override').select('*').in('render_attempt_id', attemptIds),
      db.from('outfit_quality_render_job').select('*').in('candidate_version_id', versionIds),
      db.from('outfit_quality_render_attempt').select('*').in('render_job_id', ((jobs ?? []) as any[]).map((j) => j.render_job_id)),
    ])
  void cases

  const versionById = new Map(((versions ?? []) as any[]).map((v) => [v.candidate_version_id, v]))
  const caseIds = Array.from(new Set(((versions ?? []) as any[]).map((v) => v.case_id)))
  const { data: caseRows } = await db.from('outfit_quality_case').select('*').in('case_id', caseIds)
  const caseById = new Map(((caseRows ?? []) as any[]).map((c) => [c.case_id, c]))

  const stylistIds = Array.from(new Set(((caseRows ?? []) as any[]).map((c) => c.selected_stylist_id).filter(Boolean)))
  const { data: stylists } = stylistIds.length
    ? await db.from('stylist').select('stylist_id, name').in('stylist_id', stylistIds)
    : { data: [] }
  const stylistName = new Map(((stylists ?? []) as any[]).map((s) => [s.stylist_id, s.name]))

  const checkIds = attempts.map((a) => a.fidelity_check_id).filter(Boolean)
  const { data: checks } = checkIds.length
    ? await db.from('outfit_quality_machine_check').select('*').in('check_id', checkIds)
    : { data: [] }
  const checkById = new Map(((checks ?? []) as any[]).map((c) => [c.check_id, c]))

  const overriddenAttempts = new Set(((overrides ?? []) as any[]).map((o) => o.render_attempt_id))
  const eventsByVersion = new Map<string, ReviewEventRow[]>()
  for (const e of (events ?? []) as ReviewEventRow[]) {
    const list = eventsByVersion.get(e.candidate_version_id) ?? []
    list.push(e)
    eventsByVersion.set(e.candidate_version_id, list)
  }

  const cards: AcceptedImageCard[] = []
  for (const attempt of attempts) {
    const job = jobById.get(attempt.render_job_id)
    if (!job) continue
    const version = versionById.get(job.candidate_version_id)
    const kase = version ? caseById.get(version.case_id) : null
    if (!version || !kase) continue

    // Active approval for the EXACT version, and it must be this job's approval.
    const active = latestActiveDecision(orderEvents(eventsByVersion.get(version.candidate_version_id) ?? []))
    if (!active || active.decision !== 'yes' || active.review_event_id !== job.approval_event_id) continue

    // A passed fidelity check is mandatory — failed/unavailable/errored never show.
    const check = attempt.fidelity_check_id ? checkById.get(attempt.fidelity_check_id) : null
    if (!check || check.status !== 'passed') continue

    // A Not good enough override removes the image immediately.
    if (overriddenAttempts.has(attempt.render_attempt_id)) continue

    const versionJobs = ((allJobs ?? []) as any[]).filter((j) => j.candidate_version_id === version.candidate_version_id)
    const versionJobIds = new Set(versionJobs.map((j) => j.render_job_id))
    const history = ((allAttempts ?? []) as any[])
      .filter((a) => versionJobIds.has(a.render_job_id))
      .map((a) => ({
        render_attempt_id: a.render_attempt_id,
        cycle_no: versionJobs.find((j) => j.render_job_id === a.render_job_id)?.cycle_no ?? 1,
        attempt_no: a.attempt_no,
        ready_at: a.ready_at ?? null,
        generation_status: a.generation_status ?? null,
      }))

    cards.push({
      render_attempt_id: attempt.render_attempt_id,
      render_job_id: attempt.render_job_id,
      candidate_version_id: version.candidate_version_id,
      case_id: version.case_id,
      image_url: attempt.image_url,
      ready_at: attempt.ready_at,
      cycle_no: job.cycle_no,
      attempt_no: attempt.attempt_no,
      data_partition: kase.data_partition,
      context_type: kase.real_member_id ? 'real_member' : 'evaluation_profile',
      stylist_id: kase.selected_stylist_id,
      stylist_name: stylistName.get(kase.selected_stylist_id) ?? null,
      items: ((items ?? []) as any[])
        .filter((i) => i.candidate_version_id === version.candidate_version_id)
        .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
        .map((i) => ({
          candidate_item_id: i.candidate_item_id,
          slot: i.slot,
          label: [i.item_snapshot?.brand, i.item_snapshot?.product_name ?? i.item_snapshot?.item_type].filter(Boolean).join(' — ') || i.slot,
          source_image_url: i.source_image_url,
        })),
      fidelity: {
        status: check.status,
        score: check.score ?? null,
        issueCount: Array.isArray(check.issues?.items) ? check.issues.items.length : 0,
      },
      attempts: history,
      removed: false,
    })
  }
  return cards
}

export interface AttentionJob {
  render_job_id: string
  candidate_version_id: string
  cycle_no: number
  status: string
  generation_count: number
  last_error: string | null
  updated_at: string
}

/** Jobs needing a human: second fidelity failure, checker outage, persistence failure. */
export async function loadRenderAttention(admin: Db = createAdminClient()): Promise<AttentionJob[]> {
  const db = admin as any
  const { data } = await db
    .from('outfit_quality_render_job')
    .select('render_job_id, candidate_version_id, cycle_no, status, generation_count, last_error, updated_at')
    .eq('status', 'attention_required')
    .order('updated_at', { ascending: false })
    .limit(30)
  return (data ?? []) as AttentionJob[]
}

// ── Removed images awaiting an explicit next action ───────────────────────────

export interface RemovedImageCard {
  render_attempt_id: string
  candidate_version_id: string
  image_url: string
  reason: OverrideReason
  note: string | null
  removed_at: string
  cycle_no: number
  /** The explicit follow-up actions available right now. */
  actions: ('regenerate' | 'withdraw')[]
}

/**
 * Attempts with a Not good enough override. An image-reason override on the
 * latest cycle with a still-active approval offers regeneration; an
 * underlying-outfit override with a still-active approval offers withdrawal.
 */
export async function loadRemovedImages(admin: Db = createAdminClient()): Promise<RemovedImageCard[]> {
  const db = admin as any
  const { data: overrides } = await db
    .from('outfit_quality_image_override')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(30)
  const list = (overrides ?? []) as any[]
  if (list.length === 0) return []

  const { data: attempts } = await db.from('outfit_quality_render_attempt').select('*').in('render_attempt_id', list.map((o) => o.render_attempt_id))
  const attemptById = new Map(((attempts ?? []) as any[]).map((a) => [a.render_attempt_id, a]))
  const jobIds = Array.from(new Set(((attempts ?? []) as any[]).map((a) => a.render_job_id)))
  const { data: jobs } = jobIds.length ? await db.from('outfit_quality_render_job').select('*').in('render_job_id', jobIds) : { data: [] }
  const jobById = new Map(((jobs ?? []) as any[]).map((j) => [j.render_job_id, j]))
  const versionIds = Array.from(new Set(((jobs ?? []) as any[]).map((j) => j.candidate_version_id)))
  const [{ data: events }, { data: siblingJobs }] = versionIds.length
    ? await Promise.all([
        db.from('outfit_quality_review_event').select('*').in('candidate_version_id', versionIds),
        db.from('outfit_quality_render_job').select('render_job_id, candidate_version_id, approval_event_id, cycle_no').in('candidate_version_id', versionIds),
      ])
    : [{ data: [] as any[] }, { data: [] as any[] }]

  const eventsByVersion = new Map<string, ReviewEventRow[]>()
  for (const e of (events ?? []) as ReviewEventRow[]) {
    const l = eventsByVersion.get(e.candidate_version_id) ?? []
    l.push(e)
    eventsByVersion.set(e.candidate_version_id, l)
  }

  const cards: RemovedImageCard[] = []
  for (const o of list) {
    const attempt = attemptById.get(o.render_attempt_id)
    const job = attempt ? jobById.get(attempt.render_job_id) : null
    if (!attempt || !job) continue
    const active = latestActiveDecision(orderEvents(eventsByVersion.get(job.candidate_version_id) ?? []))
    const approvalActive = !!active && active.decision === 'yes' && active.review_event_id === job.approval_event_id
    const maxCycle = Math.max(...((siblingJobs ?? []) as any[]).filter((j) => j.candidate_version_id === job.candidate_version_id && j.approval_event_id === job.approval_event_id).map((j) => j.cycle_no))
    const isLatestCycle = job.cycle_no === maxCycle

    const actions: ('regenerate' | 'withdraw')[] = []
    if (o.reason === 'underlying_outfit') {
      if (approvalActive) actions.push('withdraw')
    } else if (approvalActive && isLatestCycle) {
      actions.push('regenerate')
    }
    cards.push({
      render_attempt_id: o.render_attempt_id,
      candidate_version_id: job.candidate_version_id,
      image_url: attempt.image_url,
      reason: o.reason,
      note: o.note ?? null,
      removed_at: o.created_at,
      cycle_no: job.cycle_no,
      actions,
    })
  }
  return cards
}

/** Queue depth for the operator drain control. */
export async function loadRenderQueueCounts(admin: Db = createAdminClient()): Promise<{ queued: number; running: number }> {
  const db = admin as any
  const [{ data: queued }, { data: running }] = await Promise.all([
    db.from('outfit_quality_render_job').select('render_job_id').eq('status', 'queued'),
    db.from('outfit_quality_render_job').select('render_job_id').eq('status', 'running'),
  ])
  return { queued: (queued ?? []).length, running: (running ?? []).length }
}

// ── Shared attempt context loader ─────────────────────────────────────────────

async function loadAttemptContext(
  db: any,
  renderAttemptId: string,
): Promise<{ attempt: any | null; job: any | null; overrides: any[]; events: ReviewEventRow[] }> {
  const { data: attempt } = await db.from('outfit_quality_render_attempt').select('*').eq('render_attempt_id', renderAttemptId).maybeSingle()
  if (!attempt) return { attempt: null, job: null, overrides: [], events: [] }
  const { data: job } = await db.from('outfit_quality_render_job').select('*').eq('render_job_id', attempt.render_job_id).maybeSingle()
  const { data: overrides } = await db.from('outfit_quality_image_override').select('*').eq('render_attempt_id', renderAttemptId)
  const { data: events } = job
    ? await db.from('outfit_quality_review_event').select('*').eq('candidate_version_id', job.candidate_version_id).order('created_at', { ascending: true })
    : { data: [] }
  return { attempt, job: job ?? null, overrides: (overrides ?? []) as any[], events: (events ?? []) as ReviewEventRow[] }
}

// ── Not good enough ───────────────────────────────────────────────────────────

export type OverrideResult =
  | { ok: true; reused: boolean; overrideId: string; reason: OverrideReason; nextActions: ('regenerate' | 'withdraw')[] }
  | GalleryFailure

export async function markNotGoodEnough(
  admin: Db,
  renderAttemptId: string,
  input: { reason: unknown; note?: string | null; idempotencyKey: string },
  actor: ReviewActor,
): Promise<OverrideResult> {
  const db = admin as any
  if (!isUuid(input.idempotencyKey)) return failure('invalid_idempotency_key', 'a UUID idempotency key is required')
  if (!isOverrideReason(input.reason)) return failure('invalid_reason', 'the reason is exactly one of: image_fidelity, image_quality, underlying_outfit')

  const { data: replay } = await db.from('outfit_quality_image_override').select('*').eq('idempotency_key', input.idempotencyKey).maybeSingle()
  if (replay) {
    return { ok: true, reused: true, overrideId: replay.override_id, reason: replay.reason, nextActions: replay.reason === 'underlying_outfit' ? ['withdraw'] : ['regenerate'] }
  }

  const ctx = await loadAttemptContext(db, renderAttemptId)
  if (!ctx.attempt || !ctx.job) return failure('not_found', 'render attempt not found')
  if (!ctx.attempt.ready_at) return failure('not_ready', 'only a ready image can be marked not good enough')
  const active = latestActiveDecision(ctx.events)
  if (!active || active.decision !== 'yes' || active.review_event_id !== ctx.job.approval_event_id) {
    return failure('no_active_approval', 'the approval for this version is no longer active')
  }
  if (ctx.overrides.length > 0) return failure('already_overridden', 'this image already has a Not good enough override')

  const { data: override, error } = await db
    .from('outfit_quality_image_override')
    .insert({
      render_attempt_id: renderAttemptId,
      action: 'not_good_enough',
      reason: input.reason,
      reviewer_user_id: actor.userId,
      note: (input.note ?? '').trim() ? String(input.note).trim().slice(0, 2000) : null,
      idempotency_key: input.idempotencyKey,
    })
    .select('*')
    .maybeSingle()
  if (error || !override) {
    if (isUniqueViolation(error)) {
      const { data: existing } = await db.from('outfit_quality_image_override').select('*').eq('idempotency_key', input.idempotencyKey).maybeSingle()
      if (existing) return { ok: true, reused: true, overrideId: existing.override_id, reason: existing.reason, nextActions: existing.reason === 'underlying_outfit' ? ['withdraw'] : ['regenerate'] }
      return failure('already_overridden', 'this image already has a Not good enough override')
    }
    return failure('override_insert_failed', boundError(error?.message ?? 'no row returned'))
  }
  return { ok: true, reused: false, overrideId: override.override_id, reason: override.reason, nextActions: override.reason === 'underlying_outfit' ? ['withdraw'] : ['regenerate'] }
}

// ── Explicit regeneration ─────────────────────────────────────────────────────

export type RegenerateResult =
  | { ok: true; reused: boolean; cycleNo: number; renderJobId: string }
  | GalleryFailure

/**
 * Create the next render cycle for the attempt's approval. Regeneration is an
 * explicit operator action following an image-reason override on the LATEST
 * cycle; it never resets or hides the prior cycle, and the total number of
 * cycles is bounded.
 */
export async function regenerateRenderCycle(
  admin: Db,
  renderAttemptId: string,
  input: { idempotencyKey: string },
  actor: ReviewActor,
): Promise<RegenerateResult> {
  const db = admin as any
  if (!isUuid(input.idempotencyKey)) return failure('invalid_idempotency_key', 'a UUID idempotency key is required')
  void actor // identity is enforced by the gated wrapper; the job records provenance via the approval

  const ctx = await loadAttemptContext(db, renderAttemptId)
  if (!ctx.attempt || !ctx.job) return failure('not_found', 'render attempt not found')

  const override = ctx.overrides[0]
  if (!override) return failure('not_overridden', 'regeneration follows a Not good enough override')
  if (override.reason !== 'image_fidelity' && override.reason !== 'image_quality') {
    return failure('not_image_reason', 'only image fidelity/quality overrides offer regeneration — this one concerns the underlying outfit')
  }

  const { data: cycleJobs } = await db
    .from('outfit_quality_render_job')
    .select('*')
    .eq('candidate_version_id', ctx.job.candidate_version_id)
    .eq('approval_event_id', ctx.job.approval_event_id)
  const jobs = (cycleJobs ?? []) as any[]
  const latestCycle = jobs.length ? Math.max(...jobs.map((j) => j.cycle_no)) : ctx.job.cycle_no

  if (latestCycle > ctx.job.cycle_no) {
    // A newer cycle exists. It is a replay of THIS regeneration only when it
    // is the fresh, untouched cycle immediately after this attempt's cycle.
    const next = jobs.find((j) => j.cycle_no === ctx.job.cycle_no + 1)
    if (next && latestCycle === next.cycle_no) {
      const { data: nextAttempts } = await db.from('outfit_quality_render_attempt').select('render_attempt_id').eq('render_job_id', next.render_job_id)
      if ((nextAttempts ?? []).length === 0) {
        return { ok: true, reused: true, cycleNo: next.cycle_no, renderJobId: next.render_job_id }
      }
    }
    return failure('not_latest_cycle', 'a newer render cycle already exists — act on its latest image')
  }

  // The approval must still be current for the exact version.
  const gate = await verifyRenderableApproval(admin, ctx.job.candidate_version_id, ctx.job.approval_event_id)
  if (!gate.ok) return failure(gate.code, gate.message)

  const plan = planNextCycle(jobs.map((j) => j.cycle_no))
  if (!plan.ok) return failure('cycle_limit', `regeneration is bounded at ${MAX_RENDER_CYCLES} cycles`)

  const { data: created, error } = await db
    .from('outfit_quality_render_job')
    .insert({
      candidate_version_id: ctx.job.candidate_version_id,
      approval_event_id: ctx.job.approval_event_id,
      promotion_id: ctx.job.promotion_id ?? null,
      cycle_no: plan.cycleNo,
      status: 'queued',
    })
    .select('render_job_id, cycle_no')
    .maybeSingle()
  if (error || !created) {
    if (isUniqueViolation(error)) {
      const { data: existing } = await db
        .from('outfit_quality_render_job')
        .select('render_job_id, cycle_no')
        .eq('candidate_version_id', ctx.job.candidate_version_id)
        .eq('approval_event_id', ctx.job.approval_event_id)
        .eq('cycle_no', plan.cycleNo)
        .maybeSingle()
      if (existing) return { ok: true, reused: true, cycleNo: existing.cycle_no, renderJobId: existing.render_job_id }
    }
    return failure('job_insert_failed', boundError(error?.message ?? 'no row returned'))
  }
  return { ok: true, reused: false, cycleNo: created.cycle_no, renderJobId: created.render_job_id }
}

// ── Underlying-outfit withdrawal ──────────────────────────────────────────────

export type OutfitWithdrawalResult = { ok: true; reused: boolean } | GalleryFailure

/**
 * The underlying-outfit path of Not good enough: withdraw the approval
 * (append-only review event, ready output hidden by derivation) and mark the
 * promotion withdrawn. All approval, attempt, fidelity, and override history
 * is preserved.
 */
export async function withdrawUnderlyingOutfit(
  admin: Db,
  renderAttemptId: string,
  input: { idempotencyKey: string; note?: string | null },
  actor: ReviewActor,
): Promise<OutfitWithdrawalResult> {
  const db = admin as any
  if (!isUuid(input.idempotencyKey)) return failure('invalid_idempotency_key', 'a UUID idempotency key is required')

  const ctx = await loadAttemptContext(db, renderAttemptId)
  if (!ctx.attempt || !ctx.job) return failure('not_found', 'render attempt not found')
  const override = ctx.overrides[0]
  if (!override || override.reason !== 'underlying_outfit') {
    return failure('not_outfit_override', 'outfit withdrawal follows an underlying_outfit override')
  }

  const result = await withdrawCandidateApproval(ctx.job.candidate_version_id, { idempotencyKey: input.idempotencyKey, note: input.note ?? null }, actor, admin)
  if (!result.ok && result.code !== 'not_approved') {
    return failure(result.code, result.message)
  }
  await markPromotionWithdrawn(admin, ctx.job.candidate_version_id)
  return { ok: true, reused: !result.ok || result.reused }
}
