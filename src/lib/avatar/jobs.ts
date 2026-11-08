// MEMBER AVATAR — the work queue. Same shape as styled_way_job: a row per job, a drainer that
// claims the oldest, a heartbeat while it runs, stale jobs re-queued, and a "kick" so a tap in
// the app starts a drain now rather than waiting for the five-minute cron.

import 'server-only'
import { waitUntil } from '@vercel/functions'
import { createAdminClient } from '@/lib/supabase-server'
import { siteUrl } from '@/lib/studio/email'
import { AVATAR_CONFIG } from './config'
import { runPortraitStep, runBodyStep } from './pipeline'
import { getAvatar, updateAvatar } from './store'

export type JobKind = 'portrait' | 'body' | 'layer' | 'finish'
const RUNNING_STALE_MS = 90_000
const HEARTBEAT_MS = 20_000
const KICK_THROTTLE_MS = 15_000
let lastKickAt = 0

const admin = () => createAdminClient() as any

export async function enqueueAvatarJob(kind: JobKind, refId: string, memberId: string, priority: 1 | 2 = 1): Promise<void> {
  const { error } = await admin().from('avatar_job').insert({ kind, ref_id: refId, member_id: memberId, priority })
  // the unique open index turns a duplicate into a no-op
  if (error && !/duplicate|unique|23505/i.test(error.message ?? '')) throw new Error(`avatar_job insert: ${error.message}`)
}

export async function openJobFor(kind: JobKind, refId: string): Promise<{ job_id: string; status: string; error: string | null; attempts: number } | null> {
  const { data } = await admin().from('avatar_job').select('job_id, status, error, attempts, created_at').eq('kind', kind).eq('ref_id', refId).order('created_at', { ascending: false }).limit(1).maybeSingle()
  return data ?? null
}

async function runJob(job: { job_id: string; kind: JobKind; ref_id: string; member_id: string; attempts: number }): Promise<void> {
  const a = admin()
  const beat = () => { a.from('avatar_job').update({ heartbeat_at: new Date().toISOString() }).eq('job_id', job.job_id).eq('status', 'running').then(() => undefined, () => undefined) }
  const timer = setInterval(beat, HEARTBEAT_MS)
  try {
    if (job.kind === 'portrait') await runPortraitStep(job.ref_id, beat)
    else if (job.kind === 'body') await runBodyStep(job.ref_id, beat)
    else throw new Error(`job kind ${job.kind} arrives in phase 2`)
    await a.from('avatar_job').update({ status: 'done', finished_at: new Date().toISOString() }).eq('job_id', job.job_id)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    const giveUp = job.attempts >= AVATAR_CONFIG.maxAttempts
    await a.from('avatar_job').update({ status: giveUp ? 'failed' : 'queued', error: msg.slice(0, 500), finished_at: giveUp ? new Date().toISOString() : null }).eq('job_id', job.job_id)
    if (giveUp && (job.kind === 'portrait' || job.kind === 'body')) {
      const av = await getAvatar(job.ref_id)
      if (av) await updateAvatar(av.avatar_id, { status: 'failed', error: msg.slice(0, 500), attempts: av.attempts + 1 })
    }
    console.error('[avatar] job', job.kind, job.ref_id, msg)
  } finally {
    clearInterval(timer)
  }
}

/** Oldest first, one at a time, within a time budget. Re-queues jobs whose function died. */
export async function drainAvatarQueue(budgetMs = 240_000): Promise<{ done: number; failed: number; remaining: number }> {
  const a = admin()
  const t0 = Date.now()
  const staleBefore = new Date(Date.now() - RUNNING_STALE_MS).toISOString()
  await a.from('avatar_job').update({ status: 'queued', heartbeat_at: null })
    .eq('status', 'running').or(`heartbeat_at.lt.${staleBefore},and(heartbeat_at.is.null,started_at.lt.${staleBefore})`)
  let done = 0, failed = 0
  while (Date.now() - t0 < budgetMs) {
    const { data: next } = await a.from('avatar_job').select('job_id, kind, ref_id, member_id, attempts').eq('status', 'queued')
      .lt('attempts', AVATAR_CONFIG.maxAttempts + 1).order('priority', { ascending: true }).order('created_at', { ascending: true }).limit(1).maybeSingle()
    if (!next) break
    const { data: claimed } = await a.from('avatar_job')
      .update({ status: 'running', started_at: new Date().toISOString(), heartbeat_at: new Date().toISOString(), attempts: next.attempts + 1 })
      .eq('job_id', next.job_id).eq('status', 'queued').select('job_id').maybeSingle()
    if (!claimed) continue   // someone else took it
    await runJob({ ...next, attempts: next.attempts + 1 })
    const { data: after } = await a.from('avatar_job').select('status').eq('job_id', next.job_id).maybeSingle()
    if (after?.status === 'done') done++; else if (after?.status === 'failed') failed++
  }
  const { count } = await a.from('avatar_job').select('job_id', { count: 'exact', head: true }).eq('status', 'queued')
  return { done, failed, remaining: count ?? 0 }
}

/** Start a drain now. On Vercel: its own 300s function via the cron route. Locally: in this process. */
export function kickAvatarDrain(budgetMs = 240_000): void {
  if (Date.now() - lastKickAt < KICK_THROTTLE_MS) return
  lastKickAt = Date.now()
  const secret = process.env.CRON_SECRET
  if (secret && process.env.VERCEL) {
    const req = fetch(siteUrl(`/api/cron/avatar?kick=1&budget=${budgetMs}`), { headers: { authorization: `Bearer ${secret}` }, cache: 'no-store' })
      .then((r) => { if (!r.ok) console.error('[avatar] kick', r.status) })
      .catch((e) => console.error('[avatar] kick', e))
    try { waitUntil(Promise.race([req, new Promise((r) => setTimeout(r, 3_000))])) } catch { /* local */ }
    return
  }
  const work = drainAvatarQueue(budgetMs).catch((e) => console.error('[avatar] drain', e))
  try { waitUntil(work) } catch { /* local dev: it simply runs */ }
}
