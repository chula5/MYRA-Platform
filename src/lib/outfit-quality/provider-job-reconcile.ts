// Read-only reconciliation of an ACCEPTED Higgsfield provider job for the
// Outfit Quality Lab render path.
//
// WHY: `create` and result retrieval are separate phases. Once Higgsfield
// accepts a create request the attempt row persists its `provider_job_id`
// immediately (see render-worker). If the subsequent wait/result retrieval
// then fails transiently (a 403, a timeout), the job is left reconcilable:
// the accepted provider job may well have completed and been charged, so the
// ONLY correct recovery is to read it back — never to create again.
//
// This module:
//   · reads the accepted provider job READ-ONLY (`generate get <id>`) — there
//     is deliberately NO generate/create slot in its deps, so no code path here
//     can submit or re-submit a generation or increment the generation count;
//   · persists a recovered completed result durably to Cloudinary exactly once
//     (only when the attempt has no durable image yet), then runs the strict
//     fidelity checker against the frozen sources and, on a conclusive pass,
//     re-gates the EXISTING attempt against the current exact-version approval
//     before marking it ready — identical to the drain's readiness gate;
//   · is idempotent: replaying a recovered attempt returns the same correlated
//     job/attempt/result with no duplicate asset, attempt, generation count, or
//     readiness transition;
//   · is fail-closed: a pending job persists nothing (safe to reconcile again);
//     a failed/not-found job stays attention_required; an unavailable/errored
//     fidelity check keeps the recovered durable image but records no
//     conclusive check, leaving a later explicit fidelity re-check available;
//   · preserves the UNCHANGED corrective-retry policy: a conclusive first
//     fidelity failure with corrective evidence re-queues the job so the
//     explicit local drain runs the one corrective attempt (no submission here).
//
// Server-only: reached through the admin-gated action or a local operator
// script. Explicit invocation only — nothing here is scheduled or automatic.

import 'server-only'
import { createAdminClient } from '@/lib/supabase-server'
import {
  QUALITY_RENDER_FOLDER,
  QUALITY_RENDER_MODEL,
  boundError,
  buildFrozenManifest,
  manifestComplete,
  planFidelityAction,
} from '@/lib/outfit-quality/render-domain'
import { verifyRenderableApproval, type ProviderJobStatus } from '@/lib/outfit-quality/render-worker'
import { attachPromotedImage } from '@/lib/outfit-quality/promotion'
import { checkQualityRenderFidelity, type StrictFidelityResult } from '@/lib/outfit-quality/fidelity'
import { isCloudinaryUrl } from '@/lib/cloudinary-persist'

type Db = ReturnType<typeof createAdminClient>

/**
 * The reconcile's dependencies: a READ-ONLY provider get, durable persistence,
 * and the strict fidelity checker. There is deliberately NO renderer/submit
 * slot — this path cannot create or re-create a generation.
 */
export interface ProviderJobReconcileDeps {
  getProviderJob(providerJobId: string): Promise<ProviderJobStatus>
  persist(imageUrl: string, opts: { folder: string; publicId: string }): Promise<string | null>
  checkFidelity(renderUrl: string, items: { label: string; image_url: string }[]): Promise<StrictFidelityResult>
}

export type ReconcileResult =
  | { ok: true; outcome: 'ready'; replayed: boolean }
  | { ok: true; outcome: 'corrective_retry_authorized'; replayed: boolean }
  | { ok: true; outcome: 'attention'; replayed: boolean; reason: string }
  | { ok: true; outcome: 'pending'; providerState: string }
  | { ok: true; outcome: 'cancelled'; reason: string }
  | { ok: false; code: string; message: string }

function refusal(code: string, message: string): ReconcileResult {
  return { ok: false, code, message }
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
    model: row.model ?? QUALITY_RENDER_MODEL,
  }
}

/** The default real dependencies: the read-only CLI get, Cloudinary, Anthropic. */
export function realProviderJobReconcileDeps(): ProviderJobReconcileDeps {
  return {
    getProviderJob: async (providerJobId) => {
      const { getHiggsfieldJob } = await import('@/app/admin/projects/higgsfield-actions')
      return getHiggsfieldJob(providerJobId)
    },
    persist: async (imageUrl, opts) => {
      const { persistImageToCloudinary } = await import('@/lib/cloudinary-persist')
      return persistImageToCloudinary(imageUrl, opts)
    },
    checkFidelity: (renderUrl, items) => checkQualityRenderFidelity(renderUrl, items),
  }
}

/**
 * Reconcile ONE accepted provider job read-only. Explicit, idempotent, and
 * fail-closed; never submits a render and never increments generation_count.
 */
export async function reconcileAcceptedProviderJob(
  admin: Db,
  renderAttemptId: string,
  deps: ProviderJobReconcileDeps = realProviderJobReconcileDeps(),
): Promise<ReconcileResult> {
  const db = admin as any

  // 1. Load the attempt and its job.
  const { data: attempt, error: aErr } = await db
    .from('outfit_quality_render_attempt')
    .select('*')
    .eq('render_attempt_id', renderAttemptId)
    .maybeSingle()
  if (aErr) return refusal('read_failed', boundError(aErr.message, redactionList()))
  if (!attempt) return refusal('not_found', 'render attempt not found')

  // Idempotent replay: an already-ready attempt returns ready without any
  // provider contact or new side effect.
  if (attempt.ready_at) return { ok: true, outcome: 'ready', replayed: true }

  if (!attempt.provider_job_id) {
    return refusal('no_provider_job', 'the attempt has no persisted accepted provider job id — nothing to reconcile')
  }

  const { data: job, error: jErr } = await db
    .from('outfit_quality_render_job')
    .select('*')
    .eq('render_job_id', attempt.render_job_id)
    .maybeSingle()
  if (jErr) return refusal('read_failed', boundError(jErr.message, redactionList()))
  if (!job) return refusal('not_found', 'owning render job not found')
  if (job.status !== 'attention_required') {
    return refusal('job_not_reconcilable', `job status is ${job.status} — reconciliation only applies to attention_required jobs`)
  }

  // 2. Recover a durable image if the attempt has none yet. The provider job is
  //    read READ-ONLY; a completed result is persisted to Cloudinary exactly
  //    once. Replaying with an image already set skips this entirely.
  if (!attempt.image_url) {
    let provider: ProviderJobStatus
    try {
      provider = await deps.getProviderJob(attempt.provider_job_id)
    } catch (err) {
      await db
        .from('outfit_quality_render_attempt')
        .update({ generation_error: boundError(err, redactionList()) })
        .eq('render_attempt_id', renderAttemptId)
      return { ok: true, outcome: 'attention', replayed: false, reason: boundError(`provider get failed: ${err}`, redactionList()) }
    }

    if (provider.state === 'pending') {
      return { ok: true, outcome: 'pending', providerState: 'pending' }
    }
    if (provider.state !== 'completed' || !provider.imageUrl) {
      // Failed / not-found / error — fail closed; the job stays attention.
      await db
        .from('outfit_quality_render_attempt')
        .update({ generation_status: 'failed', generation_error: boundError(provider.error ?? `provider job ${provider.state}`, redactionList()) })
        .eq('render_attempt_id', renderAttemptId)
      return { ok: true, outcome: 'attention', replayed: false, reason: boundError(`accepted provider job ${provider.state}`, redactionList()) }
    }

    // Durable persistence BEFORE fidelity — an ephemeral provider URL is never
    // a gallery asset.
    const ephemeral = provider.imageUrl
    let durable: string | null = null
    let persistErr: string | null = null
    try {
      durable = isCloudinaryUrl(ephemeral)
        ? ephemeral
        : await deps.persist(ephemeral, { folder: QUALITY_RENDER_FOLDER, publicId: `oq-${renderAttemptId}` })
    } catch (err) {
      persistErr = boundError(err, redactionList())
    }
    if (!durable || !isCloudinaryUrl(durable)) {
      await db
        .from('outfit_quality_render_attempt')
        .update({ generation_status: 'persist_failed', generation_error: persistErr ?? 'durable Cloudinary persistence failed' })
        .eq('render_attempt_id', renderAttemptId)
      return { ok: true, outcome: 'attention', replayed: false, reason: boundError(`persist failed: ${persistErr ?? 'no durable Cloudinary asset'}`, redactionList()) }
    }
    await db
      .from('outfit_quality_render_attempt')
      .update({ image_url: durable, cloudinary_asset: `oq-${renderAttemptId}`, generation_status: 'generated', provider_status: 'completed', generation_error: null })
      .eq('render_attempt_id', renderAttemptId)
    attempt.image_url = durable
    attempt.provider_status = 'completed'
  }

  // 3. Fidelity against the frozen sources. Replay returns the recorded check.
  const manifestFromRows = async () => {
    const { data: itemRows } = await db.from('outfit_quality_candidate_item').select('*').eq('candidate_version_id', job.candidate_version_id)
    return buildFrozenManifest(itemRows ?? [])
  }

  let fidelity: StrictFidelityResult
  if (attempt.fidelity_check_id) {
    const { data: checkRow } = await db.from('outfit_quality_machine_check').select('*').eq('check_id', attempt.fidelity_check_id).maybeSingle()
    if (!checkRow) return refusal('read_failed', 'persisted fidelity check is missing')
    fidelity = fidelityFromCheckRow(checkRow)
  } else {
    const manifest = await manifestFromRows()
    if (!manifestComplete(manifest)) return refusal('incomplete_manifest', 'the frozen source manifest is incomplete')
    try {
      fidelity = await deps.checkFidelity(attempt.image_url, manifest.map((m) => ({ label: m.label, image_url: m.source_image_url })))
    } catch (err) {
      // Fail closed: keep the recovered durable image, record no conclusive
      // check, leave the job for a later explicit re-check.
      await db
        .from('outfit_quality_render_job')
        .update({ last_error: boundError(`fidelity check error — fail closed: ${err}`, redactionList()), updated_at: new Date().toISOString() })
        .eq('render_job_id', job.render_job_id)
        .eq('status', 'attention_required')
      return { ok: true, outcome: 'attention', replayed: false, reason: 'fidelity check error — fail closed' }
    }

    if (fidelity.status === 'unavailable' || fidelity.status === 'error') {
      // Inconclusive: persist nothing conclusive so the recovered image can be
      // re-checked once the checker recovers.
      await db
        .from('outfit_quality_render_job')
        .update({ last_error: boundError(`fidelity ${fidelity.status} — fail closed`, redactionList()), updated_at: new Date().toISOString() })
        .eq('render_job_id', job.render_job_id)
        .eq('status', 'attention_required')
      return { ok: true, outcome: 'attention', replayed: false, reason: `fidelity ${fidelity.status} — fail closed` }
    }

    // Persist the conclusive fidelity outcome under the SAME key the drain uses,
    // so a later drain replay never double-records it.
    const checkRow = {
      candidate_version_id: job.candidate_version_id,
      kind: 'fidelity',
      check_name: 'render_fidelity',
      status: fidelity.status,
      verdict: fidelity.status === 'passed' ? 'pass' : 'fail',
      score: fidelity.score,
      issues: { items: fidelity.issues, corrective_notes: fidelity.correctiveNotes, detail: fidelity.detail },
      model: fidelity.model,
      prompt_version: 'oq-fidelity-1',
      attempt: attempt.attempt_no,
      idempotency_key: `fidelity:${renderAttemptId}`,
    }
    const { data: inserted, error: fErr } = await db.from('outfit_quality_machine_check').insert(checkRow).select('check_id').maybeSingle()
    let checkId = inserted?.check_id ?? null
    if (fErr) {
      const { data: existing } = await db.from('outfit_quality_machine_check').select('*').eq('idempotency_key', checkRow.idempotency_key).maybeSingle()
      if (!existing) return refusal('record_failed', boundError(fErr.message, redactionList()))
      fidelity = fidelityFromCheckRow(existing)
      checkId = existing.check_id
    }
    await db.from('outfit_quality_render_attempt').update({ fidelity_check_id: checkId }).eq('render_attempt_id', renderAttemptId)
  }

  // 4. The UNCHANGED retry budget decides what the conclusive outcome means.
  const plan = planFidelityAction({ attemptNo: attempt.attempt_no, outcome: fidelity.status, correctiveNotes: fidelity.correctiveNotes })

  if (plan.action === 'ready') {
    // Readiness still requires the current exact-version approval.
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
    return { ok: true, outcome: 'ready', replayed: false }
  }

  if (plan.action === 'retry') {
    // The recovered image is kept; the job is re-queued so the EXISTING explicit
    // local drain runs the one corrective attempt. No submission happens here.
    await db
      .from('outfit_quality_render_job')
      .update({
        status: 'queued',
        lease_token: null,
        leased_at: null,
        worker_id: null,
        last_error: 'reconciled a conclusive first fidelity failure with corrective evidence — run the explicit local drain for the corrective attempt',
        updated_at: new Date().toISOString(),
      })
      .eq('render_job_id', job.render_job_id)
      .eq('status', 'attention_required')
    return { ok: true, outcome: 'corrective_retry_authorized', replayed: false }
  }

  // plan.action === 'attention': conclusive failure without corrective budget.
  await db
    .from('outfit_quality_render_job')
    .update({ last_error: boundError(plan.reason, redactionList()), updated_at: new Date().toISOString() })
    .eq('render_job_id', job.render_job_id)
    .eq('status', 'attention_required')
  return { ok: true, outcome: 'attention', replayed: false, reason: plan.reason }
}
