// OUR PICKS — the editorial item moment under the New Outfits feed.
// Headline art: the Cult Gaia Amun bag hanging out of the lettering.
// Picks: standout items from the newest live outfits — one per brand, mixed
// piece types, statement pieces first — always shoppable (live items only).
import 'server-only'
import { createAdminClient } from '@/lib/supabase-server'

export interface OurPick {
  item_id: string
  product_name: string
  brand_name: string | null
  image_url: string
  retailer_url: string | null
  price: string
}

export interface OurPicksData {
  artImageUrl: string | null
  picks: OurPick[]
}

function fmtPrice(price: string | null, currency: string | null): string {
  if (!price) return ''
  const sym: Record<string, string> = { GBP: '£', USD: '$', EUR: '€', AUD: 'A$', CAD: 'C$', JPY: '¥' }
  return `${sym[currency ?? 'GBP'] ?? ''}${String(price).replace(/\.00$/, '')}`
}

export interface PickWithOutfits extends OurPick {
  outfits: { outfit_id: string; image_url: string | null }[]
}

// Collection + the live outfits each piece appears in (the small clickable
// thumbs under each bag — "wear it like this").
export async function getPickCollectionWithOutfits(collection: string): Promise<PickWithOutfits[]> {
  const picks = await getPickCollection(collection)
  if (!picks.length) return []
  try {
    const admin = createAdminClient()
    const { data } = await admin
      .from('outfit_item' as any)
      .select('item_id, outfit:outfit_id(outfit_id, image_url, additional_images, status, published_at)')
      .in('item_id', picks.map((p) => p.item_id))
      .limit(2000)
    const byItem = new Map<string, { outfit_id: string; image_url: string | null; published_at: string }[]>()
    for (const r of (data ?? []) as any[]) {
      const o = r.outfit
      if (!o || o.status !== 'live') continue
      const extra = Array.isArray(o.additional_images) ? o.additional_images : []
      const arr = byItem.get(r.item_id) ?? []
      if (arr.some((x) => x.outfit_id === o.outfit_id)) continue
      arr.push({
        outfit_id: o.outfit_id,
        image_url: extra[extra.length - 1] ?? o.image_url ?? null,
        published_at: o.published_at ?? '',
      })
      byItem.set(r.item_id, arr)
    }
    return picks.map((p) => ({
      ...p,
      outfits: (byItem.get(p.item_id) ?? [])
        .sort((a, b) => (b.published_at > a.published_at ? 1 : -1))
        .slice(0, 4)
        .map(({ outfit_id, image_url }) => ({ outfit_id, image_url })),
    }))
  } catch {
    return picks.map((p) => ({ ...p, outfits: [] }))
  }
}

// A curated collection ('picks', 'bags', …) — live items only, in her order.
// Two-step join: our_pick has no FK to item, so PostgREST embeds can't
// resolve the relationship.
export async function getPickCollection(collection: string): Promise<OurPick[]> {
  try {
    const admin = createAdminClient()
    const { data } = await admin
      .from('our_pick' as any)
      .select('item_id, sort_order')
      .eq('collection', collection)
      .order('sort_order', { ascending: true })
    const rows = (data ?? []) as any[]
    if (!rows.length) return []
    const { data: items } = await admin
      .from('item' as any)
      .select('item_id, product_name, image_url, retailer_url, price, currency, status, brand:brand_id(name)')
      .in('item_id', rows.map((r) => r.item_id))
    const byId = new Map(((items ?? []) as any[]).map((it) => [it.item_id, it]))
    return rows
      .map((r) => byId.get(r.item_id))
      .filter((it) => it && it.status === 'live')
      .map((it: any) => ({
        item_id: it.item_id,
        product_name: it.product_name,
        brand_name: it.brand?.name ?? null,
        image_url: it.image_url,
        retailer_url: it.retailer_url ?? null,
        price: fmtPrice(it.price, it.currency),
      }))
  } catch {
    return [] // table not migrated yet
  }
}

export async function getOurPicks(limit = 6): Promise<OurPicksData> {
  try {
    const admin = createAdminClient()

    // Headline art: the rainbow Amun as a TRUE cutout — background removed
    // locally (flood-fill from Chloé's supplied product shot) and served as a
    // static transparent PNG, so the bare bag hangs off the lettering.
    const artImageUrl = '/amun-cutout.png'

    // THE CURATED COLLECTION FIRST (managed at /admin/picks). When Chloé has
    // hand-picked items, the section is exactly her collection — live items
    // only ever surface publicly. The automatic selection below is the
    // fallback until the collection exists.
    const curated = await getPickCollection('picks')
    if (curated.length > 0) {
      return { artImageUrl, picks: curated }
    }

    // Items inside the freshest live outfits.
    const { data: outfits } = await admin
      .from('outfit' as any)
      .select('published_at, outfit_item(item(item_id, product_name, image_url, retailer_url, price, currency, status, item_type, pattern, surface, colour_depth, jewellery_scale, brand:brand_id(name)))')
      .eq('status', 'live')
      .order('published_at', { ascending: false })
      .limit(24)

    const seenBrand = new Set<string>()
    const seenType = new Map<string, number>()
    const pool: { it: any; statement: boolean }[] = []
    for (const o of (outfits ?? []) as any[]) {
      for (const oi of o.outfit_item ?? []) {
        const it = oi.item
        if (!it || it.status !== 'live' || !it.image_url) continue
        const statement =
          (it.pattern ?? 1) >= 4 || (it.surface ?? 1) >= 4 || (it.colour_depth ?? 1) >= 4 || (it.jewellery_scale ?? 0) >= 4
        pool.push({ it, statement })
      }
    }
    // Statement pieces first, then editorial variety: max one per brand, max
    // two per garment type.
    pool.sort((a, b) => Number(b.statement) - Number(a.statement))
    const picks: OurPick[] = []
    const pickedIds = new Set<string>()
    for (const { it } of pool) {
      if (picks.length >= limit) break
      if (pickedIds.has(it.item_id)) continue
      const brand = (it.brand?.name ?? '').toLowerCase()
      const type = String(it.item_type)
      if (brand && seenBrand.has(brand)) continue
      if ((seenType.get(type) ?? 0) >= 2) continue
      pickedIds.add(it.item_id)
      if (brand) seenBrand.add(brand)
      seenType.set(type, (seenType.get(type) ?? 0) + 1)
      picks.push({
        item_id: it.item_id,
        product_name: it.product_name,
        brand_name: it.brand?.name ?? null,
        image_url: it.image_url,
        retailer_url: it.retailer_url ?? null,
        price: fmtPrice(it.price, it.currency),
      })
    }

    return { artImageUrl, picks }
  } catch (err) {
    console.error('[getOurPicks]', err)
    return { artImageUrl: null, picks: [] }
  }
}
