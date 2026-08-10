// Shared plumbing for every metric on the performance dashboard: week buckets,
// paged timestamp reads, and the bucketing itself.
//
// Two rules hold everywhere in here:
//   1. A missing table is not an error. Migrations get run late; a page that
//      500s because 0024 hasn't been applied is worse than one showing zero.
//      Every read returns `{ rows, available }` and callers degrade.
//   2. Supabase caps a response at 1000 rows. Anything unbounded pages.

import { createAdminClient } from '@/lib/supabase-server'

export interface Bucket {
  /** ISO date of the bucket start (Monday for weeks, the day itself for days). */
  key: string
  /** Short display label, e.g. "4 AUG". */
  label: string
  start: Date
  end: Date
}

/** Monday 00:00 UTC of the week containing `d`. */
export function weekStart(d: Date): Date {
  const out = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  const dow = (out.getUTCDay() + 6) % 7 // Monday = 0
  out.setUTCDate(out.getUTCDate() - dow)
  return out
}

function shortLabel(d: Date): string {
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }).toUpperCase()
}

/** The last `count` weeks, oldest first, ending with the week in progress. */
export function weekBuckets(count: number, now = new Date()): Bucket[] {
  const thisWeek = weekStart(now)
  const out: Bucket[] = []
  for (let i = count - 1; i >= 0; i--) {
    const start = new Date(thisWeek)
    start.setUTCDate(start.getUTCDate() - i * 7)
    const end = new Date(start)
    end.setUTCDate(end.getUTCDate() + 7)
    out.push({ key: start.toISOString().slice(0, 10), label: shortLabel(start), start, end })
  }
  return out
}

/** The last `count` days, oldest first, ending today. */
export function dayBuckets(count: number, now = new Date()): Bucket[] {
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const out: Bucket[] = []
  for (let i = count - 1; i >= 0; i--) {
    const start = new Date(today)
    start.setUTCDate(start.getUTCDate() - i)
    const end = new Date(start)
    end.setUTCDate(end.getUTCDate() + 1)
    out.push({ key: start.toISOString().slice(0, 10), label: shortLabel(start), start, end })
  }
  return out
}

const PAGE = 1000
const MAX_ROWS = 100_000

/**
 * "This table doesn't exist yet" vs "something is broken".
 *
 * Postgres raises 42P01, but PostgREST usually answers from its schema cache
 * first and returns PGRST205 instead — so checking only 42P01 makes an
 * unmigrated table look like an empty one, and the UI says "no sales" when it
 * should say "run the migration".
 */
export function isMissingTable(error: unknown): boolean {
  const code = (error as any)?.code
  if (code === '42P01' || code === 'PGRST205' || code === 'PGRST202') return true
  const message = String((error as any)?.message ?? '')
  return /could not find the table|does not exist/i.test(message)
}

/**
 * Read `columns` from `table` where `timeColumn` falls on or after `since`,
 * paging until exhausted. `available: false` means the table isn't there —
 * treat it as "no data yet", not as a failure.
 */
export async function readSince<T = Record<string, unknown>>(
  table: string,
  timeColumn: string,
  since: Date,
  columns = '*',
  opts: {
    refine?: (q: any) => any
    /** Set for DATE columns — a full ISO timestamp is the wrong literal there. */
    columnType?: 'timestamp' | 'date'
  } = {},
): Promise<{ rows: T[]; available: boolean }> {
  const admin = createAdminClient()
  const { refine, columnType = 'timestamp' } = opts
  const sinceLiteral = columnType === 'date' ? since.toISOString().slice(0, 10) : since.toISOString()
  const rows: T[] = []
  try {
    for (let from = 0; from < MAX_ROWS; from += PAGE) {
      let q = admin
        .from(table as any)
        .select(columns)
        .gte(timeColumn, sinceLiteral)
        .order(timeColumn, { ascending: true })
        .range(from, from + PAGE - 1)
      if (refine) q = refine(q)
      const { data, error } = await q
      if (error) {
        const missing = isMissingTable(error)
        if (!missing) console.error(`[readSince ${table}]`, error.message)
        return { rows, available: !missing }
      }
      rows.push(...((data ?? []) as unknown as T[]))
      if (!data || data.length < PAGE) break
    }
    return { rows, available: true }
  } catch (err) {
    console.error(`[readSince ${table}]`, err)
    return { rows, available: false }
  }
}

/** Count rows per bucket by reading their timestamps. */
export function bucketCount(
  rows: Array<Record<string, any>>,
  timeColumn: string,
  buckets: Bucket[],
  predicate?: (row: Record<string, any>) => boolean,
): number[] {
  const out = new Array(buckets.length).fill(0)
  for (const r of rows) {
    if (predicate && !predicate(r)) continue
    const t = new Date(r[timeColumn]).getTime()
    if (Number.isNaN(t)) continue
    for (let i = 0; i < buckets.length; i++) {
      if (t >= buckets[i].start.getTime() && t < buckets[i].end.getTime()) {
        out[i]++
        break
      }
    }
  }
  return out
}

/** Sum a numeric column per bucket. */
export function bucketSum(
  rows: Array<Record<string, any>>,
  timeColumn: string,
  valueColumn: string,
  buckets: Bucket[],
  predicate?: (row: Record<string, any>) => boolean,
): number[] {
  const out = new Array(buckets.length).fill(0)
  for (const r of rows) {
    if (predicate && !predicate(r)) continue
    const t = new Date(r[timeColumn]).getTime()
    if (Number.isNaN(t)) continue
    const v = Number(r[valueColumn] ?? 0)
    if (!Number.isFinite(v)) continue
    for (let i = 0; i < buckets.length; i++) {
      if (t >= buckets[i].start.getTime() && t < buckets[i].end.getTime()) {
        out[i] += v
        break
      }
    }
  }
  return out
}

/** Element-wise ratio, guarding the zero-denominator case. */
export function ratioSeries(numerator: number[], denominator: number[]): number[] {
  return numerator.map((n, i) => (denominator[i] > 0 ? n / denominator[i] : 0))
}

export function sum(values: number[]): number {
  return values.reduce((a, b) => a + b, 0)
}

/**
 * The completed period is the one to compare against — the week in progress is
 * always "down" simply because it hasn't finished. Returns the last COMPLETE
 * value and the one before it.
 */
export function lastComplete(series: number[]): { current: number; previous: number | null } {
  if (series.length < 2) return { current: series[0] ?? 0, previous: null }
  return {
    current: series[series.length - 2],
    previous: series.length >= 3 ? series[series.length - 3] : null,
  }
}

/** Fractional change from `prev` to `curr`; null when there's no usable baseline. */
export function change(curr: number, prev: number | null): number | null {
  if (prev === null || !Number.isFinite(prev) || prev === 0) return null
  return (curr - prev) / Math.abs(prev)
}
