// CAN THIS BRAND BE TRUSTED TO KEEP PIECES ON ITS OWN?
//
// Walk-forward over Chloe's own decisions: each one is predicted from the
// decisions made BEFORE it, then compared with what she actually did. A brand
// earns AUTOMATE when, over its recent one-by-one decisions, the pieces the
// learning would have auto-kept are ones she kept.
//
// Only careful decisions count as proof. Bulk keeps (KEEP ALL SHOWN / KEEP ALL
// BRAND — many in the same second) and pieces the system auto-kept itself
// are never evidence: 3,768 of her first 4,766 decisions were bulk, and a
// machine's keeps proving the machine right would prove nothing.
//
// Measured before building (2026-09-15): Isabel Marant 20/20, MKDT 21/21,
// Broraonline 15/15, Skall Studio 21/22 right — but ME+EM 6/11 and Sessùn 7/9,
// where the learning is no better than her keep rate. Pure; no database.

import { buildLearning, type DecidedRow } from './brand-watch-learning'

/** Learned lift a piece needs before it may be kept automatically. */
export const AUTO_KEEP_DELTA = 2
/** Recent one-by-one decisions per brand that trust is judged on. */
export const TRUST_WINDOW = 40
/** Auto-keep predictions needed in that window before trust can be earned. */
export const TRUST_MIN_PREDICTIONS = 10
/** Share of those predictions she must actually have kept. */
export const TRUST_PRECISION = 0.9
/** More decisions than this in one second is a bulk action, not a judgement. */
const BULK_PER_SECOND = 3

export interface TrustDecision extends DecidedRow {
  /** When she decided (ISO). */
  at: string
  /** The piece's house-style score when queued. */
  score: number
  /** The brand's min score. */
  minScore: number
  /** Kept by automation, not by her. */
  autoKept?: boolean
}

export interface BrandTrust {
  /** Her one-by-one decisions in the window. */
  careful: number
  /** How many of those the learning would have auto-kept. */
  predictions: number
  /** How many of those she kept. */
  right: number
  precision: number | null
  trusted: boolean
  summary: string
}

export const wouldAutoKeep = (delta: number, score: number, minScore: number): boolean =>
  delta >= AUTO_KEEP_DELTA && score >= minScore

export function summariseTrust(careful: number, predictions: number, right: number): BrandTrust {
  const precision = predictions ? right / predictions : null
  const trusted = predictions >= TRUST_MIN_PREDICTIONS && (precision ?? 0) >= TRUST_PRECISION
  const summary = careful === 0
    ? 'NO ONE-BY-ONE DECISIONS YET'
    : trusted
      ? `TRUSTED — RIGHT ${right} OF ${predictions}`
      : predictions < TRUST_MIN_PREDICTIONS
        ? `LEARNING — ${predictions} OF ${TRUST_MIN_PREDICTIONS} PREDICTIONS${predictions ? `, ${right} RIGHT` : ''}`
        : `NOT YET — RIGHT ${right} OF ${predictions} (${Math.round((precision ?? 0) * 100)}%, NEEDS ${Math.round(TRUST_PRECISION * 100)}%)`
  return { careful, predictions, right, precision, trusted, summary }
}

/** Trust per brand name. Brands with no decisions are absent. */
export function measureBrandTrust(decisions: TrustDecision[], chunk = 50): Map<string, BrandTrust> {
  const ordered = [...decisions].sort((a, b) => a.at.localeCompare(b.at))
  const perSecond = new Map<string, number>()
  for (const d of ordered) perSecond.set(d.at.slice(0, 19), (perSecond.get(d.at.slice(0, 19)) ?? 0) + 1)
  const careful = (d: TrustDecision) => !d.autoKept && (perSecond.get(d.at.slice(0, 19)) ?? 0) <= BULK_PER_SECOND

  // brand → [would auto-keep, kept] for each careful decision, oldest first
  const outcomes = new Map<string, [boolean, boolean][]>()
  for (let i = 0; i < ordered.length; i += chunk) {
    // The machine's own keeps never train the verdict that judges it.
    const learn = buildLearning(ordered.slice(0, i).filter((d) => !d.autoKept))
    for (const d of ordered.slice(i, i + chunk)) {
      if (!careful(d)) continue
      const brand = d.brandName ?? ''
      const list = outcomes.get(brand) ?? []
      list.push([wouldAutoKeep(learn(d).delta, d.score, d.minScore), d.kept])
      outcomes.set(brand, list)
    }
  }

  const out = new Map<string, BrandTrust>()
  for (const d of ordered) if (!out.has(d.brandName ?? '')) out.set(d.brandName ?? '', summariseTrust(0, 0, 0))
  outcomes.forEach((list, brand) => {
    const recent = list.slice(-TRUST_WINDOW)
    const predicted = recent.filter(([auto]) => auto)
    out.set(brand, summariseTrust(recent.length, predicted.length, predicted.filter(([, kept]) => kept).length))
  })
  return out
}
