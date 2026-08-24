// OUR PICKS — the editorial item moment under the New Outfits feed.
// Headline art: the Cult Gaia Amun bag hanging out of the lettering.
// Picks: standout items from the newest live outfits — one per brand, mixed
// piece types, statement pieces first — always shoppable (live items only).
import 'server-only'
import { createAdminClient } from '@/lib/supabase-server'
import { PICK_COLLECTIONS } from '@/lib/pick-collections'

export interface OurPick {
  item_id: string
  product_name: string
  brand_name: string | null
  image_url: string
  retailer_url: string | null
  price: string
}

/** A curated collection surfaced as a tile in the OUR PICKS section. */
export interface LandingCollection {
  slug: string
  label: string
  href: string
  /** Static cutout if the collection has one, else the lead item's photo. */
  artImageUrl: string
  /** The lead photo untransformed — what the tile shows if the cutout fails. */
  rawImageUrl?: string
}

export interface OurPicksData {
  artImageUrl: string | null
  picks: OurPick[]
  /** Curated collections with at least one live item, in config order. */
  collections: LandingCollection[]
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
      // The look's own hero, NOT the last additional image. When a Higgsfield
      // shoot lands, generateHiggsfieldShootForOutfit promotes the render to
      // image_url and pushes the PREVIOUS display — the anchor's flat-lay
      // product shot — onto the end of additional_images. Reading the last
      // extra therefore showed the product photo again instead of the model
      // wearing the piece, which is the whole point of these thumbs.
      const extra = Array.isArray(o.additional_images) ? o.additional_images : []
      const arr = byItem.get(r.item_id) ?? []
      if (arr.some((x) => x.outfit_id === o.outfit_id)) continue
      arr.push({
        outfit_id: o.outfit_id,
        image_url: o.image_url ?? extra[extra.length - 1] ?? null,
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
      // Drafts DO surface in a curated collection: these are hand-picked, so
      // the curation itself is the editorial gate rather than the item's
      // workflow status (MYRA's library sits almost entirely at draft). Only
      // genuinely unusable states are withheld — archived pieces are retired
      // and out_of_stock ones can't be bought.
      .filter((it) => it && !['archived', 'out_of_stock'].includes(String(it.status)))
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

/** One curated look in an outfit-based collection (e.g. 'mint'). */
export interface PickOutfit {
  outfit_id: string
  label: string
  image_url: string | null
}

/**
 * A curated collection of OUTFITS, in her order — live looks only, so a paused
 * or draft outfit never reaches the public page.
 */
export async function getOutfitCollection(collection: string): Promise<PickOutfit[]> {
  try {
    const admin = createAdminClient()
    const { data } = await admin
      .from('our_pick' as any)
      .select('outfit_id, sort_order')
      .eq('collection', collection)
      .not('outfit_id', 'is', null)
      .order('sort_order', { ascending: true })
    const rows = (data ?? []) as any[]
    if (!rows.length) return []
    const { data: outfits } = await admin
      .from('outfit' as any)
      .select('outfit_id, aesthetic_label, image_url, status')
      .in('outfit_id', rows.map((r) => r.outfit_id))
    const byId = new Map(((outfits ?? []) as any[]).map((o) => [o.outfit_id, o]))
    return rows
      .map((r) => byId.get(r.outfit_id))
      .filter((o) => o && o.status === 'live')
      .map((o: any) => ({
        outfit_id: o.outfit_id,
        label: String(o.aesthetic_label ?? '').replace(/^COMPOSED\s*·\s*/i, '').trim(),
        image_url: o.image_url ?? null,
      }))
  } catch {
    return [] // column not migrated yet
  }
}

/**
 * Cloudinary background removal for a tile image. Returns the URL untouched
 * when it isn't a Cloudinary asset (nothing to transform) or already carries a
 * transform. If the account can't serve the effect, Cloudinary errors on that
 * derived URL and the tile falls back to the plain photo.
 */
function cutoutUrl(url: string): string {
  if (!url.includes('res.cloudinary.com')) return url
  const i = url.indexOf('/upload/')
  if (i === -1) return url
  const after = url.slice(i + 8)
  if (/^e_/.test(after)) return url
  return `${url.slice(0, i + 8)}e_background_removal/f_png/${after}`
}

/**
 * The collection tiles for the landing section. A collection only appears once
 * it has at least one LIVE curated entry — so a new slug can ship before it's
 * curated without leaving a dead link on the homepage. Collections without a
 * hand-made cutout borrow their lead entry's photo as the tile art, which is
 * the first product for an item collection and the first look for an outfit
 * one.
 */
export async function getLandingCollections(): Promise<LandingCollection[]> {
  const out: LandingCollection[] = []
  for (const c of PICK_COLLECTIONS) {
    // Static art alone is NOT enough to publish a tile — the destination has
    // to have something in it, or the homepage links to an empty page.
    const images =
      c.kind === 'outfit'
        ? (await getOutfitCollection(c.slug)).map((o) => o.image_url)
        : (await getPickCollection(c.slug)).map((i) => i.image_url)
    if (images.length === 0) continue
    const lead = images.find(Boolean)
    const art = c.art ?? (lead && c.cutout ? cutoutUrl(lead) : lead)
    if (!art) continue
    out.push({
      slug: c.slug,
      label: c.label,
      href: `/picks/${c.slug}`,
      artImageUrl: art,
      // Keep the untouched photo so the tile can fall back to it.
      rawImageUrl: lead ?? art,
    })
  }
  return out
}

export async function getOurPicks(limit = 6): Promise<OurPicksData> {
  try {
    const admin = createAdminClient()

    // Headline art: the rainbow Amun as a TRUE cutout — background removed
    // locally (flood-fill from Chloé's supplied product shot) and served as a
    // static transparent PNG, so the bare bag hangs off the lettering.
    const artImageUrl = '/amun-cutout.png'

    // Curated collection tiles (bags, mint …) shown beside the headline.
    const collections = await getLandingCollections()

    // THE CURATED COLLECTION FIRST (managed at /admin/picks). When Chloé has
    // hand-picked items, the section is exactly her collection — live items
    // only ever surface publicly. The automatic selection below is the
    // fallback until the collection exists.
    const curated = await getPickCollection('picks')
    if (curated.length > 0) {
      return { artImageUrl, picks: curated, collections }
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

    return { artImageUrl, picks, collections }
  } catch (err) {
    console.error('[getOurPicks]', err)
    return { artImageUrl: null, picks: [], collections: [] }
  }
}
