// ── Bringing a second-hand piece into the library ────────────────────────────
//
// Second-hand stock is TIME-SENSITIVE in a way retail isn't: there is exactly
// one of it, and every day it sits unstyled is a day it can sell somewhere
// else. So the moment a one-of-one is approved it goes to the FRONT of the
// composer queue, not the back.
//
// Three things happen on intake:
//   1. class + source resolved from the merchant (unique unless told otherwise)
//   2. its single size row written, so the hard size gate has something to read
//   3. a styling set queued at priority 1

import 'server-only'
import { createAdminClient } from '@/lib/supabase-server'
import { checkStockDetailed } from '@/app/admin/items/stock-check'
import { upsertSizeAvailability, loadBrandOffsets } from '@/lib/size-availability'
import { defaultStockClass, isSecondHand, isUnique } from '@/lib/second-hand'
import { writeAudit } from '@/lib/studio/audit'

export interface IntakeResult {
  itemId: string
  stockClass: 'replenishable' | 'unique'
  sizesWritten: number
  composed?: number
  error?: string
}

/**
 * Classify a newly ingested item against its merchant and seed its size
 * availability.
 *
 * A unique item gets EXACTLY ONE size row — the database enforces it too, so no
 * ingest path can quietly create a "one-of-one" with four sizes. Where the page
 * lists several, the one that's actually in stock wins; a genuinely
 * multi-size listing means the merchant's default is wrong, and that is
 * reported rather than papered over.
 */
export async function classifyOnIntake(itemId: string): Promise<IntakeResult> {
  const admin = createAdminClient()
  const { data: item } = await admin
    .from('item' as any)
    .select('item_id, item_type, retailer_url, brand_id, merchant_id, stock_class, merchant(source_type, default_stock_class), brand(source_type)')
    .eq('item_id', itemId)
    .maybeSingle()

  if (!item) return { itemId, stockClass: 'replenishable', sizesWritten: 0, error: 'Item not found' }

  const stockClass = defaultStockClass((item as any).merchant)
  await (admin.from('item') as any).update({ stock_class: stockClass }).eq('item_id', itemId)

  let sizesWritten = 0
  const url = (item as any).retailer_url as string | null
  if (url) {
    const checked = await checkStockDetailed(url)
    let entries = checked.sizes
    if (stockClass === 'unique' && entries.length > 1) {
      const inStock = entries.filter((s) => s.inStock)
      entries = inStock.length ? [inStock[0]] : [entries[0]]
      console.warn(
        `[classifyOnIntake] ${itemId} is marked one-of-one but its page lists ${checked.sizes.length} sizes — kept "${entries[0].label}". Check the merchant's default_stock_class.`,
      )
    }
    if (entries.length) {
      const offsets = await loadBrandOffsets([(item as any).brand_id].filter(Boolean))
      await upsertSizeAvailability(itemId, entries, {
        itemType: (item as any).item_type,
        brandOffsets: offsets.get((item as any).brand_id) ?? null,
      })
      sizesWritten = entries.length
    }
    await (admin.from('item') as any)
      .update({
        stock_status: checked.status,
        stock_checked_at: new Date().toISOString(),
        stock_signal: `intake:${checked.source}`,
        stock_sizes: entries.filter((s) => s.inStock).map((s) => s.label),
      })
      .eq('item_id', itemId)
  }

  return { itemId, stockClass, sizesWritten }
}

/**
 * The full second-hand intake: classify, then get it styled and shoppable fast.
 *
 * Safe to call on a retail item — it classifies and returns without queuing
 * anything, so callers don't need to know what they're holding.
 */
export async function onItemApproved(itemId: string): Promise<IntakeResult> {
  const result = await classifyOnIntake(itemId)
  if (result.error) return result

  const admin = createAdminClient()
  const { data: item } = await admin
    .from('item' as any)
    .select('item_id, stock_class, merchant(source_type), brand(source_type)')
    .eq('item_id', itemId)
    .maybeSingle()
  if (!item) return result
  if (!isUnique(item as any) && !isSecondHand(item as any)) return result

  try {
    // Imported lazily: set-actions is a 'use server' module with a heavy import
    // graph, and most intakes are ordinary retail that never needs it.
    const { composeStylingSet } = await import('@/app/admin/pipeline/set-actions')
    const res = await composeStylingSet(itemId)
    if (res.error) return { ...result, composed: 0, error: res.error }
    await writeAudit({
      action: 'second_hand_fast_compose', entity: 'item', entityId: itemId,
      trigger: 'cron', after: { staged: res.staged, stockClass: result.stockClass },
    })
    return { ...result, composed: res.staged }
  } catch (err) {
    return { ...result, composed: 0, error: err instanceof Error ? err.message : 'Compose failed' }
  }
}

/** Batch form, for the ingest queue. Sequential — the composer is not cheap. */
export async function onItemsApproved(itemIds: string[]): Promise<IntakeResult[]> {
  const out: IntakeResult[] = []
  for (const id of itemIds) out.push(await onItemApproved(id))
  return out
}
