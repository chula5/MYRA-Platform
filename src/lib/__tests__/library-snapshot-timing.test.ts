import { describe, it, expect } from 'vitest'
import { lastRefreshBoundary, snapshotDueReason } from '@/lib/library-snapshot-timing'

const at = (iso: string) => Date.parse(iso)

describe('library snapshot: twice a day', () => {
  it('finds the last 06:00 / 18:00 UTC boundary', () => {
    expect(lastRefreshBoundary(at('2026-11-22T05:59:00Z'))).toBe(at('2026-11-21T18:00:00Z'))
    expect(lastRefreshBoundary(at('2026-11-22T06:00:00Z'))).toBe(at('2026-11-22T06:00:00Z'))
    expect(lastRefreshBoundary(at('2026-11-22T17:30:00Z'))).toBe(at('2026-11-22T06:00:00Z'))
    expect(lastRefreshBoundary(at('2026-11-22T23:10:00Z'))).toBe(at('2026-11-22T18:00:00Z'))
    expect(lastRefreshBoundary(at('2026-12-01T02:00:00Z'))).toBe(at('2026-11-30T18:00:00Z'))
  })

  it('is due only when the snapshot predates the last boundary', () => {
    const now = at('2026-11-22T12:00:00Z')
    expect(snapshotDueReason({ force: false, takenAt: at('2026-11-22T06:02:00Z'), now })).toBeNull()
    expect(snapshotDueReason({ force: false, takenAt: at('2026-11-22T05:58:00Z'), now })).toBe('twice-daily')
    expect(snapshotDueReason({ force: false, takenAt: null, now })).toBe('no snapshot')
    expect(snapshotDueReason({ force: true, takenAt: at('2026-11-22T11:59:00Z'), now })).toBe('forced')
  })

  it('rebuilds at most twice a day across 24 hours of 5-minute ticks', () => {
    const start = at('2026-11-22T00:00:00Z')
    let takenAt = start
    let rebuilds = 0
    for (let t = start; t < start + 86_400_000; t += 5 * 60_000) {
      if (snapshotDueReason({ force: false, takenAt, now: t })) { rebuilds++; takenAt = t }
    }
    expect(rebuilds).toBe(2)
  })
})
