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
  zeroVector,
} from '@/lib/taste-vector'
import { getRecommendedOutfits } from '@/lib/recommendations'

const OUTFIT_SELECT = '*, outfit_item(*, item(*, brand(*)))'

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

    const stored = (data as any)?.taste_vector as number[] | null | undefined
    if (Array.isArray(stored) && stored.length === VECTOR_DIM) return stored

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
      admin.from('user_taste_profile').select('taste_vector, event_count').eq('user_id', userId).maybeSingle(),
    ])
    if (!outfitRow) return

    const current =
      Array.isArray((profile as any)?.taste_vector) && (profile as any).taste_vector.length === VECTOR_DIM
        ? ((profile as any).taste_vector as number[])
        : await seedVectorFromHistory(userId)

    const next = accumulate(current, buildOutfitVector(outfitRow as unknown as OutfitWithItems), weight)
    const count = ((profile as any)?.event_count ?? 0) + 1

    await (admin.from('user_taste_profile') as any).upsert(
      { user_id: userId, taste_vector: next, event_count: count, updated_at: new Date().toISOString() },
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

export { cosine }
