// CONNECTED — hits the LIVE Supabase database (no judge: the heroes here are
// made-up ids, so nothing is composed and nothing costs).
//
//   MYRA_CONNECTED=1 npx vitest run src/lib/__tests__/styled-ways-demand.connected.test.ts --no-file-parallelism
//
// What it proves, for one real member: the demand ledger counts what she saw
// and what she tapped (migration 0096); the nightly cap is counted apart from
// the daytime cap; a drain claims several queued jobs in one round; the admin
// coverage metric and its breakdowns read. Rows it writes are its own and are
// removed at the end.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const CONNECTED = process.env.MYRA_CONNECTED === '1'
const HEROES = ['test-demand-a', 'test-demand-b', 'test-demand-c', 'test-demand-d', 'test-demand-e', 'test-demand-f']

function loadEnv() {
  const file = resolve(process.cwd(), '.env.local')
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, '')
  }
}

describe.runIf(CONNECTED)('styled ways — demand ledger (connected)', () => {
  let admin: any
  let memberId = ''

  async function cleanup() {
    if (!admin || !memberId) return
    await admin.from('styled_way_demand').delete().eq('member_id', memberId).in('hero_item_id', HEROES)
    await admin.from('styled_way_job').delete().eq('member_id', memberId).in('hero_item_id', HEROES)
  }

  beforeAll(async () => {
    loadEnv()
    const { createAdminClient } = await import('@/lib/supabase-server')
    admin = createAdminClient() as any
    const { data } = await admin.from('pilot_member').select('member_id').eq('is_synthetic', false).not('auth_user_id', 'is', null).limit(1)
    memberId = data?.[0]?.member_id ?? ''
    expect(memberId, 'a real member').toBeTruthy()
    await cleanup()
  }, 60_000)

  afterAll(cleanup)

  it('notices what she saw: a repeat bumps seen and keeps first_seen_at', async () => {
    const { noticeDemand } = await import('@/lib/styled-ways-demand')
    await noticeDemand(admin, memberId, [HEROES[0], HEROES[1]], 'inspiration', 'browse')
    await noticeDemand(admin, memberId, [HEROES[0]], 'inspiration', 'pick')
    const { data } = await admin.from('styled_way_demand').select('*').eq('member_id', memberId).in('hero_item_id', HEROES).order('hero_item_id')
    expect(data).toHaveLength(2)
    const a = data.find((r: any) => r.hero_item_id === HEROES[0])
    const b = data.find((r: any) => r.hero_item_id === HEROES[1])
    expect(a.seen).toBe(2); expect(a.source).toBe('pick'); expect(a.mode).toBe('inspiration')
    expect(new Date(a.last_seen_at).getTime()).toBeGreaterThanOrEqual(new Date(a.first_seen_at).getTime())
    expect(b.seen).toBe(1); expect(b.source).toBe('browse')
  }, 30_000)

  it('counts taps and which of them the memory answered whole', async () => {
    const { recordTap } = await import('@/lib/styled-ways-demand')
    await recordTap(admin, memberId, HEROES[0], 'inspiration', true)
    await recordTap(admin, memberId, HEROES[0], 'inspiration', false)
    await recordTap(admin, memberId, HEROES[2], 'blend', false) // a tap on a piece never surfaced before
    const { data } = await admin.from('styled_way_demand').select('hero_item_id, mode, source, taps, tap_hits').eq('member_id', memberId).in('hero_item_id', HEROES)
    const a = data.find((r: any) => r.hero_item_id === HEROES[0])
    const c = data.find((r: any) => r.hero_item_id === HEROES[2])
    expect(a.taps).toBe(2); expect(a.tap_hits).toBe(1)
    expect(c.taps).toBe(1); expect(c.tap_hits).toBe(0); expect(c.source).toBe('tap'); expect(c.mode).toBe('blend')
  }, 30_000)

  it('lists what she saw lately that has no ways yet, most-seen first', async () => {
    const { uncoveredDemand } = await import('@/lib/styled-ways-demand')
    const ids = await uncoveredDemand(admin, memberId, 'inspiration', { sinceDays: 1, limit: 12 })
    const mine = ids.filter((id) => HEROES.includes(id))
    expect(mine[0]).toBe(HEROES[0]) // seen twice
    expect(mine).toContain(HEROES[1])
  }, 30_000)

  it('the nightly cap is counted apart from the daytime cap', async () => {
    const { enqueueWarmups } = await import('@/lib/styled-ways-queue')
    // Two nightly jobs already done today.
    const { error } = await admin.from('styled_way_job').insert([
      { member_id: memberId, hero_item_id: HEROES[3], mode: 'blend', priority: 2, reason: 'nightly', status: 'done', finished_at: new Date().toISOString() },
      { member_id: memberId, hero_item_id: HEROES[4], mode: 'blend', priority: 2, reason: 'nightly', status: 'done', finished_at: new Date().toISOString() },
    ])
    expect(error).toBeNull()
    // Daytime, cap 1: the nightly jobs do not count, so this queues.
    const day = await enqueueWarmups(admin, memberId, [HEROES[5]], 'feed', { mode: 'blend', cap: 1 })
    expect(day.queued).toEqual([HEROES[5]])
    expect(day.capped).toBe(false)
    // Nightly, cap 2: two are already in, so this is capped and queues nothing.
    const night = await enqueueWarmups(admin, memberId, [HEROES[2]], 'nightly', { mode: 'blend', cap: 2 })
    expect(night.queued).toEqual([])
    expect(night.capped).toBe(true)
    // Both asks were noticed on the ledger whatever happened to the queue.
    const { data } = await admin.from('styled_way_demand').select('hero_item_id, source').eq('member_id', memberId).in('hero_item_id', [HEROES[5], HEROES[2]])
    expect(data.map((r: any) => r.source).sort()).toEqual(['feed', 'nightly'])
  }, 30_000)

  it('a drain claims several queued jobs in one round', async () => {
    const { drainStyledWaysQueue } = await import('@/lib/styled-ways-queue')
    // Only when nothing real is waiting: a drain runs whatever is queued.
    const { count } = await admin.from('styled_way_job').select('job_id', { count: 'exact', head: true }).eq('status', 'queued').not('hero_item_id', 'in', `(${HEROES.map((h) => `"${h}"`).join(',')})`)
    if ((count ?? 0) > 0) { console.log(`[drain] skipped: ${count} real job(s) queued`); return }
    await admin.from('styled_way_job').insert([
      { member_id: memberId, hero_item_id: HEROES[3], mode: 'blend', priority: 2, reason: 'nightly', status: 'queued' },
      { member_id: memberId, hero_item_id: HEROES[4], mode: 'blend', priority: 2, reason: 'nightly', status: 'queued' },
    ])
    const r = await drainStyledWaysQueue(60_000)
    const { data: jobs } = await admin.from('styled_way_job').select('hero_item_id, status, started_at, error').eq('member_id', memberId).in('hero_item_id', HEROES).in('status', ['failed', 'done']).not('started_at', 'is', null)
    const started = jobs.map((j: any) => new Date(j.started_at).getTime())
    console.log(`[drain] ${JSON.stringify(r)}; ${jobs.length} job(s) ran, started within ${Math.max(...started) - Math.min(...started)}ms of each other; errors: ${Array.from(new Set(jobs.map((j: any) => j.error))).join(' | ')}`)
    // Made-up heroes fail for good ("cannot find that piece") without touching the judge.
    expect(jobs.length).toBeGreaterThanOrEqual(3)
    expect(jobs.every((j: any) => j.status === 'failed')).toBe(true)
    // Three jobs claimed in one round start together, not one after another.
    expect(Math.max(...started) - Math.min(...started)).toBeLessThan(5_000)
  }, 120_000)

  it('the admin coverage metric and its breakdowns read', async () => {
    const { getDashboardMetrics } = await import('@/lib/dashboard-metrics')
    const { getBreakdowns } = await import('@/lib/metric-detail')
    const all = await getDashboardMetrics()
    const m = all.metrics['ways-coverage']
    expect(m.available).toBe(true)
    expect(m.series).toHaveLength(all.buckets.length)
    const area = all.areas.find((a) => a.label === 'WAYS TO WEAR')
    expect(area).toBeTruthy()
    console.log(`[coverage] ${area!.value} · ${area!.detail}`)
    const b = await getBreakdowns('ways-coverage')
    expect(b.map((x) => x.title)).toEqual(['COVERED BY POOL', 'SURFACED BY WHERE SHE SAW IT', 'COLD TAP · SECONDS TO FIRST LOOK', 'JOBS BY STATUS', 'JUDGE SPEND BY REASON'])
    expect(b[1].rows.some((r) => r.label === 'PICK' || r.label === 'BROWSE')).toBe(true)
  }, 120_000)
})
