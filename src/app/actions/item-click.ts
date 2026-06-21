'use server'

import { createAdminClient } from '@/lib/supabase-server'

// Record a retailer click-through for an item. Fire-and-forget — analytics
// must never break the browsing experience.
export async function recordItemClick(itemId: string, outfitId?: string) {
  try {
    if (!itemId) return
    const admin = createAdminClient()
    await admin.from('item_click').insert({ item_id: itemId, outfit_id: outfitId ?? null })
  } catch {
    // swallow
  }
}
