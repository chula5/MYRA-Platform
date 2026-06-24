import { createAdminClient } from '@/lib/supabase-server'
import { BRAND_GROUPS } from '@/app/onboarding/brand-groups'
import type { OutfitWithItems } from '@/types/database'

// Silhouette key — same axis used by Similar/Explore.
function silhouette(o: OutfitWithItems): string {
  const types = (o.outfit_item ?? []).filter((oi) => oi.item).map((oi) => String(oi.item.item_type))
  if (types.some((t) => ['mini_dress', 'midi_dress', 'maxi_dress', 'shirt_dress', 'slip_dress'].includes(t))) return 'dress'
  if (types.includes('skirt')) return 'skirt'
  if (types.some((t) => ['trousers', 'jeans', 'shorts'].includes(t))) return 'trousers'
  return 'other'
}

// Hero garment id (dress → top → bottom → outerwear → first item).
function anchor(o: OutfitWithItems): string | null {
  const its = (o.outfit_item ?? []).filter((oi) => oi.item)
  const bySlot = (slot: string) => its.find((oi) => oi.slot === slot)?.item_id
  return bySlot('dress') || bySlot('top') || bySlot('bottom') || bySlot('outerwear') || its[0]?.item_id || null
}

function brandsOf(o: OutfitWithItems): string[] {
  return (o.outfit_item ?? [])
    .map((oi) => (oi.item as any)?.brand?.name?.toLowerCase())
    .filter(Boolean) as string[]
}

/**
 * Personalised outfit recommendations from a user's taste signal:
 *   - outfits they've saved
 *   - outfits they liked at onboarding
 *   - the brand "worlds" they picked at onboarding
 * Scores live outfits by shared brands, occasion tags and silhouette.
 * Returns [] when there's no signal yet (so the caller can hide the row).
 */
export async function getRecommendedOutfits(userId: string, limit = 8): Promise<OutfitWithItems[]> {
  try {
    const admin = createAdminClient()

    const [{ data: saved }, { data: pref }, { data: live }] = await Promise.all([
      admin.from('saved_outfit').select('outfit_id').eq('user_id', userId),
      admin.from('signup_preference').select('brand_groups, liked_outfit_ids').eq('user_id', userId).maybeSingle(),
      admin.from('outfit').select('*, outfit_item(*, item(*, brand(*)))').eq('status', 'live').order('published_at', { ascending: false }).limit(300),
    ])

    const savedIds: string[] = ((saved ?? []) as any[]).map((r) => r.outfit_id)
    const brandGroups: string[] = (pref as any)?.brand_groups ?? []
    const onbLiked: string[] = (pref as any)?.liked_outfit_ids ?? []
    const likedIds = new Set<string>([...savedIds, ...onbLiked])

    const groupBrands = new Set(
      BRAND_GROUPS.filter((g) => brandGroups.includes(g.key)).flatMap((g) => g.brands.map((b) => b.toLowerCase())),
    )

    const liveOutfits = (live ?? []) as unknown as OutfitWithItems[]
    const likedOutfits = liveOutfits.filter((o) => likedIds.has(o.outfit_id))

    if (likedOutfits.length === 0 && groupBrands.size === 0) return []

    // Build affinity profile.
    const affBrand = new Map<string, number>()
    const affTag = new Map<string, number>()
    const affSil = new Map<string, number>()
    for (const o of likedOutfits) {
      for (const b of brandsOf(o)) affBrand.set(b, (affBrand.get(b) ?? 0) + 1)
      for (const t of o.occasion_tags ?? []) affTag.set(t, (affTag.get(t) ?? 0) + 1)
      const s = silhouette(o)
      affSil.set(s, (affSil.get(s) ?? 0) + 1)
    }

    const scored = liveOutfits
      .filter((o) => !likedIds.has(o.outfit_id))
      .map((o) => {
        let score = 0
        const seenBrand = new Set<string>()
        for (const b of brandsOf(o)) {
          if (seenBrand.has(b)) continue
          seenBrand.add(b)
          if (affBrand.has(b)) score += 3 * affBrand.get(b)!
          if (groupBrands.has(b)) score += 2
        }
        for (const t of o.occasion_tags ?? []) if (affTag.has(t)) score += affTag.get(t)!
        const s = silhouette(o)
        if (affSil.has(s)) score += 2 * affSil.get(s)!
        return { o, score }
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)

    // One per anchor so recommendations are varied.
    const seen = new Set<string>()
    const out: OutfitWithItems[] = []
    for (const { o } of scored) {
      const a = anchor(o)
      if (a && seen.has(a)) continue
      if (a) seen.add(a)
      out.push(o)
      if (out.length >= limit) break
    }
    return out
  } catch (err) {
    console.error('[getRecommendedOutfits]', err)
    return []
  }
}
