// ── MYRA taste vectors ────────────────────────────────────────────────────
// A deterministic 34-dimension "taste fingerprint" for every outfit, and the
// cosine-similarity machinery that ranks outfits against a user's accumulated
// taste vector.
//
// Why cosine, not distance: cosine measures the ANGLE between two taste
// profiles, not their magnitude. A brand-new user with a handful of onboarding
// likes has a short, low-magnitude vector; a power user has a dense one — but
// both get well-matched recommendations because direction is what's compared.
// New users aren't penalised for thin data.
//
// The vector is built purely from outfit attributes, so it runs anywhere
// (server or client) with no model call and no DB round-trip.

import type { OutfitWithItems } from '@/types/database'

export const VECTOR_DIM = 34

// Signal weights by intent — a shop click-out moves taste hardest, a save next,
// down to a soft explore/style tap, with a negative pull on dislike.
export const EVENT_WEIGHTS: Record<string, number> = {
  shop_click: 7,
  save: 5,
  like: 5,
  similar_tap: 1,
  style_tap: 1,
  source_tap: 1,
  explore_tap: 1,
  skip: -1,
  dislike: -2,
}

const NEUTRALS = new Set(['white', 'cream', 'black', 'grey', 'navy', 'beige', 'camel', 'brown'])

// Map a 1-5 attribute onto [0,1]; null/undefined → 0.5 (neutral, doesn't skew).
function n5(v: number | null | undefined): number {
  if (v == null || Number.isNaN(v)) return 0.5
  const c = Math.max(1, Math.min(5, v))
  return (c - 1) / 4
}

function avg(nums: number[]): number | null {
  const xs = nums.filter((x) => typeof x === 'number' && !Number.isNaN(x))
  if (xs.length === 0) return null
  return xs.reduce((a, b) => a + b, 0) / xs.length
}

type AnyItem = { item: any; slot?: string }

export function buildOutfitVector(o: OutfitWithItems): number[] {
  const oo = o as any
  const links = ((o.outfit_item ?? []) as AnyItem[]).filter((l) => l.item)
  const items = links.map((l) => l.item)
  const brands = items.map((it) => it.brand).filter(Boolean)
  const n = items.length || 1
  const colours = items.map((it) => String(it.colour_family ?? ''))
  const types = items.map((it) => String(it.item_type ?? ''))
  const frac = (pred: (it: any) => boolean) => items.filter(pred).length / n
  const colourFrac = (...c: string[]) => colours.filter((x) => c.includes(x)).length / n
  const hasType = (...t: string[]) => (types.some((x) => t.includes(x)) ? 1 : 0)

  const v: number[] = [
    // ── Outfit-level styling scores (0-8) ──
    n5(oo.formality),
    n5(oo.planning),
    n5(oo.wearer_priority),
    n5(oo.time_of_day),
    n5(oo.construction),
    n5(oo.surface_story),
    n5(oo.volume),
    n5(oo.colour_story),
    n5(oo.intent),
    // ── Brand positioning, averaged across the look (9-13) ──
    n5(avg(brands.map((b: any) => b.price_tier))),
    n5(avg(brands.map((b: any) => b.era_orientation))),
    n5(avg(brands.map((b: any) => b.aesthetic_output))),
    n5(avg(brands.map((b: any) => b.cultural_legibility))),
    n5(avg(brands.map((b: any) => b.creative_behaviour))),
    // ── Colour story (14-21) ──
    colours.filter((c) => NEUTRALS.has(c)).length / n, // neutral ratio
    colourFrac('black'),
    colourFrac('white', 'cream'),
    colourFrac('navy', 'blue'),
    colourFrac('brown', 'camel'),
    colourFrac('green'),
    colourFrac('red', 'burgundy', 'orange', 'pink', 'yellow', 'purple'),
    colourFrac('multicolour'),
    // ── Silhouette / composition (22-29) ──
    hasType('mini_dress', 'midi_dress', 'maxi_dress', 'shirt_dress', 'slip_dress'),
    hasType('trousers', 'jeans', 'shorts'),
    hasType('skirt'),
    hasType('blazer', 'jacket', 'trench', 'coat'),
    hasType('knitwear', 't-shirt', 'jeans', 'sneaker'),
    n5(oo.shoe_style),
    n5(oo.jewellery_scale),
    n5(oo.bag_formality),
    // ── Material + occasion breadth (30-33) ──
    n5(avg(items.map((it: any) => it.material_formality))),
    n5(avg(items.map((it: any) => it.material_weight))),
    Math.min((o.occasion_tags ?? []).length / 5, 1),
    n5(oo.shoe_formality),
  ]

  return v
}

export function dot(a: number[], b: number[]): number {
  let s = 0
  for (let i = 0; i < a.length; i++) s += a[i] * b[i]
  return s
}

export function magnitude(a: number[]): number {
  return Math.sqrt(dot(a, a))
}

// Cosine similarity in [-1,1]. Returns 0 if either vector has no magnitude.
export function cosine(a: number[], b: number[]): number {
  const ma = magnitude(a)
  const mb = magnitude(b)
  if (ma === 0 || mb === 0) return 0
  return dot(a, b) / (ma * mb)
}

// Unit vector (direction only) — each outfit contributes its direction,
// scaled by the event's intent weight, when learning a user's taste.
export function unit(a: number[]): number[] {
  const m = magnitude(a)
  if (m === 0) return a.slice()
  return a.map((x) => x / m)
}

// Fold one interaction into a running taste vector: acc += weight · unit(outfit).
export function accumulate(acc: number[], outfitVec: number[], weight: number): number[] {
  const u = unit(outfitVec)
  const out = acc.length === VECTOR_DIM ? acc.slice() : new Array(VECTOR_DIM).fill(0)
  for (let i = 0; i < VECTOR_DIM; i++) out[i] += weight * u[i]
  return out
}

export function zeroVector(): number[] {
  return new Array(VECTOR_DIM).fill(0)
}

export function isZero(a: number[] | null | undefined): boolean {
  return !a || a.length === 0 || a.every((x) => x === 0)
}

// Rank outfits by cosine similarity to a taste vector (highest first).
export function rankByTaste<T extends OutfitWithItems>(
  userVec: number[],
  outfits: T[],
): { outfit: T; score: number }[] {
  return outfits
    .map((o) => ({ outfit: o, score: cosine(userVec, buildOutfitVector(o)) }))
    .sort((a, b) => b.score - a.score)
}
