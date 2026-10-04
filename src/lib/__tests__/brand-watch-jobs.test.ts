import { describe, it, expect, vi } from 'vitest'
import {
  bulkJobOf, bulkLine, bulkLineVisible, bulkRunning, scanProgressOf, throttledProgress, withBulkJob, STALE_JOB_MS,
  type BulkJob,
} from '../brand-watch-jobs'

const NOW = Date.UTC(2026, 9, 4, 12, 0, 0)
const ago = (ms: number) => new Date(NOW - ms).toISOString()
const job = (over: Partial<BulkJob> = {}): BulkJob => ({
  kind: 'keep-all', label: 'KEEPING 214 PIECES', done: 0, total: 214, started_at: ago(5_000), ...over,
})

describe('bulkJobOf', () => {
  it('reads a job off scan_state', () => {
    const j = job()
    expect(bulkJobOf({ running: false, bulk: j })).toEqual(j)
  })

  it('ignores a scan_state with no job, or a half-written one', () => {
    expect(bulkJobOf(null)).toBeUndefined()
    expect(bulkJobOf({ running: true, done: 3 })).toBeUndefined()
    expect(bulkJobOf({ bulk: { kind: 'keep-all' } })).toBeUndefined() // no label or start time
  })
})

describe('scanProgressOf', () => {
  it('reports progress only while the scan says it is running', () => {
    expect(scanProgressOf({ running: true, done: 12, total: 40 })).toEqual({ done: 12, total: 40, started_at: undefined })
    expect(scanProgressOf({ running: false, done: 40, total: 40 })).toBeUndefined()
    expect(scanProgressOf({ running: true })).toEqual({ done: 0, total: null, started_at: undefined })
  })
})

describe('bulkRunning', () => {
  it('is running until it says it ended', () => {
    expect(bulkRunning(job(), NOW)).toBe(true)
    expect(bulkRunning(job({ ended_at: ago(1_000) }), NOW)).toBe(false)
  })

  it('stops claiming to run once it is stale — a dead process must not read as busy', () => {
    expect(bulkRunning(job({ started_at: ago(STALE_JOB_MS + 60_000) }), NOW)).toBe(false)
  })

  it('is false for no job at all', () => {
    expect(bulkRunning(undefined, NOW)).toBe(false)
  })
})

describe('withBulkJob', () => {
  it('leaves a running scan its own counters — the two share one column', () => {
    const scan = { running: true, done: 12, total: 40, started_at: '2026-10-04T09:00:00.000Z' }
    const merged = withBulkJob(scan, job())
    expect(merged).toMatchObject(scan)
    expect(bulkJobOf(merged)).toEqual(job())
    // And the scan still reads as running off the merged state.
    expect(scanProgressOf(merged)).toEqual({ done: 12, total: 40, started_at: scan.started_at })
  })

  it('works on a brand that has never been scanned', () => {
    expect(bulkJobOf(withBulkJob(null, job()))).toEqual(job())
  })

  it('replaces an older job rather than stacking them', () => {
    const first = job({ kind: 'keep-shown', label: 'FIRST' })
    const second = job({ kind: 'keep-all', label: 'SECOND' })
    expect(bulkJobOf(withBulkJob(withBulkJob({}, first), second))).toEqual(second)
  })
})

describe('bulkLine', () => {
  it('shows how far it has got while it runs', () => {
    expect(bulkLine(job({ done: 40 }), NOW)).toEqual({ text: 'KEEPING 214 PIECES — 40/214', tone: 'working' })
  })

  it('shows no count when the size is not known', () => {
    expect(bulkLine(job({ total: 0, done: 0 }), NOW)).toEqual({ text: 'KEEPING 214 PIECES', tone: 'working' })
  })

  it('reports what it kept when it finishes', () => {
    expect(bulkLine(job({ ended_at: ago(1_000), kept: 211 }), NOW)).toEqual({ text: 'KEEPING 214 PIECES — 211 KEPT', tone: 'done' })
  })

  it('carries the note, so "out of season" is not silently dropped', () => {
    const l = bulkLine(job({ ended_at: ago(1_000), kept: 200, note: '25 OUT-OF-SEASON LEFT' }), NOW)
    expect(l).toEqual({ text: 'KEEPING 214 PIECES — 200 KEPT · 25 OUT-OF-SEASON LEFT', tone: 'done' })
  })

  it('says it failed, and why, rather than reporting a clean finish', () => {
    expect(bulkLine(job({ ended_at: ago(1_000), error: 'item insert failed: no item_type' }), NOW))
      .toEqual({ text: 'KEEPING 214 PIECES FAILED — item insert failed: no item_type', tone: 'failed' })
  })

  it('calls out a job that stopped part-way instead of spinning for ever', () => {
    expect(bulkLine(job({ started_at: ago(STALE_JOB_MS + 60_000) }), NOW))
      .toEqual({ text: 'KEEPING 214 PIECES STOPPED PART-WAY — START IT AGAIN', tone: 'stopped' })
  })

  it('says nothing when there is no job', () => {
    expect(bulkLine(undefined, NOW)).toBeNull()
  })
})

describe('bulkLineVisible', () => {
  it('keeps a running job on screen', () => {
    expect(bulkLineVisible(job(), NOW)).toBe(true)
  })

  it('keeps a finished job readable for a few minutes, then lets it go', () => {
    expect(bulkLineVisible(job({ ended_at: ago(60_000) }), NOW)).toBe(true)
    expect(bulkLineVisible(job({ ended_at: ago(11 * 60_000) }), NOW)).toBe(false)
  })

  it('keeps saying a job stopped part-way until she restarts it', () => {
    expect(bulkLineVisible(job({ started_at: ago(STALE_JOB_MS + 60_000) }), NOW)).toBe(true)
  })

  it('shows nothing for no job', () => {
    expect(bulkLineVisible(undefined, NOW)).toBe(false)
  })
})

describe('throttledProgress', () => {
  it('writes the last one even inside the window, so a job never ends one short', () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(NOW)
      const write = vi.fn()
      const p = throttledProgress(2_000, write)
      p(1, 3)
      p(2, 3)
      p(3, 3)
      expect(write.mock.calls.map((c) => c[0])).toEqual([1, 3])
    } finally { vi.useRealTimers() }
  })

  it('writes at most once per window while the job is still going', () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(NOW)
      const write = vi.fn()
      const p = throttledProgress(2_000, write)
      p(1, 100)
      vi.setSystemTime(NOW + 500)
      p(2, 100)
      vi.setSystemTime(NOW + 2_500)
      p(3, 100)
      expect(write.mock.calls.map((c) => c[0])).toEqual([1, 3])
    } finally { vi.useRealTimers() }
  })
})
