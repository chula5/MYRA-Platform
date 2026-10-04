// Background work for Brand Watch, and how the page reports it.
//
// Every long job here used to run inside the click that started it. Choosing a
// brand, switching AUTO-ADD on, clearing a backlog and KEEP ALL SHOWN each held
// the request open, and the page greyed every control while it waited — so
// setting up four brands meant four waits in a row, and a queue load stopped
// her touching anything else at all.
//
// A job now starts, says so on its own brand's card, and runs on. The state
// lives in watched_brand.scan_state beside the scan flag that was already
// there, so this needs no migration and survives a reload.

export interface BulkJob {
  /** Which button started it, e.g. 'keep-all'. */
  kind: string
  /** What the card says, e.g. 'KEEPING 214 PIECES'. */
  label: string
  done: number
  total: number
  started_at: string
  /** Absent while it is still going. */
  ended_at?: string
  error?: string
  kept?: number
  note?: string
}

/** How far a catalogue scan has got. */
export interface ScanProgress {
  done: number
  total: number | null
  started_at?: string
}

/** A job whose process died mid-run must not read as running for ever. */
export const STALE_JOB_MS = 30 * 60 * 1000

export function bulkJobOf(scanState: unknown): BulkJob | undefined {
  const job = (scanState as { bulk?: unknown } | null | undefined)?.bulk
  if (!job || typeof job !== 'object') return undefined
  const j = job as BulkJob
  return typeof j.started_at === 'string' && typeof j.label === 'string' ? j : undefined
}

export function scanProgressOf(scanState: unknown): ScanProgress | undefined {
  const s = scanState as { running?: boolean; done?: number; total?: number; started_at?: string } | null | undefined
  if (!s?.running) return undefined
  return { done: Number(s.done ?? 0), total: s.total == null ? null : Number(s.total), started_at: s.started_at }
}

export function bulkRunning(job: BulkJob | undefined, now = Date.now()): boolean {
  if (!job || job.ended_at) return false
  const started = Date.parse(job.started_at)
  return !Number.isFinite(started) || now - started <= STALE_JOB_MS
}

/**
 * A bulk job goes into scan_state BESIDE the scan's own counters, never over
 * them. The two run in the same column and a blind write would wipe a scan's
 * progress mid-run, leaving the card saying "SCANNING 0/?" for a catalogue that
 * is nearly read.
 */
export function withBulkJob(scanState: unknown, bulk: BulkJob): Record<string, unknown> {
  return { ...((scanState as Record<string, unknown> | null | undefined) ?? {}), bulk }
}

export type BulkTone = 'working' | 'done' | 'failed' | 'stopped'

export interface BulkLine {
  text: string
  tone: BulkTone
}

/** What a brand's card says about its current or last job. Null when silent. */
export function bulkLine(job: BulkJob | undefined, now = Date.now()): BulkLine | null {
  if (!job) return null
  const started = Date.parse(job.started_at)
  const expired = !Number.isFinite(started) || now - started > STALE_JOB_MS
  if (!job.ended_at) {
    if (expired) return { text: `${job.label} STOPPED PART-WAY — START IT AGAIN`, tone: 'stopped' }
    const progress = job.total > 0 ? ` — ${job.done}/${job.total}` : ''
    return { text: `${job.label}${progress}`, tone: 'working' }
  }
  if (job.error) return { text: `${job.label} FAILED — ${job.error}`, tone: 'failed' }
  const kept = job.kept != null ? `${job.kept} KEPT` : 'DONE'
  return { text: `${job.label} — ${kept}${job.note ? ` · ${job.note}` : ''}`, tone: 'done' }
}

/**
 * Whether a card should still show its job. A finished job is worth reading for
 * a few minutes — it is the record of what the button just did — and after that
 * it is only clutter on a card she reads every day.
 */
export function bulkLineVisible(job: BulkJob | undefined, now = Date.now(), withinMs = 10 * 60 * 1000): boolean {
  if (!job) return false
  if (bulkRunning(job, now)) return true
  if (!job.ended_at) return true // stopped part-way: worth saying until she restarts it
  const ended = Date.parse(job.ended_at)
  return !Number.isFinite(ended) || now - ended <= withinMs
}

/**
 * Progress writes, throttled. A 400-piece keep must not spend 400 round trips
 * telling the page where it is. The final write always goes through, so a job
 * never finishes showing one piece short.
 */
export function throttledProgress(ms: number, write: (done: number) => void): (done: number, total: number) => void {
  let last = 0
  return (done, total) => {
    const now = Date.now()
    if (done < total && now - last < ms) return
    last = now
    write(done)
  }
}
