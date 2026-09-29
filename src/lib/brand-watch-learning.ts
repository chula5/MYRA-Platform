// Deterministic keep/skip learning for Brand Watch. No API cost, no model —
// log-odds over features of every decision already made (KEEP → ready,
// SKIP → archived). Fine-grained on purpose: item type alone never damns a
// category; the words of the product name (chunky, mesh, croco, heel heights),
// colour, material and price band separate the trainers that were kept from
// the trainers that were skipped.
//
// ── WHAT `delta` MEANS ──────────────────────────────────────────────────────
// Log-odds ABOVE OR BELOW her base keep rate. A piece whose features behave
// exactly like her average decision scores 0. Positive is better than average,
// negative is worse. Not a probability — brand-watch-confidence turns it into
// one.
//
// ── WHY IT IS BUILT THIS WAY (measured 2026-09-29) ──────────────────────────
// The first version summed `log2((k+0.5)/(s+0.5))` clamped to ±2 over every
// feature, and it could not tell anything from anything: AUC 0.560 against a
// 0.5 coin flip, and 54% of 5,377 decided pieces landed on exactly +6.0 — the
// clamp. Two faults, both fixed here:
//
//  1. NOT CENTRED ON THE PRIOR. She keeps ~62% of what reaches the queue, so
//     a feature that means nothing at all still scored log2(0.62/0.38) = +0.7,
//     and anything slightly better hit the +2 clamp. Every feature voted keep.
//     Now each weight is measured AGAINST the base rate, so an average feature
//     contributes exactly nothing and only real evidence moves the number.
//
//  2. CORRELATED FEATURES COUNTED OVER AND OVER. `type:knitwear`,
//     `kind:knitwear|natural_knit`, `tc:knitwear|black` and the name token
//     `t:knit` are one fact about a garment, not four. Summing them meant a
//     piece with 8.9 features raced to the clamp on a single idea. They are
//     now grouped, averaged within the group, and the groups are weighted.
//
// Shrinkage replaces the old `k + s < 2` cutoff: a feature seen twice is pulled
// most of the way back to the prior, so thin evidence can no longer shout.

export interface DecidedRow {
  kept: boolean
  brandName: string | null
  productName: string | null
  itemType: string | null
  colourFamily: string | null
  materialCategory: string | null
  price: string | null
  /** Price converted to pounds — preferred over raw price for the price band. */
  priceGbp?: number | null
  /** Why it was skipped: 'colour' | 'type' | 'price' | 'too_young' | 'not_style'. */
  skipReason?: string | null
}

export interface LearnedVerdict {
  /** Log-odds above (+) or below (−) her base keep rate. 0 = a typical piece. */
  delta: number
  reasons: string // human-readable top contributors
  predictedSkip: boolean
  /**
   * Decisions on this exact KIND of piece — its type in its material. A leather
   * blazer is not "blazer, and leather": she keeps blazers and she keeps
   * leather, and had never once kept a leather blazer. Read by the confidence
   * model, which must not be sure about a combination it has never seen.
   */
  kindKeeps: number
  kindSkips: number
}

const STOP = new Set(['the', 'and', 'with', 'for', 'from', 'one'])

/** Which facts about a piece are really the same fact. */
type Group = 'type' | 'colour' | 'material' | 'price' | 'token'

/**
 * What each group is worth. The name tokens carry most of the style signal a
 * feed ever states ("relaxed", "cropped", "chunky", "mesh"), so they sit close
 * to the type group; price is the weakest and is there to stop an £800 piece
 * from a brand she buys at £200 reading as typical.
 */
const GROUP_WEIGHT: Record<Group, number> = {
  type: 1.6,
  colour: 1.0,
  material: 0.8,
  price: 0.6,
  token: 1.4,
}

/**
 * How much evidence a feature needs before it speaks over the base rate. At 8,
 * a feature seen 8 times is halfway to its own measured rate; seen twice, it
 * barely moves. This is what stops one lucky keep from inventing a rule.
 */
const SHRINKAGE = 8

/** Log-odds above the base rate that reads as "she would skip this". */
export const PREDICTED_SKIP_DELTA = -0.8
/** Decisions needed before the learning is allowed to predict a skip at all. */
const PREDICT_AFTER = 15

const logit = (p: number) => Math.log(p / (1 - p))

function featuresOf(r: {
  productName: string | null; itemType: string | null; colourFamily: string | null
  materialCategory: string | null; price: string | null; priceGbp?: number | null
}): Array<[Group, string]> {
  const f: Array<[Group, string]> = []
  if (r.itemType) f.push(['type', 'type:' + r.itemType])
  if (r.colourFamily) f.push(['colour', 'col:' + r.colourFamily])
  if (r.materialCategory) f.push(['material', 'mat:' + r.materialCategory])
  // The combination, not only its parts: a blazer in leather is its own thing.
  if (r.itemType && r.materialCategory) f.push(['type', 'kind:' + r.itemType + '|' + r.materialCategory])
  if (r.itemType && r.colourFamily) f.push(['type', 'tc:' + r.itemType + '|' + r.colourFamily])
  // Pounds, not the store's own currency: a DKK 2,200 piece is ~£250, not £500+.
  const p = r.priceGbp != null ? Number(r.priceGbp) : parseFloat(String(r.price ?? ''))
  if (!isNaN(p)) f.push(['price', 'price:' + (p < 150 ? 'under150' : p < 300 ? '150-300' : p < 500 ? '300-500' : '500plus')])
  const seen = new Set<string>()
  for (const tok of String(r.productName ?? '').toLowerCase().split(/[^a-z0-9]+/)) {
    if (!tok || tok.length < 2 || STOP.has(tok) || seen.has(tok)) continue
    seen.add(tok)
    f.push(['token', 't:' + tok])
  }
  return f
}

interface Tally { k: number; s: number }

/** A skip reason names the feature it was about; that feature counts twice. */
const REASON_PREFIX: Record<string, string> = { colour: 'col:', type: 'type:', price: 'price:' }

export function buildLearning(decided: DecidedRow[]): (row: {
  brandName: string | null; productName: string | null; itemType: string | null
  colourFamily: string | null; materialCategory: string | null; price: string | null
  priceGbp?: number | null
}) => LearnedVerdict {
  const global = new Map<string, Tally>()
  const perBrand = new Map<string, Map<string, Tally>>()
  const bump = (map: Map<string, Tally>, f: string, kept: boolean) => {
    const t = map.get(f) ?? { k: 0, s: 0 }
    if (kept) t.k++; else t.s++
    map.set(f, t)
  }
  for (const d of decided) {
    const brandMap = perBrand.get(d.brandName ?? '') ?? new Map<string, Tally>()
    perBrand.set(d.brandName ?? '', brandMap)
    const stressed = !d.kept && d.skipReason ? REASON_PREFIX[d.skipReason] : undefined
    for (const [, f] of featuresOf(d)) {
      bump(global, f, d.kept)
      bump(brandMap, f, d.kept)
      if (stressed && f.startsWith(stressed)) bump(global, f, d.kept)
    }
  }
  const total = decided.length
  // Everything is measured against this. With no decisions at all there is no
  // prior to measure against, so nothing can be learned and delta stays 0.
  const keeps = decided.filter((d) => d.kept).length
  const prior = total ? Math.min(0.98, Math.max(0.02, keeps / total)) : 0.5
  const priorLogit = logit(prior)

  // How much she has decided about this kind of piece. Material is the sharper
  // read, but 26% of queued rows never state one, and treating every one of
  // those as "a kind never seen" put 3,792 of 10,437 queued pieces onto the
  // same capped number with no way to rank them. Colour, then bare type, are
  // the honest fallbacks — thinner evidence, but real evidence.
  const kindTally = (row: { itemType: string | null; materialCategory: string | null; colourFamily: string | null }) => {
    if (!row.itemType) return { k: 0, s: 0 }
    const key = row.materialCategory
      ? 'kind:' + row.itemType + '|' + row.materialCategory
      : row.colourFamily
        ? 'tc:' + row.itemType + '|' + row.colourFamily
        : 'type:' + row.itemType
    // The brand's own decisions were counted into both maps; take the global.
    return global.get(key) ?? { k: 0, s: 0 }
  }

  return (row) => {
    const kind = kindTally(row)
    if (total === 0) return { delta: 0, reasons: '', predictedSkip: false, kindKeeps: 0, kindSkips: 0 }
    const brandMap = perBrand.get(row.brandName ?? '')
    const groups = new Map<Group, number[]>()
    const contribs: Array<[string, number]> = []

    for (const [group, f] of featuresOf(row)) {
      const b = brandMap?.get(f) ?? { k: 0, s: 0 }
      const g = global.get(f) ?? { k: 0, s: 0 }
      // this brand's decisions count double
      const k = g.k + b.k
      const s = g.s + b.s
      if (k + s === 0) continue
      // Shrunk towards the base rate, then measured against it: a feature that
      // behaves like her average contributes exactly 0.
      const rate = (k + SHRINKAGE * prior) / (k + s + SHRINKAGE)
      const w = logit(rate) - priorLogit
      if (w === 0) continue
      groups.set(group, [...(groups.get(group) ?? []), w])
      contribs.push([f, w])
    }

    // Averaged within the group so one idea said four ways is still one idea.
    let sum = 0
    groups.forEach((ws, group) => {
      sum += GROUP_WEIGHT[group] * (ws.reduce((a, b) => a + b, 0) / ws.length)
    })
    const delta = Math.round(sum * 100) / 100

    contribs.sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
    const reasons = contribs
      .slice(0, 3)
      .map(([f, w]) => `${f.replace(/^t:/, '')} ${w > 0 ? '+' : ''}${w.toFixed(1)}`)
      .join(', ')
    return {
      delta,
      reasons,
      predictedSkip: total >= PREDICT_AFTER && delta <= PREDICTED_SKIP_DELTA,
      kindKeeps: kind.k,
      kindSkips: kind.s,
    }
  }
}
