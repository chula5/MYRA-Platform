// WAYS TO WEAR IT — the queue (migration 0094), modelled on wardrobe/queue.ts.
//
// A tap is priority 1: she is waiting, and it runs even while a warm-up is
// running. A warm-up is priority 2: pieces she is about to be able to tap
// (what her page shows, what she kept while shopping, what she added to her
// wardrobe), styled before she asks, under a daily cap per member so the
// judge's cost stays proportional to what she can actually see.
//
// Drains: fire-and-forget after a tap or a page load (waitUntil), the page
// polling the memory while a job is open, and /api/cron/styled-ways. A drain
// runs up to CONCURRENCY jobs at once (the judge is API-bound, not CPU-bound);
// a tap is always claimed, a warm-up only while there is a free slot.
//
// The nightly sweep (/api/cron/styled-ways-nightly) queues with reason
// 'nightly' under its own cap, so it never eats the daytime cap and leaves
// her FOR YOU and Browse warm-ups blocked until midnight.

import 'server-only'
import { waitUntil } from '@vercel/functions'
import { createAdminClient } from '@/lib/supabase-server'
import { composeStyledWays } from '@/lib/styled-ways-compose'
import { countFreshWays } from '@/lib/styled-ways'
import { noticeDemand, type DemandSource } from '@/lib/styled-ways-demand'
import { WAYS, WARMUP_CAP_DEFAULT, NIGHTLY_CAP_DEFAULT, judgedCost, warmupAllowed, type WayMode } from '@/lib/styled-ways-core'

export type JobReason = 'tap' | 'more' | 'save' | 'view' | 'feed' | 'wardrobe' | 'browse' | 'pick' | 'look' | 'nightly'
export type JobStatus = 'queued' | 'running' | 'done' | 'failed'

const STALE_MS = 4 * 60 * 1000
const MAX_ATTEMPTS = 2
/** Jobs one drain runs side by side. */
const CONCURRENCY = 3

interface Job {
  job_id: string
  member_id: string
  hero_item_id: string
  mode: WayMode
  priority: number
  reason: JobReason
  shuffle: number
  attempts: number
}

const migrationHint = (msg: string) => (/styled_way_job/.test(msg) ? 'Run migration 0094 in Supabase first' : msg)

/** The open job for a piece, if any. */
export async function openJobFor(admin: any, memberId: string, heroId: string, mode: WayMode = 'blend'):
  Promise<{ job_id: string; status: JobStatus; error: string | null; created_at: string } | null> {
  const { data } = await admin.from('styled_way_job').select('job_id, status, error, created_at')
    .eq('member_id', memberId).eq('hero_item_id', heroId).eq('mode', mode)
    .in('status', ['queued', 'running']).limit(1)
  return (data ?? [])[0] ?? null
}

/** The last finished job for a piece — so a surface can say why there is nothing. */
export async function lastJobFor(admin: any, memberId: string, heroId: string, mode: WayMode = 'blend'):
  Promise<{ job_id: string; status: JobStatus; error: string | null; finished_at: string | null } | null> {
  const { data } = await admin.from('styled_way_job').select('job_id, status, error, finished_at')
    .eq('member_id', memberId).eq('hero_item_id', heroId).eq('mode', mode)
    .in('status', ['done', 'failed']).order('created_at', { ascending: false }).limit(1)
  return (data ?? [])[0] ?? null
}

/**
 * Ask for a piece to be styled. A second ask while the first is open joins it
 * (the partial unique index makes that the only possible outcome).
 */
export async function requestStyledWays(
  admin: any,
  memberId: string,
  heroId: string,
  opts: { mode?: WayMode; reason?: JobReason; shuffle?: number; priority?: 1 | 2 } = {},
): Promise<{ jobId: string; joined: boolean; error?: string }> {
  const mode = opts.mode ?? 'blend'
  const reason = opts.reason ?? 'tap'
  const priority = opts.priority ?? (reason === 'tap' || reason === 'more' ? 1 : 2)
  const { data, error } = await admin.from('styled_way_job')
    .insert({ member_id: memberId, hero_item_id: heroId, mode, priority, reason, shuffle: opts.shuffle ?? 0 })
    .select('job_id').maybeSingle()
  if (!error && data) return { jobId: data.job_id, joined: false }
  if (error && error.code === '23505') {
    const open = await openJobFor(admin, memberId, heroId, mode)
    if (open) {
      // A tap outranks the warm-up it joined: she is waiting now.
      if (priority === 1) await admin.from('styled_way_job').update({ priority: 1 }).eq('job_id', open.job_id).eq('status', 'queued')
      return { jobId: open.job_id, joined: true }
    }
  }
  return { jobId: '', joined: false, error: migrationHint(error?.message ?? 'Could not queue this piece') }
}

/**
 * Warm-up jobs queued for a member since the start of today (UTC). The
 * daytime count leaves the nightly sweep out; the nightly count is only it.
 */
async function warmupsToday(admin: any, memberId: string, kind: 'day' | 'nightly'): Promise<number> {
  const start = new Date(); start.setUTCHours(0, 0, 0, 0)
  let q = admin.from('styled_way_job').select('job_id', { count: 'exact', head: true })
    .eq('member_id', memberId).eq('priority', 2).gte('created_at', start.toISOString())
  q = kind === 'nightly' ? q.eq('reason', 'nightly') : q.neq('reason', 'nightly')
  const { count } = await q
  return count ?? 0
}

function envCap(name: string, fallback: number): number {
  const n = Number(process.env[name] ?? fallback)
  return Number.isFinite(n) ? n : fallback
}

export function warmupCap(): number { return envCap('STYLED_WAYS_WARMUP_CAP', WARMUP_CAP_DEFAULT) }
export function nightlyCap(): number { return envCap('STYLED_WAYS_NIGHTLY_CAP', NIGHTLY_CAP_DEFAULT) }

/**
 * Queue warm-ups for pieces she is about to be able to tap. Pieces that
 * already have their ways, or an open job, are skipped; the daily cap stops
 * the rest. Returns what was queued and what already had ways.
 */
export async function enqueueWarmups(
  admin: any,
  memberId: string,
  heroIds: string[],
  reason: Exclude<JobReason, 'tap' | 'more'>,
  opts: { mode?: WayMode; cap?: number } = {},
): Promise<{ queued: string[]; ready: string[]; capped: boolean }> {
  const mode = opts.mode ?? 'blend'
  const ids = Array.from(new Set(heroIds.filter(Boolean)))
  if (!ids.length) return { queued: [], ready: [], capped: false }
  // Whatever happens to the queue, she saw these: the ledger is the record.
  await noticeDemand(admin, memberId, ids, mode, reason as DemandSource)
  const fresh = await countFreshWays(admin, memberId, ids, mode)
  const ready = ids.filter((id) => (fresh.get(id) ?? 0) >= WAYS)
  const wanted = ids.filter((id) => (fresh.get(id) ?? 0) < WAYS)
  if (!wanted.length) return { queued: [], ready, capped: false }

  const nightly = reason === 'nightly'
  let used = await warmupsToday(admin, memberId, nightly ? 'nightly' : 'day')
  const cap = opts.cap ?? (nightly ? nightlyCap() : warmupCap())
  const queued: string[] = []
  let capped = false
  for (const id of wanted) {
    if (!warmupAllowed(used, cap)) { capped = true; break }
    const r = await requestStyledWays(admin, memberId, id, { mode, reason, priority: 2 })
    if (r.error) break
    if (!r.joined) { queued.push(id); used++ }
  }
  return { queued, ready, capped }
}

/** One claimed job, run and recorded. True when it finished, false when it failed for good. */
async function runJob(a: any, job: Job): Promise<boolean | null> {
  let error: string | null = null
  let stats: Partial<{ composed: number; passed: number; first_look_ms: number | null; total_ms: number; cost_gbp: number }> = {}
  try {
    const r = await composeStyledWays(job.member_id, job.hero_item_id, {
      mode: job.mode, shuffle: job.shuffle, source: job.priority === 1 ? 'tap' : 'warmup', admin: a,
    })
    stats = { composed: r.composed, passed: r.passed, first_look_ms: r.firstLookMs, total_ms: r.totalMs, cost_gbp: judgedCost(r.judged) }
    if (r.error && !r.saved.length) error = r.error
  } catch (err) {
    error = (err instanceof Error ? err.message : 'Job crashed').slice(0, 500)
  }

  if (!error) {
    await a.from('styled_way_job').update({ ...stats, status: 'done', finished_at: new Date().toISOString(), error: null }).eq('job_id', job.job_id)
    return true
  }
  // "Nothing goes with it" will not change on a retry; a crash gets one more go.
  const final = /Nothing|Import your wardrobe|cannot find|No picture|Member not found|ANTHROPIC_API_KEY|401|403/i.test(error)
  if (!final && job.attempts + 1 < MAX_ATTEMPTS) {
    await a.from('styled_way_job').update({ ...stats, status: 'queued', error }).eq('job_id', job.job_id)
    return null
  }
  await a.from('styled_way_job').update({ ...stats, status: 'failed', finished_at: new Date().toISOString(), error }).eq('job_id', job.job_id)
  return false
}

/**
 * Run jobs until the budget is spent, up to CONCURRENCY at a time. A tap is
 * always claimed (she is waiting); a warm-up is claimed only while fewer than
 * CONCURRENCY jobs are running anywhere, so a cron tick cannot crowd out
 * someone who is waiting and two drains never judge the same piece (the
 * claim is a conditional update on status).
 */
export async function drainStyledWaysQueue(budgetMs = 50_000): Promise<{ done: number; failed: number; remaining: number; skipped?: string }> {
  const a = createAdminClient() as any
  const startedAt = Date.now()
  let done = 0
  let failed = 0

  const staleBefore = new Date(Date.now() - STALE_MS).toISOString()
  const { error: staleErr } = await a.from('styled_way_job').update({ status: 'queued' }).eq('status', 'running').lt('started_at', staleBefore)
  if (staleErr) return { done: 0, failed: 0, remaining: 0, skipped: migrationHint(staleErr.message) }

  while (Date.now() - startedAt < budgetMs) {
    const { data: nextRows } = await a.from('styled_way_job')
      .select('job_id, member_id, hero_item_id, mode, priority, reason, shuffle, attempts')
      .eq('status', 'queued').order('priority', { ascending: true }).order('created_at', { ascending: true }).limit(CONCURRENCY)
    const candidates = (nextRows ?? []) as Job[]
    if (!candidates.length) break

    const { count: runningCount } = await a.from('styled_way_job').select('job_id', { count: 'exact', head: true }).eq('status', 'running')
    let running = runningCount ?? 0

    const claimedJobs: Job[] = []
    for (const job of candidates) {
      if (job.priority > 1 && running >= CONCURRENCY) break
      const { data: claimed } = await a.from('styled_way_job')
        .update({ status: 'running', started_at: new Date().toISOString(), attempts: job.attempts + 1 })
        .eq('job_id', job.job_id).eq('status', 'queued').select('job_id')
      if (!claimed || claimed.length === 0) continue
      claimedJobs.push(job)
      running++
    }
    // Everything queued is a warm-up and every slot is taken: another drain has it.
    if (!claimedJobs.length) break

    const results = await Promise.all(claimedJobs.map((job) => runJob(a, job)))
    for (const r of results) { if (r === true) done++; else if (r === false) failed++ }
    // On Chloe's Mac the pictures follow the ways (lib/styled-ways-shoot);
    // elsewhere the renderer is absent and this is a no-op.
    if (results.some((r) => r === true) && process.env.STYLED_WAYS_RENDER_ON_DRAIN !== '0') {
      for (const memberId of Array.from(new Set(claimedJobs.map((j) => j.member_id)))) kickStyledWaysRender(memberId)
    }
  }

  const { count } = await a.from('styled_way_job').select('job_id', { count: 'exact', head: true }).eq('status', 'queued')
  return { done, failed, remaining: count ?? 0 }
}

/** Make pictures for a member's newest ways in the background — local only, Chloe's ways by default. */
export function kickStyledWaysRender(memberId: string, limit = 3): void {
  const work = import('@/lib/styled-ways-shoot')
    .then(({ renderStyledWays }) => renderStyledWays({ memberId, limit }))
    .then((r) => { if (!r.skipped && (r.made || r.failed)) console.log('[styled-ways] pictures', JSON.stringify(r)) })
    .catch((e) => console.error('[styled-ways] render', e))
  try { waitUntil(work) } catch { /* local dev: the promise simply runs */ }
}

/** Start a drain without waiting for it — after a tap or a page load. */
export function kickStyledWaysDrain(budgetMs = 50_000): void {
  const work = drainStyledWaysQueue(budgetMs).catch((e) => console.error('[styled-ways] drain', e))
  try { waitUntil(work) } catch { /* local dev: the promise simply runs */ }
}
