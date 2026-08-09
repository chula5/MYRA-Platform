// Stock Sentinel — every 12 hours, checks availability of every LIVE item that
// appears in at least one live outfit, via its retailer product URL (reusing
// the existing stock-check detection: Shopify variants → JSON-LD → text
// markers). A failed fetch is 'unknown', never 'dead' — an item is only marked
// out_of_stock after 2 consecutive OOS-indicating checks.
//
// When an item goes down:
//   1. item → out_of_stock (distinct from archived; original status remembered)
//   2. every live outfit containing it → paused (off the feed instantly)
//   3. replacement candidates ranked by item-vector cosine, filtered by the
//      same ejection/skip-combination/stock rules as the mobile swap sheet
//   4. confidence routing — like-for-like top candidate (same type, same
//      colour family, same/adjacent tier, similarity ≥ threshold) is swapped
//      in automatically, the outfit vector recomputed, and the MANDATORY
//      Higgsfield re-render queued (the outfit republishes only when the
//      render lands). Anything less keeps the outfit paused and sends it to
//      the review queue as a "restock" card with the dead item greyed out.
//
// Restock: out_of_stock items keep being checked for 30 days. Back in stock →
// flagged in the next stock email with a one-tap restore. 30 days dead →
// archived automatically. Everything lands in the audit log.

import 'server-only'
import { createAdminClient } from '@/lib/supabase-server'
import { checkStockForUrl } from '@/app/admin/items/stock-check'
import { getOutfit, getReadyAndLiveItems, type ItemWithBrand } from '@/lib/admin-queries'
import { getSwapCandidates, qualifiesForAutoSwap, type SwapCandidate } from './swap-candidates'
import { loadStyleGuards } from './guards'
import { recomputeOutfit, outfitEntries } from './outfit-recompute'
import { enqueueRender } from './render-queue'
import { writeAudit } from './audit'

const OOS_STRIKES_REQUIRED = 2
const ARCHIVE_AFTER_DAYS = 30

export interface AutoSwapReport {
  outfitId: string
  outfitLabel: string
  slot: string
  outItem: { id: string; name: string; image: string | null }
  inItem: { id: string; name: string; image: string | null }
  similarity: number
  undoToken: string
}

export interface NeedsPickReport {
  outfitId: string
  outfitLabel: string
  deadItem: { id: string; name: string }
  candidates: { id: string; name: string; brand: string | null; similarity: number }[]
}

export interface SentinelReport {
  itemsChecked: number
  itemsDown: { id: string; name: string }[]
  outfitsPaused: number
  autoSwapped: AutoSwapReport[]
  needsPick: NeedsPickReport[]
  backInStock: { id: string; name: string; restoreToken: string | null }[]
  archived: number
}

// Supabase caps a single response at 1000 rows, so both queries below MUST be
// paged: a truncated link list would silently exclude items from the sweep
// permanently (they'd look like they aren't in any live outfit), leaving a
// blind spot no number of re-runs could clear.
async function fetchAllPages<T = any>(
  buildPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: any }>,
  hardCap = 100_000,
): Promise<T[]> {
  const PAGE = 1000
  const all: T[] = []
  for (let from = 0; from < hardCap; from += PAGE) {
    const { data, error } = await buildPage(from, from + PAGE - 1)
    if (error) {
      console.error('[stock-sentinel] page fetch failed', error)
      break
    }
    const rows = data ?? []
    all.push(...rows)
    if (rows.length < PAGE) break
  }
  return all
}

// Items to check this run: LIVE items in ≥1 live outfit, plus every
// out_of_stock item still inside its 30-day restock window. Stalest first.
async function listItemsToCheck(maxItems: number): Promise<any[]> {
  const admin = createAdminClient()

  const liveLinks = await fetchAllPages<{ item_id: string }>((from, to) =>
    admin
      .from('outfit_item' as any)
      .select('item_id, outfit!inner(status)')
      .eq('outfit.status', 'live')
      .range(from, to) as any,
  )
  const liveItemIds = new Set(liveLinks.map((r) => r.item_id))

  const items = await fetchAllPages<any>((from, to) =>
    admin
      .from('item' as any)
      .select('item_id, product_name, retailer_url, status, stock_status, stock_checked_at, oos_strikes, oos_since, status_before_oos, image_url')
      .in('status', ['live', 'out_of_stock'])
      .not('retailer_url', 'is', null)
      .neq('retailer_url', '')
      .order('stock_checked_at', { ascending: true, nullsFirst: true })
      .order('item_id', { ascending: true }) // stable tiebreak so paging can't repeat/skip rows
      .range(from, to) as any,
  )

  return items
    .filter((it) => it.status === 'out_of_stock' || liveItemIds.has(it.item_id))
    .slice(0, maxItems)
}

export async function runStockSentinel(
  opts: { maxItems?: number; budgetMs?: number } = {},
): Promise<SentinelReport> {
  const { maxItems = 80, budgetMs = 220_000 } = opts
  const startedAt = Date.now()
  const admin = createAdminClient()

  const report: SentinelReport = {
    itemsChecked: 0, itemsDown: [], outfitsPaused: 0,
    autoSwapped: [], needsPick: [], backInStock: [], archived: 0,
  }

  const items = await listItemsToCheck(maxItems)
  // Guards + library loaded ONCE for the whole cycle.
  const guards = await loadStyleGuards()
  const library = await getReadyAndLiveItems()

  for (const item of items) {
    if (Date.now() - startedAt > budgetMs) break
    report.itemsChecked++

    const { status: checked } = await checkStockForUrl(item.retailer_url)
    const now = new Date().toISOString()

    if (checked === 'unknown') {
      // Failed fetch — retailer downtime is not a strike, just note the check.
      await (admin.from('item') as any)
        .update({ stock_checked_at: now, stock_signal: 'sentinel:unknown' })
        .eq('item_id', item.item_id)
      continue
    }

    if (checked === 'in_stock' || checked === 'low_stock') {
      const wasOOS = item.status === 'out_of_stock'
      await (admin.from('item') as any)
        .update({
          stock_status: checked,
          stock_checked_at: now,
          stock_signal: `sentinel:${checked}`,
          oos_strikes: 0,
          ...(wasOOS
            ? { status: item.status_before_oos ?? 'live', oos_since: null, status_before_oos: null }
            : {}),
        })
        .eq('item_id', item.item_id)

      if (wasOOS) {
        // Back in stock — offer a one-tap restore of the most recent
        // not-yet-undone swap that replaced this item.
        const { data: swaps } = await admin
          .from('stock_swap' as any)
          .select('undo_token')
          .eq('out_item_id', item.item_id)
          .eq('undone', false)
          .order('created_at', { ascending: false })
          .limit(1)
        report.backInStock.push({
          id: item.item_id,
          name: item.product_name,
          restoreToken: ((swaps ?? []) as any[])[0]?.undo_token ?? null,
        })
        await writeAudit({
          action: 'back_in_stock', entity: 'item', entityId: item.item_id,
          trigger: 'stock_sentinel', before: { status: 'out_of_stock' }, after: { status: item.status_before_oos ?? 'live' },
        })
      }
      continue
    }

    // checked === 'out_of_stock' — a strike.
    const strikes = (item.oos_strikes ?? 0) + 1
    if (item.status === 'out_of_stock' || strikes < OOS_STRIKES_REQUIRED) {
      await (admin.from('item') as any)
        .update({ stock_status: 'out_of_stock', stock_checked_at: now, stock_signal: 'sentinel:oos', oos_strikes: strikes })
        .eq('item_id', item.item_id)
      continue
    }

    // Two consecutive strikes — the item is genuinely down.
    await (admin.from('item') as any)
      .update({
        status: 'out_of_stock',
        status_before_oos: item.status,
        oos_since: now,
        stock_status: 'out_of_stock',
        stock_checked_at: now,
        stock_signal: 'sentinel:oos-confirmed',
        oos_strikes: strikes,
      })
      .eq('item_id', item.item_id)
    report.itemsDown.push({ id: item.item_id, name: item.product_name })
    await writeAudit({
      action: 'oos_detected', entity: 'item', entityId: item.item_id,
      trigger: 'stock_sentinel', before: { status: item.status }, after: { status: 'out_of_stock' },
    })

    await handleItemDown(item.item_id, item.product_name, guards, library, report)
  }

  // 30 days dead → archived automatically.
  const cutoff = new Date(Date.now() - ARCHIVE_AFTER_DAYS * 86_400_000).toISOString()
  const { data: archivedRows } = await (admin.from('item') as any)
    .update({ status: 'archived' })
    .eq('status', 'out_of_stock')
    .lt('oos_since', cutoff)
    .select('item_id')
  report.archived = ((archivedRows ?? []) as any[]).length
  for (const row of (archivedRows ?? []) as any[]) {
    await writeAudit({
      action: 'archive', entity: 'item', entityId: row.item_id,
      trigger: 'stock_sentinel', before: { status: 'out_of_stock' }, after: { status: 'archived', reason: '30_days_out_of_stock' },
    })
  }

  return report
}

// An item is confirmed down: pause its live outfits, then route each one —
// auto-swap when the top candidate is like-for-like, otherwise leave paused
// for the review queue's restock card.
async function handleItemDown(
  itemId: string,
  itemName: string,
  guards: Awaited<ReturnType<typeof loadStyleGuards>>,
  library: ItemWithBrand[],
  report: SentinelReport,
): Promise<void> {
  const admin = createAdminClient()

  const { data: links } = await admin
    .from('outfit_item' as any)
    .select('outfit_id, outfit!inner(status)')
    .eq('item_id', itemId)
    .eq('outfit.status', 'live')
  const outfitIds = Array.from(new Set(((links ?? []) as any[]).map((r) => r.outfit_id)))

  for (const outfitId of outfitIds) {
    // 1. Pause — off the front-end feed immediately, all data kept.
    await (admin.from('outfit') as any)
      .update({ status: 'paused', paused_reason: `item_out_of_stock:${itemId}` })
      .eq('outfit_id', outfitId)
      .eq('status', 'live')
    report.outfitsPaused++
    await writeAudit({
      action: 'pause', entity: 'outfit', entityId: outfitId,
      trigger: 'stock_sentinel', before: { status: 'live' }, after: { status: 'paused', deadItem: itemId },
    })

    const outfit = await getOutfit(outfitId)
    if (!outfit) continue
    const entries = outfitEntries(outfit)
    const deadEntry = entries.find((e) => e.item.item_id === itemId)
    if (!deadEntry) continue
    const remaining = entries.filter((e) => e.item.item_id !== itemId).map((e) => e.item)
    const anchorItemId = entries[0]?.item.item_id ?? null

    // 2. Replacement candidates — same rules as the mobile swap sheet.
    const candidates = await getSwapCandidates({
      outgoing: deadEntry.item, remaining, anchorItemId, limit: 3, guards, library,
    })
    const top: SwapCandidate | undefined = candidates[0]

    if (qualifiesForAutoSwap(top)) {
      // 3a. AUTO-SWAP — the outfit already carries Chloe's approval; the
      // mandatory re-render keeps the hero honest to the items.
      await (admin.from('outfit_item') as any)
        .update({ item_id: top.item.item_id })
        .eq('outfit_item_id', deadEntry.outfit_item_id)

      const { data: swapRow } = await (admin.from('stock_swap') as any)
        .insert({
          outfit_id: outfitId,
          slot: deadEntry.slot,
          out_item_id: itemId,
          in_item_id: top.item.item_id,
          similarity: top.similarity,
          mode: 'auto',
        })
        .select('undo_token')
        .single()

      await recomputeOutfit(outfitId)
      await writeAudit({
        action: 'auto_swap', entity: 'outfit', entityId: outfitId,
        trigger: 'stock_sentinel',
        before: { item: itemId }, after: { item: top.item.item_id, similarity: top.similarity },
      })
      await enqueueRender(outfitId, 'stock_swap')

      report.autoSwapped.push({
        outfitId,
        outfitLabel: (outfit as any).aesthetic_label ?? 'Untitled',
        slot: deadEntry.slot,
        outItem: { id: itemId, name: itemName, image: deadEntry.item.image_url ?? null },
        inItem: { id: top.item.item_id, name: top.item.product_name, image: top.item.image_url ?? null },
        similarity: top.similarity,
        undoToken: (swapRow as any)?.undo_token ?? '',
      })
    } else {
      // 3b. NEEDS ME — stays paused; restock card in the review queue with the
      // dead item greyed out.
      await recomputeOutfit(outfitId, { dimItemId: itemId })
      report.needsPick.push({
        outfitId,
        outfitLabel: (outfit as any).aesthetic_label ?? 'Untitled',
        deadItem: { id: itemId, name: itemName },
        candidates: candidates.map((c) => ({
          id: c.item.item_id,
          name: c.item.product_name,
          brand: c.item.brand?.name ?? null,
          similarity: c.similarity,
        })),
      })
    }
  }
}
