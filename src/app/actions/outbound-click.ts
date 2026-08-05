'use server'

// Beacon-mode click logging: used where the outbound link must stay untouched
// (Awin Convert-a-Link merchants — the MasterTag rewrites the href client-side,
// so routing through /go/ would break their attribution). The link navigates
// as it always did; this action records the click in parallel.

import { headers } from 'next/headers'
import { createAdminClient } from '@/lib/supabase-server'
import { logOutboundClick } from '@/lib/outbound-log'
import { deviceFromUa } from '@/lib/outbound'

export async function recordOutboundBeacon(input: {
  clickId: string
  itemId: string
  outfitId?: string | null
  destinationUrl: string
  sessionId?: string | null
  ref?: string | null
  label?: string | null
}): Promise<void> {
  try {
    if (!input?.clickId || !input?.itemId) return
    const h = await headers()
    const ua = h.get('user-agent')

    // Resolve the item's merchant so the click routes to the right ledger.
    let merchantId: string | null = null
    try {
      const admin = createAdminClient()
      const { data } = await admin.from('item' as any).select('merchant_id').eq('item_id', input.itemId).single()
      merchantId = (data as any)?.merchant_id ?? null
    } catch { /* merchant optional */ }

    await logOutboundClick({
      ...input,
      merchantId,
      device: deviceFromUa(ua),
      referrer: h.get('referer'),
      isBot: false, // a beacon fires from a real click handler in a real page
    })
  } catch {
    /* never break navigation */
  }
}
