// ── Risk-tiered stock polling ────────────────────────────────────────────────
//
// A uniform cadence is wrong in both directions: too slow for the piece someone
// is waiting on in her size, and a pointless burst on a retailer for the piece
// nobody has looked at. So the sweep is scheduled by what a stale answer would
// COST, and the cost is dominated by one thing — a saver whose size it is.
//
//   Tier A  saved by 1+ users in their size, or clicked in the last 24h   30 min
//   Tier B  live in outfits, no engagement                                 3 h
//   Tier C  no live outfit                                                 daily
//
// FEED FIRST, though: this is the fallback. Where a merchant gives us a product
// feed or a webhook (see sprl-feed.ts) that is the source of truth, and polling
// only covers what the feed doesn't reach.

import 'server-only'
import { createAdminClient } from '@/lib/supabase-server'
import { sizeCategoryFor } from '@/lib/size-canonical'
import { pollTier, riskScore, nextCheckAt, type PollTier, type RiskInputs, type StockClass } from '@/lib/second-hand'

export interface ItemRisk extends RiskInputs {
  itemId: string
  tier: PollTier
  score: number
}

const DAY = 86_400_000

/**
 * Score a batch of items. One query per signal rather than per item — the sweep
 * runs over the whole live catalogue and N+1 here would dominate its budget.
 */
export async function computeRisk(
  items: { item_id: string; item_type?: string | null; stock_class?: string | null; live_since?: string | null }[],
): Promise<Map<string, ItemRisk>> {
  const out = new Map<string, ItemRisk>()
  if (!items.length) return out
  const admin = createAdminClient()
  const ids = items.map((i) => i.item_id)
  const now = Date.now()

  const [subsRes, clicksRes, liveRes] = await Promise.all([
    admin
      .from('stock_subscription' as any)
      .select('item_id, watch_category, watch_values')
      .in('item_id', ids)
      .eq('active', true),
    admin
      .from('item_click' as any)
      .select('item_id, clicked_at')
      .in('item_id', ids)
      .gte('clicked_at', new Date(now - 2 * DAY).toISOString()),
    admin
      .from('outfit_item' as any)
      .select('item_id, outfit!inner(status)')
      .in('item_id', ids)
      .eq('outfit.status', 'live'),
  ])

  const inSize = new Map<string, number>()
  const otherSize = new Map<string, number>()
  for (const s of ((subsRes.data ?? []) as any[])) {
    const watching = Array.isArray(s.watch_values) && s.watch_values.length > 0
    const map = watching ? inSize : otherSize
    map.set(s.item_id, (map.get(s.item_id) ?? 0) + 1)
  }

  const c48 = new Map<string, number>()
  const c24 = new Map<string, number>()
  for (const c of ((clicksRes.data ?? []) as any[])) {
    c48.set(c.item_id, (c48.get(c.item_id) ?? 0) + 1)
    if (now - new Date(c.clicked_at).getTime() <= DAY) c24.set(c.item_id, (c24.get(c.item_id) ?? 0) + 1)
  }

  const live = new Set(((liveRes.data ?? []) as any[]).map((r) => r.item_id))

  for (const item of items) {
    const stockClass: StockClass = item.stock_class === 'unique' ? 'unique' : 'replenishable'
    const daysLive = item.live_since ? (now - new Date(item.live_since).getTime()) / DAY : 0
    const inputs: RiskInputs = {
      saversInSize: inSize.get(item.item_id) ?? 0,
      saversOtherSize: otherSize.get(item.item_id) ?? 0,
      clickOuts48h: c48.get(item.item_id) ?? 0,
      clickOuts24h: c24.get(item.item_id) ?? 0,
      daysLive,
      inLiveOutfit: live.has(item.item_id),
      stockClass,
    }
    out.set(item.item_id, { itemId: item.item_id, ...inputs, tier: pollTier(inputs), score: riskScore(inputs) })
  }

  // The category is only needed to interpret the watch values; keeping the call
  // here documents that "in her size" is what the tier turns on.
  void sizeCategoryFor
  return out
}

/**
 * Recompute tier / risk / next_check_at across the catalogue. Cheap enough to
 * run at the head of every sweep, which keeps the schedule honest as saves and
 * click-outs arrive.
 *
 * SOLD items are skipped entirely: they have no next check, ever.
 */
export async function refreshPollSchedule(limit = 2000): Promise<{ scored: number; byTier: Record<PollTier, number> }> {
  const admin = createAdminClient()
  const { data } = await admin
    .from('item' as any)
    .select('item_id, item_type, stock_class, live_since, next_check_at')
    .not('status', 'in', '("archived","sold")')
    .not('retailer_url', 'is', null)
    .neq('retailer_url', '')
    .limit(limit)

  const items = (data ?? []) as any[]
  const risks = await computeRisk(items)
  const byTier: Record<PollTier, number> = { A: 0, B: 0, C: 0 }
  const now = Date.now()

  for (const item of items) {
    const r = risks.get(item.item_id)
    if (!r) continue
    byTier[r.tier]++
    const patch: Record<string, unknown> = {
      poll_tier: r.tier,
      risk_score: Number(r.score.toFixed(4)),
    }
    // Only pull a check FORWARD. Pushing next_check_at back on every refresh
    // would let a piece that keeps getting re-scored never actually be checked.
    const due = nextCheckAt(r.tier, now).toISOString()
    if (!item.next_check_at || item.next_check_at > due) patch.next_check_at = due
    await (admin.from('item') as any).update(patch).eq('item_id', item.item_id)
  }
  return { scored: items.length, byTier }
}

export interface DueItem {
  item_id: string
  product_name: string
  retailer_url: string
  item_type: string | null
  brand_id: string | null
  merchant_id: string | null
  status: string
  stock_class: StockClass
  stock_status: string | null
  oos_strikes: number
  oos_since: string | null
  status_before_oos: string | null
  image_url: string | null
  poll_tier: PollTier | null
  risk_score: number | null
  live_since: string | null
}

/**
 * Items due a check, highest risk first — then STAGGERED so we never fire a run
 * of consecutive requests at the same retailer. The list is round-robined by
 * host, which spreads one merchant's items across the whole pass instead of
 * hammering them in a block.
 */
export async function selectDueItems(limit: number): Promise<DueItem[]> {
  const admin = createAdminClient()
  const nowIso = new Date().toISOString()
  const { data } = await admin
    .from('item' as any)
    .select('item_id, product_name, retailer_url, item_type, brand_id, merchant_id, status, stock_class, stock_status, oos_strikes, oos_since, status_before_oos, image_url, poll_tier, risk_score, live_since, next_check_at')
    .not('status', 'in', '("archived","sold")')
    .not('retailer_url', 'is', null)
    .neq('retailer_url', '')
    .or(`next_check_at.is.null,next_check_at.lte.${nowIso}`)
    .order('risk_score', { ascending: false, nullsFirst: false })
    .limit(limit * 3)

  const rows = ((data ?? []) as any[]).map((r) => ({
    ...r,
    stock_class: (r.stock_class === 'unique' ? 'unique' : 'replenishable') as StockClass,
    oos_strikes: r.oos_strikes ?? 0,
  })) as DueItem[]

  return staggerByHost(rows).slice(0, limit)
}

/** Round-robin across hosts so no retailer sees a burst. */
export function staggerByHost<T extends { retailer_url: string }>(rows: T[]): T[] {
  const byHost = new Map<string, T[]>()
  for (const r of rows) {
    let host = 'unknown'
    try { host = new URL(r.retailer_url).host } catch { /* keep 'unknown' */ }
    const list = byHost.get(host) ?? []
    list.push(r)
    byHost.set(host, list)
  }
  const queues = Array.from(byHost.values())
  const out: T[] = []
  let drained = false
  while (!drained) {
    drained = true
    for (const q of queues) {
      const next = q.shift()
      if (next) { out.push(next); drained = false }
    }
  }
  return out
}

/** Minimum gap between two requests to the SAME host, in ms. */
export const HOST_COOLDOWN_MS = 1500

/** Simple per-host throttle for a sequential sweep. */
export class HostThrottle {
  private last = new Map<string, number>()

  async wait(url: string): Promise<void> {
    let host = 'unknown'
    try { host = new URL(url).host } catch { /* keep 'unknown' */ }
    const prev = this.last.get(host)
    const now = Date.now()
    if (prev != null && now - prev < HOST_COOLDOWN_MS) {
      await new Promise((r) => setTimeout(r, HOST_COOLDOWN_MS - (now - prev)))
    }
    this.last.set(host, Date.now())
  }
}

/** Push an item's next check out by its tier — call after every check. */
export async function scheduleNextCheck(itemId: string, tier: PollTier | null): Promise<void> {
  const admin = createAdminClient()
  await (admin.from('item') as any)
    .update({ next_check_at: nextCheckAt(tier ?? 'C', Date.now()).toISOString() })
    .eq('item_id', itemId)
}
