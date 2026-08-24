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
  item_id: string
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
    const { data } = await admin
      .from('our_pick' as any)
      .select('id, collection, item_id, sort_order')
      .order('sort_order', { ascending: true })
    const rows = (data ?? []) as any[]
    if (!rows.length) return empty
    const { data: items } = await admin
      .from('item' as any)
      .select('item_id, product_name, image_url, item_type, status, price, brand:brand_id(name)')
      .in('item_id', rows.map((r) => r.item_id))
    const byId = new Map(((items ?? []) as any[]).map((it) => [it.item_id, it]))
    for (const r of rows) {
      const it = byId.get(r.item_id)
      const row: AdminPickRow = {
        id: r.id,
        collection: r.collection,
        item_id: r.item_id,
        sort_order: r.sort_order,
        product_name: it?.product_name ?? '—',
        brand_name: it?.brand?.name ?? null,
        image_url: it?.image_url ?? null,
        item_type: String(it?.item_type ?? ''),
        status: it?.status ?? 'unknown',
        price: it?.price ?? null,
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
    let query = admin
      .from('item' as any)
      .select('item_id, product_name, image_url, item_type, status, colour_family, brand:brand_id(name)')
      .in('status', ['draft', 'ready', 'live'])
      .limit(120)
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
