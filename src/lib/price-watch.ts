// WAIT FOR SALE — a bell on a saved piece; MYRA tells her when the price drops.
//
// Chloe asked (2026-11-01): save pieces to wait for them to go on sale, and be
// told when the price changes. She rings the bell on a piece in her Saved
// shelf (member_saved_item.price_watch); the price that day is frozen
// (price_at_watch). Every reading of the piece's price — the stock sentinel's
// page read, which polls a watched piece every 30 minutes, and a Shopify sync —
// goes through recordPrice: history kept when it changes, and a drop of at
// least 5% and £3 under both what it cost when she rang and the lowest she has
// already been told of sends a note and a push AT ONCE. Sales sell out.
//
// A price in another currency is turned into pounds at the piece's own stored
// rate (price_gbp / price), so a drop is a drop whatever the shop's currency.
// A reading with no currency, on a piece with none either, is never turned
// into pounds — a $248 piece must not become £248.
//
// Plain module: the sentinel, the Shopify sync and her actions call it.

import 'server-only'
import { notifyMember } from '@/lib/push/notify'
import type { PriceReading } from '@/lib/retailer-prices'
import { toGbpAmount } from '@/lib/currency'

const DROP_SHARE = 0.05
const DROP_POUNDS = 3

const round = (x: number) => Math.round(x * 100) / 100

/** A reading in pounds, at the piece's own rate when the shop is not in pounds. */
export function poundsOf(reading: PriceReading, item: { price?: string | number | null; currency?: string | null; price_gbp?: number | string | null }): { now: number; was: number | null } | null {
  // No currency from the page or the piece: unpriced rather than wrong.
  const cur = reading.currency ?? item.currency ?? null
  if (!cur) return null
  if (cur.toUpperCase() === 'GBP') return { now: round(reading.amount), was: reading.was != null ? round(reading.was) : null }
  const shop = Number(item.price)
  const gbp = Number(item.price_gbp)
  // No stored rate for this currency (an unpriced piece): the page named its
  // currency, so the house rates (lib/currency) turn it into pounds.
  if (!(shop > 0) || !(gbp > 0) || String(item.currency ?? '').toUpperCase() !== cur.toUpperCase()) {
    if (!reading.currency) return null
    const now = toGbpAmount(reading.amount, cur)
    if (now == null) return null
    const was = reading.was != null ? toGbpAmount(reading.was, cur) : null
    return { now: round(now), was: was != null ? round(was) : null }
  }
  const rate = gbp / shop
  return { now: round(reading.amount * rate), was: reading.was != null ? round(reading.was * rate) : null }
}

/** Is `now` a sale worth telling her about, against what she has already seen? */
export function isDrop(now: number, base: number | null, lowest: number | null): boolean {
  const floor = Math.min(...[base, lowest].filter((x): x is number => x != null && x > 0))
  if (!Number.isFinite(floor)) return false
  return now <= floor * (1 - DROP_SHARE) && floor - now >= DROP_POUNDS
}

/**
 * Today's price for a piece. Keeps history when it moved, moves the piece's
 * own price, and tells every member waiting on it when it dropped. Returns how
 * many members were told.
 */
export async function recordPrice(admin: any, itemId: string, reading: PriceReading | null | undefined, source: string): Promise<number> {
  if (!reading || !(reading.amount > 0)) return 0
  const { data: item } = await admin.from('item')
    .select('item_id, product_name, price, currency, price_gbp, was_price_gbp, brand:brand_id(name)').eq('item_id', itemId).maybeSingle()
  if (!item) return 0
  const gbp = poundsOf(reading, item)
  if (!gbp) return 0

  const before = item.price_gbp != null ? Number(item.price_gbp) : null
  if (before == null || Math.abs(before - gbp.now) >= 0.01 || (gbp.was ?? null) !== (item.was_price_gbp != null ? Number(item.was_price_gbp) : null)) {
    await admin.from('item_price_history').insert({ item_id: itemId, price_gbp: gbp.now, was_price_gbp: gbp.was, source })
    await admin.from('item').update({ price_gbp: gbp.now, was_price_gbp: gbp.was }).eq('item_id', itemId)
  }
  return raisePriceDrops(admin, item, gbp.now)
}

async function raisePriceDrops(admin: any, item: any, now: number): Promise<number> {
  const { data: watchers } = await admin.from('member_saved_item')
    .select('member_id, price_at_watch, lowest_seen').eq('item_id', item.item_id).eq('price_watch', true)
  let told = 0
  for (const w of (watchers ?? []) as any[]) {
    const base = w.price_at_watch != null ? Number(w.price_at_watch) : null
    const lowest = w.lowest_seen != null ? Number(w.lowest_seen) : null
    if (!isDrop(now, base, lowest)) continue
    // Claimed before telling, so two readings in one sweep tell her once.
    const { data: claimed } = await admin.from('member_saved_item')
      .update({ lowest_seen: now, price_dropped_at: new Date().toISOString() })
      .eq('member_id', w.member_id).eq('item_id', item.item_id).eq('price_watch', true)
      .or(lowest != null ? `lowest_seen.is.null,lowest_seen.gt.${now}` : 'lowest_seen.is.null')
      .select('member_id')
    if (!claimed?.length) continue
    const was = Math.round(base ?? lowest ?? now)
    const name = [item.brand?.name, item.product_name].filter(Boolean).join(' ')
    await notifyMember(admin,
      { memberId: w.member_id, kind: 'price_drop', body: `${name} is now £${Math.round(now)} (was £${was}).` },
      { title: 'It’s gone on sale', url: '/me/dressing-room?tab=saved', collapseId: `price-${item.item_id}` })
    told++
  }
  return told
}
