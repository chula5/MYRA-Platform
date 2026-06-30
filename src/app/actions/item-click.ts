'use server'

import { createServerClient, createAdminClient } from '@/lib/supabase-server'
import { recordTasteEvent } from '@/lib/taste-profile'
import { recordLandingEvent } from '@/app/actions/landing-analytics'

// Record a retailer click-through for an item. Fire-and-forget — analytics
// must never break the browsing experience. When a signed-in early-access user
// clicks out to shop, that's the strongest taste signal (+7) — learn from it.
// `ref` + `label` let referral analytics show WHICH items a referred visitor
// clicked (mirrored into landing_event, which carries the ref).
export async function recordItemClick(itemId: string, outfitId?: string, ref?: string | null, label?: string) {
  try {
    if (!itemId) return
    const admin = createAdminClient()
    await admin.from('item_click').insert({ item_id: itemId, outfit_id: outfitId ?? null } as any)

    // Mirror into landing_event so referral breakdowns can show clicked items.
    void recordLandingEvent('item_click', (label || itemId).slice(0, 120), ref)

    if (outfitId) {
      const supabase = await createServerClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (user) void recordTasteEvent(user.id, outfitId, 'shop_click', { itemId })
    }
  } catch {
    // swallow
  }
}
