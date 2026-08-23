'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase-server'
import { checkStockDetailed } from '@/app/admin/items/stock-check'
import { upsertSizeAvailability, loadBrandOffsets, loadSizeRowsFor } from '@/lib/size-availability'
import { markUniqueSold } from '@/lib/rescue'
import type { SizeRow } from '@/lib/size-match'

/**
 * Per-item override of the class inherited from the merchant.
 *
 * Refused on a sold item: 'sold' is terminal, and quietly reclassifying one
 * would leave retired looks and completed rescues describing a piece that no
 * longer claims to be one-of-one.
 */
export async function setItemStockClass(
  itemId: string,
  stockClass: 'replenishable' | 'unique',
): Promise<{ error?: string }> {
  try {
    const admin = createAdminClient()
    const { data: item } = await admin
      .from('item' as any)
      .select('status')
      .eq('item_id', itemId)
      .maybeSingle()
    if ((item as any)?.status === 'sold') return { error: 'This piece has sold — its class is fixed.' }

    const { error } = await (admin.from('item') as any)
      .update({ stock_class: stockClass })
      .eq('item_id', itemId)
    if (error) throw error
    revalidatePath(`/admin/items/${itemId}/edit`)
    return {}
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not change the class' }
  }
}

/** Re-read size availability from the retailer now. */
export async function refreshItemSizes(
  itemId: string,
): Promise<{ sizes?: SizeRow[]; error?: string }> {
  try {
    const admin = createAdminClient()
    const { data: item } = await admin
      .from('item' as any)
      .select('item_id, item_type, retailer_url, brand_id')
      .eq('item_id', itemId)
      .maybeSingle()
    const url = (item as any)?.retailer_url
    if (!url) return { error: 'This item has no retailer URL' }

    const checked = await checkStockDetailed(url)
    if (!checked.sizes.length) return { sizes: [], error: 'The retailer page gave no size data' }

    const offsets = await loadBrandOffsets([(item as any).brand_id].filter(Boolean))
    const { changed } = await upsertSizeAvailability(itemId, checked.sizes, {
      itemType: (item as any).item_type,
      brandOffsets: offsets.get((item as any).brand_id) ?? null,
    })
    revalidatePath(`/admin/items/${itemId}/edit`)
    return { sizes: changed }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not read the sizes' }
  }
}

/** Mark a one-of-one sold by hand — retires its looks and starts the rescues. */
export async function markItemSold(
  itemId: string,
): Promise<{ retired?: number; rescued?: number; error?: string }> {
  try {
    const res = await markUniqueSold(itemId, 'manual')
    revalidatePath(`/admin/items/${itemId}/edit`)
    revalidatePath('/admin/second-hand')
    return { retired: res.outfitsRetired, rescued: res.rescuesCreated }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not mark it sold' }
  }
}

/** Current size rows, for the item edit panel. */
export async function getItemSizeRows(itemId: string): Promise<SizeRow[]> {
  return (await loadSizeRowsFor([itemId])).get(itemId) ?? []
}
