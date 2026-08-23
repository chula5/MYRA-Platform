// ── Size- and consent-aware outfit filtering ─────────────────────────────────
//
// The asymmetry from the spec, applied to whole looks:
//
//   HARD FILTER   a look containing a one-of-one that isn't in her size never
//                 reaches her. There is no version of that look she can buy and
//                 no restock that will change it.
//
//   HARD FILTER   a look containing a pre-loved or vintage piece reaches her
//                 only if she asked to see pre-loved and vintage pieces.
//
//   RANK          a look containing a REPLENISHABLE piece that's out of her
//                 size sorts down and says so in the sourcing panel. Retail
//                 stock returns, and the styling still has value.
//
// An admin size override on the outfit_item (e.g. "sized up on purpose —
// oversized fit") exempts that item from the hard filter, because the size
// mismatch was the styling decision.

import 'server-only'
import type { OutfitWithItems } from '@/types/database'
import { isSecondHand, isUnique } from '@/lib/second-hand'
import { SEED } from '@/lib/brand-affinity'
import { resolveAvailability, type ItemAvailability } from '@/lib/size-match'
import { loadSizeRowsFor, type ShopperSizeContext } from '@/lib/size-availability'

export interface OutfitSizeVerdict {
  /** May she see this look at all? */
  visible: boolean
  /** Why it was hidden — for admin previews and debugging, never shown to her. */
  hiddenReason:
    | 'unique_out_of_size'
    | 'second_hand_not_opted_in'
    | 'second_hand_brand_off_taste'
    | 'item_sold'
    | null
  /** A replenishable piece she can't currently buy in her size. Sorts down. */
  outOfSize: boolean
  /** Item-level verdicts, keyed by item_id — drives the sourcing-panel labels. */
  availability: Map<string, ItemAvailability>
  /** Items deliberately included out of size, with the stylist's note. */
  overrides: { itemId: string; note: string | null }[]
  /** One-of-one items in this look, with their save counts. */
  unique: Record<string, { saves: number }>
}

/**
 * Her brand affinities, or null when the taste graph has nothing to say about
 * her yet. Null means the graph can't judge — and an unbuilt graph must not
 * silently hide half the catalogue, so it lets everything through.
 */
async function loadBrandAffinities(
  userId: string | null | undefined,
): Promise<Map<string, { affinity: number; hidden: boolean }> | null> {
  if (!userId) return null
  try {
    const { createAdminClient } = await import('@/lib/supabase-server')
    const admin = createAdminClient()
    const { data } = await admin
      .from('user_brand_affinity' as any)
      .select('brand_id, affinity, hidden')
      .eq('user_id', userId)
    const rows = (data ?? []) as any[]
    if (!rows.length) return null
    return new Map(rows.map((r) => [r.brand_id, { affinity: Number(r.affinity ?? 0), hidden: !!r.hidden }]))
  } catch {
    return null
  }
}

function brandPassesTaste(
  affinities: Map<string, { affinity: number; hidden: boolean }> | null,
  brandId: string | null | undefined,
): boolean {
  if (!affinities || !brandId) return true
  const row = affinities.get(brandId)
  if (!row) return true // the graph hasn't reached this brand — not a verdict
  return !row.hidden && row.affinity >= SEED.baseline
}

/** Save counts, for the honest social-proof line on scarce pieces. */
async function loadSaveCounts(itemIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  if (!itemIds.length) return out
  try {
    const { createAdminClient } = await import('@/lib/supabase-server')
    const admin = createAdminClient()
    const { data } = await admin.from('saved_item' as any).select('item_id').in('item_id', itemIds)
    for (const r of (data ?? []) as any[]) out.set(r.item_id, (out.get(r.item_id) ?? 0) + 1)
  } catch {
    // Social proof is a nicety; never let it break a feed render.
  }
  return out
}

export interface MaskedFeed<T extends OutfitWithItems> {
  outfits: T[]
  verdicts: Map<string, OutfitSizeVerdict>
}

/**
 * Apply the mask to a batch of outfits in ONE pass: all size rows are loaded
 * together, so a feed of 300 looks costs a handful of queries rather than one
 * per item.
 *
 * Returns the visible looks with out-of-size ones sorted to the back, plus the
 * per-outfit verdicts so the cards and sourcing panel can label honestly.
 */
export async function maskOutfitsForShopper<T extends OutfitWithItems>(
  outfits: T[],
  ctx: ShopperSizeContext,
  userId?: string | null,
): Promise<MaskedFeed<T>> {
  const verdicts = new Map<string, OutfitSizeVerdict>()
  if (!outfits.length) return { outfits, verdicts }

  const allItemIds = Array.from(
    new Set(
      outfits.flatMap((o) =>
        ((o.outfit_item ?? []) as any[]).filter((oi) => oi.item).map((oi) => oi.item.item_id),
      ),
    ),
  )
  const sizeRows = await loadSizeRowsFor(allItemIds)

  // Only scarce pieces get a "saved by N people" line — on a replenishable
  // item it's flattery, on a one-of-one it's information.
  const uniqueItemIds = Array.from(
    new Set(
      outfits.flatMap((o) =>
        ((o.outfit_item ?? []) as any[])
          .filter((oi) => oi.item && isUnique(oi.item))
          .map((oi) => oi.item.item_id),
      ),
    ),
  )
  const saveCounts = await loadSaveCounts(uniqueItemIds)

  // Opting in to pre-loved is not a licence to show her any pre-loved thing.
  // A second-hand piece still has to clear her taste graph like anything else,
  // so its brand must sit at or above the baseline affinity and not be hidden.
  const affinities = await loadBrandAffinities(userId)

  const visible: T[] = []
  for (const outfit of outfits) {
    const links = ((outfit.outfit_item ?? []) as any[]).filter((oi) => oi.item)
    const availability = new Map<string, ItemAvailability>()
    const overrides: { itemId: string; note: string | null }[] = []
    let hiddenReason: OutfitSizeVerdict['hiddenReason'] = null
    let outOfSize = false

    for (const link of links) {
      const item = link.item
      const a = resolveAvailability(item, sizeRows.get(item.item_id) ?? [], ctx.profile)
      availability.set(item.item_id, a)

      const overridden = link.size_override === true
      if (overridden) overrides.push({ itemId: item.item_id, note: link.size_override_note ?? null })

      if (item.status === 'sold') { hiddenReason = 'item_sold'; break }
      if (isSecondHand(item)) {
        if (!ctx.acceptsSecondHand) { hiddenReason = 'second_hand_not_opted_in'; break }
        if (!brandPassesTaste(affinities, item.brand_id)) { hiddenReason = 'second_hand_brand_off_taste'; break }
      }
      if (isUnique(item) && a.outOfHerSize && !overridden) { hiddenReason = 'unique_out_of_size'; break }
      if (a.outOfHerSize && !overridden) outOfSize = true
    }

    verdicts.set(outfit.outfit_id, {
      visible: hiddenReason == null,
      hiddenReason,
      outOfSize,
      availability,
      overrides,
      unique: Object.fromEntries(
        links
          .filter((l) => isUnique(l.item))
          .map((l) => [l.item.item_id, { saves: saveCounts.get(l.item.item_id) ?? 0 }]),
      ),
    })
    if (hiddenReason == null) visible.push(outfit)
  }

  // Stable partition: everything she can buy in her size keeps its existing
  // order, then the out-of-size looks follow in theirs. Sorting rather than
  // interleaving keeps whatever ranking the caller already applied intact.
  const inSize = visible.filter((o) => !verdicts.get(o.outfit_id)?.outOfSize)
  const rest = visible.filter((o) => verdicts.get(o.outfit_id)?.outOfSize)
  return { outfits: [...inSize, ...rest], verdicts }
}

/**
 * The client-safe shape of a verdict — plain objects for the props boundary,
 * since a Map can't cross it.
 */
export interface ItemSizeInfo {
  quality: ItemAvailability['quality']
  herSizeLabel: string | null
  lowInHerSize: boolean
  outOfHerSize: boolean
  inStockLabels: string[]
  overrideNote?: string | null
  /** Present only on one-of-one pieces. */
  unique?: boolean
  saves?: number
}

export interface OutfitSizeInfo {
  outOfSize: boolean
  items: Record<string, ItemSizeInfo>
}

export function serialiseVerdicts(
  verdicts: Map<string, OutfitSizeVerdict>,
): Record<string, OutfitSizeInfo> {
  const out: Record<string, OutfitSizeInfo> = {}
  for (const [outfitId, v] of Array.from(verdicts.entries())) {
    if (!v.visible) continue
    const noteBy = new Map(v.overrides.map((o) => [o.itemId, o.note]))
    const items: OutfitSizeInfo['items'] = {}
    for (const [itemId, a] of Array.from(v.availability.entries())) {
      items[itemId] = {
        quality: a.quality,
        herSizeLabel: a.herSizeLabel,
        lowInHerSize: a.lowInHerSize,
        outOfHerSize: a.outOfHerSize,
        inStockLabels: a.inStockLabels,
        ...(noteBy.has(itemId) ? { overrideNote: noteBy.get(itemId) ?? null } : {}),
        ...(v.unique[itemId] ? { unique: true, saves: v.unique[itemId].saves } : {}),
      }
    }
    out[outfitId] = { outOfSize: v.outOfSize, items }
  }
  return out
}
