'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase-server'
import { markUniqueSold, setRescueReplacement, rescueReviewQueue } from '@/lib/rescue'
import { onItemApproved } from '@/lib/second-hand-intake'
import { runFeed, feedMerchants } from '@/lib/studio/second-hand-feed'
import type { SizeCategory } from '@/lib/size-canonical'

const PATH = '/admin/second-hand'

/** Set a merchant's source type, default class, and feed/webhook plumbing. */
export async function updateMerchantSourcing(
  merchantId: string,
  patch: {
    source_type?: 'retail' | 'second_hand' | 'vintage'
    default_stock_class?: 'replenishable' | 'unique'
    feed_url?: string | null
    feed_format?: 'shopify_json' | 'google_rss' | 'custom_json' | null
    webhook_secret?: string | null
  },
): Promise<{ error?: string }> {
  try {
    const admin = createAdminClient()
    const { error } = await (admin.from('merchant') as any).update(patch).eq('merchant_id', merchantId)
    if (error) throw error
    revalidatePath(PATH)
    return {}
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not update the merchant' }
  }
}

/**
 * Per-brand size offset, in ladder STEPS.
 *   -1  runs small — a labelled UK 10 fits like a UK 8
 *    0  true to size
 *   +1  runs large — a labelled UK 10 fits like a UK 12
 * Nothing infers this; it's a judgement about a brand's cut.
 */
export async function setBrandSizeOffset(
  brandId: string,
  category: SizeCategory | 'default',
  steps: number,
): Promise<{ error?: string }> {
  try {
    const admin = createAdminClient()
    const { data: brand } = await admin
      .from('brand' as any)
      .select('size_offset')
      .eq('brand_id', brandId)
      .maybeSingle()
    const offsets = { ...(((brand as any)?.size_offset ?? {}) as Record<string, number>) }
    if (steps === 0) delete offsets[category]
    else offsets[category] = Math.max(-2, Math.min(2, Math.round(steps)))

    const { error } = await (admin.from('brand') as any)
      .update({ size_offset: offsets })
      .eq('brand_id', brandId)
    if (error) throw error
    revalidatePath(PATH)
    return {}
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not set the offset' }
  }
}

/** Mark a one-of-one sold by hand — retires its looks and starts the rescues. */
export async function markSoldByHand(itemId: string): Promise<{ error?: string; retired?: number; rescued?: number }> {
  try {
    const res = await markUniqueSold(itemId, 'manual')
    revalidatePath(PATH)
    return { retired: res.outfitsRetired, rescued: res.rescuesCreated }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not mark it sold' }
  }
}

/** Classify + fast-compose a piece now, rather than waiting for the next run. */
export async function styleNow(itemId: string): Promise<{ error?: string; composed?: number }> {
  const res = await onItemApproved(itemId)
  revalidatePath(PATH)
  return res.error ? { error: res.error } : { composed: res.composed ?? 0 }
}

/** Chloe picks the replacement for a rescue nothing passed the constitution on. */
export async function chooseRescueReplacement(
  rescueId: string,
  itemId: string,
): Promise<{ error?: string }> {
  const res = await setRescueReplacement(rescueId, itemId)
  revalidatePath(PATH)
  return res
}

export async function listRescueReviewQueue() {
  return rescueReviewQueue()
}

/** Pull every configured feed on demand. */
export async function pullFeedsNow(): Promise<{ merchants: number; sold: number; error?: string }> {
  try {
    const merchants = await feedMerchants()
    let sold = 0
    for (const m of merchants) sold += (await runFeed(m)).sold
    revalidatePath(PATH)
    return { merchants: merchants.length, sold }
  } catch (err) {
    return { merchants: 0, sold: 0, error: err instanceof Error ? err.message : 'Feed pull failed' }
  }
}

/**
 * Deliberately include an out-of-size piece in a look, with a note.
 *
 * The size gate is absolute for one-of-ones, so without this an intentional
 * styling decision ("sized up on purpose — oversized fit") would be impossible
 * to express. The note is shown to her, so it has to say something true.
 */
export async function setSizeOverride(
  outfitItemId: string,
  on: boolean,
  note: string | null,
): Promise<{ error?: string }> {
  try {
    const admin = createAdminClient()
    const { error } = await (admin.from('outfit_item') as any)
      .update({ size_override: on, size_override_note: on ? note?.trim() || null : null })
      .eq('outfit_item_id', outfitItemId)
    if (error) throw error
    revalidatePath(PATH)
    return {}
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not set the override' }
  }
}
