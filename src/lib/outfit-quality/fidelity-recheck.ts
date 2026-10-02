// The FIDELITY-ONLY re-evaluation path for the Outfit Quality Lab.
//
// When a render attempt generated and durably persisted its Cloudinary image
// but the fidelity checker was unavailable or errored (e.g. exhausted API
// credit), the attempt sits in `attention_required` with no conclusive
// fidelity evidence. Re-rendering would spend the renderer budget on an image
// that already exists. This module re-runs ONLY the strict fidelity adapter
// against the EXISTING durable image:
//
//   · zero renderer involvement — the dependency type has no generate/persist
//     slot, so no code path here can submit or re-upload anything;
//   · generation_count is never touched and no new attempt row is created —
//     the single-render budget accounting is preserved exactly;
//   · eligibility is fail-closed: the attempt must be persisted, unready, hold
//     a durable image, belong to an attention_required job, and its recorded
//     fidelity outcome must be inconclusive (unavailable/error or missing);
//   · idempotent: a conclusive re-check is persisted once under a stable
//     idempotency key; replaying returns the recorded outcome without calling
//     the checker again. Inconclusive (unavailable/error) outcomes persist
//     NOTHING, so a later explicit re-check can run once the checker recovers;
//   · on pass the EXISTING attempt is re-gated against the current
//     exact-version approval and then marked ready (the same readiness gate
//     the drain uses);
//   · on conclusive failure the UNCHANGED planFidelityAction policy decides:
//     attempt 1 with corrective evidence re-queues the job so the explicit
//     local drain runs the one corrective attempt; anything else stays
//     attention_required.
//
// Server-only: reached through the admin-gated action or a local operator
// script. Explicit invocation only — nothing here is scheduled or automatic.

import 'server-only'
import { createAdminClient } from '@/lib/supabase-server'
import {
  boundError,
  buildFrozenManifest,
  manifestComplete,
  planFidelityAction,
} from '@/lib/outfit-quality/render-domain'
import { verifyRenderableApproval } from '@/lib/outfit-quality/render-worker'
import { attachPromotedImage } from '@/lib/outfit-quality/promotion'
import { checkQualityRenderFidelity, FIDELITY_MODEL, type StrictFidelityResult } from '@/lib/outfit-quality/fidelity'

type Db = ReturnType<typeof createAdminClient>

/**
 * The re-check's only external dependency: the strict fidelity checker. There
 * is deliberately NO renderer/persist slot — this path cannot submit a
 * generation or re-upload an image.
 */
export interface FidelityRecheckDeps {
  checkFidelity(renderUrl: string, items: { label: string; image_url: string }[]): Promise<StrictFidelityResult>
}

export type RecheckResult =
  | { ok: true; outcome: 'ready'; replayed: boolean; checkId: string }
  | { ok: true; outcome: 'corrective_retry_authorized'; replayed: boolean; checkId: string }
  | { ok: true; outcome: 'attention'; replayed: boolean; checkId: string; reason: string }
  | { ok: true; outcome: 'unresolved'; status: 'unavailable' | 'error'; detail: string | null }
  | { ok: true; outcome: 'cancelled'; reason: string }
  | { ok: false; code: string; message: string }

function refusal(code: string, message: string): RecheckResult {
  return { ok: false, code, message }
}

/** The stable idempotency key for the one conclusive re-check of an attempt. */
export function recheckIdempotencyKey(renderAttemptId: string): string {
  return `fidelity-recheck:${renderAttemptId}`
}

/** Values that must never survive into a stored message. */
function redactionList(): string[] {
  return [process.env.CLOUDINARY_API_SECRET ?? '', process.env.CLOUDINARY_API_KEY ?? '', process.env.ANTHROPIC_API_KEY ?? ''].filter(Boolean)
}

function fidelityFromCheckRow(row: any): StrictFidelityResult {
  const payload = (row?.issues ?? {}) as any
  return {
    status: row.status,
    score: row.score ?? null,
    issues: Array.isArray(payload?.items) ? payload.items : [],
    correctiveNotes: payload?.corrective_notes ?? null,
    detail: payload?.detail ?? null,
    model: row.model ?? FIDELITY_MODEL,
  }
}

/**
 * Re-run the strict fidelity check against an attempt's EXISTING durable
 * image. Explicit, idempotent, and fail-closed; never submits a render and
 * never increments generation_count.
 */
export async function recheckPersistedAttemptFidelity(
  admin: Db,
  renderAttemptId: string,
  deps: FidelityRecheckDeps = { checkFidelity: (url, items) => checkQualityRenderFidelity(url, items) },
): Promise<RecheckResult> {
  const db = admin as any

  // 1. Load the attempt and its job; only the documented stuck state is eligible.
  const { data: attempt, error: aErr } = await db
    .from('outfit_quality_render_attempt')
    .select('*')
    .eq('render_attempt_id', renderAttemptId)
    .maybeSingle()
  if (aErr) return refusal('read_failed', boundError(aErr.message, redactionList()))
  if (!attempt) return refusal('not_found', 'render attempt not found')

  const { data: job, error: jErr } = await db
    .from('outfit_quality_render_job')
    .select('*')
    .eq('render_job_id', attempt.render_job_id)
    .maybeSingle()
  if (jErr) return refusal('read_failed', boundError(jErr.message, redactionList()))
  if (!job) return refusal('not_found', 'owning render job not found')
  if (job.status !== 'attention_required') {
    return refusal('job_not_attention', `job status is ${job.status} — re-check only applies to attention_required jobs`)
  }
  if (attempt.ready_at) return refusal('already_ready', 'the attempt is already ready')
  if (!attempt.image_url) {
    return refusal('no_durable_image', 'the attempt has no durable persisted image — a re-check cannot substitute for a render')
  }

  // 2. Replay: a conclusive re-check for this attempt is recorded once, under a
  //    stable key. Replaying returns it without calling the checker again.
  const recheckKey = recheckIdempotencyKey(renderAttemptId)
  const { data: existingRecheck } = await db
    .from('outfit_quality_machine_check')
    .select('*')
    .eq('idempotency_key', recheckKey)
    .maybeSingle()

  let fidelity: StrictFidelityResult
  let checkId: string | null = null
  let replayed = false

  if (existingRecheck) {
    fidelity = fidelityFromCheckRow(existingRecheck)
    checkId = existingRecheck.check_id
    replayed = true
  } else {
    // 3. Eligibility: the attempt's recorded fidelity outcome must be
    //    inconclusive. A conclusive pass/fail already follows the normal
    //    policy; a re-check must never overwrite concluded evidence.
    if (attempt.fidelity_check_id) {
      const { data: prior } = await db
        .from('outfit_quality_machine_check')
        .select('*')
        .eq('check_id', attempt.fidelity_check_id)
        .maybeSingle()
      if (prior && prior.status !== 'unavailable' && prior.status !== 'error') {
        return refusal('not_eligible', `the recorded fidelity outcome is conclusive (${prior.status}) — re-check only applies to unavailable/errored checks`)
      }
    }

    // 4. Frozen items only — the same manifest the drain would have used.
    const { data: itemRows, error: iErr } = await db
      .from('outfit_quality_candidate_item')
      .select('*')
      .eq('candidate_version_id', job.candidate_version_id)
    if (iErr) return refusal('read_failed', boundError(iErr.message, redactionList()))
    const manifest = buildFrozenManifest(itemRows ?? [])
    if (!manifestComplete(manifest)) return refusal('incomplete_manifest', 'the frozen source manifest is incomplete')

    // 5. The strict checker against the EXISTING durable image. An exception
    //    or an inconclusive outcome persists nothing and changes nothing, so
    //    the explicit re-check remains safe to run again later.
    try {
      fidelity = await deps.checkFidelity(attempt.image_url, manifest.map((m) => ({ label: m.label, image_url: m.source_image_url })))
    } catch (err) {
      return { ok: true, outcome: 'unresolved', status: 'error', detail: boundError(err, redactionList()) }
    }
    if (fidelity.status === 'unavailable' || fidelity.status === 'error') {
      return { ok: true, outcome: 'unresolved', status: fidelity.status, detail: fidelity.detail }
    }

    // 6. Persist the conclusive re-check as an append-only machine_check.
    const checkRow = {
      candidate_version_id: job.candidate_version_id,
      kind: 'fidelity',
      check_name: 'render_fidelity_recheck',
      status: fidelity.status,
      verdict: fidelity.status === 'passed' ? 'pass' : 'fail',
      score: fidelity.score,
      issues: { items: fidelity.issues, corrective_notes: fidelity.correctiveNotes, detail: fidelity.detail },
      model: fidelity.model,
      prompt_version: 'oq-fidelity-1',
      attempt: attempt.attempt_no,
      idempotency_key: recheckKey,
    }
    const { data: inserted, error: fErr } = await db.from('outfit_quality_machine_check').insert(checkRow).select('check_id').maybeSingle()
    checkId = inserted?.check_id ?? null
    if (fErr) {
      // Lost a race with a concurrent re-check — replay the winner's outcome.
      const { data: winner } = await db.from('outfit_quality_machine_check').select('*').eq('idempotency_key', recheckKey).maybeSingle()
      if (!winner) return refusal('record_failed', boundError(fErr.message, redactionList()))
      fidelity = fidelityFromCheckRow(winner)
      checkId = winner.check_id
      replayed = true
    }
    await db.from('outfit_quality_render_attempt').update({ fidelity_check_id: checkId }).eq('render_attempt_id', renderAttemptId)
  }

  // 7. The UNCHANGED retry budget decides what the conclusive outcome means.
  const plan = planFidelityAction({ attemptNo: attempt.attempt_no, outcome: fidelity.status, correctiveNotes: fidelity.correctiveNotes })

  if (plan.action === 'ready') {
    // Readiness still requires the current exact-version approval — identical
    // to the drain's pre-readiness gate.
    const gate = await verifyRenderableApproval(admin, job.candidate_version_id, job.approval_event_id)
    if (!gate.ok) {
      await db
        .from('outfit_quality_render_job')
        .update({ status: 'cancelled', last_error: boundError(`approval recheck failed before readiness: ${gate.code}`, redactionList()), updated_at: new Date().toISOString() })
        .eq('render_job_id', job.render_job_id)
        .eq('status', 'attention_required')
      return { ok: true, outcome: 'cancelled', reason: `approval recheck failed before readiness: ${gate.code}` }
    }
    await db
      .from('outfit_quality_render_attempt')
      .update({ ready_at: new Date().toISOString() })
      .eq('render_attempt_id', renderAttemptId)
    await attachPromotedImage(admin, job.candidate_version_id, attempt.image_url)
    await db
      .from('outfit_quality_render_job')
      .update({ status: 'ready', last_error: null, updated_at: new Date().toISOString() })
      .eq('render_job_id', job.render_job_id)
      .eq('status', 'attention_required')
    return { ok: true, outcome: 'ready', replayed, checkId: checkId! }
  }

  if (plan.action === 'retry') {
    // The re-check itself performs no submission. It re-queues the job so the
    // EXISTING explicit local drain runs the one corrective attempt under the
    // unchanged policy. Conditional on the attention state so a replay cannot
    // resurrect a job that already moved on.
    await db
      .from('outfit_quality_render_job')
      .update({
        status: 'queued',
        lease_token: null,
        leased_at: null,
        worker_id: null,
        last_error: 'fidelity re-check recorded a conclusive first failure with corrective evidence — run the explicit local drain for the corrective attempt',
        updated_at: new Date().toISOString(),
      })
      .eq('render_job_id', job.render_job_id)
      .eq('status', 'attention_required')
    return { ok: true, outcome: 'corrective_retry_authorized', replayed, checkId: checkId! }
  }

  // plan.action === 'attention': conclusive failure without corrective budget.
  await db
    .from('outfit_quality_render_job')
    .update({ last_error: boundError(plan.reason, redactionList()), updated_at: new Date().toISOString() })
    .eq('render_job_id', job.render_job_id)
    .eq('status', 'attention_required')
  return { ok: true, outcome: 'attention', replayed, checkId: checkId!, reason: plan.reason }
}
