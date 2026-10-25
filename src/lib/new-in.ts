// NEW IN FROM HER BRANDS — what the Monday push is about.
//
// Chloe asked (2026-10-24): when ME+EM (or any brand she loves) uploads new
// pieces, tell her on her phone, on a Monday. Brand Watch reads every watched
// brand about weekly (an hourly cron, stalest first), so the Monday note is
// the week's arrivals, not one scan's: pieces that came into MYRA in the last
// seven days, from the brands she NAMED (pilot_member.brands — never an
// input-only or not-for-me brand), that she could buy today in her size.
//
// "Could buy" is the same bar as everywhere she is shown pieces: a picture,
// not sold or out of stock or unreadable (sellable), not something she owns,
// and through the strict size gate the composer uses (filterItemsForShopper).
// Drafts count — Browse shows them, and the label section of the shop brain
// shows her brands' drafts on purpose.
//
// Plain module: the cron and Browse both call it.

import 'server-only'
import { brandKey } from '@/lib/brand-affinity'
import { sellable } from '@/lib/stock-sellable'
import { isOwnedItem } from '@/lib/wardrobe/owned-items'
import { filterItemsForShopper, loadMemberSizeProfile } from '@/lib/size-availability'

export const NEW_IN_DAYS = 7
const SHOWABLE = ['ready', 'live', 'draft']
const CARD = 'item_id, product_name, image_url, price_gbp, retailer_url, item_type, colour_family, status, stock_status, stock_class, available, ownership, owner_kind, created_at, brand_id, brand:brand_id(name, source_type, size_offset)'

export interface NewInMember {
  member_id: string
  brands?: unknown
  brands_input_only?: string[] | null
  brands_never?: string[] | null
}

export interface NewInBrand { brand_id: string; name: string; count: number }

export interface NewInResult {
  since: string
  /** Her brands with new pieces, in her own ranking order. */
  brands: NewInBrand[]
  /** The pieces themselves, newest first. */
  items: any[]
}

/** The brands she asked to be sent, in her order, minus the ones she wears but never wants sent. */
export function namedBrands(m: NewInMember): string[] {
  const list = Array.isArray(m.brands) ? (m.brands as any[]) : []
  const blocked = new Set([...(m.brands_input_only ?? []), ...(m.brands_never ?? [])].map((b) => brandKey(String(b))))
  return list
    .filter((b) => b?.name)
    .sort((a, b) => Number(a.rank ?? 99) - Number(b.rank ?? 99))
    .map((b) => String(b.name))
    .filter((n) => !blocked.has(brandKey(n)))
}

let brandCache: { at: number; rows: { brand_id: string; name: string; keys: string[] }[] } | null = null

async function brandRows(admin: any) {
  if (brandCache && Date.now() - brandCache.at < 5 * 60_000) return brandCache.rows
  const { data } = await admin.from('brand').select('brand_id, name, aliases').limit(3000)
  const rows = ((data ?? []) as any[]).filter((b) => b?.name).map((b) => ({
    brand_id: String(b.brand_id),
    name: String(b.name),
    keys: [brandKey(String(b.name)), ...((Array.isArray(b.aliases) ? b.aliases : []) as string[]).map((a) => brandKey(String(a)))].filter(Boolean),
  }))
  brandCache = { at: Date.now(), rows }
  return rows
}

/** New pieces from her brands since `since` (default: the last seven days) that she could buy in her size. */
export async function newInForMember(admin: any, m: NewInMember, since?: string): Promise<NewInResult> {
  const from = since ?? new Date(Date.now() - NEW_IN_DAYS * 24 * 3600_000).toISOString()
  const names = namedBrands(m)
  if (!names.length) return { since: from, brands: [], items: [] }

  // Her words onto MYRA's labels, keeping her order.
  const rows = await brandRows(admin)
  const order = new Map<string, number>()
  names.forEach((n, i) => {
    const k = brandKey(n)
    for (const r of rows) if (r.keys.includes(k) && !order.has(r.brand_id)) order.set(r.brand_id, i)
  })
  const ids = Array.from(order.keys())
  if (!ids.length) return { since: from, brands: [], items: [] }

  const { data, error } = await admin.from('item').select(CARD)
    .in('brand_id', ids).in('status', SHOWABLE).gte('created_at', from)
    .not('image_url', 'is', null).order('created_at', { ascending: false }).limit(1000)
  if (error) throw new Error(error.message)
  const buyable = ((data ?? []) as any[]).filter((it) => it.available !== false && sellable(it) && !isOwnedItem(it))
  const ctx = await loadMemberSizeProfile(m.member_id)
  const items = await filterItemsForShopper(buyable, ctx, { strict: true })

  const counts = new Map<string, NewInBrand>()
  for (const it of items) {
    const c = counts.get(it.brand_id) ?? { brand_id: it.brand_id, name: it.brand?.name ?? 'Your brand', count: 0 }
    c.count += 1
    counts.set(it.brand_id, c)
  }
  const brands = Array.from(counts.values()).sort((a, b) => (order.get(a.brand_id) ?? 99) - (order.get(b.brand_id) ?? 99))
  return { since: from, brands, items }
}

const pieces = (n: number) => `${n} new ${n === 1 ? 'piece' : 'pieces'}`

/**
 * The words on her lock screen. One brand: "ME+EM — 6 new pieces in your
 * size." Several: the two with the most new pieces (her ranking breaks a
 * tie), then how many more.
 */
export function newInMessage(brands: NewInBrand[]): { title: string; body: string } | null {
  if (!brands.length) return null
  const total = brands.reduce((n, b) => n + b.count, 0)
  if (brands.length === 1) {
    return { title: `New in from ${brands[0].name}`, body: `${pieces(brands[0].count)} in your size this week.` }
  }
  const [a, b, ...rest] = brands.map((x, i) => ({ ...x, i })).sort((x, y) => y.count - x.count || x.i - y.i)
  const named = `${a.count} from ${a.name}${rest.length ? ', ' : ' and '}${b.count} from ${b.name}`
  const more = rest.length ? ` and ${rest.length} more of your ${rest.length === 1 ? 'brand' : 'brands'}` : ''
  return { title: 'New in from your brands', body: `${total} new pieces in your size this week: ${named}${more}.` }
}

/** Where the tap goes: Browse, showing exactly these pieces. */
export function newInPath(since: string): string {
  return `/me/browse?new=${encodeURIComponent(since)}`
}
