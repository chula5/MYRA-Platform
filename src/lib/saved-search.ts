// SAVED SEARCHES — MYRA keeps looking after she has gone.
//
// Chloe asked (2026-11-01): save a search for a pair of trousers in the
// morning, log back on in the evening, and there are options waiting. A saved
// search is her words (and the narrowing she had on), re-run every hour by
// api/cron/saved-searches through the same search Browse runs
// (lib/member-search), asking only for pieces that came into MYRA since the
// last run. Every new answer is kept as a saved_search_hit; the unseen ones are
// the N NEW on her chip, and opening the search marks them seen.
//
// New finds are quiet: a count when she comes back, and at most one note a day,
// in the evening, for all her searches together.
//
// Plain module: the cron and her actions both call it.

import 'server-only'
import { searchForMember, type BrowseFilters, type BrowsePiece } from '@/lib/member-search'

export const MAX_SEARCHES = 12
/** The evening note goes from this hour (UK time) on, once a day. */
export const NOTE_HOUR_UK = 17

export interface SavedSearchRow {
  saved_search_id: string
  member_id: string
  query: string
  filters: BrowseFilters | null
  label: string | null
  last_run_at: string
  last_seen_at: string
  last_pushed_at: string | null
  created_at: string
}

export interface SavedSearchView {
  id: string
  query: string
  label: string | null
  /** Pieces found since she last opened it. */
  fresh: number
  /** The newest pieces this search has found, newest first. */
  pieces: BrowsePiece[]
  created_at: string
}

const COLS = 'saved_search_id, member_id, query, filters, label, last_run_at, last_seen_at, last_pushed_at, created_at'
const PIECE = 'item_id, product_name, image_url, price_gbp, retailer_url, stock_status, brand:brand_id(name)'

/** One saved search, run for what came in since it last ran. Returns how many pieces were new to it. */
export async function runSavedSearch(admin: any, row: SavedSearchRow, now = new Date()): Promise<number> {
  const view = await searchForMember(admin, row.member_id, row.query, row.filters ?? {}, { since: row.last_run_at })
  const ids = view.pieces.map((p) => p.item_id)
  let added = 0
  if (ids.length) {
    // Already found (the same piece re-read by a scan) stays as it was — seen or not.
    const { data } = await admin.from('saved_search_hit').upsert(
      ids.map((item_id) => ({ saved_search_id: row.saved_search_id, item_id, found_at: now.toISOString() })),
      { onConflict: 'saved_search_id,item_id', ignoreDuplicates: true },
    ).select('item_id')
    added = (data ?? []).length
  }
  await admin.from('saved_search').update({ last_run_at: now.toISOString() }).eq('saved_search_id', row.saved_search_id)
  return added
}

/** Her saved searches, newest first, each with its unseen count and newest pieces. */
export async function savedSearchesFor(admin: any, memberId: string, perSearch = 8): Promise<SavedSearchView[]> {
  const { data: rows } = await admin.from('saved_search').select(COLS)
    .eq('member_id', memberId).eq('active', true).order('created_at', { ascending: false }).limit(MAX_SEARCHES)
  const list = (rows ?? []) as SavedSearchRow[]
  if (!list.length) return []
  const { data: hits } = await admin.from('saved_search_hit')
    .select(`saved_search_id, item_id, found_at, seen_at, item:item_id(${PIECE})`)
    .in('saved_search_id', list.map((r) => r.saved_search_id))
    .order('found_at', { ascending: false }).limit(MAX_SEARCHES * 40)
  const by = new Map<string, any[]>()
  for (const h of (hits ?? []) as any[]) {
    if (!h.item || h.item.stock_status === 'out_of_stock') continue
    const l = by.get(h.saved_search_id) ?? []
    l.push(h)
    by.set(h.saved_search_id, l)
  }
  return list.map((r) => {
    const h = by.get(r.saved_search_id) ?? []
    return {
      id: r.saved_search_id,
      query: r.query,
      label: r.label,
      fresh: h.filter((x) => !x.seen_at).length,
      pieces: h.slice(0, perSearch).map((x) => ({
        item_id: x.item_id,
        product_name: x.item.product_name ?? 'Piece',
        brand: x.item.brand?.name ?? null,
        image_url: x.item.image_url ?? null,
        price_gbp: x.item.price_gbp != null ? Number(x.item.price_gbp) : null,
        url: x.item.retailer_url ?? null,
      })),
      created_at: r.created_at,
    }
  })
}

/** The hour in the UK right now, 0–23. */
export function ukHour(now = new Date()): number {
  return Number(new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hourCycle: 'h23', timeZone: 'Europe/London' }).format(now))
}

/** The UK day of a moment, YYYY-MM-DD — "already told today". */
export function ukDay(at: Date | string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(typeof at === 'string' ? new Date(at) : at)
}

const pieces = (n: number) => `${n} new ${n === 1 ? 'piece' : 'pieces'}`

/**
 * The evening note, for all her searches at once. One search: '3 new pieces
 * for "navy cami top".' Several: the busiest two, then how many more.
 */
export function savedSearchMessage(found: { query: string; fresh: number }[]): { title: string; body: string } | null {
  const live = found.filter((f) => f.fresh > 0).sort((a, b) => b.fresh - a.fresh)
  if (!live.length) return null
  if (live.length === 1) return { title: 'MYRA kept looking', body: `${pieces(live[0].fresh)} for "${live[0].query}".` }
  const [a, b, ...rest] = live
  const more = rest.length ? ` and ${rest.length} more of your searches` : ''
  return { title: 'MYRA kept looking', body: `${pieces(a.fresh)} for "${a.query}", ${b.fresh} for "${b.query}"${more}.` }
}

/** Where a tap goes: Browse, the search opened with what is new first. */
export function savedSearchPath(id?: string): string {
  return id ? `/me/browse?saved=${encodeURIComponent(id)}` : '/me/dressing-room?tab=searches'
}
