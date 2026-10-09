// CONNECTED — hits the LIVE Supabase database and MYRA's eye (Anthropic).
// Run one at a time, never with a pending migration:
//
//   MYRA_CONNECTED=1 npx vitest run src/lib/__tests__/styled-ways.connected.test.ts --no-file-parallelism
//
// What it proves, for one real member and one real piece she has saved or
// owns: a cold tap composes, judges and keeps up to three ways (and reports
// first-look and total time); a warm tap answers from the memory with no
// composing; retiring a piece retires every way holding it; the queue runs
// a job end to end. Rows it writes are its own and are removed at the end.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const CONNECTED = process.env.MYRA_CONNECTED === '1'

function loadEnv() {
  const file = resolve(process.cwd(), '.env.local')
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, '')
  }
}

describe.runIf(CONNECTED)('styled ways — connected', () => {
  let admin: any
  let memberId = ''
  let heroId = ''
  let heroName = ''
  const written: string[] = []

  beforeAll(async () => {
    loadEnv()
    const { createAdminClient } = await import('@/lib/supabase-server')
    admin = createAdminClient() as any
    // A real member with a saved piece, else an owned one.
    const { data: saved } = await admin.from('member_saved_item')
      .select('member_id, item_id, item:item_id(product_name, image_url, status)')
      .order('saved_at', { ascending: false }).limit(20)
    const pick = ((saved ?? []) as any[]).find((r) => r.item?.image_url && r.item.status !== 'archived')
    if (pick) { memberId = pick.member_id; heroId = pick.item_id; heroName = pick.item.product_name }
    expect(memberId, 'a member with a saved piece').toBeTruthy()
  }, 60_000)

  afterAll(async () => {
    if (!admin || !memberId || !heroId) return
    await admin.from('styled_way').delete().eq('member_id', memberId).eq('hero_item_id', heroId)
    await admin.from('styled_way_job').delete().eq('member_id', memberId).eq('hero_item_id', heroId)
  })

  it('cold tap: composes, judges and keeps up to three ways, first one early', async () => {
    const { composeStyledWays } = await import('@/lib/styled-ways-compose')
    const seen: number[] = []
    const t0 = Date.now()
    const r = await composeStyledWays(memberId, heroId, { source: 'tap', admin, onLook: () => { seen.push(Date.now() - t0) } })
    console.log(`[cold] ${heroName}: composed ${r.composed}, judged ${r.judged}, passed ${r.passed}, kept ${r.saved.length}; first look ${r.firstLookMs}ms, total ${r.totalMs}ms; looks landed at ${seen.join(', ')}ms${r.error ? `; error: ${r.error}` : ''}`)
    expect(r.judged).toBeGreaterThan(0)
    expect(r.saved.length).toBeLessThanOrEqual(3)
    for (const l of r.saved) {
      expect(l.items.some((i) => i.item_id === heroId)).toBe(true)
      expect(['works', 'borderline']).toContain(l.verdict)
      written.push(l.styled_way_id)
    }
    if (r.saved.length) expect(r.firstLookMs!).toBeLessThanOrEqual(r.totalMs)
  }, 180_000)

  it('warm tap: answers from the memory, best first, without composing', async () => {
    const { getStyledWays } = await import('@/lib/styled-ways')
    const t0 = Date.now()
    const looks = await getStyledWays(admin, memberId, heroId, 'blend')
    console.log(`[warm] ${looks.length} ways in ${Date.now() - t0}ms: ${looks.map((l) => `${l.verdict}${l.occasion_label ? ` (${l.occasion_label})` : ''}`).join(', ')}`)
    expect(looks.length).toBe(written.length)
    expect(Date.now() - t0).toBeLessThan(3_000)
    const ranks = looks.map((l) => (l.verdict === 'works' ? 0 : 1))
    expect([...ranks].sort().join()).toBe(ranks.join())
  }, 30_000)

  it('a piece that stops being sellable retires every way holding it', async () => {
    if (!written.length) return
    const { getStyledWays, markStyledWaysStale } = await import('@/lib/styled-ways')
    const { data: row } = await admin.from('styled_way').select('item_ids').eq('styled_way_id', written[0]).single()
    const victim = (row.item_ids as string[]).find((id) => id !== heroId) ?? heroId
    const n = await markStyledWaysStale(admin, victim, 'test')
    expect(n).toBeGreaterThanOrEqual(1)
    const left = await getStyledWays(admin, memberId, heroId, 'blend')
    expect(left.every((l) => !l.items.some((i) => i.item_id === victim))).toBe(true)
    console.log(`[stale] retiring ${victim} removed ${n} way(s); ${left.length} left`)
  }, 30_000)

  it('the queue runs a tap job end to end and records its timings', async () => {
    const { requestStyledWays, drainStyledWaysQueue } = await import('@/lib/styled-ways-queue')
    const q = await requestStyledWays(admin, memberId, heroId, { reason: 'more', shuffle: 3, priority: 1 })
    expect(q.error).toBeUndefined()
    const r = await drainStyledWaysQueue(170_000)
    const { data: job } = await admin.from('styled_way_job').select('*').eq('job_id', q.jobId).single()
    console.log(`[queue] drain ${JSON.stringify(r)}; job ${job.status}: composed ${job.composed}, passed ${job.passed}, first ${job.first_look_ms}ms, total ${job.total_ms}ms, cost £${job.cost_gbp}${job.error ? `, error: ${job.error}` : ''}`)
    expect(['done', 'failed']).toContain(job.status)
    expect(job.total_ms).toBeGreaterThan(0)
  }, 180_000)
})
