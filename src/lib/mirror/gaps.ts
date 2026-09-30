// WHAT HER WARDROBE IS SHORT OF.
//
// The Mirror's picks answer two different questions on a brand's site. One is
// taste — MYRA already ranks every tile by her brands, her pieces and her size
// (rank.ts). The other is the question taste cannot answer: not "would she
// like it" but "does she need it". A fourth maxi dress is on taste and still
// the wrong thing to show a woman who owns eleven dresses and three tops.
//
// The reading is deliberately plain: count what she owns per slot, against
// what a wardrobe needs before that slot stops being thin. No wear data exists
// yet, so nothing here pretends to know what she reaches for — only what is
// missing, which is a claim her own wardrobe can settle.

import { slotForItemType, type Slot } from '@/lib/composer'
import type { ItemType } from '@/types/database'

export type { Slot }

/**
 * What a wardrobe wants in each slot before it can dress a week without
 * repeating itself. Tops and bottoms carry the most looks, so they need the
 * most; a dress is a whole outfit, so three go a long way; one bag is a
 * uniform and three is a choice.
 *
 * These are a starting point, not a measurement. They are here, named and in
 * one place, so the bar can be argued with rather than buried in a score.
 */
export const SLOT_TARGET: Record<Slot, number> = {
  top: 6,
  bottom: 5,
  shoe: 5,
  outerwear: 3,
  dress: 3,
  bag: 3,
  jewellery: 3,
  accessory: 2,
}

const SLOT_NOUN: Record<Slot, { one: string; many: string }> = {
  top: { one: 'top', many: 'tops' },
  bottom: { one: 'skirt or trouser', many: 'skirts and trousers' },
  shoe: { one: 'pair of shoes', many: 'pairs of shoes' },
  outerwear: { one: 'coat or jacket', many: 'coats and jackets' },
  dress: { one: 'dress', many: 'dresses' },
  bag: { one: 'bag', many: 'bags' },
  jewellery: { one: 'piece of jewellery', many: 'pieces of jewellery' },
  accessory: { one: 'accessory', many: 'accessories' },
}

export interface WardrobeGap {
  slot: Slot
  owned: number
  target: number
  /** How many pieces short. Always ≥ 1 — a slot at target is not a gap. */
  deficit: number
}

/** The slot a piece sits in, or null for a type MYRA has no slot for. */
export function slotOf(itemType: string | null | undefined): Slot | null {
  if (!itemType) return null
  return slotForItemType(itemType as ItemType) ?? null
}

/**
 * Her thin slots, emptiest first. An empty slot always outranks a short one,
 * however large the shortfall: owning no coat is a different kind of missing
 * from owning two.
 */
export function wardrobeGaps(owned: { item_type?: string | null }[]): WardrobeGap[] {
  const count = new Map<Slot, number>()
  for (const slot of Object.keys(SLOT_TARGET) as Slot[]) count.set(slot, 0)
  for (const i of owned) {
    const slot = slotOf(i.item_type)
    if (slot) count.set(slot, (count.get(slot) ?? 0) + 1)
  }
  return (Object.keys(SLOT_TARGET) as Slot[])
    .map((slot) => ({ slot, owned: count.get(slot) ?? 0, target: SLOT_TARGET[slot], deficit: SLOT_TARGET[slot] - (count.get(slot) ?? 0) }))
    .filter((g) => g.deficit > 0)
    .sort((a, b) => (a.owned === 0 ? -1 : 0) - (b.owned === 0 ? -1 : 0) || b.deficit - a.deficit || a.slot.localeCompare(b.slot))
}

/** The gap this piece would fill, if it fills one. */
export function gapForItemType(itemType: string | null | undefined, gaps: WardrobeGap[]): WardrobeGap | null {
  const slot = slotOf(itemType)
  if (!slot) return null
  return gaps.find((g) => g.slot === slot) ?? null
}

/** Why this piece is worth her attention, in her own wardrobe's terms. */
export function gapSentence(gap: WardrobeGap): string {
  const noun = SLOT_NOUN[gap.slot]
  if (gap.owned === 0) return `Nothing in your wardrobe covers ${noun.many}`
  if (gap.owned === 1) return `You own one ${noun.one}`
  return `You own ${gap.owned} ${noun.many}`
}
