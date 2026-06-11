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
 * SIMILAR  → live outfits with the SAME silhouette as the anchor (e.g. long
 *            dress → long dresses), occasion-overlap preferred.
 * EXPLORE  → live outfits with a DIFFERENT silhouette but a shared occasion
 *            (e.g. long dress → short dresses, skirts, trousers).
 *
 * The two are guaranteed disjoint (one matches sig === anchorSig, the other
 * sig !== anchorSig), which fixes the overlapping-results bug.
 */
export async function getRelatedOutfits(
  outfitId: string,
  mode: 'similar' | 'explore',
): Promise<{ outfits: OutfitWithItems[] }> {
  const admin = createAdminClient()

  const { data: cur } = await admin.from('outfit').select(SELECT).eq('outfit_id', outfitId).single()
  if (!cur) return { outfits: [] }

  const anchorSig = outfitSilhouette(cur)
  const anchorTags: string[] = ((cur as any).occasion_tags ?? []) as string[]

  const { data: pool } = await admin
    .from('outfit')
    .select(SELECT)
    .eq('status', 'live')
    .neq('outfit_id', outfitId)
    .limit(200)

  const overlapsOccasion = (tags?: string[]) =>
    Array.isArray(tags) && tags.some((t) => anchorTags.includes(t))

  const scored = ((pool ?? []) as any[]).map((o) => ({
    o,
    sig: outfitSilhouette(o),
    ov: overlapsOccasion(o.occasion_tags),
  }))

  let chosen: typeof scored
  if (mode === 'similar') {
    // Same silhouette. Prefer shared occasion, then keep the rest.
    chosen = scored.filter((c) => c.sig === anchorSig)
  } else {
    // Different silhouette, same occasion (so it's a real "explore for this
    // occasion"). Fall back to any different silhouette if none share an occasion.
    const diff = scored.filter((c) => c.sig !== anchorSig)
    const sameOccasion = diff.filter((c) => c.ov)
    chosen = sameOccasion.length > 0 ? sameOccasion : diff
  }

  chosen.sort((a, b) => Number(b.ov) - Number(a.ov))
  return { outfits: chosen.slice(0, 6).map((c) => c.o as OutfitWithItems) }
}
