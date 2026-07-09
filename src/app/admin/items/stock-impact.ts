'use server'

import { createAdminClient } from '@/lib/supabase-server'
import { revalidatePath } from 'next/cache'

export type StockStatus = 'in_stock' | 'low_stock' | 'out_of_stock' | 'unknown' | null

export interface StockOutfitItem {
  outfit_item_id: string
  item_id: string
  slot: string
  product_name: string
  brand_name: string | null
  image_url: string | null
  stock_status: StockStatus
}
export interface StockOutfit {
  outfit_id: string
  project_id: string | null
  aesthetic_label: string
  status: string
  image_url: string | null
  items: StockOutfitItem[]
  hasOut: boolean
  hasLow: boolean
}

// Every non-archived outfit that contains at least one low-stock or out-of-stock
// item. Each outfit lists ALL its items (with stock status) so the admin can see
// what's still in stock vs what needs swapping. Sorted most-urgent first: live
// before draft, out-of-stock before low.
export async function getStockFlaggedOutfits(): Promise<{ outfits: StockOutfit[]; error?: string }> {
  const admin = createAdminClient()
  try {
    const { data: flagged } = await admin
      .from('item')
      .select('item_id')
      .in('stock_status', ['low_stock', 'out_of_stock'])
      .limit(50000)
    const flaggedIds = ((flagged ?? []) as { item_id: string }[]).map((r) => r.item_id)
    if (flaggedIds.length === 0) return { outfits: [] }

    const { data: oiRows } = await admin
      .from('outfit_item')
      .select('outfit_id')
      .in('item_id', flaggedIds)
      .limit(50000)
    const outfitIds = Array.from(new Set(((oiRows ?? []) as { outfit_id: string }[]).map((r) => r.outfit_id)))
    if (outfitIds.length === 0) return { outfits: [] }

    const { data: rows } = await admin
      .from('outfit')
      .select('outfit_id, project_id, aesthetic_label, status, image_url, outfit_item(outfit_item_id, slot, item(item_id, product_name, image_url, item_type, stock_status, brand(name)))')
      .in('outfit_id', outfitIds)
      .neq('status', 'archived')

    const outfits: StockOutfit[] = ((rows ?? []) as any[]).map((o) => {
      const items: StockOutfitItem[] = (o.outfit_item ?? [])
        .filter((oi: any) => oi.item)
        .map((oi: any) => ({
          outfit_item_id: oi.outfit_item_id,
          item_id: oi.item.item_id,
          slot: oi.slot,
          product_name: oi.item.product_name,
          brand_name: oi.item.brand?.name ?? null,
          image_url: oi.item.image_url,
          stock_status: oi.item.stock_status ?? null,
        }))
      return {
        outfit_id: o.outfit_id,
        project_id: o.project_id ?? null,
        aesthetic_label: o.aesthetic_label,
        status: o.status,
        image_url: o.image_url,
        items,
        hasOut: items.some((it) => it.stock_status === 'out_of_stock'),
        hasLow: items.some((it) => it.stock_status === 'low_stock'),
      }
    })

    const severity = (o: StockOutfit) => (o.hasOut ? 2 : o.hasLow ? 1 : 0)
    outfits.sort((a, b) => {
      const liveA = a.status === 'live' ? 1 : 0
      const liveB = b.status === 'live' ? 1 : 0
      return liveB - liveA || severity(b) - severity(a)
    })

    return { outfits }
  } catch (err) {
    console.error('[getStockFlaggedOutfits]', err)
    return { outfits: [], error: err instanceof Error ? err.message : 'Failed to load' }
  }
}

// Add a new item to an EXISTING outfit (e.g. add a bag). Returns the new
// outfit_item_id so the client can track/swap it immediately.
export async function addItemToOutfitForStock(
  outfitId: string,
  itemId: string,
  slot: string,
): Promise<{ outfitItemId?: string; error?: string }> {
  const admin = createAdminClient()
  try {
    const { data, error } = await (admin.from('outfit_item') as any)
      .insert([{ outfit_id: outfitId, item_id: itemId, slot }])
      .select('outfit_item_id')
      .single()
    if (error) throw error
    revalidatePath('/admin/stock-impact')
    revalidatePath('/admin/projects')
    revalidatePath('/')
    return { outfitItemId: (data as any)?.outfit_item_id }
  } catch (err) {
    console.error('[addItemToOutfitForStock]', err)
    return { error: err instanceof Error ? err.message : 'Add failed' }
  }
}

// Swap one item out of an EXISTING outfit for another (same slot). Persists the
// change (delete the old outfit_item row, insert the replacement).
export async function swapOutfitItemForStock(
  outfitId: string,
  outfitItemId: string,
  newItemId: string,
  slot: string,
): Promise<{ outfitItemId?: string; error?: string }> {
  const admin = createAdminClient()
  try {
    const { error: delErr } = await admin.from('outfit_item').delete().eq('outfit_item_id', outfitItemId)
    if (delErr) throw delErr
    const { data, error: insErr } = await (admin.from('outfit_item') as any)
      .insert([{ outfit_id: outfitId, item_id: newItemId, slot }])
      .select('outfit_item_id')
      .single()
    if (insErr) throw insErr

    revalidatePath('/admin/stock-impact')
    revalidatePath('/admin/projects')
    revalidatePath('/')
    return { outfitItemId: (data as any)?.outfit_item_id }
  } catch (err) {
    console.error('[swapOutfitItemForStock]', err)
    return { error: err instanceof Error ? err.message : 'Swap failed' }
  }
}
