// Self-critiquing composer pipeline — pure logic (no DB, no framework).
//
// The composer's quality gate BEFORE outfits reach the review queue:
//   • deriveOccasionScores — real formality/time_of_day from item data, so no
//     outfit enters the pipeline with defaulted (=3) occasion values.
//   • computeSwapDeltas — the scored-dimension diff of a swap (outgoing vs
//     incoming item), stored as the swap's reason.
//   • ejection constraints — items swapped out 2+ times in a context are
//     excluded from that context's candidate pools; 3+ total are quarantined.
//   • confidenceGate — cosine similarity to approved-outfit history (nearest 5
//     neighbours) with penalties, routing candidates to a fast or standard lane.
//
// DB read/write lives in pipeline-store.ts.

import { cosine } from '@/lib/taste-vector'
import { extractFeatures, type StyleModel, type FeatureItem } from '@/lib/style-brain'

// ── Item scoring completeness ─────────────────────────────────────────────────

// Core visual dimensions every item should carry. `length`/`rise` etc. are
// type-specific so they're not checked here.
const CORE_DIMS = [
  'structure', 'surface', 'colour_depth', 'pattern', 'sheen',
  'material_weight', 'material_formality',
] as const

// True when the item still needs a vision pass: a core dimension is unscored
// (null), colour_family is missing, or the scores are an untouched default
// block (4+ core dims sitting exactly on 3 — the form default).
export function itemNeedsScoring(item: Record<string, unknown>): boolean {
  if (!item.colour_family) return true
  let threes = 0
  for (const d of CORE_DIMS) {
    const v = item[d]
    if (v == null) return true
    if (v === 3) threes++
  }
  return threes >= 4
}

// ── Formality band / occasion derivation ─────────────────────────────────────

export type FormalityBand = 'casual' | 'mid' | 'dressy'

type AnyItem = Record<string, any>

function avgOf(items: AnyItem[], field: string): number | null {
  const xs = items.map((i) => i?.[field]).filter((v): v is number => typeof v === 'number' && !Number.isNaN(v))
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null
}

const clamp5 = (n: number) => Math.max(1, Math.min(5, Math.round(n)))

export function formalityBand(items: AnyItem[]): FormalityBand {
  const f = avgOf(items, 'material_formality') ?? 3
  return f < 2.34 ? 'casual' : f < 3.67 ? 'mid' : 'dressy'
}

// Deterministic occasion scores from item attributes — replaces the flat 3s the
// composer used to write. Vision rescoring can refine these later; they must
// never be the untouched default.
export function deriveOccasionScores(entries: { item: AnyItem; slot: string }[]): {
  formality: number
  planning: number
  wearer_priority: number
  time_of_day: number
} {
  const items = entries.map((e) => e.item)
  const matFormal = avgOf(items, 'material_formality') ?? 3

  // Shoes and bags carry disproportionate occasion signal — weight them in.
  const shoe = entries.find((e) => e.slot === 'shoe')?.item
  const bag = entries.find((e) => e.slot === 'bag')?.item
  const anchorFormal =
    (matFormal * items.length + (shoe?.material_formality ?? matFormal) + (bag?.material_formality ?? matFormal)) /
    (items.length + 2)
  const formality = clamp5(anchorFormal)

  // Evening cues: sheen, black share, occasion-grade materials.
  const sheen = avgOf(items, 'sheen') ?? 1
  const blackFrac = items.filter((i) => i.colour_family === 'black').length / (items.length || 1)
  let tod = 2
  if (sheen >= 2.5) tod++
  if (blackFrac >= 0.5) tod++
  if (matFormal >= 4) tod++
  const time_of_day = clamp5(tod)

  // Impact vs comfort: heels + tight fits read impact-led; relaxed fits comfort.
  const fit = avgOf(items, 'fit') ?? 3
  const heel = String(shoe?.item_type ?? '') === 'heel'
  const wearer_priority = clamp5(3 + (heel ? 1 : 0) + (fit <= 2 ? 1 : 0) - (fit >= 4 ? 1 : 0))

  // Planning tracks formality — black tie is never spontaneous.
  const planning = clamp5(formality >= 4 ? 4 : formality >= 3 ? 3 : 2)

  return { formality, planning, wearer_priority, time_of_day }
}

// ── Swap deltas ───────────────────────────────────────────────────────────────

// Dimensions we diff when an item is swapped out for another. The delta is the
// swap's stored "reason" (e.g. colour_family: off-white → black).
const DELTA_DIMS = [
  'colour_family', 'material_category', 'material_primary', 'item_type',
  'pattern', 'sheen', 'structure', 'fit', 'surface',
  'material_formality', 'material_weight', 'colour_depth',
] as const

export type SwapDeltas = Record<string, { from: string | number; to: string | number }>

export function computeSwapDeltas(from: AnyItem, to: AnyItem): SwapDeltas {
  const deltas: SwapDeltas = {}
  for (const d of DELTA_DIMS) {
    const a = from?.[d]
    const b = to?.[d]
    if (a == null || b == null) continue
    if (String(a) !== String(b)) deltas[d] = { from: a, to: b }
  }
  return deltas
}

// ── Ejection constraints ──────────────────────────────────────────────────────

export interface EjectionRow {
  item_id: string
  slot: string | null
  formality_band: string | null
  occasion?: string | null
}

export const contextKey = (slot: string | null | undefined, band: string | null | undefined) =>
  `${slot ?? 'any'}|${band ?? 'any'}`

export interface EjectionConstraints {
  // item_id → context keys with 2+ ejections (excluded for those contexts)
  excludedContexts: Map<string, Set<string>>
  // item_ids ejected 3+ times overall (excluded everywhere, surfaced weekly)
  quarantined: Set<string>
  // item_id → total ejection count (for the -0.1 single-ejection penalty)
  counts: Map<string, number>
  // item_id → per-context counts
  contextCounts: Map<string, Map<string, number>>
}

export const EXCLUDE_AFTER = 2   // ejections in one context → out of that context
export const QUARANTINE_AFTER = 3 // ejections overall → out of every pool

export function buildEjectionConstraints(rows: EjectionRow[]): EjectionConstraints {
  const contextCounts = new Map<string, Map<string, number>>()
  const counts = new Map<string, number>()
  for (const r of rows) {
    counts.set(r.item_id, (counts.get(r.item_id) ?? 0) + 1)
    const ctx = contextKey(r.slot, r.formality_band)
    const m = contextCounts.get(r.item_id) ?? new Map<string, number>()
    m.set(ctx, (m.get(ctx) ?? 0) + 1)
    contextCounts.set(r.item_id, m)
  }
  const excludedContexts = new Map<string, Set<string>>()
  for (const [id, m] of contextCounts) {
    const set = new Set<string>()
    for (const [ctx, c] of m) if (c >= EXCLUDE_AFTER) set.add(ctx)
    if (set.size) excludedContexts.set(id, set)
  }
  const quarantined = new Set<string>()
  for (const [id, c] of counts) if (c >= QUARANTINE_AFTER) quarantined.add(id)
  return { excludedContexts, quarantined, counts, contextCounts }
}

// Should this item be kept out of the pool for the given context?
export function isExcluded(
  constraints: EjectionConstraints,
  itemId: string,
  slot: string,
  band: FormalityBand,
): boolean {
  if (constraints.quarantined.has(itemId)) return true
  const ctxs = constraints.excludedContexts.get(itemId)
  if (!ctxs) return false
  return ctxs.has(contextKey(slot, band)) || ctxs.has(contextKey(slot, 'any')) || ctxs.has(contextKey('any', band))
}

// ── Hard skip-combinations ────────────────────────────────────────────────────

// The "combinations you tend to skip" list, as machine constraints: pair
// features with clearly negative affinity. The composer must never propose a
// candidate containing one.
const K_SMOOTH = 2
const pairAffinity = ([a, s]: [number, number]) => (a - s) / (a + s + K_SMOOTH)

export function hardSkipPairs(model: StyleModel): Set<string> {
  const out = new Set<string>()
  for (const [k, v] of Object.entries(model.pairs)) {
    if (!/^(colour|type|brand):/.test(k)) continue
    if (v[0] + v[1] >= 2 && pairAffinity(v) < -0.15) out.add(k)
  }
  return out
}

// Which skip-pairs (if any) a candidate contains. Empty array = allowed.
export function violatedSkipPairs(items: FeatureItem[], skipPairs: Set<string>): string[] {
  if (!skipPairs.size) return []
  return extractFeatures(items).pairs.filter((p) => skipPairs.has(p))
}

// ── Favoured / approved feature sets (for penalties) ─────────────────────────

export function favouredColourPairs(model: StyleModel): Set<string> {
  const out = new Set<string>()
  for (const [k, v] of Object.entries(model.pairs)) {
    if (!k.startsWith('colour:')) continue
    if (v[0] > 0 && pairAffinity(v) > -0.05) out.add(k)
  }
  return out
}

export function approvedBrandPairs(model: StyleModel): Set<string> {
  const out = new Set<string>()
  for (const [k, v] of Object.entries(model.pairs)) {
    if (k.startsWith('brand:') && v[0] > 0) out.add(k)
  }
  return out
}

// ── Confidence gate ───────────────────────────────────────────────────────────

const PENALTY_EJECTION = 0.1
const PENALTY_COLOUR = 0.05
const PENALTY_BRAND = 0.05
const KNN = 5
// Below this many decisions the colour/brand penalty lists are too thin to
// trust — skip those penalties (cold start).
const MIN_DECISIONS_FOR_PAIR_PENALTIES = 10

export interface GateInput {
  vector: number[]
  approvedVectors: number[][]
  items: FeatureItem[]                 // anchor + additions, for pair features
  itemIds: string[]                    // same order as items
  itemLabels: string[]                 // display labels, same order
  slotByItemId: Record<string, string>
  band: FormalityBand
  constraints: EjectionConstraints
  model: StyleModel
}

export interface GateResult {
  similarity: number   // avg cosine to nearest 5 approved outfits
  confidence: number   // similarity minus penalties
  reasons: string[]    // human-readable penalty reasons (shown in standard lane)
}

const pretty = (k: string) =>
  k.slice(k.indexOf(':') + 1).split('|').join(' + ').replace(/_/g, ' ')

export function confidenceGate(input: GateInput): GateResult {
  const { vector, approvedVectors, items, itemIds, itemLabels, slotByItemId, band, constraints, model } = input

  // Nearest-5 approved neighbours, averaged. No history → neutral 0.5 so the
  // pipeline still routes (everything lands in the standard lane at first).
  let similarity = 0.5
  if (approvedVectors.length) {
    const sims = approvedVectors.map((v) => cosine(vector, v)).sort((a, b) => b - a)
    const top = sims.slice(0, KNN)
    similarity = top.reduce((s, x) => s + x, 0) / top.length
  }

  const reasons: string[] = []
  let penalty = 0

  // Items with prior ejections in this context (−0.1 each).
  itemIds.forEach((id, i) => {
    const slot = slotByItemId[id] ?? 'any'
    const ctxCount = constraints.contextCounts.get(id)?.get(contextKey(slot, band)) ?? 0
    const total = constraints.counts.get(id) ?? 0
    if (ctxCount >= 1 || total >= 1) {
      penalty += PENALTY_EJECTION
      const n = Math.max(ctxCount, 1)
      reasons.push(
        ctxCount >= 1
          ? `contains ${itemLabels[i]} — ejected ${n}× in ${band} context`
          : `contains ${itemLabels[i]} — ejected ${total}× before`,
      )
    }
  })

  if (model.decisions >= MIN_DECISIONS_FOR_PAIR_PENALTIES) {
    // Colour combinations outside the favoured list (−0.05 each, capped).
    const favoured = favouredColourPairs(model)
    const colourPairs = extractFeatures(items).pairs.filter((p) => p.startsWith('colour:'))
    let colourHits = 0
    for (const p of colourPairs) {
      if (!favoured.has(p) && colourHits < 3) {
        colourHits++
        penalty += PENALTY_COLOUR
        reasons.push(`colour pairing ${pretty(p)} not in your favoured list`)
      }
    }

    // Brand pairings never approved before (−0.05 each, capped).
    const approved = approvedBrandPairs(model)
    const brandPairs = extractFeatures(items).pairs.filter((p) => p.startsWith('brand:'))
    let brandHits = 0
    for (const p of brandPairs) {
      if (!approved.has(p) && brandHits < 3) {
        brandHits++
        penalty += PENALTY_BRAND
        reasons.push(`brand pairing ${pretty(p)} never approved before`)
      }
    }
  }

  return { similarity, confidence: similarity - penalty, reasons }
}

// ── Adaptive fast-lane threshold ─────────────────────────────────────────────
// Starts conservative (0.82). A fast-lane override (you had to swap something
// that was supposed to be a one-tap approve) means the gate let a bad outfit
// through — TIGHTEN it. A sustained streak of clean one-tap approvals means the
// gate has headroom — relax it slightly.

export const THRESHOLD_START = 0.82
export const THRESHOLD_MAX = 0.95
export const THRESHOLD_MIN = 0.75
export const TIGHTEN_STEP = 0.02
export const RELAX_STEP = 0.01
export const RELAX_AFTER_CLEAN = 10

export function nextThreshold(
  current: number,
  event: 'override' | 'clean_approve',
  cleanStreak: number,
): { threshold: number; cleanStreak: number; changed: boolean } {
  if (event === 'override') {
    const t = Math.min(THRESHOLD_MAX, +(current + TIGHTEN_STEP).toFixed(3))
    return { threshold: t, cleanStreak: 0, changed: t !== current }
  }
  const streak = cleanStreak + 1
  if (streak >= RELAX_AFTER_CLEAN) {
    const t = Math.max(THRESHOLD_MIN, +(current - RELAX_STEP).toFixed(3))
    return { threshold: t, cleanStreak: 0, changed: t !== current }
  }
  return { threshold: current, cleanStreak: streak, changed: false }
}
