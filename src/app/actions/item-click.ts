'use server'

import { createServerClient, createAdminClient } from '@/lib/supabase-server'
import { recordTasteEvent } from '@/lib/taste-profile'
import { recordLandingEvent } from '@/app/actions/landing-analytics'
import { getVisitorId } from '@/lib/visitor'
import { linkVisitorClicks } from '@/lib/visitor-link'

// Record a retailer click-through for an item. Fire-and-forget — analytics
// must never break the browsing experience. When a signed-in early-access user
// clicks out to shop, that's the strongest taste signal (+7) — learn from it.
// `ref` + `label` let referral analytics show WHICH items a referred visitor
// clicked (mirrored into landing_event, which carries the ref).
export async function recordItemClick(itemId: string, outfitId?: string, ref?: string | null, label?: string) {
  try {
    if (!itemId) return
    const admin = createAdminClient()

    // Who clicked. Null for logged-out visitors — most traffic is anonymous and
    // that is recorded honestly rather than guessed at.
    let userId: string | null = null
    try {
      const supabase = await createServerClient()
      const { data: { user } } = await supabase.auth.getUser()
      userId = user?.id ?? null
      if (user && outfitId) void recordTasteEvent(user.id, outfitId, 'shop_click', { itemId })
    } catch {
      /* auth unavailable → anonymous click */
    }

    // The browser behind the click, signed in or not — lets anonymous clicks be
    // grouped as one person's browsing, and claimed later if they sign up.
    const visitorId = await getVisitorId()

    await admin
      .from('item_click')
      .insert({ item_id: itemId, outfit_id: outfitId ?? null, user_id: userId, visitor_id: visitorId } as any)

    if (userId && visitorId) void linkVisitorClicks(userId, visitorId)

    // Mirror into landing_event so referral breakdowns can show clicked items.
    void recordLandingEvent('item_click', (label || itemId).slice(0, 120), ref)
  } catch {
    // swallow
  }
}
