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
// Built out (2026-11-06, Chloe's three choices):
//   * SEARCH THE SHOPS TOO — each run also looks through the new pieces Brand
//     Watch has read from her labels but nobody has added yet (the queue), and
//     brings the ones that answer her words straight in. A label MYRA does not
//     read at all ("Dries Van Noten trainers") is asked for, once.
//   * WHY IT MATCHED — every find says what it answered ("DRIES VAN NOTEN ·
//     TRAINERS · YOUR SIZE"), and she answers YES (kept to her saved pieces) or
//     NOT THIS (gone, and taught: a colour or label refused twice in a search
//     is held back from it).
//   * SOONER — a strong find (the label she named, or one of her own labels)
//     goes to her phone at once, one a search every six hours, three a day.
//     Everything else waits for the quiet evening note.
//
// Plain module: the cron and her actions both call it.

import 'server-only'
import { searchForMember, readQuery, nameFilters, type BrowseFilters, type BrowsePiece } from '@/lib/member-search'
import { loadTasteGraph, overHerBudget } from '@/lib/taste-graph'
import { keepQueueRows } from '@/lib/brand-watch-keep'
import { brandKey } from '@/lib/brand-affinity'

export const MAX_SEARCHES = 12
/** Shop pieces brought in per search per run: each is read live on the shop as it is kept. */
const SHOP_PER_RUN = 4
/** A colour or label refused this many times in one search is held back from it. */
const REFUSED_TIMES = 2
const NAMED = 0.8
/** Fewer exact answers than this, and the closest kind is kept too — named as close. */
const CLOSE_BELOW = 3

/**
 * What a saved search keeps from one search: every exact answer, and — when a
 * long ask ("sequin embellished midi pencil skirt") has almost none — the
 * nearest kind of near-miss, labelled for what it is: "CLOSE · SEQUIN SKIRTS".
 */
export function keepFromView(view: { pieces: BrowsePiece[]; similar: BrowsePiece[]; similarKind: string | null; similarGroups?: { title: string; ids: string[] }[]; read: string[] }, sized: boolean): { piece: BrowsePiece; why: string | null }[] {
  const exactWhy = whyLine(view.read, sized)
  const out = view.pieces.map((piece) => ({ piece, why: exactWhy }))
  const group = view.similarKind === 'close' ? view.similarGroups?.[0] : undefined
  if (out.length < CLOSE_BELOW && group) {
    const ids = new Set(group.ids)
    const why = `CLOSE · ${group.title}${sized ? ' · YOUR SIZE' : ''}`
    for (const piece of view.similar) if (ids.has(piece.item_id)) out.push({ piece, why })
  }
  return out
}
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
  shop_note?: string | null
  last_instant_at?: string | null
}

/** A find, with what it answered and her answer. */
export interface SavedSearchPiece extends BrowsePiece {
  why: string | null
  verdict: 'yes' | 'no' | null
  fresh: boolean
  /** Brought in from a shop's new pieces for this search. */
  fromShop: boolean
}

export interface SavedSearchView {
  id: string
  query: string
  label: string | null
  /** Pieces found since she last opened it. */
  fresh: number
  /** The newest pieces this search has found, newest first; NOT THIS left out. */
  pieces: SavedSearchPiece[]
  created_at: string
  /** What MYRA did beyond its own shelves, e.g. "MYRA HAS ASKED TO ADD DRIES VAN NOTEN'S SHOP". */
  shopNote: string | null
}

const COLS = 'saved_search_id, member_id, query, filters, label, last_run_at, last_seen_at, last_pushed_at, created_at, shop_note, last_instant_at'
const PIECE = 'item_id, product_name, image_url, price_gbp, retailer_url, stock_status, colour_family, brand_id, brand:brand_id(name)'

/** What a find answered, in her words: the read of her search, and her size. */
export function whyLine(read: string[], sized: boolean): string | null {
  // MYRA's piece names, said the way she says them.
  const said: Record<string, string> = { SNEAKER: 'TRAINERS' }
  const parts = [...read.map((r) => said[r] ?? r), ...(sized ? ['YOUR SIZE'] : [])]
  return parts.length ? parts.join(' · ') : null
}

/**
 * SEARCH THE SHOPS TOO: the new pieces Brand Watch has read from her labels
 * (or the label she named) that are the piece, cloth, colour and label she
 * asked for — cuts and loose words are left to the search itself, which then
 * files each as an answer or a close one — brought into
 * MYRA — read live on the shop as they are kept, so stock and sizes are
 * today's. A search with no piece, cloth or cut in it ("Dries Van Noten") is
 * not a shop sweep: it would bring a whole label in.
 */
export async function searchTheShops(admin: any, row: SavedSearchRow, max = SHOP_PER_RUN): Promise<number> {
  const rq = await readQuery(admin, row.query)
  const p = rq.parsed
  const names = nameFilters({ ...p, cuts: [] })
  if (!p.itemTypes.length && !names.length) return 0
  // Her ceilings hold here too: a piece over her budget would come in and never show.
  const graph = await loadTasteGraph(admin, row.member_id)
  let brands = rq.brandIds.filter((id) => !graph.blocked.has(id))
  if (!rq.brandIds.length) brands = Array.from(graph.weights.entries()).sort((a, b) => b[1] - a[1]).slice(0, 80).map(([id]) => id)
  if (!brands.length) return 0
  let q = admin.from('brand_watch_queue').select('queue_id, item_type, price_gbp')
    .eq('status', 'queued').in('brand_id', brands).not('image_url', 'is', null).neq('stock_status', 'out_of_stock')
    // A rental listing ("RENT - Toni Sequin Skirt") is not a piece she can buy.
    .not('product_name', 'ilike', 'rent %')
  if (p.itemTypes.length) q = q.in('item_type', p.itemTypes)
  if (p.colourFamilies.length) q = q.in('colour_family', p.colourFamilies)
  for (const f of names) q = q.or(f)
  const { data } = await q.order('discovery_score', { ascending: false }).limit(max * 10)
  const ids = ((data ?? []) as any[]).filter((r) => !overHerBudget(graph, r)).slice(0, max).map((r) => r.queue_id)
  if (!ids.length) return 0
  return keepQueueRows(admin, ids, { auto: true, liveStock: true })
}

/**
 * A label she named that MYRA does not read yet: ask for its shop, once — the
 * same request the Mirror's "Add this brand" makes (lib/brand-onboarding).
 * Returns the note for her search, or null when MYRA already reads it.
 */
export async function askForLabelShop(admin: any, row: SavedSearchRow, byAdmin: boolean): Promise<{ note: string | null; requestId?: string }> {
  const rq = await readQuery(admin, row.query)
  if (!rq.brandIds.length || !rq.brandName) return { note: null }
  const [{ data: watched }, { data: byName }] = await Promise.all([
    admin.from('watched_brand').select('watched_brand_id').in('brand_id', rq.brandIds).eq('active', true).limit(1),
    // The same label watched under a second name ("Sandro – Official Website").
    admin.from('watched_brand').select('watched_brand_id').ilike('name', `${rq.brandName}%`).eq('active', true).limit(1),
  ])
  if (watched?.length || byName?.length) return { note: null }
  // Its own shop, from the pieces MYRA already has of it: the host that carries its name.
  const { data: items } = await admin.from('item').select('retailer_url').in('brand_id', rq.brandIds).not('retailer_url', 'is', null).limit(200)
  const key = brandKey(rq.brandName).replace(/\s+/g, '')
  const host = ((items ?? []) as any[]).map((i) => { try { return new URL(i.retailer_url).host.replace(/^www\./, '') } catch { return '' } })
    .find((h) => h && h.replace(/[^a-z0-9]/g, '').includes(key))
  const label = rq.brandName.toUpperCase()
  if (!host) return { note: `MYRA LOOKS FOR ${label} AT THE SHOPS THAT CARRY IT` }
  const now = new Date().toISOString()
  const { data: existing } = await admin.from('mirror_site_request').select('request_id, times_asked')
    .eq('member_id', row.member_id).eq('host', host).maybeSingle()
  let requestId = existing?.request_id as string | undefined
  if (existing) {
    await admin.from('mirror_site_request').update({ times_asked: (existing.times_asked ?? 1) + 1, last_asked_at: now }).eq('request_id', requestId)
  } else {
    const { data: made } = await admin.from('mirror_site_request').insert({
      member_id: row.member_id, host, url: `https://${host}`, page_title: `Saved search: ${row.query}`, reason: 'add',
      last_asked_at: now, ...(byAdmin ? { requested_by_admin: true } : {}),
    }).select('request_id').single()
    requestId = made?.request_id
  }
  return { note: `MYRA HAS ASKED TO ADD ${label}'S OWN SHOP`, requestId }
}

export interface RunResult {
  added: number
  /** Brought in from the shops this run. */
  fromShops: number
  /** New finds strong enough to tell her at once. */
  strong: BrowsePiece[]
}

/** One saved search: the shops first, then everything new in MYRA since it last ran. */
export async function runSavedSearch(admin: any, row: SavedSearchRow, now = new Date(), opts: { shops?: boolean } = {}): Promise<RunResult> {
  let fromShops = 0
  if (opts.shops !== false) {
    try { fromShops = await searchTheShops(admin, row) } catch (err) { console.error('[saved-search] shops', row.query, err) }
  }
  const view = await searchForMember(admin, row.member_id, row.query, row.filters ?? {}, { since: row.last_run_at })
  const kept = keepFromView(view, true)
  const whyOf = new Map(kept.map((k) => [k.piece.item_id, k.why]))
  let found = kept.map((k) => k.piece)

  // NOT THIS, taught: a colour or a label she has refused twice in this search is held back from it.
  const { data: refused } = await admin.from('saved_search_hit').select('item:item_id(colour_family, brand_id)')
    .eq('saved_search_id', row.saved_search_id).eq('verdict', 'no')
  const tally = (k: 'colour_family' | 'brand_id') => {
    const n = new Map<string, number>()
    for (const r of (refused ?? []) as any[]) { const v = r.item?.[k]; if (v) n.set(v, (n.get(v) ?? 0) + 1) }
    return new Set(Array.from(n.entries()).filter(([, c]) => c >= REFUSED_TIMES).map(([v]) => v))
  }
  const heldColours = tally('colour_family')
  const heldBrands = tally('brand_id')
  const facts = new Map<string, any>()
  if (found.length) {
    const { data: rows } = await admin.from('item').select('item_id, colour_family, brand_id').in('item_id', found.map((p) => p.item_id))
    for (const r of (rows ?? []) as any[]) facts.set(r.item_id, r)
    if (heldColours.size || heldBrands.size) {
      found = found.filter((p) => { const f = facts.get(p.item_id); return !f || (!heldColours.has(f.colour_family) && !heldBrands.has(f.brand_id)) })
    }
  }

  let added: BrowsePiece[] = []
  if (found.length) {
    const { data } = await admin.from('saved_search_hit').upsert(
      found.map((p) => ({ saved_search_id: row.saved_search_id, item_id: p.item_id, found_at: now.toISOString(), why: whyOf.get(p.item_id) ?? null, source: 'myra' })),
      { onConflict: 'saved_search_id,item_id', ignoreDuplicates: true },
    ).select('item_id')
    const ids = new Set(((data ?? []) as any[]).map((r) => r.item_id))
    added = found.filter((p) => ids.has(p.item_id))
  }
  // Pieces this run brought in from a shop say so.
  if (fromShops && added.length) {
    const { data: kept } = await admin.from('brand_watch_queue').select('item_id').in('item_id', added.map((p) => p.item_id))
    const shopIds = ((kept ?? []) as any[]).map((r) => r.item_id).filter(Boolean)
    if (shopIds.length) await admin.from('saved_search_hit').update({ source: 'shop' }).eq('saved_search_id', row.saved_search_id).in('item_id', shopIds)
  }

  // Strong: the label she named, or one of her own labels.
  let strong: BrowsePiece[] = []
  if (added.length) {
    const named = new Set((await readQuery(admin, row.query)).brandIds)
    const graph = named.size ? null : await loadTasteGraph(admin, row.member_id)
    strong = added.filter((p) => {
      if (String(whyOf.get(p.item_id) ?? '').startsWith('CLOSE')) return false
      const b = facts.get(p.item_id)?.brand_id
      return b && (named.size ? named.has(b) : (graph!.weights.get(b) ?? 0) >= NAMED)
    })
  }
  await admin.from('saved_search').update({ last_run_at: now.toISOString() }).eq('saved_search_id', row.saved_search_id)
  return { added: added.length, fromShops, strong }
}

/** Her saved searches, newest first, each with its unseen count and newest pieces. */
export async function savedSearchesFor(admin: any, memberId: string, perSearch = 8): Promise<SavedSearchView[]> {
  const { data: rows } = await admin.from('saved_search').select(COLS)
    .eq('member_id', memberId).eq('active', true).order('created_at', { ascending: false }).limit(MAX_SEARCHES)
  const list = (rows ?? []) as SavedSearchRow[]
  if (!list.length) return []
  const { data: hits } = await admin.from('saved_search_hit')
    .select(`saved_search_id, item_id, found_at, seen_at, why, verdict, source, item:item_id(${PIECE})`)
    .in('saved_search_id', list.map((r) => r.saved_search_id))
    .order('found_at', { ascending: false }).limit(MAX_SEARCHES * 40)
  const by = new Map<string, any[]>()
  for (const h of (hits ?? []) as any[]) {
    if (!h.item || h.item.stock_status === 'out_of_stock' || h.verdict === 'no') continue
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
        why: x.why ?? null,
        verdict: x.verdict ?? null,
        fresh: !x.seen_at,
        fromShop: x.source === 'shop',
      })),
      created_at: r.created_at,
      shopNote: r.shop_note ?? null,
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

/** A strong find, at once: 'Dries Van Noten — new for "trainers": Leather sneakers, £420.' */
export function instantMessage(query: string, pieces: BrowsePiece[]): { title: string; body: string } | null {
  const p = pieces[0]
  if (!p) return null
  const price = p.price_gbp != null ? `, £${Math.round(p.price_gbp)}` : ''
  const more = pieces.length > 1 ? ` and ${pieces.length - 1} more` : ''
  return { title: `Found for "${query}"`, body: `${p.brand ? `${p.brand} ` : ''}${p.product_name}${price}${more}.` }
}

/** Where a tap goes: Browse, the search opened with what is new first. */
export function savedSearchPath(id?: string): string {
  return id ? `/me/browse?saved=${encodeURIComponent(id)}` : '/me/dressing-room?tab=searches'
}
