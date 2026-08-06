// The ONE sequential Higgsfield render queue.
//
// CORE RENDERING RULE — Higgsfield never renders an outfit that has not been
// approved. A render job is created in exactly three places:
//   · an APPROVAL (mobile swipe / desktop)            → priority 1
//   · a stock swap on an ALREADY-APPROVED outfit      → priority 2
//   · a restock restore on an already-approved outfit → priority 2
// There is no pre-rendering and no batch rendering of pending outfits.
//
// Jobs run strictly one at a time (approvals first, then FIFO), so a retailer
// sale wiping out 15 items produces 15 sequential renders, each outfit
// (re)publishing as its render lands — never 15 simultaneous renders. An
// outfit is only ever published FROM here, after its render succeeds: the
// public hero is always the freshly rendered image of the actual item set,
// never a placeholder or item-group collage.

import 'server-only'
import { createAdminClient } from '@/lib/supabase-server'
import { generateHiggsfieldShootForOutfit } from '@/app/admin/projects/higgsfield-actions'
import { writeAudit } from './audit'

const MAX_ATTEMPTS = 2               // initial try + one retry
const RUNNING_STALE_MS = 15 * 60_000 // recover a crashed 'running' job

export async function enqueueRender(
  outfitId: string,
  trigger: 'approval' | 'stock_swap' | 'restock_restore' | 'manual',
): Promise<void> {
  const admin = createAdminClient()
  // One pending job per outfit — a newer trigger supersedes nothing; the render
  // always uses the outfit's CURRENT item set when it actually runs.
  const { data: existing } = await admin
    .from('render_job' as any)
    .select('job_id')
    .eq('outfit_id', outfitId)
    .in('status', ['queued', 'running'])
    .limit(1)
  if ((existing ?? []).length > 0) return

  await (admin.from('render_job') as any).insert({
    outfit_id: outfitId,
    trigger,
    priority: trigger === 'approval' ? 1 : 2,
  })
  await writeAudit({
    action: 'render_queued', entity: 'render_job', entityId: outfitId,
    trigger: trigger === 'approval' ? 'mobile_review' : 'stock_sentinel',
    after: { trigger },
  })
}

/**
 * Drain the queue sequentially within a time budget. Safe to call from the
 * cron route, and fire-and-forget after an approval. Returns counts.
 */
export async function processRenderQueue(budgetMs = 240_000): Promise<{ done: number; failed: number }> {
  const admin = createAdminClient()
  const startedAt = Date.now()
  let done = 0
  let failed = 0

  // Recover stale running jobs (crashed invocation) → back to queued.
  const staleBefore = new Date(Date.now() - RUNNING_STALE_MS).toISOString()
  await (admin.from('render_job') as any)
    .update({ status: 'queued' })
    .eq('status', 'running')
    .lt('started_at', staleBefore)

  while (Date.now() - startedAt < budgetMs) {
    // A genuinely running job means another invocation holds the queue — the
    // sequential guarantee matters more than throughput.
    const { data: running } = await admin
      .from('render_job' as any)
      .select('job_id')
      .eq('status', 'running')
      .limit(1)
    if ((running ?? []).length > 0) break

    const { data: nextRows } = await admin
      .from('render_job' as any)
      .select('job_id, outfit_id, trigger, attempts')
      .eq('status', 'queued')
      .order('priority', { ascending: true })   // approvals first
      .order('created_at', { ascending: true }) // then FIFO
      .limit(1)
    const job = (nextRows ?? [])[0] as
      | { job_id: string; outfit_id: string; trigger: string; attempts: number }
      | undefined
    if (!job) break

    // Claim — guarded so two overlapping invocations can't both take it.
    const { data: claimed } = await (admin.from('render_job') as any)
      .update({ status: 'running', started_at: new Date().toISOString(), attempts: job.attempts + 1 })
      .eq('job_id', job.job_id)
      .eq('status', 'queued')
      .select('job_id')
    if (!claimed || (claimed as any[]).length === 0) continue

    const res: { imageUrl?: string; error?: string } = await generateHiggsfieldShootForOutfit(job.outfit_id, 'F6')
      .catch((err: unknown) => ({ error: err instanceof Error ? err.message : 'Render crashed' }))

    if (res.imageUrl) {
      // Hero attached (the shoot promotes itself to image_url). Publish.
      await (admin.from('render_job') as any)
        .update({ status: 'done', finished_at: new Date().toISOString(), error: null })
        .eq('job_id', job.job_id)
      await (admin.from('outfit') as any)
        .update({
          status: 'live',
          published_at: new Date().toISOString(),
          paused_reason: null,
          last_render_error: null,
        })
        .eq('outfit_id', job.outfit_id)
        .in('status', ['approved_rendering', 'paused', 'render_failed'])
      await writeAudit({
        action: 'render_done', entity: 'outfit', entityId: job.outfit_id,
        trigger: 'system', after: { hero: res.imageUrl, republished: true, jobTrigger: job.trigger },
      })
      done++
    } else {
      const error = (res.error ?? 'No image returned').slice(0, 500)
      if (job.attempts + 1 < MAX_ATTEMPTS) {
        // Retry once.
        await (admin.from('render_job') as any)
          .update({ status: 'queued', error })
          .eq('job_id', job.job_id)
      } else {
        await (admin.from('render_job') as any)
          .update({ status: 'failed', finished_at: new Date().toISOString(), error })
          .eq('job_id', job.job_id)
        await (admin.from('outfit') as any)
          .update({ status: 'render_failed', last_render_error: error })
          .eq('outfit_id', job.outfit_id)
          .in('status', ['approved_rendering', 'paused'])
        await writeAudit({
          action: 'render_failed', entity: 'outfit', entityId: job.outfit_id,
          trigger: 'system', after: { error, jobTrigger: job.trigger },
        })
        failed++
      }
    }
  }

  return { done, failed }
}

/** Queue stats for the digest email ("rendering now: n" + failures). */
export async function renderQueueStats(): Promise<{ pending: number; failedOutfits: { outfit_id: string; label: string }[] }> {
  const admin = createAdminClient()
  const { count } = await admin
    .from('render_job' as any)
    .select('*', { count: 'exact', head: true })
    .in('status', ['queued', 'running'])
  const { data: failedRows } = await admin
    .from('outfit' as any)
    .select('outfit_id, aesthetic_label')
    .eq('status', 'render_failed')
    .limit(10)
  return {
    pending: count ?? 0,
    failedOutfits: ((failedRows ?? []) as any[]).map((o) => ({
      outfit_id: o.outfit_id,
      label: o.aesthetic_label ?? 'Untitled',
    })),
  }
}
