// "What should she buy to unlock the most outfits from what she owns?"
//
// Pure. For each candidate retail item, count the distinct wearable outfits it
// would complete using ONLY her owned pieces for every other slot. Every outfit
// counted here is one she could not wear before the purchase, so the count is
// exactly the marginal unlock — the sharpest cost-per-wear number we can give
// her before she spends anything.
//
// An outfit = body covered (a dress, or a top + a bottom) + shoes when she owns
// any, and it must clear the same bar her composed looks clear: the composer's
// pairwise coherence floor plus her own hard gate (input-only brands, excluded
// brand pairs). Ranking is by her taste and her stylist persona — the same
// signals that decide what actually gets composed — so the count and the order
// answer the same question the lookbook does.

import type { ItemWithBrand } from '@/lib/admin-queries'
import { pairCompat, slotForItemType, type Slot } from '@/lib/composer'

export interface UnlockOptions {
  /** Candidates considered (after ranking) — keeps the enumeration bounded. */
  maxCandidates?: number
  /** Owned pieces kept per slot per candidate (top-N by compat with the candidate). */
  perSlotOwned?: number
  /** Average pairwise compat floor — same register as the composer's minScore. */
  minCoherence?: number
  /** Her hard gate — the same one composition uses (input-only brands, excluded pairs). */
  gate?: (items: ItemWithBrand[]) => boolean
  /** Member-specific ranking of the retail pool (affinity, occasion, persona lens); higher first. */
  rank?: (item: ItemWithBrand) => number
  maxResults?: number
}

export interface UnlockExample {
  itemIds: string[]
  coherence: number
}

export interface UnlockResult {
  item: ItemWithBrand
  slot: Slot
  /** Distinct wearable outfits this purchase would unlock. */
  unlocked: number
  /** Best few, as item-id lists (candidate first), for the UI. */
  examples: UnlockExample[]
  /** Mean coherence across the unlocked outfits. */
  avgCoherence: number
  /** unlocked ÷ price — how many new outfits per £100 (null when unpriced). */
  outfitsPer100: number | null
}

function priceGbp(it: ItemWithBrand): number | null {
  const a = it as any
  const v = a.price_gbp != null ? Number(a.price_gbp) : a.price != null ? Number(a.price) : NaN
  return Number.isFinite(v) && v > 0 ? v : null
}

function meanPairwise(items: ItemWithBrand[]): number {
  let sum = 0
  let n = 0
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      sum += pairCompat(items[i], items[j]).total
      n++
    }
  }
  return n ? sum / n : 0
}

function bySlot(items: ItemWithBrand[]): Record<Slot, ItemWithBrand[]> {
  const out: Record<Slot, ItemWithBrand[]> = { outerwear: [], top: [], bottom: [], dress: [], shoe: [], bag: [], jewellery: [], accessory: [] }
  for (const it of items) out[slotForItemType(it.item_type)].push(it)
  return out
}

function topByCompat(pool: ItemWithBrand[], anchor: ItemWithBrand, n: number): ItemWithBrand[] {
  return pool
    .map((it) => ({ it, c: pairCompat(anchor, it).total }))
    .sort((a, b) => b.c - a.c)
    .slice(0, n)
    .map((x) => x.it)
}

/** Enumerate the outfit "bodies" a candidate can complete with owned pieces. */
function bodiesFor(candidate: ItemWithBrand, owned: Record<Slot, ItemWithBrand[]>, perSlot: number): ItemWithBrand[][] {
  const slot = slotForItemType(candidate.item_type)
  const tops = topByCompat(owned.top, candidate, perSlot)
  const bottoms = topByCompat(owned.bottom, candidate, perSlot)
  const dresses = topByCompat(owned.dress, candidate, perSlot)
  const bodies: ItemWithBrand[][] = []
  if (slot === 'dress') bodies.push([candidate])
  else if (slot === 'top') for (const b of bottoms) bodies.push([candidate, b])
  else if (slot === 'bottom') for (const t of tops) bodies.push([candidate, t])
  else {
    // shoe / bag / outerwear / jewellery / accessory — needs an owned body under it
    for (const d of dresses) bodies.push([candidate, d])
    for (const t of tops) for (const b of bottoms) bodies.push([candidate, t, b])
  }
  return bodies
}

export function rankUnlockPurchases(owned: ItemWithBrand[], retail: ItemWithBrand[], opts: UnlockOptions = {}): UnlockResult[] {
  const maxCandidates = opts.maxCandidates ?? 150
  const perSlot = opts.perSlotOwned ?? 6
  const minCoherence = opts.minCoherence ?? 0.55
  const maxResults = opts.maxResults ?? 20
  const ownedBySlot = bySlot(owned)
  const hasOwnedShoes = ownedBySlot.shoe.length > 0
  const canCoverBody = ownedBySlot.dress.length > 0 || (ownedBySlot.top.length > 0 && ownedBySlot.bottom.length > 0)

  const ranked = opts.rank
    ? [...retail].sort((a, b) => (opts.rank!(b) - opts.rank!(a)))
    : retail
  const candidates = ranked.slice(0, maxCandidates)

  const results: UnlockResult[] = []
  for (const c of candidates) {
    const slot = slotForItemType(c.item_type)
    // A candidate that can't become an outfit with what she owns unlocks nothing.
    if (slot !== 'dress' && slot !== 'top' && slot !== 'bottom' && !canCoverBody) continue
    if ((slot === 'top' && ownedBySlot.bottom.length === 0) || (slot === 'bottom' && ownedBySlot.top.length === 0)) continue

    const bodies = bodiesFor(c, ownedBySlot, perSlot)
    // shoes: required when she owns some (or the candidate IS the shoe)
    const shoeOptions: (ItemWithBrand | null)[] =
      slot === 'shoe' ? [null] : hasOwnedShoes ? topByCompat(ownedBySlot.shoe, c, perSlot) : [null]

    const seen = new Set<string>()
    const examples: UnlockExample[] = []
    let unlocked = 0
    let cohSum = 0
    for (const body of bodies) {
      for (const shoe of shoeOptions) {
        const outfit = shoe ? [...body, shoe] : body
        const key = outfit.map((i) => i.item_id).sort().join('|')
        if (seen.has(key)) continue
        seen.add(key)
        const coherence = meanPairwise(outfit)
        if (coherence < minCoherence) continue
        if (opts.gate && !opts.gate(outfit)) continue
        unlocked++
        cohSum += coherence
        if (examples.length < 3) examples.push({ itemIds: outfit.map((i) => i.item_id), coherence })
      }
    }
    if (!unlocked) continue
    const price = priceGbp(c)
    results.push({
      item: c,
      slot,
      unlocked,
      examples: examples.sort((a, b) => b.coherence - a.coherence),
      avgCoherence: cohSum / unlocked,
      outfitsPer100: price ? (unlocked / price) * 100 : null,
    })
  }

  results.sort((a, b) => b.unlocked - a.unlocked || b.avgCoherence - a.avgCoherence)
  return results.slice(0, maxResults)
}
