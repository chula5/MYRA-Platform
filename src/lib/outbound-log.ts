// Server-side outbound click logging, shared by the /go/[clickId] redirect
// route and the beacon action (Awin merchants whose links can't be redirected).
//
// Fire-and-forget by design: logging must never block or break the redirect.
// Never log secrets; never store anything user-identifying beyond user_id.

import { createServerClient, createAdminClient } from '@/lib/supabase-server'
import { recordTasteEvent } from '@/lib/taste-profile'
import { recordLandingEvent } from '@/app/actions/landing-analytics'

export interface OutboundClickInput {
  clickId: string
  itemId: string
  outfitId?: string | null
  merchantId?: string | null
  destinationUrl: string
  sessionId?: string | null
  ref?: string | null
  label?: string | null      // "Brand — Product" for referral analytics
  device?: string | null
  referrer?: string | null
  isBot?: boolean
}

export async function logOutboundClick(input: OutboundClickInput): Promise<void> {
  try {
    const admin = createAdminClient()

    // Who is clicking (logged-out → null user, null snapshot).
    let userId: string | null = null
    let snapshot: string | null = null
    try {
      const supabase = await createServerClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        userId = user.id
        const { data: prof } = await admin
          .from('user_taste_profile' as any)
          .select('taste_vector')
          .eq('user_id', user.id)
          .single()
        // pgvector arrives as a string '[0.1,…]' via PostgREST; insert verbatim.
        snapshot = (prof as any)?.taste_vector ?? null
      }
    } catch { /* auth unavailable → anonymous click */ }

    // The click row — the permanent record. Idempotent on click_id (double
    // clicks / retried beacons reuse the same id and are dropped).
    await admin.from('click' as any).upsert(
      {
        click_id: input.clickId,
        user_id: userId,
        session_id: input.sessionId ?? null,
        item_id: input.itemId,
        outfit_id: input.outfitId ?? null,
        merchant_id: input.merchantId ?? null,
        destination_url: input.destinationUrl,
        taste_vector_snapshot: snapshot,
        device: input.device ?? null,
        referrer: input.referrer ?? null,
        is_bot: input.isBot ?? false,
      } as any,
      { onConflict: 'click_id', ignoreDuplicates: true },
    )

    if (input.isBot) return // bots get logged (flagged) but never train taste or analytics

    // Legacy dual-writes so existing admin analytics stay continuous:
    // item_click (top-items view) + landing_event mirror (referral breakdowns).
    void admin.from('item_click' as any).insert({ item_id: input.itemId, outfit_id: input.outfitId ?? null } as any)
    void recordLandingEvent('item_click', (input.label || input.itemId).slice(0, 120), input.ref ?? null)

    // Strongest taste signal (+7) — same rule as before: needs a signed-in user
    // and an outfit context.
    if (userId && input.outfitId) {
      void recordTasteEvent(userId, input.outfitId, 'shop_click', { itemId: input.itemId })
    }
  } catch {
    /* logging must never surface an error */
  }
}
