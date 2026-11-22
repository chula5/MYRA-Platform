// When the retail-library snapshot is rebuilt — pure rules, kept apart from
// library-snapshot.ts (which needs the database) so they can be tested alone.

/** Rebuilt at these UTC hours. */
export const REFRESH_HOURS_UTC = [6, 18] as const
/** New pieces gone live trigger an early rebuild, at most this often. */
export const NEW_ARRIVALS_MIN_GAP_MS = 60 * 60 * 1000

/** The most recent rebuild boundary at or before `now` (06:00 or 18:00 UTC). */
export function lastRefreshBoundary(now: number = Date.now()): number {
  const d = new Date(now)
  const day = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
  const hours = [...REFRESH_HOURS_UTC].sort((a, b) => b - a)
  for (const h of hours) { const t = day + h * 3_600_000; if (t <= now) return t }
  return day - 86_400_000 + hours[0] * 3_600_000 // before 06:00: yesterday's 18:00
}

/** Why the snapshot is due on the clock alone, or null. Pure, for tests. */
export function snapshotDueReason(o: { force: boolean; takenAt: number | null; now: number }): string | null {
  if (o.force) return 'forced'
  if (o.takenAt == null) return 'no snapshot'
  if (o.takenAt < lastRefreshBoundary(o.now)) return 'twice-daily'
  return null
}
