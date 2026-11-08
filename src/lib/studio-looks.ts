// FROM THE STUDIO — the outfits Chloe's studio has already made with a piece.
//
// Every finished outfit on the outfit table (live, or paused off the feed) is a way to wear each piece
// in it. Until now a member only ever met those through the feed; a piece she
// finds in Browse, keeps from a shop, or searches for in her Looks had no way
// back to them. These readers give every piece its studio outfits, drawn with
// the same card as a kept way (ComposedLookCard), so nothing is rebuilt.
//
// Studio outfits are shown as they are — drafts never, and nothing is
// composed here. Chloe, 2026-11-03: "I should be able to look at
// the outfits associated with 16arlington when I search, and in my saved
// items see the outfits under each saved item."

import { toLookItem } from '@/lib/pilot-composer'
import { occasionLabel } from '@/lib/occasions'
import type { LookItem } from '@/lib/pilot-stylist'
import type { ItemWithBrand } from '@/lib/admin-queries'

/**
 * Outfits the studio has finished: live (what the feed shows) and paused
 * (finished and pictured, off the feed for now). Drafts never. The
 * outfit_status_enum has no 'ready'. Chloe, 2026-11-08: the Flora skirt is in
 * four finished outfits and she expects to see all four under it.
 */
export const STUDIO_STATUSES = ['live', 'paused']

export interface StudioLook {
  outfit_id: string
  /** The outfit's own picture (always present on a studio outfit). */
  image_url: string | null
  items: LookItem[]
  why: string
  occasion_id?: string | null
  occasion_label: string | null
  look_id: null
}

const ITEM = 'item_id, product_name, price_gbp, retailer_url, image_url, item_type, material_primary, status, stock_status, stock_class, available, ownership, owner_kind, brand_id, brand:brand_id(name, brand_id)'

// THE INDEX — every finished studio outfit, drawn once and kept in memory.
//
// There are a few hundred of them against 31,000 pieces, so a search that
// asked the item table by name (ilike over every row) took ~4s on the nano
// database before it could even find the outfits. Now the outfits are read
// once, with their pieces, and every question (which outfits hold this piece,
// which answer these words, how many per piece) is answered from memory.
// Studio outfits change when Chloe says YES in Review, so the index is
// re-read after a few minutes; a search between reads can miss the newest.

interface StudioIndex {
  looks: StudioLook[]
  /** item_id → the studio looks it is in, newest first. */
  byItem: Map<string, StudioLook[]>
  /** Everything a word could land on, per look: occasion, brands, names, types. */
  hay: Map<string, string>
  at: number
}
const INDEX_TTL_MS = 5 * 60_000
const slot = ((globalThis as any).__myraStudioIndex ??= { index: null as StudioIndex | null, loading: null as Promise<StudioIndex> | null })

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '')
const chunk = <T,>(xs: T[], n: number) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n))

async function readIndex(admin: any): Promise<StudioIndex> {
  const { data: outfits } = await admin.from('outfit')
    .select('outfit_id, image_url, occasion_tags, status, published_at, created_at')
    .in('status', STUDIO_STATUSES)
    .order('published_at', { ascending: false, nullsFirst: false }).order('created_at', { ascending: false })
    .limit(2000)
  const rows = ((outfits ?? []) as any[])
  // Live before paused, each newest first.
  rows.sort((a, b) => (a.status === b.status ? 0 : a.status === 'live' ? -1 : 1))
  const outfitIds = rows.map((o) => o.outfit_id as string)
  const links: any[] = []
  for (const ids of chunk(outfitIds, 150)) {
    const { data } = await admin.from('outfit_item').select('outfit_id, item_id, sort_order').in('outfit_id', ids).order('sort_order')
    links.push(...((data ?? []) as any[]))
  }
  const itemIds = Array.from(new Set(links.map((l) => l.item_id as string)))
  const byId = new Map<string, any>()
  for (const ids of chunk(itemIds, 150)) {
    const { data } = await admin.from('item').select(ITEM).in('item_id', ids)
    for (const it of (data ?? []) as any[]) byId.set(it.item_id, it)
  }
  const looks: StudioLook[] = []
  const byItem = new Map<string, StudioLook[]>()
  const hay = new Map<string, string>()
  for (const o of rows) {
    const pieces = links.filter((l) => l.outfit_id === o.outfit_id).map((l) => byId.get(l.item_id))
      .filter((it) => it && it.status !== 'archived') as ItemWithBrand[]
    if (pieces.length < 2) continue
    const tag = (o.occasion_tags ?? [])[0] as string | undefined
    const look: StudioLook = {
      outfit_id: o.outfit_id,
      image_url: o.image_url ?? null,
      items: pieces.map(toLookItem),
      why: 'From the studio',
      occasion_id: tag ?? null,
      occasion_label: tag ? occasionLabel(tag) : null,
      look_id: null,
    }
    looks.push(look)
    for (const it of look.items) if (it.item_id) byItem.set(it.item_id, [...(byItem.get(it.item_id) ?? []), look])
    hay.set(look.outfit_id, norm([look.occasion_label ?? '', ...look.items.map((i) => `${i.brand} ${i.product_name} ${i.item_type ?? ''}`)].join(' ')))
  }
  return { looks, byItem, hay, at: Date.now() }
}

/** The studio index, read once and kept for a few minutes; one read at a time. */
export async function studioIndex(admin: any): Promise<StudioIndex> {
  if (slot.index && Date.now() - slot.index.at < INDEX_TTL_MS) return slot.index
  if (!slot.loading) {
    slot.loading = readIndex(admin).then((ix) => { slot.index = ix; return ix }).finally(() => { slot.loading = null })
  }
  // A stale index answers now rather than making her wait for the re-read.
  return slot.index ?? slot.loading
}

/** The studio outfits with these ids, in the index's order (live first, newest first). */
export async function loadStudioOutfits(admin: any, outfitIds: string[], limit = 12): Promise<StudioLook[]> {
  const want = new Set(outfitIds.filter(Boolean))
  if (!want.size) return []
  const ix = await studioIndex(admin)
  return ix.looks.filter((l) => want.has(l.outfit_id)).slice(0, limit)
}

/** The studio outfits one piece is in. */
export async function studioLooksWithPiece(admin: any, itemId: string, limit = 6): Promise<StudioLook[]> {
  const ix = await studioIndex(admin)
  return (ix.byItem.get(itemId) ?? []).slice(0, limit)
}

/** How many studio outfits each of these pieces is in. */
export async function studioCountsFor(admin: any, itemIds: string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>()
  if (!itemIds.length) return counts
  const ix = await studioIndex(admin)
  for (const id of itemIds) { const n = ix.byItem.get(id)?.length ?? 0; if (n) counts.set(id, n) }
  return counts
}

/**
 * The studio outfits that answer her words — "16arlington", "feather skirt".
 * A word is read against each piece's brand, name and type and the outfit's
 * occasion; an outfit answers when every word is found somewhere in it.
 */
export async function studioLooksMatching(admin: any, query: string, limit = 12): Promise<StudioLook[]> {
  const words = Array.from(new Set(query.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter((w) => w.length >= 2))).slice(0, 6)
  if (!words.length) return []
  const ix = await studioIndex(admin)
  return ix.looks.filter((l) => { const h = ix.hay.get(l.outfit_id) ?? ''; return words.every((w) => h.includes(w)) }).slice(0, limit)
}
