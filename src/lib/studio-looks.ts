// FROM THE STUDIO — the outfits Chloe's studio has already made with a piece.
//
// Every live or ready outfit on the outfit table is a way to wear each piece
// in it. Until now a member only ever met those through the feed; a piece she
// finds in Browse, keeps from a shop, or searches for in her Looks had no way
// back to them. These readers give every piece its studio outfits, drawn with
// the same card as a kept way (ComposedLookCard), so nothing is rebuilt.
//
// Studio outfits are shown as they are — drafts and paused outfits never, and
// nothing is composed here. Chloe, 2026-11-03: "I should be able to look at
// the outfits associated with 16arlington when I search, and in my saved
// items see the outfits under each saved item."

import { toLookItem } from '@/lib/pilot-composer'
import { occasionLabel } from '@/lib/occasions'
import type { LookItem } from '@/lib/pilot-stylist'
import type { ItemWithBrand } from '@/lib/admin-queries'

/** Outfits the studio has signed off: what the feed shows (outfit_status_enum has no 'ready'). */
export const STUDIO_STATUSES = ['live']

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

/** The studio outfits with these ids, newest first, every piece drawn. */
export async function loadStudioOutfits(admin: any, outfitIds: string[], limit = 12): Promise<StudioLook[]> {
  const ids = Array.from(new Set(outfitIds.filter(Boolean)))
  if (!ids.length) return []
  const { data: outfits } = await admin.from('outfit')
    .select('outfit_id, image_url, occasion_tags, status, published_at, created_at')
    .in('outfit_id', ids).in('status', STUDIO_STATUSES)
    .order('published_at', { ascending: false, nullsFirst: false }).order('created_at', { ascending: false })
    .limit(limit)
  const rows = (outfits ?? []) as any[]
  if (!rows.length) return []
  const { data: links } = await admin.from('outfit_item')
    .select('outfit_id, item_id, sort_order').in('outfit_id', rows.map((o) => o.outfit_id)).order('sort_order')
  const itemIds = Array.from(new Set(((links ?? []) as any[]).map((l) => l.item_id as string)))
  const { data: items } = itemIds.length ? await admin.from('item').select(ITEM).in('item_id', itemIds) : { data: [] }
  const byId = new Map(((items ?? []) as any[]).map((it) => [it.item_id, it]))
  const out: StudioLook[] = []
  for (const o of rows) {
    const pieces = ((links ?? []) as any[])
      .filter((l) => l.outfit_id === o.outfit_id)
      .map((l) => byId.get(l.item_id))
      .filter((it) => it && it.status !== 'archived') as ItemWithBrand[]
    if (pieces.length < 2) continue
    const tag = (o.occasion_tags ?? [])[0] as string | undefined
    out.push({
      outfit_id: o.outfit_id,
      image_url: o.image_url ?? null,
      items: pieces.map(toLookItem),
      why: 'From the studio',
      occasion_id: tag ?? null,
      occasion_label: tag ? occasionLabel(tag) : null,
      look_id: null,
    })
  }
  return out
}

/** The studio outfits one piece is in. */
export async function studioLooksWithPiece(admin: any, itemId: string, limit = 6): Promise<StudioLook[]> {
  const { data } = await admin.from('outfit_item').select('outfit_id').eq('item_id', itemId).limit(60)
  return loadStudioOutfits(admin, ((data ?? []) as any[]).map((l) => l.outfit_id), limit)
}

/** How many studio outfits each of these pieces is in (live or ready only). */
export async function studioCountsFor(admin: any, itemIds: string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>()
  if (!itemIds.length) return counts
  const { data } = await admin.from('outfit_item')
    .select('item_id, outfit:outfit_id!inner(status)').in('item_id', itemIds).in('outfit.status', STUDIO_STATUSES).limit(2000)
  for (const r of (data ?? []) as any[]) counts.set(r.item_id, (counts.get(r.item_id) ?? 0) + 1)
  return counts
}

/**
 * The studio outfits that answer her words — "16arlington", "feather skirt".
 * A word is read against each piece's label and name; an outfit answers when
 * every word is found somewhere in it, as her own Looks search reads them.
 */
export async function studioLooksMatching(admin: any, query: string, limit = 12): Promise<StudioLook[]> {
  const words = Array.from(new Set(query.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter((w) => w.length >= 2))).slice(0, 6)
  if (!words.length) return []
  // Pieces that carry any of her words, by label or by name.
  const ors = words.flatMap((w) => [`product_name.ilike.%${w}%`])
  const [{ data: byName }, { data: brands }] = await Promise.all([
    admin.from('item').select('item_id').neq('status', 'archived').or(ors.join(',')).limit(400),
    admin.from('brand').select('brand_id').or(words.map((w) => `name.ilike.%${w}%`).join(',')).limit(20),
  ])
  const brandIds = ((brands ?? []) as any[]).map((b) => b.brand_id)
  const { data: byBrand } = brandIds.length
    ? await admin.from('item').select('item_id').in('brand_id', brandIds).limit(400)
    : { data: [] }
  const itemIds = Array.from(new Set([...((byName ?? []) as any[]), ...((byBrand ?? []) as any[])].map((r) => r.item_id)))
  if (!itemIds.length) return []
  const { data: links } = await admin.from('outfit_item')
    .select('outfit_id, outfit:outfit_id!inner(status)').in('item_id', itemIds).in('outfit.status', STUDIO_STATUSES).limit(600)
  const outfitIds = Array.from(new Set(((links ?? []) as any[]).map((l) => l.outfit_id)))
  const looks = await loadStudioOutfits(admin, outfitIds, 60)
  // Every word must land somewhere in the outfit.
  const hay = (l: StudioLook) => [l.occasion_label ?? '', ...l.items.map((i) => `${i.brand} ${i.product_name} ${i.item_type ?? ''}`)]
    .join(' ').toLowerCase().replace(/[^a-z0-9]+/g, '')
  return looks.filter((l) => { const h = hay(l); return words.every((w) => h.includes(w)) }).slice(0, limit)
}
