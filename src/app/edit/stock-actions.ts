'use server'

// Shopper-facing stock actions: the "notify me if it returns" reminder on a
// piece that isn't in her size, and the rescue flow's engagement layer.

import { createServerClient, createAdminClient } from '@/lib/supabase-server'
import {
  notifyMeOnRestock, markAlertsSeen, unsubscribe, listUserAlerts, type UserAlert,
} from '@/lib/stock-alerts'
import {
  engageRescue, chooseAlternative, rescuesForUser,
  type AlternativeCard, type SavedOutfitRescue,
} from '@/lib/rescue'
import { loadUserSizeProfile } from '@/lib/size-availability'

async function currentUser() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  return user
}

/** "Notify me if it returns" from the sourcing panel. */
export async function watchForRestock(
  itemId: string,
  itemType: string | null,
): Promise<{ watching?: boolean; error?: string }> {
  const user = await currentUser()
  if (!user) return { error: 'Sign in to be told when it returns' }
  const res = await notifyMeOnRestock(user.id, { item_id: itemId, item_type: itemType })
  if (res.error) return { error: res.error }
  return { watching: true }
}

export async function stopWatching(itemId: string): Promise<{ watching?: boolean }> {
  const user = await currentUser()
  if (!user) return {}
  await unsubscribe(user.id, itemId, 'notify_me')
  return { watching: false }
}

export async function dismissAlerts(alertIds?: string[]): Promise<void> {
  const user = await currentUser()
  if (!user) return
  await markAlertsSeen(user.id, alertIds)
}

/**
 * She tapped the restyled look, or the struck-through item. THIS is what buys
 * the second layer — 2-4 alternatives as item cards, in her size, ordered by
 * her brand affinities. No render happens here.
 */
export async function findSomethingSimilar(rescueId: string): Promise<AlternativeCard[]> {
  const user = await currentUser()
  if (!user) return []
  return engageRescue(user.id, rescueId)
}

/** She saved an alternative — the only thing that queues a second render. */
export async function pickAlternative(
  rescueId: string,
  alternativeId: string,
): Promise<{ queued?: boolean; imageUrl?: string | null; error?: string }> {
  const user = await currentUser()
  if (!user) return { error: 'Sign in to keep this restyle' }
  const res = await chooseAlternative(user.id, rescueId, alternativeId)
  return { queued: res.queued, imageUrl: res.imageUrl }
}

// ── The wardrobe's rescue + alert payload ────────────────────────────────────

export interface WardrobeRescue {
  outfit: {
    outfit_id: string
    image_url: string | null
    aesthetic_label: string | null
    soldItem: { item_id: string; product_name: string; brand_name: string | null; image_url: string | null } | null
  }
  rescue: SavedOutfitRescue
}

export interface WardrobeAlerts {
  rescues: WardrobeRescue[]
  alerts: UserAlert[]
}

/**
 * Everything the wardrobe needs to show rescue state and stock alerts.
 *
 * Saved outfits are never removed from her list, so this doesn't filter
 * anything — it annotates. A look whose one-of-one has sold comes back here
 * with its rescue, and the wardrobe renders it in rescue state instead of the
 * ordinary thumbnail.
 */
export async function getWardrobeRescues(): Promise<WardrobeAlerts> {
  const user = await currentUser()
  if (!user) return { rescues: [], alerts: [] }
  try {
    const admin = createAdminClient()
    const { data: saved } = await admin
      .from('saved_outfit')
      .select('outfit_id')
      .eq('user_id', user.id)
    const outfitIds = ((saved ?? []) as any[]).map((r) => r.outfit_id)
    if (!outfitIds.length) return { rescues: [], alerts: await listUserAlerts(user.id, 20) }

    const ctx = await loadUserSizeProfile(user.id)
    const rescueMap = await rescuesForUser(user.id, outfitIds, ctx)
    if (rescueMap.size === 0) return { rescues: [], alerts: await listUserAlerts(user.id, 20) }

    const rescued = Array.from(rescueMap.values())
    const [{ data: outfits }, { data: soldItems }] = await Promise.all([
      admin
        .from('outfit')
        .select('outfit_id, image_url, aesthetic_label')
        .in('outfit_id', rescued.map((r) => r.outfit_id)),
      admin
        .from('item')
        .select('item_id, product_name, image_url, brand(name)')
        .in('item_id', rescued.map((r) => r.sold_item_id)),
    ])
    const outfitBy = new Map(((outfits ?? []) as any[]).map((o) => [o.outfit_id, o]))
    const itemBy = new Map(((soldItems ?? []) as any[]).map((i) => [i.item_id, i]))

    const rescues: WardrobeRescue[] = rescued
      .map((rescue) => {
        const o = outfitBy.get(rescue.outfit_id)
        if (!o) return null
        const sold = itemBy.get(rescue.sold_item_id)
        return {
          outfit: {
            outfit_id: o.outfit_id,
            image_url: o.image_url,
            aesthetic_label: o.aesthetic_label,
            soldItem: sold
              ? {
                  item_id: sold.item_id,
                  product_name: sold.product_name,
                  brand_name: sold.brand?.name ?? null,
                  image_url: sold.image_url,
                }
              : null,
          },
          rescue,
        }
      })
      .filter((r): r is WardrobeRescue => r != null)

    return { rescues, alerts: await listUserAlerts(user.id, 20) }
  } catch (err) {
    console.error('[getWardrobeRescues]', err)
    return { rescues: [], alerts: [] }
  }
}
