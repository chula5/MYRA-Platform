// Stock Sentinel — the POLLING FALLBACK for availability.
//
// Feed and webhook come first (see second-hand-feed.ts): structured
// availability beats scraping, and a webhook is an instant sold-signal. This
// sweep covers everything those don't reach, and it is RISK-TIERED rather than
// uniform (see risk-tier.ts):
//
//   Tier A  saved by 1+ users in their size, or clicked in the last 24h  30 min
//   Tier B  live in outfits, no engagement                                3 h
//   Tier C  no live outfit                                               daily
//
// Every check captures SIZE-LEVEL availability, not just an item-level verdict:
// a size selling out is a user-facing event ("sold out in your size"), and it
// happens long before the product page goes dark. Requests are staggered across
// hosts and throttled per host — a sweep must never burst a retailer.
//
// TWO CLASSES, TWO ENDINGS:
//
//   replenishable  2 consecutive OOS readings → status out_of_stock, live
//                  outfits PAUSED, auto-swap or review, 30-day restock watch,
//                  archived if it never returns.
//   unique         an EXPLICIT sold signal is acted on at once — no second
//                  confirmation, because waiting means leaving a look live that
//                  nobody can buy. Only ambiguous failures (timeout, 500) need
//                  a second reading. Then it is SOLD: outfits retired, saved
//                  outfits rescued, never re-checked, never restored.

import 'server-only'
import { createAdminClient } from '@/lib/supabase-server'
import { checkStockDetailed } from '@/app/admin/items/stock-check'
import { getOutfit, getReadyAndLiveItems, type ItemWithBrand } from '@/lib/admin-queries'
import { getSwapCandidates, qualifiesForAutoSwap, type SwapCandidate } from './swap-candidates'
import { loadStyleGuards } from './guards'
import { recomputeOutfit, outfitEntries } from './outfit-recompute'
import { enqueueRender } from './render-queue'
import { writeAudit } from './audit'
import {
  selectDueItems, refreshPollSchedule, scheduleNextCheck, computeRisk, HostThrottle,
  type DueItem,
} from './risk-tier'
import { upsertSizeAvailability, loadBrandOffsets } from '@/lib/size-availability'
import { raiseSizeAlerts } from '@/lib/stock-alerts'
import { markUniqueSold } from '@/lib/rescue'
import { actImmediately, classifySignal } from '@/lib/second-hand'

const OOS_STRIKES_REQUIRED = 2
const ARCHIVE_AFTER_DAYS = 30

// Circuit breaker. Pausing is the correct response to a dead item — a customer
// must never click through to a sold-out product — but this runs unattended on
// a cron, and a backlog (or a retailer-wide sale) can take down enough items to
// empty most of the feed in a single pass. Once this many outfits have been
// paused in one run, remaining down-items keep their strikes and are confirmed
// on the next run instead, so the catalogue drains gradually and every run
// reports what it deferred. Raise it if you'd rather it clear faster.
const MAX_PAUSES_PER_RUN = 25

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
  /** Confirmed-down items held back by the per-run pause cap; handled next run. */
  deferred: number
  /** One-of-one pieces confirmed sold this run, with what that retired/rescued. */
  uniqueSold: { id: string; name: string; outfitsRetired: number; rescuesCreated: number }[]
  /** Size-level alerts raised (her size low / gone / back). */
  sizeAlerts: number
}

export async function runStockSentinel(
  opts: { maxItems?: number; budgetMs?: number } = {},
): Promise<SentinelReport> {
  const { maxItems = 80, budgetMs = 220_000 } = opts
  const startedAt = Date.now()
  const admin = createAdminClient()

  const report: SentinelReport = {
    itemsChecked: 0, itemsDown: [], outfitsPaused: 0,
    autoSwapped: [], needsPick: [], backInStock: [], archived: 0, deferred: 0,
    uniqueSold: [], sizeAlerts: 0,
  }

  // Re-tier before selecting: saves and click-outs since the last run are
  // exactly what should move a piece into the 30-minute lane.
  await refreshPollSchedule()

  const items = await selectDueItems(maxItems)
  // Guards + library loaded ONCE for the whole cycle.
  const guards = await loadStyleGuards()
  const library = await getReadyAndLiveItems()
  const offsets = await loadBrandOffsets(items.map((i) => i.brand_id).filter(Boolean) as string[])
  const risks = await computeRisk(items)
  const throttle = new HostThrottle()

  for (const item of items) {
    if (Date.now() - startedAt > budgetMs) break
    report.itemsChecked++

    await throttle.wait(item.retailer_url)
    const checked = await checkStockDetailed(item.retailer_url)
    const now = new Date().toISOString()
    const signalKind = classifySignal(checked.source)

    // ── SIZE-LEVEL AVAILABILITY, captured on every check ──
    if (checked.sizes.length) {
      const { previous, changed } = await upsertSizeAvailability(item.item_id, checked.sizes, {
        itemType: item.item_type,
        brandOffsets: item.brand_id ? offsets.get(item.brand_id) ?? null : null,
      })
      report.sizeAlerts += await raiseSizeAlerts({
        itemId: item.item_id,
        before: previous,
        after: changed,
        stockClass: item.stock_class,
        risk: risks.get(item.item_id),
      })
    }

    await scheduleNextCheck(item.item_id, item.poll_tier)

    if (checked.status === 'unknown') {
      // Failed fetch — retailer downtime is not a strike, just note the check.
      await (admin.from('item') as any)
        .update({ stock_checked_at: now, stock_signal: 'sentinel:unknown' })
        .eq('item_id', item.item_id)
      continue
    }

    if (checked.status === 'in_stock' || checked.status === 'low_stock') {
      await handleBackUp(item, checked.status, now, report)
      continue
    }

    // ── out_of_stock ──
    // A one-of-one with an EXPLICIT sold signal is acted on immediately: no
    // second confirmation, no strike accounting, no restock watch.
    if (actImmediately(item.stock_class, signalKind)) {
      const sold = await markUniqueSold(item.item_id, 'poll')
      report.uniqueSold.push({
        id: item.item_id, name: item.product_name,
        outfitsRetired: sold.outfitsRetired, rescuesCreated: sold.rescuesCreated,
      })
      continue
    }

    const strikes = (item.oos_strikes ?? 0) + 1
    if (item.status === 'out_of_stock' || strikes < OOS_STRIKES_REQUIRED) {
      await (admin.from('item') as any)
        .update({ stock_status: 'out_of_stock', stock_checked_at: now, stock_signal: 'sentinel:oos', oos_strikes: strikes })
        .eq('item_id', item.item_id)
      continue
    }

    // Confirmed down on a second reading. A unique piece confirmed twice is
    // sold — the second reading is what an ambiguous signal needed.
    if (item.stock_class === 'unique') {
      const sold = await markUniqueSold(item.item_id, 'poll')
      report.uniqueSold.push({
        id: item.item_id, name: item.product_name,
        outfitsRetired: sold.outfitsRetired, rescuesCreated: sold.rescuesCreated,
      })
      continue
    }

    // Replenishable, confirmed down — unless the pause budget for this run is
    // spent: bank the strike and confirm it next run, so a big backlog can't
    // empty the feed in one pass.
    if (report.outfitsPaused >= MAX_PAUSES_PER_RUN) {
      await (admin.from('item') as any)
        .update({ stock_status: 'out_of_stock', stock_checked_at: now, stock_signal: 'sentinel:oos-deferred', oos_strikes: strikes })
        .eq('item_id', item.item_id)
      report.deferred++
      continue
    }

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

  // 30 days dead → archived automatically. SOLD items are excluded by the
  // status filter: they were never on the restock watch to begin with.
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

/** In stock again (or still). Restores a replenishable item; never a sold one. */
async function handleBackUp(
  item: DueItem,
  status: 'in_stock' | 'low_stock',
  now: string,
  report: SentinelReport,
): Promise<void> {
  const admin = createAdminClient()
  const wasOOS = item.status === 'out_of_stock'
  await (admin.from('item') as any)
    .update({
      stock_status: status,
      stock_checked_at: now,
      stock_signal: `sentinel:${status}`,
      oos_strikes: 0,
      ...(wasOOS
        ? { status: item.status_before_oos ?? 'live', oos_since: null, status_before_oos: null }
        : {}),
    })
    .eq('item_id', item.item_id)

  if (!wasOOS) return

  // Back in stock — offer a one-tap restore of the most recent not-yet-undone
  // swap that replaced this item.
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

// A REPLENISHABLE item is confirmed down: pause its live outfits, then route
// each one — auto-swap when the top candidate is like-for-like, otherwise leave
// paused for the review queue's restock card. Unique items never reach here;
// they retire rather than pause, because they cannot come back.
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
