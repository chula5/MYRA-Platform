'use server'

// OUR PICKS admin — curate the collections shown on the public feed:
//   'picks' → the OUR PICKS grid under New Outfits
//   'bags'  → the destination when the headline bag is clicked
// Only LIVE items ever surface publicly; anything else is flagged here.

import { createAdminClient } from '@/lib/supabase-server'
import { revalidatePath } from 'next/cache'

export type PickCollection = 'picks' | 'bags' | 'mint'

export interface AdminPickRow {
  id: string
  collection: string
  /** 'item' rows point at a product; 'outfit' rows at a complete look. */
  kind: 'item' | 'outfit'
  /** Empty string on outfit rows. */
  item_id: string
  outfit_id?: string | null
  sort_order: number
  product_name: string
  brand_name: string | null
  image_url: string | null
  item_type: string
  status: string
  price: string | null
}

export async function listPicks(): Promise<Record<PickCollection, AdminPickRow[]>> {
  const empty: Record<PickCollection, AdminPickRow[]> = { picks: [], bags: [], mint: [] }
  try {
    const admin = createAdminClient()
    // Two-step join: our_pick has no FK to item, so PostgREST's embedded
    // select can't resolve the relationship — fetch items separately.
    // outfit_id only exists once migration 0051 has run. Selecting a missing
    // column errors the whole query, which would blank EVERY collection —
    // including the item curation that predates it — so fall back to the
    // pre-0051 shape rather than showing an empty studio.
    let { data, error } = await admin
      .from('our_pick' as any)
      .select('id, collection, item_id, outfit_id, sort_order')
      .order('sort_order', { ascending: true })
    if (error) {
      const retry = await admin
        .from('our_pick' as any)
        .select('id, collection, item_id, sort_order')
        .order('sort_order', { ascending: true })
      if (retry.error) throw retry.error
      data = retry.data
    }
    const rows = (data ?? []) as any[]
    if (!rows.length) return empty
    const itemIds = rows.map((r) => r.item_id).filter(Boolean)
    const outfitIds = rows.map((r) => r.outfit_id).filter(Boolean)
    const { data: items } = itemIds.length
      ? await admin
          .from('item' as any)
          .select('item_id, product_name, image_url, item_type, status, price, brand:brand_id(name)')
          .in('item_id', itemIds)
      : { data: [] as any[] }
    // Outfit picks (the look collections) resolve against outfit instead.
    const { data: outfits } = outfitIds.length
      ? await admin
          .from('outfit' as any)
          .select('outfit_id, aesthetic_label, image_url, status')
          .in('outfit_id', outfitIds)
      : { data: [] as any[] }
    const byId = new Map(((items ?? []) as any[]).map((it) => [it.item_id, it]))
    const byOutfit = new Map(((outfits ?? []) as any[]).map((o) => [o.outfit_id, o]))
    for (const r of rows) {
      const isOutfit = !!r.outfit_id
      const it = byId.get(r.item_id)
      const of = byOutfit.get(r.outfit_id)
      const row: AdminPickRow = {
        id: r.id,
        collection: r.collection,
        kind: isOutfit ? 'outfit' : 'item',
        item_id: r.item_id ?? '',
        outfit_id: r.outfit_id ?? null,
        sort_order: r.sort_order,
        product_name: isOutfit
          ? (String(of?.aesthetic_label ?? '').replace(/^COMPOSED\s*·\s*/i, '').trim() || 'UNTITLED LOOK')
          : (it?.product_name ?? '—'),
        brand_name: isOutfit ? null : (it?.brand?.name ?? null),
        image_url: (isOutfit ? of?.image_url : it?.image_url) ?? null,
        item_type: isOutfit ? 'outfit' : String(it?.item_type ?? ''),
        status: (isOutfit ? of?.status : it?.status) ?? 'unknown',
        price: isOutfit ? null : (it?.price ?? null),
      }
      if (r.collection === 'bags') empty.bags.push(row)
      else if (r.collection === 'mint') empty.mint.push(row)
      else empty.picks.push(row)
    }
    return empty
  } catch (err) {
    console.error('[listPicks]', err)
    return empty
  }
}

const BAG_TYPES = ['tote', 'shoulder_bag', 'clutch', 'crossbody', 'structured_bag']

export async function searchPickItems(
  q: string,
  collection: PickCollection,
  filters?: { brand?: string; itemType?: string; colour?: string },
): Promise<{ item_id: string; product_name: string; brand_name: string | null; image_url: string | null; item_type: string; status: string }[]> {
  try {
    const admin = createAdminClient()
    // Drafts are pickable in ADMIN (badged, so you can curate ahead of going
    // live) — the public pages still only ever show live items.
    //
    // out_of_stock is included deliberately. The stock sentinel moves items to
    // that status, and leaving it out meant a piece you KNOW you own simply
    // vanished from this picker with no explanation. It's badged like any
    // other non-live status, and getPickCollection still keeps it off the site.
    //
    // Ordering matters as much as the limit: without it Postgres returns an
    // arbitrary slice, so the same search could show a piece one time and not
    // the next. Newest first is both deterministic and the useful default.
    let query = admin
      .from('item' as any)
      .select('item_id, product_name, image_url, item_type, status, colour_family, brand:brand_id(name)')
      .in('status', ['draft', 'ready', 'live', 'out_of_stock'])
      .order('created_at', { ascending: false })
      .limit(200)
    // Brand filters SERVER-SIDE, before the row limit — filtering in memory
    // after a limit silently hid most of a brand's items. Case-insensitive so
    // near-duplicate brand rows still resolve.
    if (filters?.brand) {
      const { data: brands } = await admin
        .from('brand' as any)
        .select('brand_id')
        .ilike('name', filters.brand.trim())
      const ids = ((brands ?? []) as any[]).map((b) => b.brand_id)
      if (!ids.length) return []
      query = query.in('brand_id', ids)
    }
    // The bags collection defaults to bag types unless a type/query overrides.
    if (collection === 'bags' && !q.trim() && !filters?.itemType) query = query.in('item_type', BAG_TYPES)
    // Text search matches PRODUCT NAME OR BRAND NAME ("cult" finds Cult Gaia).
    if (q.trim()) {
      const needle = q.trim()
      const { data: qBrands } = await admin
        .from('brand' as any)
        .select('brand_id')
        .ilike('name', `%${needle}%`)
      const qids = ((qBrands ?? []) as any[]).map((b) => b.brand_id)
      query = qids.length
        ? query.or(`product_name.ilike.%${needle}%,brand_id.in.(${qids.join(',')})`)
        : query.ilike('product_name', `%${needle}%`)
    }
    if (filters?.itemType) query = query.eq('item_type', filters.itemType)
    if (filters?.colour) query = query.eq('colour_family', filters.colour)
    const { data } = await query
    const rows = (data ?? []) as any[]
    return rows.map((it) => ({
      item_id: it.item_id,
      product_name: it.product_name,
      brand_name: it.brand?.name ?? null,
      image_url: it.image_url,
      item_type: String(it.item_type),
      status: it.status,
    }))
  } catch {
    return []
  }
}

// Brand list for the filter dropdown (every brand with non-archived items —
// drafts included, since drafts are curatable ahead of going live).
export async function listPickBrands(): Promise<{ name: string; count: number }[]> {
  try {
    const admin = createAdminClient()
    const { data } = await admin
      .from('item' as any)
      .select('brand:brand_id(name)')
      .in('status', ['draft', 'ready', 'live'])
      .limit(10000)
    const counts = new Map<string, number>()
    for (const r of (data ?? []) as any[]) {
      const b = (r.brand?.name ?? '').trim()
      if (b) counts.set(b, (counts.get(b) ?? 0) + 1)
    }
    return [...counts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => a.name.localeCompare(b.name))
  } catch {
    return []
  }
}

/** Live/draft outfits for the outfit-based collections (e.g. Mint Green).
 *  Matches the aesthetic label, or the name/brand of any item in the look, so
 *  "proenza" or "mint" both find it. */
export async function searchPickOutfits(
  q: string,
): Promise<{ outfit_id: string; label: string; image_url: string | null; status: string }[]> {
  try {
    const admin = createAdminClient()
    const needle = q.trim()

    let outfitIdsFromItems: string[] = []
    if (needle) {
      // Items whose product OR brand name matches, then the looks holding them.
      const { data: brands } = await admin
        .from('brand' as any).select('brand_id').ilike('name', `%${needle}%`)
      const bids = ((brands ?? []) as any[]).map((b) => b.brand_id)
      let itemQuery = admin.from('item' as any).select('item_id').limit(400)
      itemQuery = bids.length
        ? itemQuery.or(`product_name.ilike.%${needle}%,brand_id.in.(${bids.join(',')})`)
        : itemQuery.ilike('product_name', `%${needle}%`)
      const { data: items } = await itemQuery
      const iids = ((items ?? []) as any[]).map((i) => i.item_id)
      if (iids.length) {
        const { data: links } = await admin
          .from('outfit_item' as any).select('outfit_id').in('item_id', iids).limit(2000)
        outfitIdsFromItems = Array.from(new Set(((links ?? []) as any[]).map((l) => l.outfit_id)))
      }
    }

    let query = admin
      .from('outfit' as any)
      .select('outfit_id, aesthetic_label, image_url, status, created_at')
      .in('status', ['live', 'draft', 'in_review'])
      .order('created_at', { ascending: false })
      .limit(120)
    if (needle) {
      query = outfitIdsFromItems.length
        ? query.or(`aesthetic_label.ilike.%${needle}%,outfit_id.in.(${outfitIdsFromItems.join(',')})`)
        : query.ilike('aesthetic_label', `%${needle}%`)
    }
    const { data } = await query
    return ((data ?? []) as any[]).map((o) => ({
      outfit_id: o.outfit_id,
      label: String(o.aesthetic_label ?? '').replace(/^COMPOSED\s*·\s*/i, '').trim() || 'UNTITLED LOOK',
      image_url: o.image_url ?? null,
      status: o.status,
    }))
  } catch (err) {
    console.error('[searchPickOutfits]', err)
    return []
  }
}

export async function addOutfitPick(
  collection: PickCollection,
  outfitId: string,
): Promise<{ ok?: true; error?: string }> {
  try {
    const admin = createAdminClient()
    const { data: max } = await admin
      .from('our_pick' as any)
      .select('sort_order')
      .eq('collection', collection)
      .order('sort_order', { ascending: false })
      .limit(1)
      .maybeSingle()
    const { error } = await (admin.from('our_pick') as any).insert({
      collection,
      outfit_id: outfitId,
      sort_order: ((max as any)?.sort_order ?? -1) + 1,
    })
    if (error) throw error
    revalidatePath('/admin/picks')
    revalidatePath('/')
    revalidatePath(`/picks/${collection}`)
    return { ok: true }
  } catch (err: any) {
    const msg: string = err?.message ?? 'Add failed'
    console.error('[addOutfitPick]', msg, err?.code ?? '')
    if (/column .*outfit_id.* does not exist/i.test(msg)) {
      return { error: 'Run migration 0051 first — our_pick has no outfit_id column yet.' }
    }
    return { error: /duplicate|unique/i.test(msg) ? 'Already in this collection' : msg }
  }
}

export async function addPick(collection: PickCollection, itemId: string): Promise<{ ok?: true; error?: string }> {
  try {
    const admin = createAdminClient()
    const { data: max } = await admin
      .from('our_pick' as any)
      .select('sort_order')
      .eq('collection', collection)
      .order('sort_order', { ascending: false })
      .limit(1)
      .maybeSingle()
    const { error } = await (admin.from('our_pick') as any).insert({
      collection,
      item_id: itemId,
      sort_order: ((max as any)?.sort_order ?? -1) + 1,
    })
    if (error) throw error
    revalidatePath('/admin/picks')
    revalidatePath('/')
    revalidatePath('/picks/bags')
    return { ok: true }
  } catch (err: any) {
    // Supabase errors are plain objects, not Error instances — read .message
    // directly or every real cause collapses into a generic "Add failed".
    const msg: string = err?.message ?? 'Add failed'
    console.error('[addPick]', msg, err?.code ?? '')
    return { error: /duplicate|unique/i.test(msg) ? 'Already in this collection' : msg }
  }
}

export async function removePick(id: string): Promise<{ ok: true }> {
  try {
    const admin = createAdminClient()
    await admin.from('our_pick' as any).delete().eq('id', id)
    revalidatePath('/admin/picks')
    revalidatePath('/')
    revalidatePath('/picks/bags')
  } catch (err) {
    console.error('[removePick]', err)
  }
  return { ok: true }
}

/**
 * Make this pick the collection's LEAD — first in display order, and so the
 * image used for the collection's tile in OUR PICKS. Ordering already decided
 * the tile implicitly; this makes it a deliberate one-click choice instead of
 * something you have to arrive at with the arrows.
 */
export async function makeTileImage(id: string): Promise<{ ok: true }> {
  try {
    const admin = createAdminClient()
    const { data: row } = await admin.from('our_pick' as any).select('*').eq('id', id).maybeSingle()
    if (!row) return { ok: true }
    const r = row as any
    const { data: first } = await admin
      .from('our_pick' as any)
      .select('sort_order')
      .eq('collection', r.collection)
      .order('sort_order', { ascending: true })
      .limit(1)
      .maybeSingle()
    const lowest = (first as any)?.sort_order ?? 0
    if (lowest === r.sort_order) return { ok: true } // already the lead
    await (admin.from('our_pick') as any).update({ sort_order: lowest - 1 }).eq('id', r.id)
    revalidatePath('/admin/picks')
    revalidatePath('/')
    revalidatePath(`/picks/${r.collection}`)
  } catch (err) {
    console.error('[makeTileImage]', err)
  }
  return { ok: true }
}

export async function movePick(id: string, direction: 'up' | 'down'): Promise<{ ok: true }> {
  try {
    const admin = createAdminClient()
    const { data: row } = await admin.from('our_pick' as any).select('*').eq('id', id).maybeSingle()
    if (!row) return { ok: true }
    const r = row as any
    const { data: neighbour } = await admin
      .from('our_pick' as any)
      .select('*')
      .eq('collection', r.collection)
      [direction === 'up' ? 'lt' : 'gt']('sort_order', r.sort_order)
      .order('sort_order', { ascending: direction === 'down' })
      .limit(1)
      .maybeSingle()
    if (!neighbour) return { ok: true }
    const n = neighbour as any
    await (admin.from('our_pick') as any).update({ sort_order: n.sort_order }).eq('id', r.id)
    await (admin.from('our_pick') as any).update({ sort_order: r.sort_order }).eq('id', n.id)
    revalidatePath('/admin/picks')
    revalidatePath('/')
    revalidatePath('/picks/bags')
  } catch (err) {
    console.error('[movePick]', err)
  }
  return { ok: true }
}
