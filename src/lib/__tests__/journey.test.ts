import { describe, it, expect } from 'vitest'
import {
  sessionActiveMs,
  resolveStartedAt,
  median,
  periodChange,
  fmtDuration,
  fmtClock,
  describeEvent,
  ROOM_LABEL,
  type JourneyEvent,
} from '@/lib/journey'

const MIN = 60_000
const HOUR = 60 * MIN

const at = (iso: string) => iso
const event = (over: Partial<JourneyEvent> & { type: JourneyEvent['type'] }): JourneyEvent => ({
  eventId: 1, msOffset: 0, seq: 0, at: '2026-09-22T10:00:00Z',
  room: null, path: null, label: null, targetKind: null, targetId: null, meta: {},
  ...over,
})

describe('how long a visit counts for', () => {
  it('trusts the tracker’s own active time over the wall clock', () => {
    // She had the tab open for an hour but was only looking for four minutes.
    // The four minutes is the honest number.
    expect(sessionActiveMs({
      active_ms: 4 * MIN,
      started_at: at('2026-09-22T10:00:00Z'),
      last_seen_at: at('2026-09-22T11:00:00Z'),
    })).toBe(4 * MIN)
  })

  it('falls back to elapsed time when the visit closed before its first heartbeat', () => {
    expect(sessionActiveMs({
      active_ms: 0,
      started_at: at('2026-09-22T10:00:00Z'),
      last_seen_at: at('2026-09-22T10:02:30Z'),
    })).toBe(150_000)
  })

  it('treats a missing active_ms the same as a zero one', () => {
    expect(sessionActiveMs({
      started_at: at('2026-09-22T10:00:00Z'),
      last_seen_at: at('2026-09-22T10:01:00Z'),
    })).toBe(MIN)
  })

  it('caps a lid-closed session rather than reporting a nine-hour styling appointment', () => {
    expect(sessionActiveMs({
      active_ms: 0,
      started_at: at('2026-09-22T09:00:00Z'),
      last_seen_at: at('2026-09-22T18:00:00Z'),
    })).toBe(4 * HOUR)
    // The cap applies to a declared total too — a broken tracker cannot inflate it.
    expect(sessionActiveMs({
      active_ms: 20 * HOUR,
      started_at: at('2026-09-22T09:00:00Z'),
      last_seen_at: at('2026-09-22T09:10:00Z'),
    })).toBe(4 * HOUR)
  })

  it('is zero when last_seen_at is not after started_at', () => {
    expect(sessionActiveMs({
      active_ms: 0,
      started_at: at('2026-09-22T10:00:00Z'),
      last_seen_at: at('2026-09-22T10:00:00Z'),
    })).toBe(0)
    expect(sessionActiveMs({
      active_ms: 0,
      started_at: at('2026-09-22T10:00:00Z'),
      last_seen_at: at('2026-09-22T09:59:00Z'),
    })).toBe(0)
  })
})

describe('the start time a browser claims for its own visit', () => {
  const now = Date.parse('2026-09-22T12:00:00Z')

  it('is kept when it could be true — this is what survives a reload', () => {
    const tenMinutesAgo = now - 10 * MIN
    expect(resolveStartedAt(tenMinutesAgo, now)).toBe(new Date(tenMinutesAgo).toISOString())
  })

  it('is refused when it is in the future', () => {
    expect(resolveStartedAt(now + 10 * MIN, now)).toBeNull()
  })

  it('allows a little clock skew rather than punishing it', () => {
    expect(resolveStartedAt(now + 30_000, now)).not.toBeNull()
  })

  it('is refused when it is older than a session could be', () => {
    expect(resolveStartedAt(now - 5 * HOUR, now)).toBeNull()
  })

  it('is refused when it is not a usable number', () => {
    expect(resolveStartedAt(null, now)).toBeNull()
    expect(resolveStartedAt(undefined, now)).toBeNull()
    expect(resolveStartedAt(0, now)).toBeNull()
    expect(resolveStartedAt(Number.NaN, now)).toBeNull()
  })
})

describe('median', () => {
  it('takes the middle of an odd list', () => {
    expect(median([30, 10, 20])).toBe(20)
  })

  it('averages the middle pair of an even list', () => {
    expect(median([10, 20, 30, 40])).toBe(25)
  })

  it('is zero for nothing', () => {
    expect(median([])).toBe(0)
  })

  it('does not reorder the caller’s array', () => {
    const values = [30, 10, 20]
    median(values)
    expect(values).toEqual([30, 10, 20])
  })
})

describe('period-over-period change', () => {
  it('reads a doubling as +100%', () => {
    expect(periodChange(10, 5)).toBe(1)
  })

  it('reads a halving as -50%', () => {
    expect(periodChange(5, 10)).toBe(-0.5)
  })

  it('refuses to divide by an empty baseline', () => {
    // Her first-ever week is not an infinite improvement on the week before it.
    expect(periodChange(4, 0)).toBeNull()
  })
})

describe('durations read as minutes, not as seconds', () => {
  it('shows seconds alone under a minute', () => {
    expect(fmtDuration(42_000)).toBe('42S')
  })

  it('shows minutes and seconds under an hour', () => {
    expect(fmtDuration(4 * MIN + 12_000)).toBe('4M 12S')
  })

  it('drops to hours and minutes past an hour', () => {
    expect(fmtDuration(2 * HOUR + 7 * MIN)).toBe('2H 7M')
  })

  it('is zero for nothing, and never negative', () => {
    expect(fmtDuration(0)).toBe('0S')
    expect(fmtDuration(-500)).toBe('0S')
  })

  it('pads the replay clock', () => {
    expect(fmtClock(65_000)).toBe('1:05')
    expect(fmtClock(0)).toBe('0:00')
  })
})

describe('what an event reads as in the replay', () => {
  it('names the room she walked into, not its id', () => {
    expect(describeEvent(event({ type: 'room_open', room: 'dressing_room' })))
      .toBe(`WENT INTO ${ROOM_LABEL.dressing_room}`)
  })

  it('turns scroll depth into a percentage of the page', () => {
    expect(describeEvent(event({ type: 'scroll', room: 'all_looks', meta: { depth: 0.62 } })))
      .toBe('SCROLLED 62% OF YOUR LOOKS')
  })

  it('quotes what she searched for', () => {
    expect(describeEvent(event({ type: 'search', label: 'something for Greece' })))
      .toBe('SEARCHED "something for Greece"')
  })

  it('names the retailer she left for', () => {
    expect(describeEvent(event({ type: 'click_out', label: 'net-a-porter.com' })))
      .toBe('CLICKED THROUGH TO net-a-porter.com')
  })

  it('says nothing more than it knows when a tap had no label', () => {
    expect(describeEvent(event({ type: 'session_start' }))).toBe('OPENED THE APP')
    expect(describeEvent(event({ type: 'click' }))).toBe('TAPPED')
  })
})
