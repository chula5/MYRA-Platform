'use server'

// WAIT FOR SALE — her side of the bell on a saved piece (lib/price-watch does
// the watching). Ringing it freezes today's price; MYRA tells her when it drops.

import { createAdminClient } from '@/lib/supabase-server'
import { resolveClientMember } from '@/lib/client-member'

export interface PriceWatch {
  item_id: string
  watching: boolean
  price_at_watch: number | null
  /** The lowest price she has been told of, once it has dropped. */
  lowest_seen: number | null
  dropped_at: string | null
}

/** The bell state of every piece on her saved shelf. */
export async function loadMyPriceWatches(asMemberId?: string): Promise<{ watches: PriceWatch[]; error?: string }> {
  const me = await resolveClientMember(asMemberId)
  if (!me) return { watches: [], error: 'Not signed in' }
  const { data, error } = await (createAdminClient() as any).from('member_saved_item')
    .select('item_id, price_watch, price_at_watch, lowest_seen, price_dropped_at').eq('member_id', me.memberId)
  if (error) return { watches: [], error: /price_watch/.test(error.message) ? 'Run migration 0110 first' : error.message }
  return {
    watches: ((data ?? []) as any[]).map((r) => ({
      item_id: r.item_id,
      watching: !!r.price_watch,
      price_at_watch: r.price_at_watch != null ? Number(r.price_at_watch) : null,
      lowest_seen: r.lowest_seen != null ? Number(r.lowest_seen) : null,
      dropped_at: r.price_dropped_at ?? null,
    })),
  }
}

/** Ring or silence the bell on a saved piece. */
export async function togglePriceWatch(itemId: string, asMemberId?: string): Promise<{ watching?: boolean; error?: string }> {
  const me = await resolveClientMember(asMemberId)
  if (!me) return { error: 'Not signed in' }
  const admin = createAdminClient() as any
  const { data: row } = await admin.from('member_saved_item').select('price_watch')
    .eq('member_id', me.memberId).eq('item_id', itemId).maybeSingle()
  if (!row) return { error: 'Save the piece first' }

  if (row.price_watch) {
    const { error } = await admin.from('member_saved_item')
      .update({ price_watch: false, price_at_watch: null, lowest_seen: null, price_dropped_at: null })
      .eq('member_id', me.memberId).eq('item_id', itemId)
    return error ? { error: error.message } : { watching: false }
  }
  const { data: item } = await admin.from('item').select('price_gbp').eq('item_id', itemId).maybeSingle()
  const price = item?.price_gbp != null ? Number(item.price_gbp) : null
  const { error } = await admin.from('member_saved_item')
    .update({ price_watch: true, price_at_watch: price, lowest_seen: null, price_dropped_at: null })
    .eq('member_id', me.memberId).eq('item_id', itemId)
  return error ? { error: error.message } : { watching: true }
}
