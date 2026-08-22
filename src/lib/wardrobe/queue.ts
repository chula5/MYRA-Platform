// The ONE sequential wardrobe extraction queue — modelled on render-queue.ts.
//
// Jobs run strictly one at a time: detect (priority 1, cheap, unblocks review
// of what was found) ahead of extract / regenerate / rescore, FIFO within
// priority. A 12-photo upload therefore produces 12 detects then N cutouts in
// series, never N parallel image generations. Claims are guarded so two
// overlapping drains (a cron tick + an admin "process now") cannot both take
// the same job, and a crashed drain is recovered after queueStaleMs.
//
// Drains: fire-and-forget after an upload (waitUntil), the admin/client page
// polling "process now" while anything is queued, and /api/cron/wardrobe-queue.

import 'server-only'
import { analyseProductImage } from '@/app/admin/items/analyse-image'
import { WARDROBE_CONFIG, openAiConfigured } from './config'
import { detectGarments, editToCutout, OpenAIError } from './openai'
import { buildCutoutPrompt, cropGarment, cutoutLooksValid, detectorJpeg, frameOnWhite, normalisePhoto } from './cutout'
import { uploadBufferToCloudinary } from './cloudinary'
import { imageCallCost, textCallCost } from './cost'
import { lowConfidenceDims } from './approve'
import { admin, downloadPhotoBytes, logApiCall } from './store'
import type { DetectedGarment } from './types'

interface Job {
  job_id: string
  kind: 'detect' | 'extract' | 'regenerate' | 'rescore'
  batch_id: string | null
  photo_id: string | null
  extraction_id: string | null
  owner_user_id: string
  attempts: number
  payload: Record<string, unknown>
}

export async function processWardrobeQueue(budgetMs = 50_000): Promise<{ done: number; failed: number; remaining: number; skipped?: string }> {
  const a = admin()
  const startedAt = Date.now()
  let done = 0
  let failed = 0

  // Recover stale running jobs (crashed invocation) → back to queued.
  const staleBefore = new Date(Date.now() - WARDROBE_CONFIG.queueStaleMs).toISOString()
  await a.from('wardrobe_job').update({ status: 'queued' }).eq('status', 'running').lt('started_at', staleBefore)

  if (!openAiConfigured()) {
    const { count } = await a.from('wardrobe_job').select('job_id', { count: 'exact', head: true }).eq('status', 'queued')
    return { done: 0, failed: 0, remaining: count ?? 0, skipped: 'OPENAI_API_KEY not configured — jobs left queued' }
  }

  while (Date.now() - startedAt < budgetMs) {
    const { data: running } = await a.from('wardrobe_job').select('job_id').eq('status', 'running').limit(1)
    if ((running ?? []).length > 0) break // another drain holds the queue

    const { data: nextRows } = await a
      .from('wardrobe_job')
      .select('job_id, kind, batch_id, photo_id, extraction_id, owner_user_id, attempts, payload')
      .eq('status', 'queued')
      .order('priority', { ascending: true })
      .order('created_at', { ascending: true })
      .limit(1)
    const job = (nextRows ?? [])[0] as Job | undefined
    if (!job) break

    const { data: claimed } = await a
      .from('wardrobe_job')
      .update({ status: 'running', started_at: new Date().toISOString(), attempts: job.attempts + 1 })
      .eq('job_id', job.job_id)
      .eq('status', 'queued')
      .select('job_id')
    if (!claimed || claimed.length === 0) continue

    let error: string | null = null
    try {
      if (job.kind === 'detect') await runDetect(job)
      else if (job.kind === 'rescore') await runRescore(job)
      else await runExtract(job, job.kind === 'regenerate')
    } catch (err) {
      error = (err instanceof Error ? err.message : 'Job crashed').slice(0, 500)
    }

    if (!error) {
      await a.from('wardrobe_job').update({ status: 'done', finished_at: new Date().toISOString(), error: null }).eq('job_id', job.job_id)
      done++
    } else {
      // Auth/config errors will never succeed on retry; everything else gets one more go.
      const permanent = /OPENAI_API_KEY|401|403|invalid_api_key|insufficient_quota|billing/i.test(error)
      if (!permanent && job.attempts + 1 < WARDROBE_CONFIG.queueMaxAttempts) {
        await a.from('wardrobe_job').update({ status: 'queued', error }).eq('job_id', job.job_id)
      } else {
        await a.from('wardrobe_job').update({ status: 'failed', finished_at: new Date().toISOString(), error }).eq('job_id', job.job_id)
        if (job.kind === 'detect' && job.photo_id) await a.from('wardrobe_photo').update({ status: 'failed', error }).eq('photo_id', job.photo_id)
        if (job.extraction_id) await a.from('wardrobe_extraction').update({ status: 'failed', error, updated_at: new Date().toISOString() }).eq('extraction_id', job.extraction_id)
        failed++
      }
    }
  }

  const { count } = await a.from('wardrobe_job').select('job_id', { count: 'exact', head: true }).eq('status', 'queued')
  await closeFinishedBatches()
  return { done, failed, remaining: count ?? 0 }
}

// A batch is done when none of its photos or extractions still has work pending.
async function closeFinishedBatches(): Promise<void> {
  const a = admin()
  const { data: open } = await a.from('wardrobe_batch').select('batch_id').in('status', ['open', 'processing']).limit(200)
  for (const b of (open ?? []) as any[]) {
    const { count } = await a.from('wardrobe_job').select('job_id', { count: 'exact', head: true }).eq('batch_id', b.batch_id).in('status', ['queued', 'running'])
    if ((count ?? 0) === 0) {
      const { count: photos } = await a.from('wardrobe_photo').select('photo_id', { count: 'exact', head: true }).eq('batch_id', b.batch_id)
      if ((photos ?? 0) > 0) await a.from('wardrobe_batch').update({ status: 'done' }).eq('batch_id', b.batch_id)
    }
  }
}

// ── Stage 1: DETECT ─────────────────────────────────────────────────────────

async function runDetect(job: Job): Promise<void> {
  const a = admin()
  if (!job.photo_id) throw new Error('detect job without photo')
  const { data: photo } = await a.from('wardrobe_photo').select('*').eq('photo_id', job.photo_id).single()
  if (!photo || photo.status === 'deleted') return
  await a.from('wardrobe_photo').update({ status: 'detecting', error: null }).eq('photo_id', photo.photo_id)

  const bytes = await downloadPhotoBytes(photo.storage_path)
  const { png } = await normalisePhoto(bytes)
  const small = await detectorJpeg(png)

  let det
  try {
    det = await detectGarments(small)
  } catch (err) {
    const model = WARDROBE_CONFIG.visionModel
    await logApiCall({ batchId: job.batch_id, ownerId: job.owner_user_id, stage: 'detect', provider: 'openai', model, costUsd: 0, estimated: true, ok: false })
    throw err
  }
  const cost = textCallCost(det.model, det.usage)
  await logApiCall({ batchId: job.batch_id, ownerId: job.owner_user_id, stage: 'detect', provider: 'openai', model: det.model, usage: det.usage, costUsd: cost.usd, estimated: cost.estimated, durationMs: det.ms })

  if (!det.garments.length) {
    await a.from('wardrobe_photo').update({ status: 'no_garments', detected: det.raw as any, garment_count: 0 }).eq('photo_id', photo.photo_id)
    return
  }

  // One extraction row per garment, with its padded crop hosted for the review card.
  const rows: any[] = []
  for (let i = 0; i < det.garments.length; i++) {
    const g = det.garments[i]
    let cropUrl: string | null = null
    try {
      const crop = await cropGarment(png, g.bounding_box)
      const up = await uploadBufferToCloudinary(crop, { folder: `${WARDROBE_CONFIG.cloudinaryFolder}/${job.owner_user_id}/crops`, publicId: `crop-${photo.photo_id}-${i + 1}` })
      cropUrl = up.url ?? null
    } catch { /* a missing crop thumbnail is cosmetic */ }
    rows.push({
      photo_id: photo.photo_id,
      batch_id: job.batch_id,
      owner_user_id: photo.owner_user_id,
      owner_kind: photo.owner_kind,
      position: i + 1,
      status: 'cutout_queued',
      detected: g,
      crop_url: cropUrl,
    })
  }
  const { data: inserted, error } = await a.from('wardrobe_extraction').insert(rows).select('extraction_id')
  if (error) throw new Error(error.message)
  await a.from('wardrobe_job').insert(
    ((inserted ?? []) as any[]).map((x) => ({
      kind: 'extract', batch_id: job.batch_id, photo_id: photo.photo_id, extraction_id: x.extraction_id, owner_user_id: photo.owner_user_id, priority: 2,
    })),
  )
  await a.from('wardrobe_photo').update({ status: 'detected', detected: det.raw as any, garment_count: det.garments.length }).eq('photo_id', photo.photo_id)
}

// ── Stage 2 + 3: CUTOUT then SCORE ──────────────────────────────────────────

async function runExtract(job: Job, regenerate: boolean): Promise<void> {
  const a = admin()
  if (!job.extraction_id) throw new Error('extract job without extraction')
  const { data: x } = await a.from('wardrobe_extraction').select('*, photo:photo_id(storage_path, status)').eq('extraction_id', job.extraction_id).single()
  if (!x || x.status === 'discarded' || x.status === 'approved' || x.photo?.status === 'deleted') return
  const g = x.detected as DetectedGarment
  await a.from('wardrobe_extraction').update({ status: 'cutout_running', error: null, updated_at: new Date().toISOString() }).eq('extraction_id', x.extraction_id)

  const bytes = await downloadPhotoBytes(x.photo.storage_path)
  const { png } = await normalisePhoto(bytes)
  const crop = await cropGarment(png, g.bounding_box, 0.12)

  const attempt = (x.cutout_attempts ?? 0) + 1
  let prompt = buildCutoutPrompt(g, regenerate ? x.regen_direction : null)
  let result = await editToCutout(crop, prompt)
  let cost = imageCallCost(result.model, result.usage, WARDROBE_CONFIG.imageQuality)
  await logApiCall({ batchId: job.batch_id, ownerId: job.owner_user_id, stage: 'cutout', provider: 'openai', model: result.model, usage: result.usage, imageCount: 1, costUsd: cost.usd, estimated: cost.estimated, durationMs: result.ms })

  // One automatic retry when the output is obviously not a cutout on white.
  const check = await cutoutLooksValid(result.png)
  if (!check.ok) {
    prompt = `${prompt}\n\nThe previous attempt failed because: ${check.reason}. The background must be uniform pure white edge to edge and the complete garment must be clearly visible in the centre.`
    result = await editToCutout(crop, prompt)
    cost = imageCallCost(result.model, result.usage, WARDROBE_CONFIG.imageQuality)
    await logApiCall({ batchId: job.batch_id, ownerId: job.owner_user_id, stage: 'cutout', provider: 'openai', model: result.model, usage: result.usage, imageCount: 1, costUsd: cost.usd, estimated: cost.estimated, durationMs: result.ms })
  }

  const framed = await frameOnWhite(result.png)
  const up = await uploadBufferToCloudinary(framed, {
    folder: `${WARDROBE_CONFIG.cloudinaryFolder}/${job.owner_user_id}`,
    publicId: `cutout-${x.extraction_id}-${attempt}`,
    contentType: 'image/jpeg',
  })
  if (!up.url) throw new Error(up.error ?? 'Could not host the cutout')

  await a
    .from('wardrobe_extraction')
    .update({ cutout_url: up.url, cutout_attempts: attempt, status: 'scoring', updated_at: new Date().toISOString() })
    .eq('extraction_id', x.extraction_id)

  await scoreExtraction({ ...x, cutout_url: up.url }, job)
}

async function runRescore(job: Job): Promise<void> {
  const a = admin()
  if (!job.extraction_id) throw new Error('rescore job without extraction')
  const { data: x } = await a.from('wardrobe_extraction').select('*').eq('extraction_id', job.extraction_id).single()
  if (!x || !x.cutout_url) return
  await scoreExtraction(x, job)
}

// Stage 3 — THE SAME vision scoring retail items go through. No separate path.
async function scoreExtraction(x: any, job: Job): Promise<void> {
  const a = admin()
  const g = x.detected as DetectedGarment
  const scored = await analyseProductImage(x.cutout_url)
  if (scored.usage) {
    const c = textCallCost('anthropic', scored.usage)
    await logApiCall({ batchId: job.batch_id, ownerId: job.owner_user_id, stage: 'score', provider: 'anthropic', model: scored.usage.model, usage: scored.usage, costUsd: c.usd, estimated: c.estimated, ok: !scored.error })
  }
  if (scored.error || !scored.data) {
    // Keep the cutout; the reviewer can rescore from the card.
    await a.from('wardrobe_extraction').update({ status: 'review', error: `Scoring failed: ${scored.error ?? 'no data'}`, updated_at: new Date().toISOString() }).eq('extraction_id', x.extraction_id)
    return
  }
  const brandKnown = Boolean((x.edits as any)?.brand_name || g.brand_hint || scored.data.brand_name)
  const low = lowConfidenceDims(scored.data, { brandKnown, detected: g })
  await a
    .from('wardrobe_extraction')
    .update({ scores: scored.data, low_confidence_dims: low, status: 'review', error: null, updated_at: new Date().toISOString() })
    .eq('extraction_id', x.extraction_id)
}

export { OpenAIError }
