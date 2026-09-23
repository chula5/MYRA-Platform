// MYRA Mirror — stylist mode: hold a piece (or a composed look) from a brand
// site in a member's next delivery. Chloe, shopping as Alison, taps HOLD; the
// piece lands as an unapproved look in a draft delivery, exactly where her
// other candidates live, and nothing reaches Alison until Chloe approves it
// in /admin/private-stylist. Same createDelivery / saveLook as the studio.

import 'server-only'
import { createAdminClient } from '@/lib/supabase-server'
import { createDelivery, saveLook } from '@/app/admin/private-stylist/actions'
import type { LookItem, OccasionId } from '@/lib/pilot-stylist'
import { ensureMirrorItem, type SiteProduct } from './style'
import type { MirrorMember } from './auth'

export const HOLD_REQUEST_TEXT = 'Held from brand sites (MYRA Mirror)'

export interface HoldResult { delivery_id?: string; look_id?: string; held?: number; error?: string }

export async function holdForMember(member: MirrorMember, product: SiteProduct, look?: LookItem[] | null): Promise<HoldResult> {
  const admin = createAdminClient() as any
  const ensured = await ensureMirrorItem(product, member, admin)
  if (!ensured.item) return { error: ensured.error ?? 'Could not read this piece' }
  const hero = ensured.item
  const host = (() => { try { return new URL(product.url).host.replace(/^www\./, '') } catch { return 'a brand site' } })()

  const { data: memberRow } = await admin.from('pilot_member').select('member_id, room_weights').eq('member_id', member.member_id).single()
  if (!memberRow) return { error: 'Member not found' }

  // One open "held" delivery per member; a new one only when none is open.
  const { data: open } = await admin.from('pilot_delivery').select('delivery_id')
    .eq('member_id', member.member_id).eq('status', 'draft').eq('request_text', HOLD_REQUEST_TEXT)
    .order('created_at', { ascending: false }).limit(1)
  let deliveryId: string | undefined = open?.[0]?.delivery_id
  if (!deliveryId) {
    const created = await createDelivery({ member_id: member.member_id, trigger: 'request', request_text: HOLD_REQUEST_TEXT, occasion: 'casual_day' as OccasionId })
    if (!created.delivery_id) return { error: created.error ?? 'Could not open a delivery' }
    deliveryId = created.delivery_id
  }

  const { count } = await admin.from('pilot_look').select('look_id', { count: 'exact', head: true }).eq('delivery_id', deliveryId)
  const heroItem: LookItem = {
    brand: hero.brand?.name ?? product.brand ?? '',
    product_name: hero.product_name,
    price_gbp: hero.price_gbp ?? product.price ?? null,
    url: product.url,
    owned: false,
    item_id: hero.item_id,
    brand_id: hero.brand_id ?? null,
    image_url: hero.image_url ?? null,
    item_type: hero.item_type ?? null,
  }
  const items = look && look.length ? look : [heroItem]
  const saved = await saveLook({
    delivery_id: deliveryId,
    position: (count ?? 0) + 1,
    room_mix: memberRow.room_weights,
    items,
    notes: `Held on ${host} via MYRA Mirror${look && look.length ? ' — composed look' : ''}`,
  })
  if (!saved.look_id) return { error: saved.error ?? 'Could not hold this piece' }
  return { delivery_id: deliveryId, look_id: saved.look_id, held: (count ?? 0) + 1 }
}
