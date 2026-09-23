// MYRA Mirror — save a piece from any brand site.
//
// A heart on a tile becomes: an item row MYRA can reason about, a row in her
// cross-site saved list, a stock subscription frozen to HER sizes, and a size
// baseline for the sentinel to diff against — so "sold out in your size" and
// "back in your size" arrive for a piece MYRA had never stocked. Members with
// an auth user also get the ordinary saved_item so /edit shows it.

import 'server-only'
import { createAdminClient } from '@/lib/supabase-server'
import { subscribeToItems, unsubscribe, listUserAlerts } from '@/lib/stock-alerts'
import { loadMemberSizeProfile, upsertSizeAvailability } from '@/lib/size-availability'
import { checkStockDetailed } from '@/app/admin/items/stock-check'
import { ensureMirrorItem, type SiteProduct } from './style'
import type { MirrorMember } from './auth'

const MIGRATION_HINT = 'Run migration 0060 in Supabase first — saves across sites live in member_saved_item.'

const hostOf = (url: string) => { try { return new URL(url).host.replace(/^www\./, '') } catch { return null } }
const baseOf = (url: string) => { try { const u = new URL(url); return `${u.origin}${u.pathname}` } catch { return url.split(/[?#]/)[0] } }
/** Subscriptions and alerts key on the auth user when she has one, else the member id. */
export const alertKeyFor = (m: MirrorMember) => m.auth_user_id ?? m.member_id

async function countSaves(admin: any, memberId: string): Promise<number> {
  const { count } = await admin.from('member_saved_item').select('item_id', { count: 'exact', head: true }).eq('member_id', memberId)
  return count ?? 0
}

export async function saveForMember(member: MirrorMember, product: SiteProduct): Promise<{ saved?: true; item_id?: string; count?: number; error?: string }> {
  const admin = createAdminClient() as any
  const ensured = await ensureMirrorItem(product, member, admin, { score: false })
  if (!ensured.item) return { error: ensured.error ?? 'Could not read this piece' }
  const item = ensured.item

  const { error } = await admin.from('member_saved_item')
    .upsert({ member_id: member.member_id, item_id: item.item_id, source_host: hostOf(product.url) }, { onConflict: 'member_id,item_id' })
  if (error) return { error: /schema cache|does not exist/i.test(error.message) ? MIGRATION_HINT : error.message }

  if (member.auth_user_id) {
    try { await admin.from('saved_item').upsert({ user_id: member.auth_user_id, item_id: item.item_id }, { onConflict: 'user_id,item_id' }) } catch { /* optional mirror */ }
  }

  // Size baseline: the variants the page already told us, else one fetch.
  try {
    const entries = (product.sizes ?? []).map((s) => ({ label: s.label, inStock: s.available, level: (s.available ? 'in_stock' : 'sold_out') as 'in_stock' | 'sold_out' }))
    if (entries.length) await upsertSizeAvailability(item.item_id, entries, { itemType: item.item_type })
    else {
      const detail = await checkStockDetailed(product.url)
      if (detail.sizes.length) await upsertSizeAvailability(item.item_id, detail.sizes, { itemType: item.item_type })
    }
  } catch (err) { console.error('[mirror/save] size baseline', err) }

  const ctx = await loadMemberSizeProfile(member.member_id)
  await subscribeToItems(alertKeyFor(member), [{ item_id: item.item_id, item_type: item.item_type }], 'saved_item', null, ctx)
  return { saved: true, item_id: item.item_id, count: await countSaves(admin, member.member_id) }
}

export async function unsaveForMember(member: MirrorMember, url: string): Promise<{ saved: false; count?: number; error?: string }> {
  const admin = createAdminClient() as any
  const { data } = await admin.from('item').select('item_id').like('retailer_url', `${baseOf(url)}%`).limit(1)
  const itemId = data?.[0]?.item_id
  if (!itemId) return { saved: false, count: await countSaves(admin, member.member_id) }
  await admin.from('member_saved_item').delete().eq('member_id', member.member_id).eq('item_id', itemId)
  if (member.auth_user_id) { try { await admin.from('saved_item').delete().eq('user_id', member.auth_user_id).eq('item_id', itemId) } catch { /* optional */ } }
  await unsubscribe(alertKeyFor(member), itemId, 'saved_item')
  return { saved: false, count: await countSaves(admin, member.member_id) }
}

export interface SavedPiece {
  item_id: string
  product_name: string
  brand: string | null
  image_url: string | null
  price_gbp: number | null
  url: string | null
  host: string | null
  saved_at: string
  sold: boolean
  out_of_stock: boolean
}

export async function listSavesForMember(member: MirrorMember): Promise<{ saves: SavedPiece[]; alerts: any[]; urls: string[]; error?: string }> {
  const admin = createAdminClient() as any
  const { data, error } = await admin.from('member_saved_item')
    .select('saved_at, source_host, item:item_id(item_id, product_name, image_url, price_gbp, retailer_url, status, stock_status, brand:brand_id(name))')
    .eq('member_id', member.member_id).order('saved_at', { ascending: false }).limit(200)
  if (error) return { saves: [], alerts: [], urls: [], error: /schema cache|does not exist/i.test(error.message) ? MIGRATION_HINT : error.message }
  const saves: SavedPiece[] = (data ?? []).filter((r: any) => r.item).map((r: any) => ({
    item_id: r.item.item_id,
    product_name: r.item.product_name,
    brand: r.item.brand?.name ?? null,
    image_url: r.item.image_url ?? null,
    price_gbp: r.item.price_gbp != null ? Number(r.item.price_gbp) : null,
    url: r.item.retailer_url ?? null,
    host: r.source_host ?? null,
    saved_at: r.saved_at,
    sold: r.item.status === 'sold',
    out_of_stock: r.item.stock_status === 'out_of_stock',
  }))
  const ids = new Set(saves.map((s) => s.item_id))
  const alerts = (await listUserAlerts(alertKeyFor(member), 60)).filter((a) => ids.has(a.item_id))
  return { saves, alerts, urls: saves.map((s) => s.url).filter(Boolean) as string[] }
}
