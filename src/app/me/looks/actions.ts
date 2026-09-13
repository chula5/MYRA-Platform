'use server'

// HER LOOKS — the client side of the private stylist.
//
// Everything here is scoped by the signed-in user, resolved to her pilot
// member record through pilot_member.auth_user_id. A client can only ever see
// looks flagged visible_to_client: composing for her happens live, and until
// the confidence gate proves itself on her own history, "visible" means it was
// sent by hand.
//
// Her reactions write through the SAME path the admin review uses, so there is
// one feedback trail and the scorecard cannot disagree with what she said.

import { createServerClient, createAdminClient } from '@/lib/supabase-server'
import { revalidatePath } from 'next/cache'
import { recordMemberLookFeedback } from '@/app/admin/private-stylist/actions'

export interface ClientLookItem {
  item_id: string | null
  brand: string
  product_name: string
  item_type: string | null
  price_gbp: number | null
  image_url: string | null
  url: string | null
  owned: boolean
}

export interface ClientLook {
  look_id: string
  position: number
  image_url: string | null
  occasion_label: string
  request_text: string | null
  items: ClientLookItem[]
  response: 'yes' | 'no' | null
  published_at: string | null
}

export interface ClientView {
  memberId: string | null
  name: string
  looks: ClientLook[]
  unread: number
  error?: string
}

const OCCASION_LABEL: Record<string, string> = {
  work_standard: 'Work', work_elevated: 'Work — client days',
  casual_day: 'Daytime', dinner_drinks: 'Dinners and drinks',
  event: 'Occasions', travel: 'Trips',
}

/** The member record behind the signed-in client, or null if she has none. */
export async function memberForCurrentUser(): Promise<{ memberId: string; name: string } | null> {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const admin = createAdminClient() as any
  const { data } = await admin
    .from('pilot_member').select('member_id, name').eq('auth_user_id', user.id).maybeSingle()
  return data ? { memberId: data.member_id, name: data.name } : null
}

export async function loadMyLooks(): Promise<ClientView> {
  const empty: ClientView = { memberId: null, name: '', looks: [], unread: 0 }
  try {
    const me = await memberForCurrentUser()
    if (!me) return empty
    const admin = createAdminClient() as any

    const { data: dels } = await admin
      .from('pilot_delivery').select('delivery_id, occasion, request_text').eq('member_id', me.memberId)
    const byDelivery = new Map((dels ?? []).map((d: any) => [d.delivery_id, d]))
    const ids = Array.from(byDelivery.keys())
    if (!ids.length) return { ...empty, memberId: me.memberId, name: me.name }

    const { data: looks } = await admin
      .from('pilot_look')
      .select('look_id, delivery_id, position, image_url, items, response, published_at')
      .in('delivery_id', ids)
      .eq('visible_to_client', true)
      .order('published_at', { ascending: false })

    const { count: unread } = await admin
      .from('pilot_notification').select('notification_id', { count: 'exact', head: true })
      .eq('member_id', me.memberId).is('read_at', null)

    return {
      memberId: me.memberId,
      name: me.name,
      unread: unread ?? 0,
      looks: (looks ?? []).map((l: any) => {
        const d: any = byDelivery.get(l.delivery_id)
        return {
          look_id: l.look_id,
          position: l.position,
          image_url: l.image_url,
          occasion_label: d?.occasion ? (OCCASION_LABEL[d.occasion] ?? d.occasion) : 'For you',
          request_text: d?.request_text ?? null,
          response: l.response ?? null,
          published_at: l.published_at,
          items: ((l.items ?? []) as any[]).map((it) => ({
            item_id: it.item_id ?? null,
            brand: it.brand ?? '',
            product_name: it.product_name ?? '',
            item_type: it.item_type ?? it.slot ?? null,
            price_gbp: typeof it.price_gbp === 'number' ? it.price_gbp : null,
            image_url: it.image_url ?? null,
            url: it.url ?? null,
            owned: !!it.owned,
          })),
        }
      }),
    }
  } catch (err) {
    return { ...empty, error: err instanceof Error ? err.message : 'Could not load your looks' }
  }
}

/**
 * Her verdict on a look, in her own words.
 *
 * Routed through the admin review path rather than writing its own rows: that
 * path already feeds the taste vector, the brand affinities and the persona
 * fade, and a second feedback trail would let the scorecard and the client
 * disagree about what she said.
 */
export async function reactToLook(
  lookId: string,
  verdict: 'yes' | 'no',
  reason: string | null,
  words: string,
): Promise<{ error?: string }> {
  const me = await memberForCurrentUser()
  if (!me) return { error: 'Not signed in' }

  // She can only react to a look that is hers and that she can actually see.
  const admin = createAdminClient() as any
  const { data: look } = await admin
    .from('pilot_look')
    .select('look_id, visible_to_client, delivery:delivery_id!inner(member_id)')
    .eq('look_id', lookId).maybeSingle()
  if (!look || (look.delivery as any)?.member_id !== me.memberId || !look.visible_to_client) {
    return { error: 'That look is not yours' }
  }

  const r = await recordMemberLookFeedback(lookId, verdict, (reason as any) ?? null, words)
  if (r?.error) return { error: r.error }
  revalidatePath('/me/looks')
  return {}
}

/** Mark her notifications read once she has seen the page. */
export async function markNotificationsRead(): Promise<void> {
  const me = await memberForCurrentUser()
  if (!me) return
  const admin = createAdminClient() as any
  await admin.from('pilot_notification')
    .update({ read_at: new Date().toISOString() })
    .eq('member_id', me.memberId).is('read_at', null)
}
