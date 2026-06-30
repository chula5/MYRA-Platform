'use server'

import { createAdminClient } from '@/lib/supabase-server'
import type { OutfitWithItems } from '@/types/database'

const SELECT = '*, outfit_item(*, item(*, brand(*)))'

// Reduce an outfit to a single silhouette key from its items. This is the axis
// SIMILAR matches on and EXPLORE deliberately differs on, so the two sets never
// overlap. A long dress → 'dress-long' (similar = other long dresses); a skirt
// outfit → 'skirt'; trousers → 'trousers'; etc.
function outfitSilhouette(outfit: any): string {
  const types: string[] = ((outfit?.outfit_item ?? []) as any[])
    .filter((oi) => oi.item)
    .map((oi) => String(oi.item.item_type))

  const dress = types.find((t) =>
    ['mini_dress', 'midi_dress', 'maxi_dress', 'shirt_dress', 'slip_dress'].includes(t),
  )
  if (dress) {
    if (dress === 'maxi_dress' || dress === 'midi_dress' || dress === 'shirt_dress') return 'dress-long'
    return 'dress-short' // mini / slip
  }

  const bottom = types.find((t) => ['skirt', 'trousers', 'jeans', 'shorts'].includes(t))
  if (bottom === 'skirt') return 'skirt'
  if (bottom === 'shorts') return 'shorts'
  if (bottom === 'trousers' || bottom === 'jeans') return 'trousers'

  return 'other'
}

/**
 * Both views stay WITHIN THE SAME OCCASION (shared occasion tag with the anchor):
 *   SIMILAR  → same occasion + SAME silhouette   (long dress → long dresses)
 *   EXPLORE  → same occasion + DIFFERENT silhouette (long dress → short dresses,
 *              skirts, trousers — completely different looks for that occasion)
 * Guaranteed disjoint (same vs different silhouette).
 */
// Other live outfits that use a given item ("Style this item"). Fetched
// server-side with the admin client so the result cards carry their full items
// (anon RLS would drop them, breaking each card's SOURCE ITEMS).
export async function getStyleItemOutfits(
  currentOutfitId: string,
  itemId: string,
): Promise<{ outfits: OutfitWithItems[] }> {
  const admin = createAdminClient()
  const { data: oi } = await admin
    .from('outfit_item')
    .select('outfit_id')
    .eq('item_id', itemId)
    .neq('outfit_id', currentOutfitId)
    .limit(40)
  const ids = Array.from(new Set((oi ?? []).map((r: any) => r.outfit_id)))
  if (!ids.length) return { outfits: [] }
  const { data } = await admin
    .from('outfit')
    .select(SELECT)
    .in('outfit_id', ids)
    .eq('status', 'live')
    .limit(12)
  return { outfits: (data ?? []) as OutfitWithItems[] }
}

export async function getRelatedOutfits(
  outfitId: string,
  mode: 'similar' | 'explore',
): Promise<{ outfits: OutfitWithItems[] }> {
  const admin = createAdminClient()

  const { data: cur } = await admin.from('outfit').select(SELECT).eq('outfit_id', outfitId).single()
  if (!cur) return { outfits: [] }

  const anchorSig = outfitSilhouette(cur)
  const anchorTags: string[] = ((cur as any).occasion_tags ?? []) as string[]
  const hasOccasion = anchorTags.length > 0

  const { data: pool } = await admin
    .from('outfit')
    .select(SELECT)
    .eq('status', 'live')
    .neq('outfit_id', outfitId)
    .limit(200)

  // Same occasion = shares at least one tag. If the anchor has no tags, there's
  // nothing to constrain on, so treat every outfit as same-occasion.
  const sameOccasion = (tags?: string[]) =>
    !hasOccasion || (Array.isArray(tags) && tags.some((t) => anchorTags.includes(t)))

  const scored = ((pool ?? []) as any[])
    .map((o) => ({ o, sig: outfitSilhouette(o) }))
    .filter((c) => sameOccasion(c.o.occasion_tags)) // both views: same occasion only

  const chosen =
    mode === 'similar'
      ? scored.filter((c) => c.sig === anchorSig)
      : scored.filter((c) => c.sig !== anchorSig)

  return { outfits: chosen.slice(0, 6).map((c) => c.o as OutfitWithItems) }
}
