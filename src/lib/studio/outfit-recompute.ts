// After any item change on an outfit (swap sheet, auto-swap, undo, restore):
// re-derive the slot scores and outfit-level scores from the new item set
// (same derivations the composer uses on approve), rebuild the 34-dim taste
// vector, cache the fresh review confidence, and rebuild the composed group
// image so the review card reflects the new items.

import 'server-only'
import { createAdminClient } from '@/lib/supabase-server'
import { getOutfit, type ItemWithBrand } from '@/lib/admin-queries'
import { deriveSlotScores, deriveOutfitLevelScores, slotForItemType, type Slot } from '@/lib/composer'
import { buildOutfitVector } from '@/lib/taste-vector'
import { computeOutfitConfidence } from './confidence'
import { refreshComposedGroup, type ComposedGroupInput } from './composed-group'
import type { OutfitWithItems } from '@/types/database'

export interface OutfitEntry {
  item: ItemWithBrand
  slot: Slot
  outfit_item_id: string
  sort_order: number
}

export function outfitEntries(outfit: OutfitWithItems): OutfitEntry[] {
  return ((outfit.outfit_item ?? []) as any[])
    .filter((oi) => oi.item)
    .sort((a, b) => (a.sort_order ?? 999) - (b.sort_order ?? 999))
    .map((oi) => ({
      item: oi.item as ItemWithBrand,
      slot: (oi.slot as Slot) ?? slotForItemType(oi.item.item_type),
      outfit_item_id: oi.outfit_item_id,
      sort_order: oi.sort_order ?? 999,
    }))
}

export async function recomputeOutfit(
  outfitId: string,
  opts: { dimItemId?: string | null } = {},
): Promise<OutfitWithItems | null> {
  const outfit = await getOutfit(outfitId)
  if (!outfit) return null
  const entries = outfitEntries(outfit)
  if (entries.length === 0) return outfit

  const [anchor, ...additions] = entries
  const slotScores = deriveSlotScores(entries.map(({ item, slot }) => ({ item, slot })))
  const outfitLevel = deriveOutfitLevelScores(anchor.item, additions.map(({ item, slot }) => ({ item, slot })))
  const brandIds = Array.from(new Set(entries.map((e) => e.item.brand_id).filter(Boolean)))
  const confidence = computeOutfitConfidence(entries.map((e) => e.item))

  // Vector must reflect the freshly derived outfit-level scores, not the
  // pre-swap row values.
  const refreshed = { ...outfit, ...slotScores, ...outfitLevel } as OutfitWithItems

  const admin = createAdminClient()
  await (admin.from('outfit') as any)
    .update({
      ...slotScores,
      ...outfitLevel,
      source_brand_ids: brandIds,
      taste_vector: buildOutfitVector(refreshed),
      review_confidence: Number(confidence.toFixed(3)),
    })
    .eq('outfit_id', outfitId)

  const groupInputs: ComposedGroupInput[] = entries.map((e) => ({
    item: e.item,
    slot: e.slot,
    dimmed: opts.dimItemId != null && e.item.item_id === opts.dimItemId,
  }))
  await refreshComposedGroup(outfitId, groupInputs)

  return outfit
}
