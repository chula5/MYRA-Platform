// ── Size conversion + matching ───────────────────────────────────────────────
//
// Item `stock_sizes` are raw retailer strings in a mix of systems: UK ("UK 10"),
// US numeric ("0,2,4,6"), EU ("38"), alpha ("XS,S,M,L"), jeans waist ("29"),
// and "ONE SIZE". A shopper picks ONE size; we convert it across systems and
// test it against whatever format each item uses.
//
// Conversions are the standard industry approximations and are brand-dependent
// (alpha ↔ numeric especially), so matching is deliberately lenient (±1 size)
// and never excludes an item whose sizing we can't parse.

import { slotForItemType, type Slot } from '@/lib/composer'
import type { ItemType, OutfitWithItems } from '@/types/database'

// Women's clothing — index-aligned equivalents. `alpha` lists the letter
// bucket(s) that size can be sold under (kept generous to catch retailer drift).
export interface ClothingRow { uk: number; us: number; eu: number; au: number; alpha: string[] }
export const CLOTHING_SIZES: ClothingRow[] = [
  { uk: 4,  us: 0,  eu: 32, au: 4,  alpha: ['XXS'] },
  { uk: 6,  us: 2,  eu: 34, au: 6,  alpha: ['XS'] },
  { uk: 8,  us: 4,  eu: 36, au: 8,  alpha: ['S'] },
  { uk: 10, us: 6,  eu: 38, au: 10, alpha: ['S', 'M'] },
  { uk: 12, us: 8,  eu: 40, au: 12, alpha: ['M'] },
  { uk: 14, us: 10, eu: 42, au: 14, alpha: ['L'] },
  { uk: 16, us: 12, eu: 44, au: 16, alpha: ['XL'] },
  { uk: 18, us: 14, eu: 46, au: 18, alpha: ['XL', 'XXL'] },
  { uk: 20, us: 16, eu: 48, au: 20, alpha: ['XXL'] },
  { uk: 22, us: 18, eu: 50, au: 22, alpha: ['XXL', '3XL'] },
]

// Women's shoes — UK/US/EU/AU. US ≈ UK+2, EU ≈ UK+33. AU women's shoe sizing
// commonly follows US, so au = us here (approximate).
export interface ShoeRow { uk: number; us: number; eu: number; au: number }
export const SHOE_SIZES: ShoeRow[] = [
  { uk: 2,   us: 4,   eu: 35,   au: 4 },
  { uk: 3,   us: 5,   eu: 36,   au: 5 },
  { uk: 4,   us: 6,   eu: 37,   au: 6 },
  { uk: 5,   us: 7,   eu: 38,   au: 7 },
  { uk: 6,   us: 8,   eu: 39,   au: 8 },
  { uk: 7,   us: 9,   eu: 40,   au: 9 },
  { uk: 8,   us: 10,  eu: 41,   au: 10 },
  { uk: 9,   us: 11,  eu: 42,   au: 11 },
]

const ALPHA_TO_INDICES: Record<string, number[]> = {
  XXS: [0], XS: [1], S: [2, 3], M: [3, 4], L: [5], XL: [6, 7], XXL: [7, 8], '3XL': [9],
  'XS/S': [1, 2, 3], 'S/M': [2, 3, 4], 'M/L': [4, 5], 'L/XL': [5, 6],
}

export function clothingRowByUk(uk: number): ClothingRow | undefined {
  return CLOTHING_SIZES.find((r) => r.uk === uk)
}
export function shoeRowByUk(uk: number): ShoeRow | undefined {
  return SHOE_SIZES.find((r) => r.uk === uk)
}

/** Human label with every system, e.g. "UK 10 · US 6 · EU 38 · AU 10 · S/M". */
export function clothingLabel(r: ClothingRow): string {
  return `UK ${r.uk} · US ${r.us} · EU ${r.eu} · AU ${r.au} · ${r.alpha.join('/')}`
}
export function shoeLabel(r: ShoeRow): string {
  return `UK ${r.uk} · US ${r.us} · EU ${r.eu} · AU ${r.au}`
}

const nearestIndex = <T,>(rows: T[], field: keyof T, n: number): number | null => {
  let best = -1
  let bestD = Infinity
  rows.forEach((r, i) => {
    const d = Math.abs((r[field] as unknown as number) - n)
    if (d < bestD) { bestD = d; best = i }
  })
  return bestD <= 1.5 ? best : null
}

/**
 * Parse a raw garment size string into a CLOTHING_SIZES index (or null if the
 * sizing is unknown/one-size — never treated as a mismatch).
 */
export function garmentSizeIndex(raw: string): number | null {
  const s = String(raw).trim().toUpperCase()
  if (!s || /ONE\s*SIZE|^O\/?S$|^TU$|^UNI/.test(s)) return null
  let m: RegExpMatchArray | null
  if ((m = s.match(/UK\s*(\d+(?:\.\d+)?)/))) return nearestIndex(CLOTHING_SIZES, 'uk', +m[1])
  if ((m = s.match(/US\s*(\d+)/)))            return nearestIndex(CLOTHING_SIZES, 'us', +m[1])
  if ((m = s.match(/(?:EU|FR|DE)\s*(\d+)/)))  return nearestIndex(CLOTHING_SIZES, 'eu', +m[1])
  if ((m = s.match(/IT\s*(\d+)/)))            return nearestIndex(CLOTHING_SIZES, 'eu', +m[1] - 4) // IT ≈ EU+4
  if (ALPHA_TO_INDICES[s]) return ALPHA_TO_INDICES[s][0] // representative index; matching tolerates ±1
  if ((m = s.match(/^(\d+(?:\.\d+)?)$/))) {
    const n = +m[1]
    if (n >= 30 && n <= 52) return nearestIndex(CLOTHING_SIZES, 'eu', n)  // EU clothing
    if (n >= 0 && n <= 24)  return nearestIndex(CLOTHING_SIZES, 'us', n)  // US numeric
    return null // jeans waist etc. — unknown, don't exclude
  }
  return null
}

/** Parse a raw shoe size string into a SHOE_SIZES index (or null if unknown). */
export function shoeSizeIndex(raw: string): number | null {
  const s = String(raw).trim().toUpperCase()
  if (!s || /ONE\s*SIZE|^O\/?S$/.test(s)) return null
  let m: RegExpMatchArray | null
  if ((m = s.match(/UK\s*(\d+(?:\.\d+)?)/))) return nearestIndex(SHOE_SIZES, 'uk', +m[1])
  if ((m = s.match(/US\s*(\d+(?:\.\d+)?)/))) return nearestIndex(SHOE_SIZES, 'us', +m[1])
  if ((m = s.match(/(?:EU|FR)\s*(\d+(?:\.\d+)?)/))) return nearestIndex(SHOE_SIZES, 'eu', +m[1])
  if ((m = s.match(/^(\d+(?:\.\d+)?)$/))) {
    const n = +m[1]
    if (n >= 34 && n <= 46) return nearestIndex(SHOE_SIZES, 'eu', n) // bare number on a shoe = EU
    if (n >= 2 && n <= 12)  return nearestIndex(SHOE_SIZES, 'uk', n) // small = UK
    return null
  }
  return null
}

type SizedItem = { item_type: ItemType | string; stock_sizes?: string[] | null }

const withinOne = (idxs: (number | null)[], target: number): boolean =>
  idxs.some((i) => i !== null && Math.abs(i - target) <= 1)

/**
 * Does this garment come in the user's clothing size (UK index)? Items with no
 * parseable sizes (unknown sizing / one-size) are NOT excluded — we only hide a
 * garment when it has concrete sizes and none is close to the user's.
 */
export function garmentFitsClothing(item: SizedItem, targetIndex: number): boolean {
  const sizes = item.stock_sizes ?? []
  if (sizes.length === 0) return true
  const parsed = sizes.map(garmentSizeIndex)
  if (parsed.every((p) => p === null)) return true
  return withinOne(parsed, targetIndex)
}

/** The garment an outfit is built around (dress → top → bottom → outerwear). */
export function anchorGarment(outfit: OutfitWithItems): (SizedItem & { item_id: string }) | null {
  const its = (outfit.outfit_item ?? []).filter((oi) => (oi as any).item)
  const bySlot = (slot: Slot) => its.find((oi) => slotForItemType(((oi as any).item.item_type)) === slot)
  const pick = bySlot('dress') || bySlot('top') || bySlot('bottom') || bySlot('outerwear') || its[0]
  return pick ? ((pick as any).item as SizedItem & { item_id: string }) : null
}

/**
 * Whether an outfit fits a shopper's clothing size, matching on the MAIN garment
 * only (per product decision). Outfits whose anchor sizing is unknown pass.
 */
export function outfitFitsClothingUk(outfit: OutfitWithItems, uk: number): boolean {
  const row = clothingRowByUk(uk)
  if (!row) return true
  const targetIndex = CLOTHING_SIZES.indexOf(row)
  const anchor = anchorGarment(outfit)
  if (!anchor) return true
  return garmentFitsClothing(anchor, targetIndex)
}
