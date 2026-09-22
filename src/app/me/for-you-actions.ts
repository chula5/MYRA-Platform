'use server'

// FOR YOU — her home screen: her newest looks, one plain reason each, and one
// tap to answer. Runs for Alison signed in, or for Chloe testing as her from
// HER VIEW (lib/client-member) — in which case nothing she would record is saved.

import { createAdminClient } from '@/lib/supabase-server'
import { revalidatePath } from 'next/cache'
import { resolveClientMember, firstNameOf } from '@/lib/client-member'
import { readStylePrefs } from '@/lib/pilot-stylist'
import { whyThisSuitsHer } from '@/lib/look-why'
import { OCCASION_LABEL } from '@/lib/client-occasions'
import { reactToLook } from './looks/actions'

export interface ForYouLook {
  look_id: string
  image_url: string | null
  occasion_label: string
  /** One plain sentence on why it suits her. */
  why: string
  response: 'yes' | 'no' | null
  pieces: {
    item_id: string | null
    brand: string
    product_name: string
    image_url: string | null
    owned: boolean
    /** Where to buy it, what it costs and what it is — SOURCE ITEMS reads these. */
    url: string | null
    price_gbp: number | null
    item_type: string | null
  }[]
}

export interface ForYouView {
  memberId: string | null
  firstName: string
  /** Chloe testing as her. */
  test: boolean
  looks: ForYouLook[]
  error?: string
}

const NEWEST = 12
const DIM_COLUMNS = 'item_id, retailer_url, image_url, item_type, colour_family, product_name, fit, leg_opening, length, structure, neckline, sleeve, rise, shoulder, waist_definition, pattern'

export async function loadForYou(asMemberId?: string): Promise<ForYouView> {
  const me = await resolveClientMember(asMemberId)
  if (!me) return { memberId: null, firstName: '', test: false, looks: [] }
  const base = { memberId: me.memberId, firstName: firstNameOf(me.name), test: me.test }
  try {
    const admin = createAdminClient() as any
    const [{ data: member }, { data: dels }] = await Promise.all([
      admin.from('pilot_member').select('*').eq('member_id', me.memberId).single(),
      admin.from('pilot_delivery').select('delivery_id, occasion').eq('member_id', me.memberId),
    ])
    const byDelivery = new Map<string, any>(((dels ?? []) as any[]).map((d) => [d.delivery_id, d]))
    if (!byDelivery.size) return { ...base, looks: [] }

    const { data: looks } = await admin.from('pilot_look')
      .select('look_id, delivery_id, image_url, items, response, published_at')
      .in('delivery_id', Array.from(byDelivery.keys()))
      .eq('visible_to_client', true)
      .order('published_at', { ascending: false })
      .limit(NEWEST)

    // The shapes and colours behind each piece, for the plain reason.
    const ids = Array.from(new Set(((looks ?? []) as any[]).flatMap((l) => (l.items ?? []).map((i: any) => i.item_id)).filter(Boolean)))
    const { data: rows } = ids.length ? await admin.from('item').select(DIM_COLUMNS).in('item_id', ids) : { data: [] }
    const dims = new Map<string, any>(((rows ?? []) as any[]).map((r) => [r.item_id, r]))
    const prefs = readStylePrefs(member)

    return {
      ...base,
      looks: ((looks ?? []) as any[]).map((l) => {
        const items = (l.items ?? []) as any[]
        const d = byDelivery.get(l.delivery_id)
        return {
          look_id: l.look_id,
          image_url: l.image_url ?? items.find((i) => i.image_url)?.image_url ?? null,
          occasion_label: d?.occasion ? (OCCASION_LABEL[d.occasion] ?? d.occasion) : 'For you',
          why: whyThisSuitsHer(items.map((it) => ({
            ...(dims.get(it.item_id) ?? {}),
            item_type: it.item_type ?? dims.get(it.item_id)?.item_type ?? null,
            product_name: it.product_name,
            owned: !!it.owned,
          })), prefs),
          response: l.response ?? null,
          pieces: items.map((it) => ({
            item_id: it.item_id ?? null, brand: it.brand ?? '', product_name: it.product_name ?? '',
            image_url: it.image_url ?? dims.get(it.item_id)?.image_url ?? null, owned: !!it.owned,
            url: it.owned ? null : (it.url ?? dims.get(it.item_id)?.retailer_url ?? null),
            price_gbp: it.price_gbp != null ? Number(it.price_gbp) : null,
            item_type: it.item_type ?? dims.get(it.item_id)?.item_type ?? null,
          })),
        }
      }),
    }
  } catch (err) {
    return { ...base, looks: [], error: err instanceof Error ? err.message : 'Could not load your looks' }
  }
}

/** One tap: "I'd wear this" / "Not for me". Chloe's test taps record nothing. */
export async function answerLook(lookId: string, verdict: 'yes' | 'no', asMemberId?: string): Promise<{ error?: string; test?: boolean }> {
  const me = await resolveClientMember(asMemberId)
  if (!me) return { error: 'Not signed in' }
  if (me.test) return { test: true }
  const r = await reactToLook(lookId, verdict, null, '')
  revalidatePath('/me')
  return r
}

/** The optional why, after "Not for me" — the same feedback path, now with her reason. */
export async function explainAnswer(
  lookId: string, verdict: 'yes' | 'no', reason: string | null, words: string, asMemberId?: string,
): Promise<{ error?: string; test?: boolean }> {
  const me = await resolveClientMember(asMemberId)
  if (!me) return { error: 'Not signed in' }
  if (me.test) return { test: true }
  const r = await reactToLook(lookId, verdict, reason, words)
  revalidatePath('/me')
  return r
}
