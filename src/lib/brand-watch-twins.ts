// TWINS OF WHAT SHE KEPT — the first thing Brand Watch may keep on its own.
//
// A new piece from the same design line as one Chloe kept from that brand (the
// same model in another colour or length) is almost always kept. Walk-forward on
// her real decisions (2026-09-15): 163 of 173 such pieces kept (94%) — Sessùn
// 34/34, MKDT 24/24, Broraonline 24/24, Adolfo Domínguez 17/17 — but WYSE
// 22/27, By Malene Birger 1/4, ME+EM 0/2. So trust is earned per brand.
//
// What made it reliable, measured:
//  · only her CAREFUL keeps are evidence — one by one, not KEEP ALL, not the
//    machine's own keeps (with bulk keeps as evidence: 90%)
//  · a twin of anything she SKIPPED blocks it (without that check: 83%)
// Pure; no database.

import { isModelTwin, type SimilarCandidate } from './brand-watch-similar'

/** Twin calls a brand needs before AUTO-KEEP TWINS unlocks. */
export const TWIN_MIN_PREDICTIONS = 5
/** Share of them she must actually have kept. */
export const TWIN_PRECISION = 0.9
const BULK_PER_SECOND = 3

export interface TwinDecision extends SimilarCandidate {
  kept: boolean
  /** When she decided (ISO). */
  at: string
  /** Kept by automation rather than by her. */
  autoKept?: boolean
}

export interface TwinTrust {
  predictions: number
  right: number
  trusted: boolean
  summary: string
}

/** One-by-one decisions: not a bulk action, not an automatic keep. */
export function carefulFlags(decisions: TwinDecision[]): boolean[] {
  const perSecond = new Map<string, number>()
  for (const d of decisions) perSecond.set(d.at.slice(0, 19), (perSecond.get(d.at.slice(0, 19)) ?? 0) + 1)
  return decisions.map((d) => !d.autoKept && (perSecond.get(d.at.slice(0, 19)) ?? 0) <= BULK_PER_SECOND)
}

/**
 * The piece she kept that `cand` is a twin of — or null when there is none,
 * or when `cand` is also a twin of anything she skipped.
 */
export function keptTwinOf<T extends TwinDecision>(cand: SimilarCandidate, earlier: T[], careful: boolean[]): T | null {
  let kept: T | null = null
  for (let i = 0; i < earlier.length; i++) {
    const e = earlier[i]
    if (!isModelTwin(e, cand)) continue
    if (!e.kept) return null
    if (!kept && careful[i]) kept = e
  }
  return kept
}

export function summariseTwinTrust(predictions: number, right: number): TwinTrust {
  const precision = predictions ? right / predictions : 0
  const trusted = predictions >= TWIN_MIN_PREDICTIONS && precision >= TWIN_PRECISION
  const summary = predictions === 0
    ? 'TWINS: NO TWINS OF YOUR KEEPS YET'
    : trusted
      ? `TWINS TRUSTED — RIGHT ${right} OF ${predictions}`
      : predictions < TWIN_MIN_PREDICTIONS
        ? `TWINS: LEARNING — ${predictions} OF ${TWIN_MIN_PREDICTIONS}, ${right} RIGHT`
        : `TWINS: NOT YET — RIGHT ${right} OF ${predictions} (${Math.round(precision * 100)}%)`
  return { predictions, right, trusted, summary }
}

/**
 * Twin trust per brand (keyed by brand_name as given). Each careful decision is
 * judged only against decisions made before it.
 */
export function measureTwinTrust(decisions: TwinDecision[]): Map<string, TwinTrust> {
  const byBrand = new Map<string, TwinDecision[]>()
  for (const d of [...decisions].sort((a, b) => a.at.localeCompare(b.at))) {
    const key = d.brand_name ?? ''
    byBrand.set(key, [...(byBrand.get(key) ?? []), d])
  }
  const out = new Map<string, TwinTrust>()
  byBrand.forEach((list, brand) => {
    const careful = carefulFlags(list)
    let predictions = 0
    let right = 0
    for (let i = 0; i < list.length; i++) {
      if (!careful[i]) continue
      if (!keptTwinOf(list[i], list.slice(0, i), careful)) continue
      predictions++
      if (list[i].kept) right++
    }
    out.set(brand, summariseTwinTrust(predictions, right))
  })
  return out
}
