// Deterministic keep/skip learning for Brand Watch. No API cost, no model —
// naive-Bayes-style log-odds over features of every decision already made
// (KEEP → ready, SKIP → archived). Fine-grained on purpose: item type alone
// never damns a category; the words of the product name (chunky, mesh, croco,
// heel heights), colour, material and price band separate the trainers that
// were kept from the trainers that were skipped.

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
  delta: number // added to the style score for ranking; negative = likely skip
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

function featuresOf(r: {
  productName: string | null; itemType: string | null; colourFamily: string | null
  materialCategory: string | null; price: string | null; priceGbp?: number | null
}): string[] {
  const f: string[] = []
  if (r.itemType) f.push('type:' + r.itemType)
  if (r.colourFamily) f.push('col:' + r.colourFamily)
  if (r.materialCategory) f.push('mat:' + r.materialCategory)
  // The combination, not only its parts: a blazer in leather is its own thing.
  if (r.itemType && r.materialCategory) f.push('kind:' + r.itemType + '|' + r.materialCategory)
  if (r.itemType && r.colourFamily) f.push('tc:' + r.itemType + '|' + r.colourFamily)
  // Pounds, not the store's own currency: a DKK 2,200 piece is ~£250, not £500+.
  const p = r.priceGbp != null ? Number(r.priceGbp) : parseFloat(String(r.price ?? ''))
  if (!isNaN(p)) f.push('price:' + (p < 150 ? 'under150' : p < 300 ? '150-300' : p < 500 ? '300-500' : '500plus'))
  const seen = new Set<string>()
  for (const tok of String(r.productName ?? '').toLowerCase().split(/[^a-z0-9]+/)) {
    if (!tok || tok.length < 2 || STOP.has(tok) || seen.has(tok)) continue
    seen.add(tok)
    f.push('t:' + tok)
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
    for (const f of featuresOf(d)) {
      bump(global, f, d.kept)
      bump(brandMap, f, d.kept)
      if (stressed && f.startsWith(stressed)) bump(global, f, d.kept)
    }
  }
  const total = decided.length

  const kindTally = (row: { itemType: string | null; materialCategory: string | null; brandName: string | null }) => {
    if (!row.itemType || !row.materialCategory) return { k: 0, s: 0 }
    const f = 'kind:' + row.itemType + '|' + row.materialCategory
    const g = global.get(f) ?? { k: 0, s: 0 }
    const b = perBrand.get(row.brandName ?? '')?.get(f) ?? { k: 0, s: 0 }
    // The brand's own decisions were counted into both maps; take the global.
    return { k: g.k, s: g.s, brandK: b.k, brandS: b.s }
  }

  return (row) => {
    const kind = kindTally(row)
    if (total === 0) return { delta: 0, reasons: '', predictedSkip: false, kindKeeps: 0, kindSkips: 0 }
    const brandMap = perBrand.get(row.brandName ?? '')
    let sum = 0
    const contribs: Array<[string, number]> = []
    for (const f of featuresOf(row)) {
      const b = brandMap?.get(f) ?? { k: 0, s: 0 }
      const g = global.get(f) ?? { k: 0, s: 0 }
      // this brand's decisions count double
      const k = g.k + b.k
      const s = g.s + b.s
      if (k + s < 2) continue // not enough evidence on this feature
      const w = Math.max(-2, Math.min(2, Math.log2((k + 0.5) / (s + 0.5))))
      if (w === 0) continue
      sum += w
      contribs.push([f, w])
    }
    const delta = Math.round(Math.max(-6, Math.min(6, sum)) * 10) / 10
    contribs.sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
    const reasons = contribs
      .slice(0, 3)
      .map(([f, w]) => `${f.replace(/^t:/, '')} ${w > 0 ? '+' : ''}${w.toFixed(1)}`)
      .join(', ')
    return { delta, reasons, predictedSkip: total >= 15 && delta <= -2, kindKeeps: kind.k, kindSkips: kind.s }
  }
}
