// ── Private-stylist intake: sizes and budgets in her own words ──────────────
//
// The onboarding form is filled in person, so it takes what she says: "10-12",
// "36/37", "W27", "£100–300". This is where those words become something the
// size gate and the price bands can act on. Plain module — the form and the
// server read the answers through the same parsers.

import { canonicalise, type CategorySizes, type SizeCategory } from '@/lib/size-canonical'
import type { PriceBand } from '@/lib/pilot-stylist'

// ── Sizes ────────────────────────────────────────────────────────────────────

const RANGE_SPLIT = /\s*(?:-|–|—|\/|,|&|\bor\b|\bto\b)\s*/i
const SYSTEM_PREFIX = /^(UK|US|EU|IT|FR|DE|AU)\s*/i

/**
 * One intake answer → her size plus the neighbour she also wears.
 * "10-12" → 10 (or 12) · "36-37" shoe → UK 3 (or 4) · "M" → 10 (or 12).
 *
 * A bare clothing number is UK: the intake is in her words, and a British
 * client saying "10" never means the US 10 a retailer's bare label would.
 */
export function parseIntakeSize(raw: string | null | undefined, category: SizeCategory): CategorySizes | null {
  const s = String(raw ?? '').trim()
  if (!s) return null
  const one = (part: string) => {
    const bareUk = category !== 'shoes' && /^\d+(\.\d+)?$/.test(part) && Number(part) <= 22
    return canonicalise(bareUk ? `UK ${part}` : part, category).values
  }
  // A range first ("UK 10-12" read whole would stop at the 10), carrying a
  // leading system onto the second number.
  const prefix = s.match(SYSTEM_PREFIX)?.[0] ?? ''
  const parts = s.slice(prefix.length).split(RANGE_SPLIT).filter(Boolean)
  let values: number[] = []
  if (parts.length >= 2) {
    const each = parts.map((p) => one(/^\d/.test(p) ? `${prefix}${p}` : p))
    if (each.every((v) => v.length)) values = each.flat()
  }
  if (!values.length) values = one(s)
  if (!values.length) return null
  const adjacent = values.find((v) => v !== values[0]) ?? null
  return { value: values[0], adjacent }
}

/** Jeans waist, "27" / "W27" / "27-28" → 27 (or 28). Matched only against waist-sized bottoms. */
export function parseWaist(raw: string | null | undefined): CategorySizes | null {
  // "W27 L30": the L is leg length, not a second waist.
  const nums = (String(raw ?? '').replace(/L\s?\d{2}/gi, '').match(/\d{2}/g) ?? []).map(Number).filter((n) => n >= 22 && n <= 40)
  if (!nums.length) return null
  return { value: nums[0], adjacent: nums.find((n) => n !== nums[0]) ?? null }
}

/** The sizes the intake asks for, in form order. `waist` is the jeans waist. */
export const INTAKE_SIZE_FIELDS = [
  { key: 'top', label: 'TOP', hint: '10-12' },
  { key: 'dress', label: 'DRESS', hint: '10' },
  { key: 'bottom', label: 'TROUSERS / SKIRT', hint: '10-12' },
  { key: 'waist', label: 'JEANS WAIST', hint: '27-28' },
  { key: 'shoe', label: 'SHOE', hint: '37 OR UK 4' },
] as const

// ── Budgets ──────────────────────────────────────────────────────────────────

/** "200" → up to £200 · "100-300" → £100 to £300 · "100+" / "from 100" → £100 and up. */
export function parseBudgetText(raw: string | null | undefined): PriceBand | null {
  const s = String(raw ?? '').replace(/,/g, '').trim()
  const nums = (s.match(/\d+(?:\.\d+)?/g) ?? []).map(Number).filter((n) => n > 0)
  if (!nums.length) return null
  if (nums.length >= 2) return { min: Math.min(nums[0], nums[1]), max: Math.max(nums[0], nums[1]) }
  if (/\+\s*$|^\s*(from|over|above|min)/i.test(s)) return { min: nums[0], max: null }
  return { min: null, max: nums[0] }
}
