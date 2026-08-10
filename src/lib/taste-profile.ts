import { createAdminClient } from '@/lib/supabase-server'
import type { OutfitWithItems } from '@/types/database'
import {
  EVENT_WEIGHTS,
  VECTOR_DIM,
  accumulate,
  buildOutfitVector,
  cosine,
  isZero,
  rankByTaste,
  rankOccasions,
  zeroVector,
} from '@/lib/taste-vector'
import { getRecommendedOutfits } from '@/lib/recommendations'
import { BRAND_GROUPS } from '@/app/onboarding/brand-groups'
import { BASE_OCCASIONS, CANDIDATE_OCCASIONS, OCCASION_TILE_COUNT } from '@/lib/occasions'

const OUTFIT_SELECT = '*, outfit_item(*, item(*, brand(*)))'

// taste_vector is a pgvector vector(34) column — PostgREST returns it as a
// string like "[0.1,0.2,...]", not a JS array. Parse it back to numbers.
function parseVector(v: unknown): number[] | null {
  if (Array.isArray(v) && v.length === VECTOR_DIM) return v as number[]
  if (typeof v === 'string') {
    try {
      const a = JSON.parse(v)
      if (Array.isArray(a) && a.length === VECTOR_DIM) return a as number[]
    } catch {
      /* not parseable */
    }
  }
  return null
}

function anchorItemId(o: OutfitWithItems): string | null {
  const its = (o.outfit_item ?? []).filter((oi) => oi.item)
  const bySlot = (slot: string) => its.find((oi) => oi.slot === slot)?.item_id
  return bySlot('dress') || bySlot('top') || bySlot('bottom') || bySlot('outerwear') || its[0]?.item_id || null
}

// Fetch a handful of outfits by id, with items + brands, so we can vectorise them.
async function fetchOutfitsByIds(ids: string[]): Promise<Map<string, OutfitWithItems>> {
  const map = new Map<string, OutfitWithItems>()
  if (ids.length === 0) return map
  const admin = createAdminClient()
  const { data } = await admin.from('outfit').select(OUTFIT_SELECT).in('outfit_id', ids)
  for (const o of ((data ?? []) as unknown as OutfitWithItems[])) map.set(o.outfit_id, o)
  return map
}

// Build a user's taste vector from scratch out of their onboarding choices and
// saves — used to seed a profile the first time we need one. Onboarding likes
// and saves pull taste toward them (+5); onboarding dislikes push away (-2).
async function seedVectorFromHistory(userId: string): Promise<number[]> {
  const admin = createAdminClient()
  const [{ data: pref }, { data: saved }] = await Promise.all([
    admin.from('signup_preference').select('liked_outfit_ids, disliked_outfit_ids').eq('user_id', userId).maybeSingle(),
    admin.from('saved_outfit').select('outfit_id').eq('user_id', userId),
  ])
  const liked: string[] = (pref as any)?.liked_outfit_ids ?? []
  const disliked: string[] = (pref as any)?.disliked_outfit_ids ?? []
  const savedIds: string[] = ((saved ?? []) as any[]).map((r) => r.outfit_id)

  const outfits = await fetchOutfitsByIds([...new Set([...liked, ...disliked, ...savedIds])])
  let vec = zeroVector()
  for (const id of [...savedIds, ...liked]) {
    const o = outfits.get(id)
    if (o) vec = accumulate(vec, buildOutfitVector(o), EVENT_WEIGHTS.save)
  }
  for (const id of disliked) {
    const o = outfits.get(id)
    if (o) vec = accumulate(vec, buildOutfitVector(o), EVENT_WEIGHTS.dislike)
  }
  return vec
}

// The user's current taste vector. Reads the stored profile; if there isn't one
// yet, seeds it from onboarding + saves and persists it.
export async function getUserTasteVector(userId: string): Promise<number[]> {
  try {
    const admin = createAdminClient()
    const { data } = await admin
      .from('user_taste_profile')
      .select('taste_vector')
      .eq('user_id', userId)
      .maybeSingle()

    const stored = parseVector((data as any)?.taste_vector)
    if (stored) return stored

    const seeded = await seedVectorFromHistory(userId)
    await (admin.from('user_taste_profile') as any).upsert(
      { user_id: userId, taste_vector: seeded, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' },
    )
    return seeded
  } catch (err) {
    console.error('[getUserTasteVector]', err)
    return zeroVector()
  }
}

// Record one taste signal and fold it into the user's vector. Fire-and-forget —
// analytics/learning must never break browsing.
export async function recordTasteEvent(
  userId: string,
  outfitId: string,
  eventType: keyof typeof EVENT_WEIGHTS | string,
  opts: { itemId?: string; occasion?: string } = {},
): Promise<void> {
  try {
    if (!userId || !outfitId) return
    const weight = EVENT_WEIGHTS[eventType] ?? 0
    const admin = createAdminClient()

    // Log the event (the append-only taste graph).
    await (admin.from('taste_event') as any).insert({
      user_id: userId,
      outfit_id: outfitId,
      item_id: opts.itemId ?? null,
      event_type: eventType,
      signal_weight: weight,
      occasion_context: opts.occasion ?? null,
    })

    if (weight === 0) return

    // Fold the outfit's vector into the running profile.
    const [{ data: outfitRow }, { data: profile }] = await Promise.all([
      admin.from('outfit').select(OUTFIT_SELECT).eq('outfit_id', outfitId).maybeSingle(),
      admin.from('user_taste_profile').select('taste_vector').eq('user_id', userId).maybeSingle(),
    ])
    if (!outfitRow) return

    const current = parseVector((profile as any)?.taste_vector) ?? (await seedVectorFromHistory(userId))
    const next = accumulate(current, buildOutfitVector(outfitRow as unknown as OutfitWithItems), weight)

    await (admin.from('user_taste_profile') as any).upsert(
      { user_id: userId, taste_vector: next, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' },
    )
  } catch (err) {
    console.error('[recordTasteEvent]', err)
  }
}

// Cosine-ranked recommendations for the Edit landing row. Falls back to the
// rule-based engine when the user has no taste signal yet.
export async function getTasteRecommendations(userId: string, limit = 8): Promise<OutfitWithItems[]> {
  try {
    const admin = createAdminClient()
    const userVec = await getUserTasteVector(userId)
    if (isZero(userVec)) return getRecommendedOutfits(userId, limit)

    const [{ data: live }, { data: saved }, { data: pref }] = await Promise.all([
      admin.from('outfit').select(OUTFIT_SELECT).eq('status', 'live').order('published_at', { ascending: false }).limit(400),
      admin.from('saved_outfit').select('outfit_id').eq('user_id', userId),
      admin.from('signup_preference').select('liked_outfit_ids').eq('user_id', userId).maybeSingle(),
    ])

    const exclude = new Set<string>([
      ...((saved ?? []) as any[]).map((r) => r.outfit_id),
      ...(((pref as any)?.liked_outfit_ids ?? []) as string[]),
    ])

    const ranked = rankByTaste(userVec, (live ?? []) as unknown as OutfitWithItems[])
      .filter((r) => !exclude.has(r.outfit.outfit_id))
      .filter((r) => r.score > 0.15) // soft floor — cut genuinely irrelevant looks

    // One per anchor so the row stays varied.
    const seen = new Set<string>()
    const out: OutfitWithItems[] = []
    for (const { outfit } of ranked) {
      const a = anchorItemId(outfit)
      if (a && seen.has(a)) continue
      if (a) seen.add(a)
      out.push(outfit)
      if (out.length >= limit) break
    }
    // If the floor was too aggressive (sparse vector), back-fill with rule-based.
    if (out.length < Math.min(4, limit)) return getRecommendedOutfits(userId, limit)
    return out
  } catch (err) {
    console.error('[getTasteRecommendations]', err)
    return getRecommendedOutfits(userId, limit)
  }
}

// ── Brand-affinity discovery row ────────────────────────────────────────────

export interface BrandRow {
  brand: string
  label: string
  outfits: OutfitWithItems[]
  // Canonical logo from the backend (brand.logo_url) — the tile's first choice.
  logo_url?: string | null
}

function brandsOfOutfit(o: OutfitWithItems): Set<string> {
  const s = new Set<string>()
  for (const oi of o.outfit_item ?? []) {
    const n = (oi.item as any)?.brand?.name
    if (n) s.add(String(n).toLowerCase())
  }
  return s
}

// Outfits to "discover more" from the brands the user actually engages with —
// saved outfits/items, retailer click-outs, and onboarding brand worlds.
export async function getBrandAffinityRows(
  userId: string,
  liveOutfits: OutfitWithItems[],
  userVec: number[],
  maxRows = 8,
): Promise<BrandRow[]> {
  try {
    const admin = createAdminClient()
    const [{ data: savedO }, { data: savedI }, { data: clicks }, { data: pref }] = await Promise.all([
      admin.from('saved_outfit').select('outfit_id').eq('user_id', userId),
      admin.from('saved_item').select('item_id').eq('user_id', userId),
      admin.from('taste_event').select('item_id').eq('user_id', userId).eq('event_type', 'shop_click').not('item_id', 'is', null),
      admin.from('signup_preference').select('brand_groups').eq('user_id', userId).maybeSingle(),
    ])

    const savedOutfitIds = new Set(((savedO ?? []) as any[]).map((r) => r.outfit_id))
    const savedItemIds = ((savedI ?? []) as any[]).map((r) => r.item_id)
    const clickItemIds = ((clicks ?? []) as any[]).map((r) => r.item_id).filter(Boolean)
    const brandGroups: string[] = (pref as any)?.brand_groups ?? []

    const weight = new Map<string, number>()
    const add = (name: string | null | undefined, w: number) => {
      if (!name) return
      const k = String(name).toLowerCase()
      weight.set(k, (weight.get(k) ?? 0) + w)
    }

    // Brands inside the user's saved outfits.
    const outfitById = new Map(liveOutfits.map((o) => [o.outfit_id, o]))
    for (const id of savedOutfitIds) {
      const o = outfitById.get(id)
      if (o) for (const b of brandsOfOutfit(o)) add(b, 2)
    }

    // Brands of saved + clicked individual items.
    const lookupIds = [...new Set([...savedItemIds, ...clickItemIds])]
    if (lookupIds.length) {
      const { data: itemsData } = await admin.from('item').select('item_id, brand(name)').in('item_id', lookupIds)
      const brandOf = new Map(((itemsData ?? []) as any[]).map((i) => [i.item_id, i.brand?.name]))
      for (const id of savedItemIds) add(brandOf.get(id), 3)
      for (const id of clickItemIds) add(brandOf.get(id), 3)
    }

    // Onboarding brand worlds (weakest signal).
    for (const g of brandGroups) {
      const grp = BRAND_GROUPS.find((x) => x.key === g)
      for (const b of grp?.brands ?? []) add(b, 1)
    }

    if (weight.size === 0) return []

    const ranked = [...weight.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k)
    const rows: BrandRow[] = []

    for (const brandLower of ranked) {
      const matches = liveOutfits.filter(
        (o) => !savedOutfitIds.has(o.outfit_id) && brandsOfOutfit(o).has(brandLower),
      )
      if (matches.length < 2) continue

      // Proper-cased brand name + backend logo from a matching item.
      let displayName = brandLower
      let logoUrl: string | null = null
      for (const o of matches) {
        const hit = (o.outfit_item ?? []).find((oi) => ((oi.item as any)?.brand?.name ?? '').toLowerCase() === brandLower)
        if (hit) {
          displayName = (hit.item as any).brand.name
          logoUrl = (hit.item as any).brand.logo_url ?? null
          break
        }
      }

      const ordered = isZero(userVec) ? matches : rankByTaste(userVec, matches).map((r) => r.outfit)
      const deduped: OutfitWithItems[] = []
      const seenAnchor = new Set<string>()
      for (const o of ordered) {
        const a = anchorItemId(o)
        if (a && seenAnchor.has(a)) continue
        if (a) seenAnchor.add(a)
        deduped.push(o)
        if (deduped.length >= 24) break
      }
      if (deduped.length < 2) continue

      const label = rows.length % 2 === 0 ? `MORE FROM ${displayName.toUpperCase()}` : `${displayName.toUpperCase()}, FOR YOU`
      rows.push({ brand: displayName, label, outfits: deduped, logo_url: logoUrl })
      if (rows.length >= maxRows) break
    }

    return rows
  } catch (err) {
    console.error('[getBrandAffinityRows]', err)
    return []
  }
}

// Personalised occasion order — occasions whose outfits best match the user's
// taste come first, with the always-on base occasions guaranteed to appear.
export function getOccasionOrder(userVec: number[], liveOutfits: OutfitWithItems[]): string[] {
  if (isZero(userVec)) return BASE_OCCASIONS
  const ranked = rankOccasions(userVec, liveOutfits, CANDIDATE_OCCASIONS).map((x) => x.tag)
  const seen = new Set(ranked)
  const withBase = [...ranked, ...BASE_OCCASIONS.filter((t) => !seen.has(t))]
  return withBase.slice(0, OCCASION_TILE_COUNT)
}

export { cosine }
