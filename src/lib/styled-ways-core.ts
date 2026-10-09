// WAYS TO WEAR IT — the pure part: no database, no session, unit-tested.
//
// A "way" is one look MYRA built around one hero piece for one member and
// judged before anyone saw it. The server module (lib/styled-ways) keeps
// them; this file decides their shape, their order and when one is dead.

import type { LookItem } from '@/lib/pilot-stylist'

/** How many ways a piece is shown in. */
export const WAYS = 3
/** Warm-up jobs a member may queue in a day before MYRA waits for a tap instead. */
export const WARMUP_CAP_DEFAULT = 40
/** What one judged look costs (the look check's own estimate: ~2p a look). */
export const COST_PER_JUDGED_LOOK_GBP = 0.02

export type WayMode = 'blend' | 'wardrobe' | 'inspiration'
export type WaySource = 'tap' | 'warmup' | 'mcp' | 'mirror'
export type WayVerdict = 'works' | 'borderline'

export interface StyledWayRow {
  styled_way_id: string
  member_id: string
  hero_item_id: string
  mode: WayMode
  items: LookItem[]
  item_ids: string[]
  items_signature: string
  verdict: WayVerdict
  confidence: number | null
  why: string
  occasion_id: string | null
  occasion_label: string | null
  source: WaySource
  judged_at: string
  stale: boolean
}

/** The look as every member surface draws it (ComposedLookCard / BuiltOutfit). */
export interface StyledWayLook {
  styled_way_id: string
  look_id: null
  image_url: null
  items: LookItem[]
  why: string
  verdict: WayVerdict
  occasion_id?: string | null
  occasion_label?: string | null
  judged_at: string
}

export const idsOf = (items: { item_id?: string | null }[]): string[] =>
  Array.from(new Set(items.map((i) => i.item_id).filter((id): id is string => !!id)))

/** Sorted item ids joined with '|': the same look is the same row, whatever order it came in. */
export const signatureOf = (items: { item_id?: string | null }[]): string => idsOf(items).sort().join('|')

export interface StockFact {
  stock_status?: string | null
  status?: string | null
}

/**
 * Which kept ways can still be shown. A retail piece that has sold out, gone
 * unreadable, been archived or deleted kills the look it is in; her own
 * pieces never do (she owns them). Returns what to keep and what to retire.
 */
export function sellableWays<T extends { item_ids: string[]; items: { item_id?: string | null; owned?: boolean }[] }>(
  rows: T[],
  stock: Map<string, StockFact>,
): { keep: T[]; dead: { row: T; itemId: string; reason: string }[] } {
  const keep: T[] = []
  const dead: { row: T; itemId: string; reason: string }[] = []
  for (const row of rows) {
    const owned = new Set(row.items.filter((i) => i.owned && i.item_id).map((i) => i.item_id as string))
    let killer: { itemId: string; reason: string } | null = null
    for (const id of row.item_ids) {
      if (owned.has(id)) continue
      const fact = stock.get(id)
      if (!fact) { killer = { itemId: id, reason: 'missing' }; break }
      if (fact.stock_status === 'out_of_stock' || fact.stock_status === 'unknown') { killer = { itemId: id, reason: fact.stock_status }; break }
      if (fact.status === 'archived' || fact.status === 'out_of_stock' || fact.status === 'sold') { killer = { itemId: id, reason: fact.status }; break }
    }
    if (killer) dead.push({ row, ...killer })
    else keep.push(row)
  }
  return { keep, dead }
}

/** Best first: what MYRA's eye called "works" ahead of "borderline", newest within each. */
export function orderWays<T extends { verdict: WayVerdict; judged_at: string }>(rows: T[]): T[] {
  const rank = (v: WayVerdict) => (v === 'works' ? 0 : 1)
  return [...rows].sort((a, b) => rank(a.verdict) - rank(b.verdict) || b.judged_at.localeCompare(a.judged_at))
}

export function toStyledLook(row: StyledWayRow): StyledWayLook {
  return {
    styled_way_id: row.styled_way_id,
    look_id: null,
    image_url: null,
    items: row.items,
    why: row.why,
    verdict: row.verdict,
    occasion_id: row.occasion_id,
    occasion_label: row.occasion_label,
    judged_at: row.judged_at,
  }
}

/** A warm-up may be queued while the member is under her daily cap. */
export function warmupAllowed(queuedToday: number, cap: number = WARMUP_CAP_DEFAULT): boolean {
  return queuedToday < Math.max(0, cap)
}

export function judgedCost(judged: number): number {
  return Math.round(judged * COST_PER_JUDGED_LOOK_GBP * 100) / 100
}
