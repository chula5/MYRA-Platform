import { createClient } from '@/lib/supabase'
import type { Outfit, OutfitWithItems, Item } from '@/types/database'

// ── Live outfit feed ──────────────────────────────────────────
export async function getLiveOutfits(
  occasionTag?: string,
  limit = 12,
  offset = 0
): Promise<Outfit[]> {
  const supabase = createClient()

  let query = supabase
    .from('outfit')
    .select('*')
    .eq('status', 'live')
    .order('published_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (occasionTag) {
    query = query.contains('occasion_tags', [occasionTag])
  }

  const { data, error } = await query

  if (error) {
    console.error('getLiveOutfits error:', error)
    return []
  }

  return data ?? []
}

// ── Single outfit with items ──────────────────────────────────
export async function getOutfitWithItems(outfitId: string): Promise<OutfitWithItems | null> {
  const supabase = createClient()

  const { data, error } = await supabase
    .from('outfit')
    .select(`
      *,
      outfit_item (
        *,
        item (
          *,
          brand (*)
        )
      )
    `)
    .eq('outfit_id', outfitId)
    .eq('status', 'live')
    .single()

  if (error) {
    console.error('getOutfitWithItems error:', error)
    return null
  }

  return data as OutfitWithItems
}

// ── Lookbook outfits for landing page ────────────────────────
export async function getLookbookOutfits(limit = 9): Promise<Outfit[]> {
  const supabase = createClient()

  const { data, error } = await supabase
    .from('outfit')
    .select('outfit_id, image_url, aesthetic_label, occasion_tags, status')
    .eq('status', 'live')
    .order('published_at', { ascending: false })
    .limit(limit)

  if (error) {
    console.error('getLookbookOutfits error:', error)
    return []
  }

  return (data ?? []) as Outfit[]
}

// ── Style Item: outfits containing a specific item ────────────
export async function getOutfitsForItem(
  itemId: string,
  excludeOutfitId: string,
  limit = 3
): Promise<Outfit[]> {
  const supabase = createClient()

  // Join via outfit_item to find outfits containing this item
  const { data: outfitItems, error: joinError } = await supabase
    .from('outfit_item')
    .select('outfit_id')
    .eq('item_id', itemId)
    .neq('outfit_id', excludeOutfitId)
    .limit(limit * 2)

  if (joinError || !outfitItems?.length) return []

  const outfitIds = outfitItems.map((oi) => oi.outfit_id)

  const { data, error } = await supabase
    .from('outfit')
    .select('*')
    .in('outfit_id', outfitIds)
    .eq('status', 'live')
    .limit(limit)

  if (error) {
    console.error('getOutfitsForItem error:', error)
    return []
  }

  return data ?? []
}

// ── Similar looks ─────────────────────────────────────────────
export async function getSimilarOutfits(
  outfit: Outfit,
  limit = 6
): Promise<Outfit[]> {
  const supabase = createClient()

  // Match by formality + occasion_tags, exclude current outfit
  const { data, error } = await supabase
    .from('outfit')
    .select('*')
    .eq('status', 'live')
    .eq('formality', outfit.formality)
    .neq('outfit_id', outfit.outfit_id)
    .overlaps('occasion_tags', outfit.occasion_tags)
    .limit(limit)

  if (error) {
    console.error('getSimilarOutfits error:', error)
    return []
  }

  return data ?? []
}

// ── Explore styles (different aesthetic cluster) ──────────────
export async function getExploreOutfits(
  outfit: Outfit,
  seenOutfitIds: string[],
  limit = 6
): Promise<Outfit[]> {
  const supabase = createClient()

  let query = supabase
    .from('outfit')
    .select('*')
    .eq('status', 'live')
    .neq('outfit_id', outfit.outfit_id)
    .overlaps('occasion_tags', outfit.occasion_tags)
    .limit(limit)

  if (seenOutfitIds.length > 0) {
    query = query.not('outfit_id', 'in', `(${seenOutfitIds.join(',')})`)
  }

  const { data, error } = await query

  if (error) {
    console.error('getExploreOutfits error:', error)
    return []
  }

  return data ?? []
}

// ── Log taste event ───────────────────────────────────────────
export async function logTasteEvent({
  userId,
  outfitId,
  itemId,
  eventType,
  occasionContext,
}: {
  userId: string
  outfitId: string
  itemId?: string
  eventType: import('@/types/database').TasteEventType
  occasionContext: string
}) {
  const supabase = createClient()

  const signalWeights: Record<string, number> = {
    shop_click: 7,
    save: 5,
    source_tap: 4,
    style_tap: 3,
    similar_tap: 3,
    like: 3,
    dislike: -2,
    explore_tap: 1,
    skip: 0,
  }

  const { error } = await supabase.from('taste_event').insert({
    user_id: userId,
    outfit_id: outfitId,
    item_id: itemId ?? null,
    event_type: eventType,
    signal_weight: signalWeights[eventType] ?? 0,
    occasion_context: occasionContext,
  })

  if (error) {
    console.error('logTasteEvent error:', error)
  }
}
