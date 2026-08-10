// Shared value formatters. Kept in one place so a metric reads identically on
// its tile, in its chart tooltip and in the table view underneath it.

// Counts are whole things. A gridline reading "21.7 clicks" is nonsense, so
// anything that isn't already an integer is rounded rather than decimalised.
export function fmtNumber(n: number): string {
  if (!Number.isFinite(n)) return '—'
  if (Math.abs(n) >= 10000) return `${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}K`
  return Math.round(n).toLocaleString('en-GB')
}

export function fmtGBP(n: number, opts: { compact?: boolean } = {}): string {
  if (!Number.isFinite(n)) return '—'
  if (opts.compact && Math.abs(n) >= 1000) return `£${(n / 1000).toFixed(1)}K`
  return `£${n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function fmtPct(fraction: number, dp = 1): string {
  if (!Number.isFinite(fraction)) return '—'
  return `${(fraction * 100).toFixed(dp)}%`
}

/** ISO date (YYYY-MM-DD) → "9 AUG". */
export function fmtDay(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }).toUpperCase()
}

/** ISO date of a week-start → "W/C 4 AUG". */
export function fmtWeek(iso: string): string {
  return `W/C ${fmtDay(iso)}`
}

/**
 * How a metric's numbers should read. Server components can't hand a formatter
 * function to a client chart, so they pass this tag instead and the client
 * resolves it here — one definition, both sides.
 */
export type FormatKind = 'count' | 'pct' | 'gbp' | 'gbp0'

export function resolveFormat(kind: FormatKind): (n: number) => string {
  switch (kind) {
    case 'pct':
      return (n) => fmtPct(n, 1)
    case 'gbp':
      return (n) => fmtGBP(n)
    case 'gbp0':
      return (n) => (Number.isFinite(n) ? `£${Math.round(n).toLocaleString('en-GB')}` : '—')
    default:
      return fmtNumber
  }
}

/** Change from `prev` to `curr` as a fraction. Null when there is no baseline. */
export function delta(curr: number, prev: number): number | null {
  if (!Number.isFinite(prev) || prev === 0) return null
  return (curr - prev) / Math.abs(prev)
}
