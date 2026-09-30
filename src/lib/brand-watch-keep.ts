// Keeping a Brand Watch piece — shared by the queue buttons and by AUTOMATE.
//
// Keep: the queue row becomes a real library item (ready — the scored 1–5
// dimensions still need a pass). Skip: the row stays in the queue table as a
// skipped decision — it never enters the item library and never resurfaces.
// Moved out of the server-actions file so the Monday scan can keep pieces too.

import { houseBanOf } from '@/lib/brand-watch-bans'
import { typeFromStoredRow } from '@/lib/brand-watch'
import { classifyItemTypeFromImage } from '@/app/admin/ai/classify-item-type'
import { checkStockDetailed } from '@/app/admin/items/stock-check'
import { upsertSizeAvailability } from '@/lib/size-availability'
import { recordStyleDecision } from '@/lib/style-brain-store'

export interface KeepReport {
  /** Kept, but sold out right now — filed on the restock watch, not in the pool. */
  outOfStock: string[]
  lowStock: string[]
  /** Left in the queue: nothing in the row or the name says what kind of piece it is. */
  untyped: string[]
}

/**
 * Keep queued pieces into the library.
 *
 * The queue's stock is from scan day, which may be weeks ago. With `liveStock`
 * each piece is checked on the shop as it is kept: a sold-out piece is still
 * kept — she wants it — but goes in as status `out_of_stock`, which the stock
 * sentinel watches and restores to `ready` the moment it is back, and which the
 * composer never draws from. Sizes come back with the check and are written
 * as size rows, so "in her size" is right from the first day.
 */
/**
 * The type read from the picture, for a piece whose name says nothing. One
 * cheap call, only on the pieces that would otherwise be refused: AFLALO's
 * "Racquet String" bracelets are jewellery made from tennis string, and the
 * name is the only text those rows carry.
 */
async function typeFromImage(imageUrl: string | null | undefined): Promise<string | null> {
  if (!imageUrl) return null
  try {
    return (await classifyItemTypeFromImage(String(imageUrl))).itemType
  } catch { return null }
}

export async function keepQueueRows(
  admin: any, queueIds: string[], opts: { auto?: boolean; liveStock?: boolean; report?: KeepReport } = {},
): Promise<number> {
  let created = 0
  const skippedUntyped: string[] = []
  for (let i = 0; i < queueIds.length; i += 100) {
    const chunk = queueIds.slice(i, i + 100)
    const { data: rows, error } = await admin
      .from('brand_watch_queue')
      .select('*')
      .in('queue_id', chunk)
      .eq('status', 'queued')
    if (error) throw new Error(error.message)
    for (const q of rows ?? []) {
      // A house ban (fuchsia, performance sportswear) is never kept — it is
      // skipped, which also teaches the learning.
      const ban = houseBanOf({ title: q.product_name, materialPrimary: q.material_primary, itemType: q.item_type })
      if (ban) {
        await admin.from('brand_watch_queue')
          .update({ status: 'skipped', decided_at: new Date().toISOString() })
          .eq('queue_id', q.queue_id)
        console.warn(`[keepQueueRows] ${q.product_name}: not kept — ${ban}`)
        continue
      }
      // The scan writes the type it read on scan day. A shop that states no
      // product_type leaves the name as the only signal — AFLALO sends the
      // literal string "undefined" — so those rows arrive untyped, and an
      // untyped piece cannot be kept: ACCEPT did nothing at all and the piece
      // stayed in the queue for ever. Read the piece's own name first, with the
      // same rules the scan uses, and if the name says nothing either, read the
      // picture. Never a default: a piece that neither the name nor the image
      // can name stays put rather than being filed as the wrong thing.
      const itemType = q.item_type ?? typeFromStoredRow(q) ?? await typeFromImage(q.image_url)
      if (!itemType) {
        skippedUntyped.push(q.product_name)
        opts.report?.untyped.push(q.product_name)
        continue
      }
      // What the shop says today, not what it said on scan day.
      let stockStatus: string | null = q.stock_status ?? null
      let stockSizes: string[] | null = q.stock_sizes ?? null
      let sizeEntries: { label: string; inStock: boolean; level: 'in_stock' | 'sold_out' | 'low' | 'unknown' }[] = []
      let stockSignal = 'brand_watch:scan'
      if (opts.liveStock && q.retailer_url) {
        try {
          const live = await checkStockDetailed(q.retailer_url)
          if (live.status !== 'unknown') {
            stockStatus = live.status
            stockSignal = `keep:${live.source}`
            if (live.sizes.length) {
              sizeEntries = live.sizes
              stockSizes = live.sizes.filter((x) => x.inStock).map((x) => x.label)
            }
          }
        } catch { /* the scan-day reading stands */ }
      }
      const soldOut = stockStatus === 'out_of_stock'
      if (soldOut) opts.report?.outOfStock.push(q.product_name)
      else if (stockStatus === 'low_stock') opts.report?.lowStock.push(q.product_name)

      const { data: item, error: ierr } = await admin
        .from('item')
        .insert([{
          brand_id: q.brand_id,
          // NEVER default. item_type is a NOT NULL enum, so an untyped piece
          // used to be silently filed as a blouse — which is how a swimsuit
          // and a bikini top ended up composed as tops in a client's outfits.
          item_type: itemType,
          product_name: q.product_name,
          retailer_url: q.retailer_url,
          image_url: q.image_url,
          price: q.price,
          currency: q.currency,
          price_gbp: q.price_gbp,
          colour_family: q.colour_family,
          material_category: q.material_category,
          material_primary: q.material_primary,
          shopify_product_id: q.shopify_product_id,
          shopify_handle: q.shopify_handle,
          stock_status: stockStatus,
          stock_sizes: stockSizes,
          stock_checked_at: new Date().toISOString(),
          stock_signal: stockSignal,
          available: !soldOut,
          // Sold out today: kept, wanted, and on the restock watch. The sentinel
          // puts it back to `ready` when it returns; until then it is never composed.
          status: soldOut ? 'out_of_stock' : 'ready',
          ...(soldOut ? { status_before_oos: 'ready', oos_since: new Date().toISOString() } : {}),
          source: 'retailer_api',
          in_inventory: false,
          discovery_source: 'brand_watch',
          discovery_score: q.discovery_score,
          discovered_at: q.discovered_at,
          admin_notes: opts.auto ? `AUTO-KEPT by Brand Watch (trusted brand). ${q.admin_notes ?? ''}` : q.admin_notes,
        }])
        .select('item_id')
        .single()
      if (ierr) throw new Error(`item insert failed: ${ierr.message}`)
      if (sizeEntries.length) {
        try { await upsertSizeAvailability(item.item_id, sizeEntries, { itemType }) } catch { /* sizes are a bonus */ }
      }
      const decided = { status: 'kept', decided_at: new Date().toISOString(), item_id: item.item_id }
      // auto_kept arrives with migration 0056. The row MUST leave the queue
      // either way, or the piece would be kept again next scan.
      const { error: uerr } = await admin.from('brand_watch_queue')
        .update(opts.auto ? { ...decided, auto_kept: true } : decided).eq('queue_id', q.queue_id)
      if (uerr) await admin.from('brand_watch_queue').update(decided).eq('queue_id', q.queue_id)
      created++
      // What goes on the site teaches Chloe's Style Brain too — a single piece,
      // so at half the weight of a whole outfit decision. Her own keeps only:
      // the machine's keeps must not teach the machine.
      if (!opts.auto) await teachStyleBrain(q, 'approve', item.item_id)
    }
  }
  if (skippedUntyped.length) {
    console.warn('[keepQueueRows] left in the queue, no item type:', skippedUntyped.join(', '))
  }
  return created
}

export async function teachStyleBrain(q: any, decision: 'approve' | 'skip', itemId?: string): Promise<void> {
  try {
    await recordStyleDecision({
      items: [{
        item_type: q.item_type ?? null,
        colour_family: q.colour_family ?? null,
        pattern: null,
        material_formality: null,
        brand_name: q.brand?.name ?? null,
        price_tier: null,
      }],
      decision,
      source: 'brand_watch',
      itemIds: itemId ? [itemId] : [],
      weight: 0.5,
    })
  } catch (err) {
    console.error('[teachStyleBrain]', err)
  }
}
