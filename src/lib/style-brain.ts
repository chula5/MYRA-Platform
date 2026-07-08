// Style Brain — learns Chloe's outfit taste from her YES / SKIP decisions in the
// Composer and Outfit Review, and feeds it back into composer candidate ranking.
//
// Pure, framework-agnostic logic (no DB). The DB read/write lives in
// style-brain-store.ts; the composer calls learnedBonus() to re-rank.
//
// What it learns:
//   • SINGLES  — how often a brand / colour / type appears in approved outfits.
//   • PAIRS    — which attribute pairings (brand×brand, colour×colour, type×type,
//                pattern×pattern, plus high/low formality & price-tier mixing) you
//                approve vs skip. This is the essence of "what goes with what".
// Each key stores [approves, skips]; affinity is the smoothed, confidence-weighted
// balance of the two. With no data the bonus is ~0, so the composer is unchanged
// (safe cold-start) and gets more "you" as decisions accumulate.

// ── Item feature shape (decoupled from DB row types) ──────────────────────────
export interface FeatureItem {
  item_type?: string | null
  colour_family?: string | null
  pattern?: string | null
  material_formality?: number | null   // 1..5
  brand_name?: string | null
  price_tier?: number | null           // 1..5
}

export interface StyleModel {
  version: number
  decisions: number
  approves: number
  skips: number
  singles: Record<string, [number, number]>  // key -> [approve, skip]
  pairs: Record<string, [number, number]>
  updatedAt?: string
}

export function emptyModel(): StyleModel {
  return { version: 1, decisions: 0, approves: 0, skips: 0, singles: {}, pairs: {} }
}

const norm = (s: unknown) =>
  String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ') || '∅'

// Bucket a numeric gap (0..4) into none / small / large so we learn whether Chloe
// mixes formality or price tiers, without overfitting exact values.
function gapBucket(a?: number | null, b?: number | null): string | null {
  if (a == null || b == null) return null
  const d = Math.abs(a - b)
  return d <= 0 ? 'same' : d <= 1 ? 'near' : 'mixed'
}

// Extract the learnable singles + pairs from one outfit (a set of items).
export function extractFeatures(items: FeatureItem[]): { singles: string[]; pairs: string[] } {
  const singles: string[] = []
  for (const it of items) {
    if (it.brand_name) singles.push(`brand:${norm(it.brand_name)}`)
    if (it.colour_family) singles.push(`colour:${norm(it.colour_family)}`)
    if (it.item_type) singles.push(`type:${norm(it.item_type)}`)
    if (it.pattern) singles.push(`pattern:${norm(it.pattern)}`)
  }

  const pairs: string[] = []
  const pairKey = (kind: string, a: string, b: string) => {
    const [x, y] = [a, b].sort()
    return `${kind}:${x}|${y}`
  }
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const A = items[i], B = items[j]
      if (A.colour_family && B.colour_family) pairs.push(pairKey('colour', norm(A.colour_family), norm(B.colour_family)))
      if (A.brand_name && B.brand_name && norm(A.brand_name) !== norm(B.brand_name)) pairs.push(pairKey('brand', norm(A.brand_name), norm(B.brand_name)))
      if (A.item_type && B.item_type) pairs.push(pairKey('type', norm(A.item_type), norm(B.item_type)))
      if (A.pattern && B.pattern) pairs.push(pairKey('pattern', norm(A.pattern), norm(B.pattern)))
      const fg = gapBucket(A.material_formality, B.material_formality)
      if (fg) pairs.push(`formalgap:${fg}`)
      const tg = gapBucket(A.price_tier, B.price_tier)
      if (tg) pairs.push(`tiergap:${tg}`)
    }
  }
  return { singles: [...new Set(singles)], pairs: [...new Set(pairs)] }
}

// Fold one decision into the model. weight defaults to 1 (a hard label); a "soft
// negative" (shown-but-not-chosen) can pass e.g. 0.3.
export function applyDecision(
  model: StyleModel,
  items: FeatureItem[],
  decision: 'approve' | 'skip',
  weight = 1,
): StyleModel {
  const { singles, pairs } = extractFeatures(items)
  const slot = decision === 'approve' ? 0 : 1
  const bump = (table: Record<string, [number, number]>, key: string) => {
    const cur = table[key] ?? [0, 0]
    cur[slot] += weight
    table[key] = cur
  }
  singles.forEach((k) => bump(model.singles, k))
  pairs.forEach((k) => bump(model.pairs, k))
  model.decisions += weight
  if (decision === 'approve') model.approves += weight
  else model.skips += weight
  return model
}

// Smoothed affinity in (-1, 1): positive = approved more than skipped.
const K_SMOOTH = 2
const C_CONF = 3
function affinity([a, s]: [number, number]): number {
  return (a - s) / (a + s + K_SMOOTH)
}
function confidence([a, s]: [number, number]): number {
  return (a + s) / (a + s + C_CONF)
}

// Learned ranking bonus for a candidate outfit, in roughly (-1, 1). Pairs carry
// more weight than singles (compatibility is mostly about combinations).
export function learnedBonus(model: StyleModel, items: FeatureItem[]): number {
  const { singles, pairs } = extractFeatures(items)
  let sum = 0
  let wsum = 0
  const acc = (table: Record<string, [number, number]>, key: string, w: number) => {
    const cell = table[key]
    if (!cell) return
    const conf = confidence(cell)
    sum += affinity(cell) * conf * w
    wsum += conf * w
  }
  pairs.forEach((k) => acc(model.pairs, k, 1.0))
  singles.forEach((k) => acc(model.singles, k, 0.5))
  return wsum > 0 ? sum / wsum : 0
}

// How strongly to let learning influence ranking — ramps from 0 to LAMBDA_MAX as
// decisions accumulate, so early on the hand-tuned composer score dominates.
const LAMBDA_MAX = 0.3
const RAMP_DECISIONS = 40
export function blendStrength(model: StyleModel): number {
  return LAMBDA_MAX * Math.min(1, model.decisions / RAMP_DECISIONS)
}

// Final re-rank score for a candidate given its base composer score.
export function blendedScore(model: StyleModel, baseScore: number, items: FeatureItem[]): number {
  return baseScore + blendStrength(model) * learnedBonus(model, items)
}

// ── House Style doc ───────────────────────────────────────────────────────────
// Human-readable distillation of the model: most-loved brands, the brand/colour
// pairings you reach for, and what you avoid. Useful both as an admin view and as
// a sourcing reference when scouting new brands.

function prettyPairValue(key: string): string {
  // "brand:toteme|wandler" -> "Totême + Wandler"
  const body = key.slice(key.indexOf(':') + 1)
  return body.split('|').map((p) => p.replace(/\b\w/g, (c) => c.toUpperCase())).join(' + ')
}
function prettySingleValue(key: string): string {
  return key.slice(key.indexOf(':') + 1).replace(/\b\w/g, (c) => c.toUpperCase())
}

function topByAffinity(table: Record<string, [number, number]>, prefix: string, minObs: number, sign: 1 | -1, limit: number) {
  return Object.entries(table)
    .filter(([k, v]) => k.startsWith(prefix) && v[0] + v[1] >= minObs)
    .map(([k, v]) => ({ k, aff: affinity(v), obs: v[0] + v[1], a: v[0], s: v[1] }))
    .filter((r) => (sign === 1 ? r.aff > 0.15 : r.aff < -0.15))
    .sort((x, y) => sign * (y.aff - x.aff) || y.obs - x.obs)
    .slice(0, limit)
}

export function buildHouseStyle(model: StyleModel): string {
  if (model.decisions < 1) {
    return '# MYRA House Style\n\n_No decisions yet. Approve outfits in the Composer or Outfit Review and this fills in._\n'
  }
  const L: string[] = []
  L.push('# MYRA House Style (learned)')
  L.push('')
  L.push(`_Learned from ${Math.round(model.approves)} approvals and ${Math.round(model.skips)} skips._`)
  L.push('')

  // Most-approved brands
  const brands = Object.entries(model.singles)
    .filter(([k]) => k.startsWith('brand:'))
    .map(([k, v]) => ({ name: prettySingleValue(k), a: v[0], s: v[1] }))
    .sort((x, y) => y.a - x.a)
    .slice(0, 12)
  if (brands.length) {
    L.push('## Brands you reach for')
    brands.forEach((b) => L.push(`- **${b.name}** — ${Math.round(b.a)} approvals`))
    L.push('')
  }

  // Most-approved colours + piece types (what shows up in looks you keep).
  const topSingles = (prefix: string) => Object.entries(model.singles)
    .filter(([k]) => k.startsWith(prefix))
    .map(([k, v]) => ({ name: prettySingleValue(k), a: v[0] }))
    .sort((x, y) => y.a - x.a)
    .slice(0, 10)
  const colours = topSingles('colour:')
  if (colours.length) {
    L.push('## Colours in your outfits')
    colours.forEach((c) => L.push(`- **${c.name}** — ${Math.round(c.a)} approvals`))
    L.push('')
  }
  const types = topSingles('type:')
  if (types.length) {
    L.push('## Pieces you build around')
    types.forEach((t) => L.push(`- **${t.name.replace(/_/g, ' ')}** — ${Math.round(t.a)} approvals`))
    L.push('')
  }

  const brandPairs = topByAffinity(model.pairs, 'brand:', 2, 1, 10)
  if (brandPairs.length) {
    L.push('## Brand pairings that work')
    brandPairs.forEach((p) => L.push(`- ${prettyPairValue(p.k)}`))
    L.push('')
  }

  const colourPairs = topByAffinity(model.pairs, 'colour:', 2, 1, 10)
  if (colourPairs.length) {
    L.push('## Colour combinations you favour')
    colourPairs.forEach((p) => L.push(`- ${prettyPairValue(p.k)}`))
    L.push('')
  }

  // Formality / price-tier mixing tendencies
  const tendency = (key: string, label: string) => {
    const same = model.pairs[`${key}:same`] ?? [0, 0]
    const mixed = model.pairs[`${key}:mixed`] ?? [0, 0]
    const sameAff = affinity(same), mixedAff = affinity(mixed)
    if (same[0] + same[1] + mixed[0] + mixed[1] < 3) return null
    if (mixedAff > sameAff + 0.1) return `- You happily **mix ${label}** (high-low).`
    if (sameAff > mixedAff + 0.1) return `- You keep **${label} consistent** within an outfit.`
    return null
  }
  const tendencies = [tendency('tiergap', 'price tiers'), tendency('formalgap', 'formality')].filter(Boolean) as string[]
  if (tendencies.length) {
    L.push('## How you mix')
    tendencies.forEach((t) => L.push(t))
    L.push('')
  }

  const avoid = [...topByAffinity(model.pairs, 'colour:', 2, -1, 5), ...topByAffinity(model.pairs, 'type:', 2, -1, 5)]
  if (avoid.length) {
    L.push('## Combinations you tend to skip')
    avoid.forEach((p) => L.push(`- ${prettyPairValue(p.k)}`))
    L.push('')
  }
  return L.join('\n')
}

// A compact one-paragraph brief for injecting into AI prompts (occasion tagging,
// discovery, etc.). Empty string until there's enough signal.
export function houseStyleBrief(model: StyleModel): string {
  if (model.decisions < 8) return ''
  const brands = Object.entries(model.singles)
    .filter(([k]) => k.startsWith('brand:'))
    .sort((x, y) => y[1][0] - x[1][0])
    .slice(0, 6)
    .map(([k]) => prettySingleValue(k))
  const colourPairs = topByAffinity(model.pairs, 'colour:', 2, 1, 4).map((p) => prettyPairValue(p.k))
  const bits: string[] = []
  if (brands.length) bits.push(`favours brands like ${brands.join(', ')}`)
  if (colourPairs.length) bits.push(`leans into colour pairings such as ${colourPairs.join('; ')}`)
  return bits.length ? `MYRA house style: ${bits.join('; ')}.` : ''
}
