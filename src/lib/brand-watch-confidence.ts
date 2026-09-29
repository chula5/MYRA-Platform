// HOW SURE IS MYRA THAT CHLOE WOULD KEEP THIS PIECE?
//
// The learning already says how much a piece looks like her keeps (a lift, in
// log-odds-ish units) and the scan says how well it fits the house style. What
// neither says is the thing she actually wants to act on: the CHANCE she would
// keep it. "Delta ≥ 2" is a rule of thumb; "94% of pieces that looked like this
// were kept" is a number you can set a bar against.
//
// So: one tiny logistic regression per brand, fitted on that brand's own
// decisions, over two features — the learned lift and the house-style score.
// Two weights and an intercept, fitted by gradient descent in a few
// milliseconds, no dependencies, deterministic. A brand with few decisions
// falls back towards its own keep rate rather than inventing certainty.
//
// Pure: no database, no clock. Everything here is measured before it is trusted
// (measureConfidence walks forward over her decisions, exactly as the existing
// trust measure does).

import { buildLearning, type DecidedRow } from './brand-watch-learning'

/** A decision, with the two numbers the model reads. */
export interface ConfidenceSample {
  kept: boolean
  /** Learned lift for the piece, from the decisions made BEFORE it. */
  delta: number
  /** The house-style score when it was queued. */
  score: number
}

export interface BrandModel {
  /** log-odds = bias + wDelta × (delta − meanDelta)/sdDelta + wScore × (score − meanScore)/sdScore */
  bias: number
  wDelta: number
  wScore: number
  meanDelta: number
  sdDelta: number
  meanScore: number
  sdScore: number
  /** Decisions it was fitted on. */
  n: number
  /** Her keep rate for the brand — what the model falls back towards. */
  baseRate: number
}

const sigmoid = (z: number) => 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, z))))

/** The model for a brand with nothing to learn from yet: her keep rate, flat. */
export function baseModel(baseRate: number, n = 0): BrandModel {
  const p = Math.max(0.02, Math.min(0.98, baseRate))
  return { bias: Math.log(p / (1 - p)), wDelta: 0, wScore: 0, meanDelta: 0, sdDelta: 1, meanScore: 0, sdScore: 1, n, baseRate: p }
}

/**
 * Fit on a brand's decisions. L2-regularised so a handful of decisions cannot
 * produce a confident model; the regularisation pulls the weights towards zero,
 * which leaves the answer at her keep rate.
 */
export function fitBrandModel(samples: ConfidenceSample[], opts: { l2?: number; iterations?: number; rate?: number } = {}): BrandModel {
  const n = samples.length
  const kept = samples.filter((s) => s.kept).length
  const baseRate = n ? kept / n : 0.5
  if (n < 8 || kept === 0 || kept === n) return baseModel(baseRate, n)

  // Light regularisation and standardised features. With a heavy penalty and a
  // fixed scale the weights barely moved, so every piece came back at her keep
  // rate — 88% on everything, which tells her nothing.
  const l2 = opts.l2 ?? 0.25
  const iterations = opts.iterations ?? 900
  const rate = opts.rate ?? 0.35
  const stats = (xs: number[]) => {
    const mean = xs.reduce((a, b) => a + b, 0) / xs.length
    const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length) || 1
    return { mean, sd: Math.max(sd, 0.25) }
  }
  const d = stats(samples.map((s) => s.delta))
  const sc = stats(samples.map((s) => s.score))
  const x = samples.map((s) => [(s.delta - d.mean) / d.sd, (s.score - sc.mean) / sc.sd])
  const y = samples.map((s) => (s.kept ? 1 : 0))
  let [bias, wDelta, wScore] = [Math.log(Math.max(0.02, baseRate) / Math.max(0.02, 1 - baseRate)), 0, 0]

  for (let it = 0; it < iterations; it++) {
    let gB = 0, gD = 0, gS = 0
    for (let i = 0; i < n; i++) {
      const p = sigmoid(bias + wDelta * x[i][0] + wScore * x[i][1])
      const e = p - y[i]
      gB += e; gD += e * x[i][0]; gS += e * x[i][1]
    }
    bias -= (rate * gB) / n
    wDelta -= (rate * (gD + l2 * wDelta)) / n
    wScore -= (rate * (gS + l2 * wScore)) / n
  }
  return { bias, wDelta, wScore, meanDelta: d.mean, sdDelta: d.sd, meanScore: sc.mean, sdScore: sc.sd, n, baseRate }
}

/** The chance she would keep a piece, 0..1. */
export function confidenceFor(model: BrandModel, delta: number, score: number): number {
  const z = model.bias
    + model.wDelta * ((delta - model.meanDelta) / model.sdDelta)
    + model.wScore * ((score - model.meanScore) / model.sdScore)
  return sigmoid(z)
}

/**
 * What she has decided about this KIND of piece — a blazer in leather, not
 * "blazer" and "leather" apart. MYRA may not be sure about a combination she
 * has never seen: she has kept hundreds of leather pieces and hundreds of
 * blazers, and never once a leather blazer.
 *
 * Thin evidence now pulls the number TOWARDS her base keep rate rather than
 * clipping it. The clip was doing most of the ranking and doing it badly: it
 * put 1,832 queued pieces on exactly 0.70 with no way to order them, and
 * because `Math.min` only ever pushes down, a piece the model disliked and a
 * piece it had simply never seen came out identical. Shrinking says the true
 * thing — "we don't know yet" — while leaving pieces comparable.
 *
 * It does NOT push a never-seen kind down on purpose: that the kind is unknown
 * is already in the learning's `kind:` feature, and punishing it twice is the
 * double-counting this scorer exists to avoid. Automation guards itself with
 * `kindIsUnproven` instead.
 */
export const KIND_EVIDENCE_K = 6
export function dampByKind(
  p: number,
  kind: { kindKeeps: number; kindSkips: number },
  baseRate = 0.5,
): number {
  const seen = kind.kindKeeps + kind.kindSkips
  const w = seen / (seen + KIND_EVIDENCE_K)
  return baseRate + (p - baseRate) * w
}

/** Decisions on a kind before automation may act on it unsupervised. */
export const KIND_PROVEN_AT = 4
/**
 * A kind she has never kept, or has barely seen. The queue still shows a
 * number for these — they have to be rankable — but AUTO-ADD will not take
 * one on its own.
 */
export const kindIsUnproven = (kind: { kindKeeps: number; kindSkips: number }): boolean =>
  kind.kindKeeps === 0 || kind.kindKeeps + kind.kindSkips < KIND_PROVEN_AT

/**
 * The one gate automation acts on — and the one the trust measure is taken
 * through, so what she is promised is what the machine does.
 */
export const wouldAutoKeepByConfidence = (
  p: number | null | undefined,
  kind: { kindKeeps: number; kindSkips: number },
  bar: number,
): boolean => p != null && p >= bar && !kindIsUnproven(kind)

// ── The models, and one piece's number ───────────────────────────────────────
// Pure, and deliberately NOT in brand-watch-auto: that module reaches the
// database and the Style Brain, so anything importing it drags a server-only
// world along. Keeping the composition here lets the offline evaluator
// (scripts/brand-watch-eval.ts) measure exactly what the queue shows, rather
// than a copy of it that quietly drifts.

export interface ConfidenceModels {
  /** Fitted on one brand's own careful decisions. */
  byBrand: Map<string, BrandModel>
  /** Fitted on every brand's careful decisions — the house's taste so far. */
  house: BrandModel | null
}

/** A decision the models are fitted on: the learning's features plus its score. */
export type ModelSample = DecidedRow & { score: number; autoKept?: boolean }

/**
 * A model per brand, and one for the house.
 *
 * A brand she has never decided on has no history of its own, but the library
 * does: thousands of keeps and skips across every other brand. That pooled
 * model is what a new brand starts from, so its first piece carries a number
 * rather than nothing. As she keeps and skips from the brand itself, its own
 * model takes over (see `confidenceFromModels`).
 */
export function confidenceModels(
  decisions: ModelSample[],
  learn: ReturnType<typeof buildLearning>,
): ConfidenceModels {
  const byBrand = new Map<string, ModelSample[]>()
  const careful: ModelSample[] = []
  for (const d of decisions) {
    if (d.autoKept) continue
    careful.push(d)
    if (!d.brandName) continue
    byBrand.set(d.brandName, [...(byBrand.get(d.brandName) ?? []), d])
  }
  const sample = (d: ModelSample) => ({ kept: d.kept, delta: learn(d).delta, score: d.score })
  const models = new Map<string, BrandModel>()
  byBrand.forEach((list, brand) => { models.set(brand, fitBrandModel(list.map(sample))) })
  return { byBrand: models, house: careful.length >= 8 ? fitBrandModel(careful.map(sample)) : null }
}

/**
 * How much of its own evidence a brand needs before its model outweighs the
 * house's. At 12 decisions a brand speaks for half of the answer.
 */
export const BRAND_EVIDENCE_K = 12

/** The chance she keeps this piece, blending the brand's model with the house's. */
export function confidenceFromModels(
  models: ConfidenceModels,
  learn: ReturnType<typeof buildLearning>,
  row: DecidedRow,
  score: number,
): number | null {
  const brand = row.brandName ? models.byBrand.get(row.brandName) : undefined
  const house = models.house
  if (!brand && !house) return null
  const v = learn(row)
  const pBrand = brand ? confidenceFor(brand, v.delta, score) : null
  const pHouse = house ? confidenceFor(house, v.delta, score) : null
  // A new brand is read by the house; a brand with its own history speaks for
  // itself, in proportion to how much of it there is.
  const w = pBrand == null ? 0 : pHouse == null ? 1 : brand!.n / (brand!.n + BRAND_EVIDENCE_K)
  const p = (pBrand ?? 0) * w + (pHouse ?? 0) * (1 - w)
  // Never sure about a kind of piece she has never kept. Shrunk towards the
  // rate she keeps at overall, which is the honest answer when nothing is known.
  return dampByKind(p, v, (house ?? brand)!.baseRate)
}

/** Where a piece's number came from — for the label under it. */
export function confidenceSource(
  models: ConfidenceModels,
  brandName: string | null | undefined,
): 'brand' | 'house' | 'blend' | null {
  const n = (brandName ? models.byBrand.get(brandName)?.n : 0) ?? 0
  if (!models.house) return n ? 'brand' : null
  if (!n) return 'house'
  return n >= BRAND_EVIDENCE_K * 3 ? 'brand' : 'blend'
}

// ── Measuring it, before trusting it ─────────────────────────────────────────

export interface ConfidenceDecision extends DecidedRow {
  at: string
  score: number
  autoKept?: boolean
}

export interface ConfidenceTrust {
  /** Her one-by-one decisions used as evidence. */
  careful: number
  /** How many of those the model would have auto-kept at this bar. */
  predictions: number
  /** How many of those she kept. */
  right: number
  precision: number | null
  /** Share of her careful decisions the bar would have taken off her hands. */
  coverage: number
  trusted: boolean
  summary: string
}

/** More decisions than this in one second is a bulk action, not a judgement. */
const BULK_PER_SECOND = 3
export const CONFIDENCE_MIN_PREDICTIONS = 12
/** The broad reading counts bulk keeps, so it needs more before it is trusted. */
export const BROAD_MIN_PREDICTIONS = 40
/**
 * The bar: anything above this may be kept without her. 85% is her own call
 * (2026-09-22), and it is where the measurement is strongest — on ME+EM's
 * history the 85% bar added 79 pieces and was right about 75 of them.
 */
export const DEFAULT_CONFIDENCE = 0.85
/** Measured precision the brand must reach at its bar before automation runs. */
export const CONFIDENCE_PRECISION = 0.9

export function summariseConfidence(careful: number, predictions: number, right: number, threshold: number, mode: 'careful' | 'all' = 'careful'): ConfidenceTrust {
  const precision = predictions ? right / predictions : null
  // A bulk keep says less about any one piece, so the broad reading needs more.
  const need = mode === 'all' ? BROAD_MIN_PREDICTIONS : CONFIDENCE_MIN_PREDICTIONS
  const trusted = predictions >= need && (precision ?? 0) >= CONFIDENCE_PRECISION
  const pct = Math.round(threshold * 100)
  const summary = careful === 0
    ? 'NO ONE-BY-ONE DECISIONS YET'
    : trusted
      ? `TRUSTED AT ${pct}% — RIGHT ${right} OF ${predictions}${mode === 'all' ? ' (KEEP-ALLS COUNTED)' : ''}`
      : predictions < CONFIDENCE_MIN_PREDICTIONS
        ? `LEARNING — ${predictions} OF ${need} PIECES OVER ${pct}%${predictions ? `, ${right} RIGHT` : ''}`
        : `NOT YET — RIGHT ${right} OF ${predictions} OVER ${pct}% (${Math.round((precision ?? 0) * 100)}%, NEEDS ${Math.round(CONFIDENCE_PRECISION * 100)}%)`
  return { careful, predictions, right, precision, coverage: careful ? predictions / careful : 0, trusted, summary }
}

/**
 * Walk forward over one brand's decisions: fit on everything decided before a
 * chunk, then ask what the model would have done with that chunk. Only her own
 * one-by-one decisions count as evidence — never a bulk keep, never an
 * auto-keep, because a machine proving itself right proves nothing.
 */
export function measureConfidence(
  decisions: ConfidenceDecision[],
  threshold = DEFAULT_CONFIDENCE,
  chunk = 25,
  /**
   * 'careful' — only her one-by-one decisions count as proof. The strictest
   *   reading, and pessimistic where she reviews one by one exactly when a
   *   scan is borderline.
   * 'all' — every decision she made herself, KEEP ALL included. A bulk keep is
   *   still her saying yes to those pieces; it is weaker evidence about any one
   *   of them, so this reading needs more of them before it is trusted.
   */
  mode: 'careful' | 'all' = 'careful',
): ConfidenceTrust {
  const ordered = [...decisions].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0))
  const perSecond = new Map<string, number>()
  for (const d of ordered) {
    const k = (d.at ?? '').slice(0, 19)
    perSecond.set(k, (perSecond.get(k) ?? 0) + 1)
  }
  const careful = (d: ConfidenceDecision) =>
    !d.autoKept && (mode === 'all' || (perSecond.get((d.at ?? '').slice(0, 19)) ?? 0) <= BULK_PER_SECOND)

  let carefulSeen = 0, predictions = 0, right = 0
  for (let i = chunk; i < ordered.length; i += chunk) {
    const past = ordered.slice(0, i).filter((d) => !d.autoKept)
    if (past.length < 12) continue
    const learn = buildLearning(past)
    const model = fitBrandModel(past.map((d) => ({ kept: d.kept, delta: learn(d).delta, score: d.score })))
    for (const d of ordered.slice(i, i + chunk)) {
      if (!careful(d)) continue
      carefulSeen++
      const v = learn(d)
      const p = dampByKind(confidenceFor(model, v.delta, d.score), v, model.baseRate)
      // Measured through the SAME gate automation acts on, or the trust number
      // would be a promise about something the machine never does.
      if (wouldAutoKeepByConfidence(p, v, threshold)) {
        predictions++
        if (d.kept) right++
      }
    }
  }
  return summariseConfidence(carefulSeen, predictions, right, threshold, mode)
}

/**
 * Both readings together. A brand may act on the broad one, but the page
 * always shows what her one-by-one decisions said as well — it is the harder
 * test, and where the two disagree she should see it.
 */
export function measureBoth(decisions: ConfidenceDecision[], threshold = DEFAULT_CONFIDENCE): { careful: ConfidenceTrust; all: ConfidenceTrust; trusted: boolean; summary: string } {
  const strict = measureConfidence(decisions, threshold, 25, 'careful')
  const broad = measureConfidence(decisions, threshold, 30, 'all')
  const trusted = strict.trusted || broad.trusted
  const summary = strict.trusted
    ? strict.summary
    : broad.trusted
      ? `${broad.summary}${strict.predictions >= 5 && (strict.precision ?? 1) < CONFIDENCE_PRECISION ? ` · ONE-BY-ONE ONLY ${Math.round((strict.precision ?? 0) * 100)}% OF ${strict.predictions}` : ''}`
      : broad.predictions > strict.predictions ? broad.summary : strict.summary
  return { careful: strict, all: broad, trusted, summary }
}
