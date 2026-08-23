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

/** One complete way to wear the candidate, using only pieces she owns. */
export interface UnlockLook {
  /** Candidate first, then her pieces in slot order. */
  itemIds: string[]
  slots: Slot[]
  coherence: number
}

export interface UnlockResult {
  item: ItemWithBrand
  slot: Slot
  /** Distinct wearable outfits this purchase would unlock. */
  unlocked: number
  /** The best few, COMPLETED — layer, bag and jewellery added from her wardrobe. */
  looks: UnlockLook[]
  /** Mean coherence across the unlocked outfits. */
  avgCoherence: number
  /** unlocked ÷ price — how many new outfits per £100 (null when unpriced). */
  outfitsPer100: number | null
  /**
   * Slots no owned piece could fill, so the look is shown honestly incomplete
   * rather than pretending an outfit with no shoes is finished.
   */
  missingSlots: Slot[]
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

/**
 * Finish a core combination into an outfit she could actually put on: add the
 * best-matching layer, bag and jewellery she already owns, each only if it does
 * not drag the look below the coherence floor. Nothing is added twice and
 * nothing is invented — if she owns no bag, the look simply has no bag.
 */
function completeLook(
  core: { item: ItemWithBrand; slot: Slot }[],
  ownedBySlot: Record<Slot, ItemWithBrand[]>,
  minCoherence: number,
  gate?: (items: ItemWithBrand[]) => boolean,
): { item: ItemWithBrand; slot: Slot }[] {
  const out = [...core]
  const used = new Set(core.map((x) => x.item.item_id))
  const present = new Set(core.map((x) => x.slot))
  for (const need of ['outerwear', 'shoe', 'bag', 'jewellery'] as Slot[]) {
    if (present.has(need)) continue
    const pool = (ownedBySlot[need] ?? []).filter((i) => !used.has(i.item_id))
    if (!pool.length) continue
    const current = out.map((x) => x.item)
    const best = pool
      .map((i) => ({ i, c: current.reduce((s2, k) => s2 + pairCompat(k, i).total, 0) / current.length }))
      .sort((a, b) => b.c - a.c)[0]
    if (!best) continue
    const withIt = [...current, best.i]
    if (meanPairwise(withIt) < minCoherence) continue
    if (gate && !gate(withIt)) continue
    out.push({ item: best.i, slot: need })
    used.add(best.i.item_id)
    present.add(need)
  }
  return out
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
    const cores: { items: ItemWithBrand[]; coherence: number }[] = []
    for (const body of bodies) {
      for (const shoe of shoeOptions) {
        const outfit = shoe ? [...body, shoe] : body
        const key = outfit.map((i) => i.item_id).sort().join('|')
        if (seen.has(key)) continue
        seen.add(key)
        const coherence = meanPairwise(outfit)
        if (coherence < minCoherence) continue
        if (opts.gate && !opts.gate(outfit)) continue
        cores.push({ items: outfit, coherence })
      }
    }
    if (!cores.length) continue
    const unlocked = cores.length
    const cohSum = cores.reduce((s2, x) => s2 + x.coherence, 0)

    // Only the looks we actually show get completed — the count is of distinct
    // CORE combinations, so swapping her one bag for another never inflates it.
    const looks: UnlockLook[] = cores
      .sort((a, b) => b.coherence - a.coherence)
      .slice(0, 3)
      .map(({ items }) => {
        const core = items.map((i) => ({ item: i, slot: slotForItemType(i.item_type) }))
        const full = completeLook(core, ownedBySlot, minCoherence, opts.gate)
        // candidate first, then her pieces in a stable head-to-toe order
        const order: Slot[] = ['outerwear', 'dress', 'top', 'bottom', 'shoe', 'bag', 'jewellery', 'accessory']
        const rest = full
          .filter((x) => x.item.item_id !== c.item_id)
          .sort((a, b) => order.indexOf(a.slot) - order.indexOf(b.slot))
        const seq = [{ item: c, slot }, ...rest]
        return {
          itemIds: seq.map((x) => x.item.item_id),
          slots: seq.map((x) => x.slot),
          coherence: meanPairwise(seq.map((x) => x.item)),
        }
      })

    // What her wardrobe cannot finish. A look with no shoes is not a look.
    const covered = new Set(looks.flatMap((l) => l.slots))
    const missingSlots = (['shoe', 'bag'] as Slot[]).filter((sl) => !covered.has(sl))

    const price = priceGbp(c)
    results.push({
      item: c,
      slot,
      unlocked,
      looks,
      avgCoherence: cohSum / unlocked,
      outfitsPer100: price ? (unlocked / price) * 100 : null,
      missingSlots,
    })
  }

  results.sort((a, b) => b.unlocked - a.unlocked || b.avgCoherence - a.avgCoherence)
  return results.slice(0, maxResults)
}
