'use server'

import { createServerClient, createAdminClient } from '@/lib/supabase-server'
import { recordTasteEvent } from '@/lib/taste-profile'
import { EVENT_WEIGHTS } from '@/lib/taste-vector'

// IDs of every outfit the current user has saved.
export async function getSavedOutfitIds(): Promise<string[]> {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return []
    const admin = createAdminClient()
    const { data } = await admin.from('saved_outfit').select('outfit_id').eq('user_id', user.id)
    return ((data ?? []) as { outfit_id: string }[]).map((r) => r.outfit_id)
  } catch {
    return []
  }
}

// Toggle a save. Returns the new saved state.
export async function toggleSaveOutfit(outfitId: string): Promise<{ saved?: boolean; error?: string }> {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { error: 'Not signed in' }
    const admin = createAdminClient()

    const { data: existing } = await admin
      .from('saved_outfit')
      .select('outfit_id')
      .eq('user_id', user.id)
      .eq('outfit_id', outfitId)
      .maybeSingle()

    if (existing) {
      await admin.from('saved_outfit').delete().eq('user_id', user.id).eq('outfit_id', outfitId)
      return { saved: false }
    }
    const { error } = await (admin.from('saved_outfit') as any).insert({ user_id: user.id, outfit_id: outfitId })
    if (error) throw error
    // A save is a strong taste signal — learn from it.
    void recordTasteEvent(user.id, outfitId, 'save')
    return { saved: true }
  } catch (err: unknown) {
    console.error('[toggleSaveOutfit]', err)
    return { error: err instanceof Error ? err.message : 'Failed to save' }
  }
}

// ── Saved ITEMS (individual pieces, not whole outfits) ──────────────────────

export async function getSavedItemIds(): Promise<string[]> {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return []
    const admin = createAdminClient()
    const { data } = await admin.from('saved_item').select('item_id').eq('user_id', user.id)
    return ((data ?? []) as { item_id: string }[]).map((r) => r.item_id)
  } catch {
    return []
  }
}

export async function toggleSaveItem(
  itemId: string,
  outfitId?: string,
): Promise<{ saved?: boolean; error?: string }> {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { error: 'Not signed in' }
    const admin = createAdminClient()

    const { data: existing } = await admin
      .from('saved_item')
      .select('item_id')
      .eq('user_id', user.id)
      .eq('item_id', itemId)
      .maybeSingle()

    if (existing) {
      await admin.from('saved_item').delete().eq('user_id', user.id).eq('item_id', itemId)
      return { saved: false }
    }
    const { error } = await (admin.from('saved_item') as any).insert({
      user_id: user.id,
      item_id: itemId,
      outfit_id: outfitId ?? null,
    })
    if (error) throw error
    // Saving an item is a strong taste signal — learn from its outfit context.
    if (outfitId) void recordTasteEvent(user.id, outfitId, 'save', { itemId })
    return { saved: true }
  } catch (err: unknown) {
    console.error('[toggleSaveItem]', err)
    return { error: err instanceof Error ? err.message : 'Failed to save' }
  }
}

export interface WardrobeOutfit { outfit_id: string; image_url: string | null; aesthetic_label: string | null }
export interface WardrobeItem {
  item_id: string
  product_name: string
  brand_name: string | null
  image_url: string | null
  price: string | null
  currency: string | null
  retailer_url: string | null
}

// Everything in the user's wardrobe — saved outfits + saved items, with the
// data needed to render them. Returns empty arrays if a table isn't there yet.
export async function getWardrobe(): Promise<{ outfits: WardrobeOutfit[]; items: WardrobeItem[] }> {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { outfits: [], items: [] }
    const admin = createAdminClient()

    const [{ data: so }, { data: si }] = await Promise.all([
      admin.from('saved_outfit').select('outfit_id, created_at').eq('user_id', user.id).order('created_at', { ascending: false }),
      admin.from('saved_item').select('item_id, created_at').eq('user_id', user.id).order('created_at', { ascending: false }),
    ])

    const outfitIds = ((so ?? []) as any[]).map((r) => r.outfit_id)
    const itemIds = ((si ?? []) as any[]).map((r) => r.item_id)

    const [outfitsRes, itemsRes] = await Promise.all([
      outfitIds.length
        ? admin.from('outfit').select('outfit_id, image_url, aesthetic_label').in('outfit_id', outfitIds)
        : Promise.resolve({ data: [] as any[] }),
      itemIds.length
        ? admin.from('item').select('item_id, product_name, image_url, price, currency, retailer_url, brand(name)').in('item_id', itemIds)
        : Promise.resolve({ data: [] as any[] }),
    ])

    // Preserve save order (most-recent first).
    const outfitMap = new Map<string, any>(((outfitsRes.data ?? []) as any[]).map((o) => [o.outfit_id, o]))
    const itemMap = new Map<string, any>(((itemsRes.data ?? []) as any[]).map((i) => [i.item_id, i]))

    const outfits: WardrobeOutfit[] = outfitIds
      .map((id) => outfitMap.get(id))
      .filter(Boolean)
      .map((o) => ({ outfit_id: o.outfit_id, image_url: o.image_url, aesthetic_label: o.aesthetic_label }))

    const items: WardrobeItem[] = itemIds
      .map((id) => itemMap.get(id))
      .filter(Boolean)
      .map((i) => ({
        item_id: i.item_id,
        product_name: i.product_name,
        brand_name: i.brand?.name ?? null,
        image_url: i.image_url,
        price: i.price,
        currency: i.currency,
        retailer_url: i.retailer_url,
      }))

    return { outfits, items }
  } catch (err) {
    console.error('[getWardrobe]', err)
    return { outfits: [], items: [] }
  }
}

// Record a softer taste signal (shop click-out, explore/style/similar tap) from
// the Edit. Fire-and-forget — never blocks the UI.
export async function recordTasteInteraction(
  outfitId: string,
  eventType: keyof typeof EVENT_WEIGHTS,
  occasion?: string,
): Promise<void> {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    await recordTasteEvent(user.id, outfitId, eventType, { occasion })
  } catch {
    // swallow — analytics must never break browsing
  }
}
