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
}

export interface LearnedVerdict {
  delta: number // added to the style score for ranking; negative = likely skip
  reasons: string // human-readable top contributors
  predictedSkip: boolean
}

const STOP = new Set(['the', 'and', 'with', 'for', 'from', 'one'])

function featuresOf(r: {
  productName: string | null; itemType: string | null; colourFamily: string | null
  materialCategory: string | null; price: string | null
}): string[] {
  const f: string[] = []
  if (r.itemType) f.push('type:' + r.itemType)
  if (r.colourFamily) f.push('col:' + r.colourFamily)
  if (r.materialCategory) f.push('mat:' + r.materialCategory)
  const p = parseFloat(String(r.price ?? ''))
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

export function buildLearning(decided: DecidedRow[]): (row: {
  brandName: string | null; productName: string | null; itemType: string | null
  colourFamily: string | null; materialCategory: string | null; price: string | null
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
    for (const f of featuresOf(d)) {
      bump(global, f, d.kept)
      bump(brandMap, f, d.kept)
    }
  }
  const total = decided.length

  return (row) => {
    if (total === 0) return { delta: 0, reasons: '', predictedSkip: false }
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
    return { delta, reasons, predictedSkip: total >= 15 && delta <= -2 }
  }
}
