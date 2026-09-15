// Keeping a Brand Watch piece — shared by the queue buttons and by AUTOMATE.
//
// Keep: the queue row becomes a real library item (ready — the scored 1–5
// dimensions still need a pass). Skip: the row stays in the queue table as a
// skipped decision — it never enters the item library and never resurfaces.
// Moved out of the server-actions file so the Monday scan can keep pieces too.

import { houseBanOf } from '@/lib/brand-watch-bans'
import { recordStyleDecision } from '@/lib/style-brain-store'

export async function keepQueueRows(admin: any, queueIds: string[], opts: { auto?: boolean } = {}): Promise<number> {
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
      if (!q.item_type) {
        // Left in the queue rather than kept as the wrong thing — the type can
        // be set by hand and it can be kept again.
        skippedUntyped.push(q.product_name)
        continue
      }
      const { data: item, error: ierr } = await admin
        .from('item')
        .insert([{
          brand_id: q.brand_id,
          // NEVER default. item_type is a NOT NULL enum, so an untyped piece
          // used to be silently filed as a blouse — which is how a swimsuit
          // and a bikini top ended up composed as tops in a client's outfits.
          item_type: q.item_type,
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
          stock_status: q.stock_status,
          stock_sizes: q.stock_sizes,
          stock_checked_at: new Date().toISOString(),
          available: q.stock_status !== 'out_of_stock',
          status: 'ready',
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
