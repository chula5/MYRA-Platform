// THE TRIALS — the same pieces, every week, every stylist, and every run kept.
//
// A trial is one piece (and maybe an occasion). A batch is one RUN ALL: every
// active trial styled by every stylist, each column saved with its scorecard.
// Comparing batches is how "did the twenty new pictures help Rosie?" gets a
// number instead of a feeling. Pure: the actions load rows, this reads them.

import { lookSimilarity } from '@/lib/look-similarity'
import type { BenchScorecard } from '@/lib/stylist-bench'

/** lookSimilarity over the supporting pieces at or above this = the same answer as before. */
export const REPRODUCE_THRESHOLD = 0.5

export interface TrialRunLite {
  run_id: string
  trial_id: string
  stylist_id: string
  batch_id: string
  run_at: string
  hero_id: string
  items: { item_id: string | null; brand: string | null }[]
  scores: Partial<BenchScorecard> | null
  verdict: 'yes' | 'no' | null
  model_decisions: number
  envelope_images: number
  brief_hash: string | null
  error?: string | null
}

const supporting = (r: TrialRunLite) => ({ items: r.items.filter((i) => i.item_id && i.item_id !== r.hero_id) })

/**
 * Is this run the same answer as one Chloe already judged? Only verdicts from
 * EARLIER batches count — a batch cannot grade itself — and only on the same
 * trial and stylist.
 */
export function compareToVerdicts(
  run: TrialRunLite,
  past: TrialRunLite[],
): { like_yes: boolean; like_no: boolean; nearest: { run_id: string; sim: number; verdict: 'yes' | 'no' } | null; judged_before: { yes: boolean; no: boolean } } {
  const earlier = past.filter((p) =>
    p.trial_id === run.trial_id && p.stylist_id === run.stylist_id && p.verdict &&
    p.batch_id !== run.batch_id && p.run_at < run.run_at && !p.error,
  )
  let like_yes = false, like_no = false
  let nearest: { run_id: string; sim: number; verdict: 'yes' | 'no' } | null = null
  const mine = supporting(run)
  for (const p of earlier) {
    const sim = lookSimilarity(mine, supporting(p))
    if (!nearest || sim > nearest.sim) nearest = { run_id: p.run_id, sim, verdict: p.verdict! }
    if (sim >= REPRODUCE_THRESHOLD) {
      if (p.verdict === 'yes') like_yes = true
      else like_no = true
    }
  }
  return {
    like_yes, like_no, nearest,
    judged_before: { yes: earlier.some((p) => p.verdict === 'yes'), no: earlier.some((p) => p.verdict === 'no') },
  }
}

export interface StylistBatchReport {
  stylist_id: string
  batch_id: string
  run_at: string
  trials: number
  errors: number
  on_brief: number | null
  occasion: number | null
  distinct: number | null
  envelope: number | null
  coherence: number | null
  /** Of the trials judged YES before, how many came back the same answer. Null = none judged yet. */
  pct_like_yes: number | null
  /** Of the trials judged NO before, how many came back the same answer. Null = none judged yet. */
  pct_like_no: number | null
  model_decisions: number
  envelope_images: number
  brief_hash: string | null
}

const avg = (xs: (number | null | undefined)[]): number | null => {
  const ok = xs.filter((x): x is number => typeof x === 'number')
  return ok.length ? Math.round(ok.reduce((a, b) => a + b, 0) / ok.length) : null
}

/** One report per stylist per batch, oldest batch first. */
export function buildReports(runs: TrialRunLite[]): StylistBatchReport[] {
  const groups = new Map<string, TrialRunLite[]>()
  for (const r of runs) {
    const key = `${r.stylist_id}|${r.batch_id}`
    groups.set(key, [...(groups.get(key) ?? []), r])
  }
  const out: StylistBatchReport[] = []
  for (const group of Array.from(groups.values())) {
    const done = group.filter((r) => !r.error && r.items.length)
    let yesBefore = 0, likeYes = 0, noBefore = 0, likeNo = 0
    for (const r of done) {
      const c = compareToVerdicts(r, runs)
      if (c.judged_before.yes) { yesBefore++; if (c.like_yes) likeYes++ }
      if (c.judged_before.no) { noBefore++; if (c.like_no) likeNo++ }
    }
    const first = group[0]
    out.push({
      stylist_id: first.stylist_id,
      batch_id: first.batch_id,
      run_at: group.reduce((m, r) => (r.run_at < m ? r.run_at : m), first.run_at),
      trials: group.length,
      errors: group.length - done.length,
      on_brief: avg(done.map((r) => r.scores?.on_brief)),
      occasion: avg(done.map((r) => r.scores?.occasion)),
      distinct: avg(done.map((r) => r.scores?.distinct)),
      envelope: avg(done.map((r) => r.scores?.envelope)),
      coherence: avg(done.map((r) => r.scores?.coherence)),
      pct_like_yes: yesBefore ? Math.round((100 * likeYes) / yesBefore) : null,
      pct_like_no: noBefore ? Math.round((100 * likeNo) / noBefore) : null,
      model_decisions: Math.max(...group.map((r) => r.model_decisions), 0),
      envelope_images: Math.max(...group.map((r) => r.envelope_images), 0),
      brief_hash: first.brief_hash ?? null,
    })
  }
  return out.sort((a, b) => a.run_at.localeCompare(b.run_at))
}

export const DELTA_METRICS = ['on_brief', 'occasion', 'distinct', 'envelope', 'coherence', 'pct_like_yes', 'pct_like_no'] as const
export type DeltaMetric = (typeof DELTA_METRICS)[number]

/** Current minus previous, per metric; null where either side is not measurable. */
export function deltas(cur: StylistBatchReport, prev?: StylistBatchReport | null): Record<DeltaMetric, number | null> {
  const out = {} as Record<DeltaMetric, number | null>
  for (const m of DELTA_METRICS) {
    const a = cur[m], b = prev?.[m]
    out[m] = typeof a === 'number' && typeof b === 'number' ? a - b : null
  }
  return out
}

/** For one stylist: the latest report, the one before it, and what moved. */
export function latestForStylist(reports: StylistBatchReport[], stylistId: string): {
  latest: StylistBatchReport | null
  previous: StylistBatchReport | null
  delta: Record<DeltaMetric, number | null> | null
  brief_changed: boolean
  images_before: number | null
} {
  const mine = reports.filter((r) => r.stylist_id === stylistId)
  const latest = mine[mine.length - 1] ?? null
  const previous = mine.length > 1 ? mine[mine.length - 2] : null
  return {
    latest, previous,
    delta: latest ? deltas(latest, previous) : null,
    brief_changed: !!(latest && previous && latest.brief_hash !== previous.brief_hash),
    images_before: previous?.envelope_images ?? null,
  }
}
