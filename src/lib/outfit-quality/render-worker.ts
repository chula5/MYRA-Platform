// The approval-gated, explicitly drained Quality Lab render worker.
//
// THE GATE (VAL-RENDER-001): no job is claimed, no attempt is submitted, and
// no image is marked ready without a CURRENT, unreversed human Yes for the
// exact immutable candidate version. The gate is re-evaluated from append-only
// review events at claim time, immediately before a real submission, and again
// immediately before readiness — a withdrawal in flight stops the pipeline.
//
// THE DRAIN (VAL-RENDER-003): `drainQualityRenderQueue` runs only when an
// operator explicitly invokes it (gated server action / local entry point). It
// claims ONE job at a time, sequentially, and only when a locally
// authenticated Higgsfield renderer is present — on Vercel the CLI binary and
// credentials do not exist, so the queue is left completely untouched. Nothing
// here is scheduled, cron-driven, or completion-triggered.
//
// FROZEN INPUTS: the renderer and fidelity checker consume only the approved
// version's persisted candidate_item rows and the persisted stylist snapshot
// id. Mutable item/outfit/stylist/inspiration tables are never read.
//
// Server-only: reached through admin-gated wrappers or the local drainer.

import 'server-only'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { createAdminClient } from '@/lib/supabase-server'
import { latestActiveDecision, type ReviewEventRow } from '@/lib/outfit-quality/review-state'
import {
  LEASE_TTL_MS,
  MAX_ATTEMPTS_PER_CYCLE,
  QUALITY_RENDER_FOLDER,
  QUALITY_RENDER_MODEL,
  boundError,
  buildFrozenManifest,
  deriveCorrectivePrompt,
  manifestComplete,
  planFidelityAction,
  type FrozenManifestItem,
} from '@/lib/outfit-quality/render-domain'
import { checkQualityRenderFidelity, type StrictFidelityResult } from '@/lib/outfit-quality/fidelity'
import { attachPromotedImage, promoteApprovedVersion } from '@/lib/outfit-quality/promotion'
import { HIGGSFIELD_COMBOS, buildGenerationPrompt, buildReferenceUrls, type ShootItem } from '@/lib/higgsfield-shoot'
import { isCloudinaryUrl } from '@/lib/cloudinary-persist'

type Db = ReturnType<typeof createAdminClient>

// ── Adapters (deterministic in tests, real only in the local drain) ───────────

export interface GenerateResult {
  /** True only once a generation was actually submitted to the renderer. */
  submitted: boolean
  imageUrl?: string
  error?: string
}

export interface RenderAdapters {
  rendererAvailable(): boolean
  generate(prompt: string, referenceUrls: string[], publicId: string): Promise<GenerateResult>
  persist(imageUrl: string, opts: { folder: string; publicId: string }): Promise<string | null>
  checkFidelity(renderUrl: string, items: { label: string; image_url: string }[]): Promise<StrictFidelityResult>
}

/** Values that must never survive into a stored error. */
function redactionList(): string[] {
  return [process.env.CLOUDINARY_API_SECRET ?? '', process.env.CLOUDINARY_API_KEY ?? '', process.env.ANTHROPIC_API_KEY ?? ''].filter(Boolean)
}

// ── The exact-version approval gate ───────────────────────────────────────────

export type GateResult = { ok: true } | { ok: false; code: string; message: string }

function gateFail(code: string, message: string): GateResult {
  return { ok: false, code, message }
}

/**
 * Verify, from persisted evidence, that this exact immutable candidate version
 * is currently renderable: current for its case, objectively passed, frozen
 * manifest complete, and holding an unreversed human Yes — and when an
 * approval event is supplied, that it IS the current active approval (a
 * parent's or superseded approval never authorizes this version).
 */
export async function verifyRenderableApproval(
  admin: Db,
  candidateVersionId: string,
  approvalEventId?: string,
): Promise<GateResult> {
  const db = admin as any
  const [{ data: version, error: vErr }, { data: items, error: iErr }, { data: events, error: eErr }, { data: objectiveChecks, error: cErr }] =
    await Promise.all([
      db.from('outfit_quality_candidate_version').select('candidate_version_id, case_id, state').eq('candidate_version_id', candidateVersionId).maybeSingle(),
      db.from('outfit_quality_candidate_item').select('candidate_item_id, item_id, slot, sort_order, item_snapshot, source_image_url, source_image_asset_version, source_image_hash').eq('candidate_version_id', candidateVersionId),
      db.from('outfit_quality_review_event').select('*').eq('candidate_version_id', candidateVersionId).order('created_at', { ascending: true }),
      db.from('outfit_quality_machine_check').select('check_id, status').eq('candidate_version_id', candidateVersionId).eq('kind', 'objective'),
    ])
  const firstErr = vErr ?? iErr ?? eErr ?? cErr
  if (firstErr) return gateFail('read_failed', boundError(firstErr.message, redactionList()))
  if (!version) return gateFail('not_found', 'candidate version not found')

  const { data: kase, error: kErr } = await db
    .from('outfit_quality_case')
    .select('case_id, current_version_id')
    .eq('case_id', version.case_id)
    .maybeSingle()
  if (kErr) return gateFail('read_failed', boundError(kErr.message, redactionList()))
  if (!kase || kase.current_version_id !== candidateVersionId) {
    return gateFail('stale_version', 'a newer version of this candidate exists — approvals and renders belong to the old version')
  }

  const active = latestActiveDecision((events ?? []) as ReviewEventRow[])
  if (!active || active.decision !== 'yes') return gateFail('no_active_approval', 'no current unreversed human Yes for this exact version')
  if (approvalEventId && active.review_event_id !== approvalEventId) {
    return gateFail('approval_mismatch', 'the job’s approval event is not the current active approval')
  }
  if (version.state !== 'approved') return gateFail('not_approved_state', `version state is ${version.state}`)

  const checks = (objectiveChecks ?? []) as any[]
  if (checks.length === 0 || checks.some((c) => c.status !== 'passed')) {
    return gateFail('objective_not_passed', 'objective checks have not all passed')
  }

  if (!manifestComplete(buildFrozenManifest(items ?? []))) {
    return gateFail('incomplete_manifest', 'the frozen source manifest is incomplete')
  }

  return { ok: true }
}

// ── Lease recovery and claims ─────────────────────────────────────────────────

/**
 * Recover expired leases. A lease that never submitted a generation returns to
 * queued with generation_count untouched; a lease that DID submit cannot be
 * blindly rerun (the renderer may have charged), so it requires attention.
 */
export async function recoverStaleLeases(admin: Db, now: Date = new Date()): Promise<{ requeued: number; attention: number }> {
  const db = admin as any
  const staleBefore = new Date(now.getTime() - LEASE_TTL_MS).toISOString()
  const { data: stale } = await db
    .from('outfit_quality_render_job')
    .select('render_job_id, generation_count, leased_at')
    .eq('status', 'running')
    .lt('leased_at', staleBefore)

  let requeued = 0
  let attention = 0
  for (const job of (stale ?? []) as any[]) {
    if ((job.generation_count ?? 0) === 0) {
      // Conditional on the SAME stale lease, so a job that finished meanwhile
      // is never resurrected.
      const { data } = await db
        .from('outfit_quality_render_job')
        .update({ status: 'queued', lease_token: null, leased_at: null, worker_id: null, last_error: null, updated_at: new Date().toISOString() })
        .eq('render_job_id', job.render_job_id)
        .eq('status', 'running')
        .lt('leased_at', staleBefore)
        .select('render_job_id')
      if ((data ?? []).length === 1) requeued += 1
    } else {
      const { data } = await db
        .from('outfit_quality_render_job')
        .update({ status: 'attention_required', last_error: 'worker lease expired after a generation was submitted — reconcile manually before any rerun', updated_at: new Date().toISOString() })
        .eq('render_job_id', job.render_job_id)
        .eq('status', 'running')
        .lt('leased_at', staleBefore)
        .select('render_job_id')
      if ((data ?? []).length === 1) attention += 1
    }
  }
  return { requeued, attention }
}

/**
 * Claim at most one queued job for this worker. A queued job that fails the
 * approval gate is cancelled WITHOUT a lease — it is never claimed and never
 * reaches the renderer. The claim itself is a conditional atomic update, so
 * two concurrent drainers cannot own the same job.
 */
export async function claimNextQualityRenderJob(admin: Db, workerId: string): Promise<any | null> {
  const db = admin as any
  const { data: candidates, error } = await db
    .from('outfit_quality_render_job')
    .select('*')
    .eq('status', 'queued')
    .order('created_at', { ascending: true })
    .limit(5)
  if (error || !candidates || candidates.length === 0) return null

  for (const job of candidates as any[]) {
    const gate = await verifyRenderableApproval(admin, job.candidate_version_id, job.approval_event_id)
    if (!gate.ok) {
      // Dead work: approval gone, version superseded, manifest broken. Cancel
      // it unleashed so it can never be claimed or submitted.
      await db
        .from('outfit_quality_render_job')
        .update({ status: 'cancelled', last_error: `render gate refused: ${gate.code}`, updated_at: new Date().toISOString() })
        .eq('render_job_id', job.render_job_id)
        .eq('status', 'queued')
        .is('lease_token', null)
      continue
    }
    const lease = randomUUID()
    const { data: claimed } = await db
      .from('outfit_quality_render_job')
      .update({ status: 'running', lease_token: lease, leased_at: new Date().toISOString(), worker_id: workerId, updated_at: new Date().toISOString() })
      .eq('render_job_id', job.render_job_id)
      .eq('status', 'queued')
      .is('lease_token', null)
      .select('*')
    if ((claimed ?? []).length === 1) return claimed[0]
    // Lost the race — try the next candidate.
  }
  return null
}

// ── Attempt processing ────────────────────────────────────────────────────────

function shootItemsOf(manifest: FrozenManifestItem[]): ShootItem[] {
  return manifest.map((m) => ({
    product_name: m.product_name,
    item_type: m.item_type,
    material_primary: m.material_primary,
    slot: m.slot,
    image_url: m.source_image_url,
    brand_name: m.brand_name,
  }))
}

function manifestPayload(manifest: FrozenManifestItem[], versionId: string, snapshotId: string | null, cycleNo: number) {
  return {
    candidate_version_id: versionId,
    stylist_snapshot_id: snapshotId,
    cycle_no: cycleNo,
    items: manifest.map((m) => ({
      candidate_item_id: m.candidate_item_id,
      item_id: m.item_id,
      slot: m.slot,
      sort_order: m.sort_order,
      label: m.label,
      source_image_url: m.source_image_url,
      source_image_asset_version: m.source_image_asset_version,
      source_image_hash: m.source_image_hash,
    })),
  }
}

type AttemptOutcome =
  | { kind: 'ready' }
  | { kind: 'retry'; correctiveNotes: string }
  | { kind: 'attention'; reason: string }
  | { kind: 'cancelled'; reason: string }

async function loadAttempt(db: any, jobId: string, attemptNo: number): Promise<any | null> {
  const { data } = await db.from('outfit_quality_render_attempt').select('*').eq('render_job_id', jobId).eq('attempt_no', attemptNo).maybeSingle()
  return data ?? null
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

/**
 * Run one attempt of the cycle to its persisted conclusion. Every stage is
 * replay-safe: a re-run after a crash resumes from the persisted attempt row
 * and never re-submits a generation that already happened.
 */
async function runAttempt(
  admin: Db,
  job: any,
  attemptNo: number,
  manifest: FrozenManifestItem[],
  prompt: string,
  adapters: RenderAdapters,
): Promise<AttemptOutcome> {
  const db = admin as any
  const refs = buildReferenceUrls(HIGGSFIELD_COMBOS.E5, shootItemsOf(manifest))

  // 1. The attempt row, keyed by (render_job_id, attempt_no) — replay returns it.
  let attempt = await loadAttempt(db, job.render_job_id, attemptNo)
  if (!attempt) {
    const { data: created, error: aErr } = await db
      .from('outfit_quality_render_attempt')
      .insert({
        render_job_id: job.render_job_id,
        attempt_no: attemptNo,
        prompt,
        reference_manifest: manifestPayload(manifest, job.candidate_version_id, job.stylist_snapshot_id ?? null, job.cycle_no),
        renderer_model: QUALITY_RENDER_MODEL,
        renderer_version: 'higgsfield-cli',
      })
      .select('*')
      .maybeSingle()
    if (aErr) {
      // Lost a race with a resumed worker — load what exists and continue.
      attempt = await loadAttempt(db, job.render_job_id, attemptNo)
      if (!attempt) return { kind: 'attention', reason: boundError(`attempt insert failed: ${aErr.message}`, redactionList()) }
    } else {
      attempt = created
    }
  }

  // 2. Submission — only ever when this attempt has never been submitted.
  if (!attempt.generation_status) {
    // Pre-submission approval recheck: a withdrawal since the claim stops the render.
    const gate = await verifyRenderableApproval(admin, job.candidate_version_id, job.approval_event_id)
    if (!gate.ok) return { kind: 'cancelled', reason: `approval recheck failed before submission: ${gate.code}` }

    const publicId = `oq-${attempt.render_attempt_id}`
    let gen: GenerateResult
    try {
      gen = await adapters.generate(prompt, refs, publicId)
    } catch (err) {
      gen = { submitted: false, error: boundError(err, redactionList()) }
    }

    if (!gen.submitted) {
      await db
        .from('outfit_quality_render_attempt')
        .update({ generation_status: 'pre_submission_failed', generation_error: boundError(gen.error ?? 'renderer unavailable', redactionList()) })
        .eq('render_attempt_id', attempt.render_attempt_id)
      return { kind: 'attention', reason: boundError(`renderer not submitted: ${gen.error ?? 'unavailable'}`, redactionList()) }
    }

    // A generation was actually submitted — count it exactly once.
    await db
      .from('outfit_quality_render_job')
      .update({ generation_count: attemptNo, updated_at: new Date().toISOString() })
      .eq('render_job_id', job.render_job_id)
      .eq('lease_token', job.lease_token)

    if (!gen.imageUrl) {
      await db
        .from('outfit_quality_render_attempt')
        .update({ generation_status: 'failed', generation_error: boundError(gen.error ?? 'no image returned', redactionList()) })
        .eq('render_attempt_id', attempt.render_attempt_id)
      return { kind: 'attention', reason: boundError(`generation failed: ${gen.error ?? 'no image returned'}`, redactionList()) }
    }
    await db
      .from('outfit_quality_render_attempt')
      .update({ generation_status: 'generated' })
      .eq('render_attempt_id', attempt.render_attempt_id)
    attempt = { ...attempt, generation_status: 'generated', generation_error: null, ephemeral_image_url: gen.imageUrl }
  }

  // 3. Durable persistence BEFORE fidelity — an ephemeral renderer URL is never
  //    a gallery asset.
  if (!attempt.image_url) {
    const ephemeral = (attempt as any).ephemeral_image_url
    if (!ephemeral) {
      // A crashed run whose ephemeral URL was never persisted cannot resume the
      // image; fail closed rather than re-submitting a charged generation.
      return { kind: 'attention', reason: 'attempt has no persisted image and cannot be safely resumed — reconcile manually' }
    }
    let durable: string | null = null
    let persistErr: string | null = null
    try {
      durable = isCloudinaryUrl(ephemeral)
        ? ephemeral
        : await adapters.persist(ephemeral, { folder: QUALITY_RENDER_FOLDER, publicId: `oq-${attempt.render_attempt_id}` })
    } catch (err) {
      persistErr = boundError(err, redactionList())
    }
    if (!durable || !isCloudinaryUrl(durable)) {
      await db
        .from('outfit_quality_render_attempt')
        .update({ generation_status: 'persist_failed', generation_error: persistErr ?? 'durable Cloudinary persistence failed' })
        .eq('render_attempt_id', attempt.render_attempt_id)
      return { kind: 'attention', reason: boundError(`persist failed: ${persistErr ?? 'no durable Cloudinary asset'}`, redactionList()) }
    }
    await db
      .from('outfit_quality_render_attempt')
      .update({ image_url: durable, cloudinary_asset: `oq-${attempt.render_attempt_id}`, generation_error: null })
      .eq('render_attempt_id', attempt.render_attempt_id)
    attempt = { ...attempt, image_url: durable }
  }

  // 4. Fidelity, recorded as a machine_check correlated to the attempt.
  let fidelity: StrictFidelityResult
  if (attempt.fidelity_check_id) {
    const { data: checkRow } = await db.from('outfit_quality_machine_check').select('*').eq('check_id', attempt.fidelity_check_id).maybeSingle()
    if (!checkRow) return { kind: 'attention', reason: 'persisted fidelity check is missing — reconcile manually' }
    fidelity = fidelityFromCheckRow(checkRow)
  } else {
    fidelity = await adapters
      .checkFidelity(attempt.image_url, manifest.map((m) => ({ label: m.label, image_url: m.source_image_url })))
      .catch((err) => ({ status: 'error', score: null, issues: [], correctiveNotes: null, detail: boundError(err, redactionList()), model: 'unknown' }) as StrictFidelityResult)

    const checkRow = {
      candidate_version_id: job.candidate_version_id,
      kind: 'fidelity',
      check_name: 'render_fidelity',
      status: fidelity.status,
      verdict: fidelity.status === 'passed' ? 'pass' : fidelity.status === 'failed' ? 'fail' : null,
      score: fidelity.score,
      issues: { items: fidelity.issues, corrective_notes: fidelity.correctiveNotes, detail: fidelity.detail },
      model: fidelity.model,
      prompt_version: 'oq-fidelity-1',
      attempt: attemptNo,
      idempotency_key: `fidelity:${attempt.render_attempt_id}`,
    }
    const { data: inserted, error: fErr } = await db.from('outfit_quality_machine_check').insert(checkRow).select('check_id').maybeSingle()
    let checkId = inserted?.check_id ?? null
    if (fErr) {
      // Replay: the check for this attempt already exists.
      const { data: existing } = await db.from('outfit_quality_machine_check').select('check_id').eq('idempotency_key', checkRow.idempotency_key).maybeSingle()
      checkId = existing?.check_id ?? null
      if (!checkId) return { kind: 'attention', reason: boundError(`fidelity record failed: ${fErr.message}`, redactionList()) }
    }
    await db.from('outfit_quality_render_attempt').update({ fidelity_check_id: checkId }).eq('render_attempt_id', attempt.render_attempt_id)
  }

  // 5. The retry budget decides what this outcome means.
  const plan = planFidelityAction({ attemptNo, outcome: fidelity.status, correctiveNotes: fidelity.correctiveNotes })
  if (plan.action === 'retry') return { kind: 'retry', correctiveNotes: plan.correctiveNotes }
  if (plan.action === 'attention') return { kind: 'attention', reason: fidelity.detail ? `${plan.reason}: ${fidelity.detail}` : plan.reason }

  // 6. Readiness requires the approval to STILL be current.
  const gate = await verifyRenderableApproval(admin, job.candidate_version_id, job.approval_event_id)
  if (!gate.ok) return { kind: 'cancelled', reason: `approval recheck failed before readiness: ${gate.code}` }

  await db
    .from('outfit_quality_render_attempt')
    .update({ ready_at: new Date().toISOString() })
    .eq('render_attempt_id', attempt.render_attempt_id)
  await attachPromotedImage(admin, job.candidate_version_id, attempt.image_url)
  return { kind: 'ready' }
}

export type ProcessOutcome = 'ready' | 'attention' | 'cancelled'

export async function processClaimedJob(
  admin: Db,
  job: any,
  adapters: RenderAdapters,
): Promise<{ outcome: ProcessOutcome; detail?: string }> {
  const db = admin as any
  const finish = async (status: string, detail?: string) => {
    await db
      .from('outfit_quality_render_job')
      .update({ status, last_error: detail ? boundError(detail, redactionList()) : null, updated_at: new Date().toISOString() })
      .eq('render_job_id', job.render_job_id)
      .eq('lease_token', job.lease_token)
  }

  // Frozen inputs only: the approved version's persisted manifest + snapshot id.
  const [{ data: itemRows }, { data: kase }] = await Promise.all([
    db.from('outfit_quality_candidate_item').select('*').eq('candidate_version_id', job.candidate_version_id),
    db.from('outfit_quality_case').select('case_id, stylist_snapshot_id').eq('case_id', (await db.from('outfit_quality_candidate_version').select('case_id').eq('candidate_version_id', job.candidate_version_id).maybeSingle()).data?.case_id ?? '').maybeSingle(),
  ])
  const manifest = buildFrozenManifest(itemRows ?? [])
  if (!manifestComplete(manifest)) {
    await finish('attention_required', 'frozen manifest incomplete at claim')
    return { outcome: 'attention', detail: 'frozen manifest incomplete' }
  }
  job = { ...job, stylist_snapshot_id: kase?.stylist_snapshot_id ?? null }

  // Promotion rides the approval transaction; ensure it here too so an
  // approval whose decide-time promotion failed still renders into its one
  // canonical outfit. Idempotent — an existing promotion is returned as-is.
  const promotion = await promoteApprovedVersion(admin, job.candidate_version_id)
  if (!promotion.ok) {
    await finish('attention_required', `promotion failed: ${promotion.code}`)
    return { outcome: 'attention', detail: `promotion failed: ${promotion.code}` }
  }
  if (!job.promotion_id) {
    await db
      .from('outfit_quality_render_job')
      .update({ promotion_id: promotion.promotionId, updated_at: new Date().toISOString() })
      .eq('render_job_id', job.render_job_id)
      .eq('lease_token', job.lease_token)
    job = { ...job, promotion_id: promotion.promotionId }
  }

  const basePrompt = buildGenerationPrompt(HIGGSFIELD_COMBOS.E5, shootItemsOf(manifest))

  let prompt = basePrompt
  for (let attemptNo = 1; attemptNo <= MAX_ATTEMPTS_PER_CYCLE; attemptNo++) {
    const result = await runAttempt(admin, job, attemptNo, manifest, prompt, adapters)
    if (result.kind === 'ready') {
      await finish('ready')
      return { outcome: 'ready' }
    }
    if (result.kind === 'cancelled') {
      await finish('cancelled', result.reason)
      return { outcome: 'cancelled', detail: result.reason }
    }
    if (result.kind === 'attention') {
      await finish('attention_required', result.reason)
      return { outcome: 'attention', detail: result.reason }
    }
    // Exactly one corrective retry, derived from the persisted attempt-1 prompt.
    const attempt1 = await loadAttempt(db, job.render_job_id, 1)
    prompt = deriveCorrectivePrompt(attempt1?.prompt ?? basePrompt, result.correctiveNotes)
  }
  await finish('attention_required', 'attempt budget exhausted')
  return { outcome: 'attention', detail: 'attempt budget exhausted' }
}

// ── The explicit sequential drain ─────────────────────────────────────────────

export interface DrainResult {
  claimed: number
  ready: number
  attention: number
  cancelled: number
  skipped?: string
}

/**
 * Drain the Quality Lab render queue, one job at a time, ONLY when explicitly
 * invoked by a local operator and only when the locally authenticated renderer
 * exists in this environment. There is no Vercel claimant, no cron
 * continuation, and no completion-triggered next claim.
 */
export async function drainQualityRenderQueue(
  admin: Db,
  opts: { workerId: string; maxJobs?: number; adapters: RenderAdapters },
): Promise<DrainResult> {
  if (!opts.adapters.rendererAvailable()) {
    return { claimed: 0, ready: 0, attention: 0, cancelled: 0, skipped: 'no Higgsfield renderer in this environment — jobs left queued' }
  }
  const maxJobs = Math.min(Math.max(opts.maxJobs ?? 10, 1), 25)
  await recoverStaleLeases(admin)

  let claimed = 0
  let ready = 0
  let attention = 0
  let cancelled = 0
  while (claimed < maxJobs) {
    const job = await claimNextQualityRenderJob(admin, opts.workerId)
    if (!job) break
    claimed += 1
    const res = await processClaimedJob(admin, job, opts.adapters)
    if (res.outcome === 'ready') ready += 1
    else if (res.outcome === 'attention') attention += 1
    else cancelled += 1
  }
  return { claimed, ready, attention, cancelled }
}

// ── Real adapters (local drain only) ──────────────────────────────────────────

/** runHiggsfieldGeneration error strings that mean the CLI never submitted. */
const PRE_SUBMISSION = /not logged in|No prompt|No reference|Could not download/i

export function realQualityRenderAdapters(): RenderAdapters {
  return {
    rendererAvailable: () => {
      try {
        // Server-only module: the local Higgsfield CLI binary marks a
        // render-capable environment. Vercel runtime never has it.
        return existsSync(join(process.cwd(), 'node_modules', '.bin', 'higgsfield'))

      } catch {
        return false
      }
    },
    generate: async (prompt, referenceUrls, publicId) => {
      const { runHiggsfieldGeneration } = await import('@/app/admin/projects/higgsfield-actions')
      const r = await runHiggsfieldGeneration(prompt, referenceUrls, publicId)
      if (r.imageUrl) return { submitted: true, imageUrl: r.imageUrl }
      const error = r.error ?? 'unknown renderer error'
      return { submitted: !PRE_SUBMISSION.test(error), error }
    },
    persist: async (imageUrl, opts) => {
      const { persistImageToCloudinary } = await import('@/lib/cloudinary-persist')
      return persistImageToCloudinary(imageUrl, opts)
    },
    checkFidelity: (renderUrl, items) => checkQualityRenderFidelity(renderUrl, items),
  }
}
