// Replacement-candidate ranking — shared by the mobile swap sheet and the
// stock sentinel so both obey the exact same rules:
//   1. rank by item-vector cosine similarity to the outgoing item
//   2. never offer a quarantined item (ejection rules)
//   3. never offer an item that creates a learned skip-combination with the
//      rest of the outfit
//   4. only status ready/live, and in stock (out_of_stock always excluded;
//      unknown/never-checked passes — the sentinel keeps stock fresh)

import 'server-only'
import { getReadyAndLiveItems, type ItemWithBrand } from '@/lib/admin-queries'
import { slotForItemType, type Slot } from '@/lib/composer'
import { itemCosine } from './confidence'
import { loadStyleGuards, isQuarantined, createsSkipCombination, type StyleGuards } from './guards'

export interface SwapCandidate {
  item: ItemWithBrand
  similarity: number
  sameType: boolean
  sameColourFamily: boolean
  tierGap: number | null // |price_tier delta| vs outgoing, null when unknown
}

export interface SwapCandidateOpts {
  outgoing: ItemWithBrand
  /** The rest of the outfit (outgoing excluded) — skip-combination context. */
  remaining: ItemWithBrand[]
  /** Anchor item id of the outfit (sort_order 0) — quarantine context. */
  anchorItemId: string | null
  limit?: number
  /** Reuse pre-loaded guards/library across many outfits (stock sentinel). */
  guards?: StyleGuards
  library?: ItemWithBrand[]
}

function inStock(item: ItemWithBrand): boolean {
  const s = (item as any).stock_status as string | null
  return s !== 'out_of_stock' && (item as any).status !== 'out_of_stock'
}

export async function getSwapCandidates(opts: SwapCandidateOpts): Promise<SwapCandidate[]> {
  const { outgoing, remaining, anchorItemId, limit = 3 } = opts
  const guards = opts.guards ?? (await loadStyleGuards())
  const library = opts.library ?? (await getReadyAndLiveItems())

  const slot: Slot = slotForItemType(outgoing.item_type)
  const usedIds = new Set([outgoing.item_id, ...remaining.map((i) => i.item_id)])

  const out = outgoing as any
  const candidates = library
    .filter((it) =>
      !usedIds.has(it.item_id) &&
      slotForItemType(it.item_type) === slot &&
      ['ready', 'live'].includes(String((it as any).status)) &&
      inStock(it) &&
      !isQuarantined(guards, it.item_id, anchorItemId) &&
      !createsSkipCombination(guards, it, remaining),
    )
    .map((it) => ({
      item: it,
      similarity: Number(itemCosine(outgoing, it).toFixed(4)),
      sameType: it.item_type === outgoing.item_type,
      sameColourFamily:
        (it as any).colour_family != null && (it as any).colour_family === out.colour_family,
      tierGap:
        it.brand?.price_tier != null && out.brand?.price_tier != null
          ? Math.abs(it.brand.price_tier - out.brand.price_tier)
          : null,
    }))
    .sort((a, b) => b.similarity - a.similarity)

  return candidates.slice(0, limit)
}

// ── Auto-swap gate (stock sentinel confidence routing) ────────────────────────
// AUTO only when the top candidate is a genuinely like-for-like replacement:
// same item_type, same colour_family, same-or-adjacent price tier, and item
// cosine ≥ AUTO_SWAP_SIMILARITY. Anything less needs Chloe.

export const AUTO_SWAP_SIMILARITY = 0.92

export function qualifiesForAutoSwap(c: SwapCandidate | undefined): c is SwapCandidate {
  return !!c &&
    c.sameType &&
    c.sameColourFamily &&
    c.tierGap != null && c.tierGap <= 1 &&
    c.similarity >= AUTO_SWAP_SIMILARITY
}
