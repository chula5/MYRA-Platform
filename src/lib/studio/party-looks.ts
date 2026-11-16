// PARTY SEASON — three looks styled for her for the Christmas party and New
// Year's Eve weeks, composed by the one composer (composeDeliveryLooks: her
// size, her bands, her avoids, Claude's check) as a held delivery, and sent
// as an email once Chloe has read the drafts. Chloe's ask, 2026-11-15: "some
// outfits styled for them, maybe for christmas party season / new years".
//
// The delivery stays a draft (looks not visible to her) until the email goes:
// sending publishes the looks first, so SEE THE LOOK opens in her app, and a
// draft Chloe never approves leaves nothing in the member's Looks.
//
// The composer steers on occasion + climate only (request_text is a label),
// so the brief is occasion 'event', climate 'cold'.

import 'server-only'
import { createDelivery, composeDeliveryLooks } from '@/app/admin/private-stylist/actions'
import { loadMemberReach, loadAgeRegisters, labelReachesHer, whyNotHers, type MemberReach } from '@/lib/member-style-gate'
import { memberCardShell, siteUrl } from './email'
import { greetingName } from './black-friday-email'
import { esc, p, h, sectionLink, lookBlock, type EditLook } from './monday-edit'

export const PARTY_LABEL = 'Party season — Christmas parties and New Year’s Eve'
export const PARTY_LOOKS = 3
const PIECES_PER_LOOK = 4
const SEASON_DAYS = 45

export interface PartyMember { member_id: string; name: string | null; auth_user_id: string | null }
export interface PartyLooks { delivery_id: string | null; status: string | null; looks: EditLook[]; composed: number; dropped: number }

async function findDelivery(admin: any, memberId: string): Promise<{ delivery_id: string; status: string } | null> {
  const since = new Date(Date.now() - SEASON_DAYS * 24 * 3600_000).toISOString()
  const { data } = await admin.from('pilot_delivery').select('delivery_id, status, created_at')
    .eq('member_id', memberId).eq('request_text', PARTY_LABEL).gte('created_at', since)
    .order('created_at', { ascending: false }).limit(1)
  const d = (data ?? [])[0]
  return d ? { delivery_id: d.delivery_id, status: d.status } : null
}

/** The brands the push-surface age gate would refuse for her, kept out of the composer up front. */
async function youngerLabelsFor(admin: any, memberId: string): Promise<string[]> {
  const [reach, registers] = await Promise.all([loadMemberReach(admin, memberId), loadAgeRegisters(admin)])
  return [...registers].filter(([id, reg]) => !reach.namedBrandIds.has(id) && !labelReachesHer(reach.ageRange, reg)).map(([id]) => id)
}

/** Her party delivery, composed once per season. compose=false only reads; recompose=true throws away unpublished looks and composes again. */
export async function ensurePartyLooks(admin: any, memberId: string, opts: { compose?: boolean; recompose?: boolean; count?: number } = {}): Promise<{ delivery_id: string | null; created: boolean; composed?: number; dropped?: number; error?: string }> {
  const compose = async (deliveryId: string, created: boolean) => {
    const r = await composeDeliveryLooks(deliveryId, { count: opts.count ?? PARTY_LOOKS, ownedMode: 'retail_only', excludeBrandIds: await youngerLabelsFor(admin, memberId) })
    return { delivery_id: deliveryId, created, composed: r.created ?? 0, dropped: r.droppedByCheck ?? 0, error: r.error }
  }
  const found = await findDelivery(admin, memberId)
  if (found) {
    if (opts.recompose && found.status === 'draft') {
      // Only looks nobody has seen: a draft delivery's looks are never visible to her.
      await admin.from('pilot_look').delete().eq('delivery_id', found.delivery_id).eq('visible_to_client', false)
    }
    const { count } = await admin.from('pilot_look').select('look_id', { count: 'exact', head: true }).eq('delivery_id', found.delivery_id)
    if ((count ?? 0) > 0 || found.status !== 'draft' || !opts.compose) return { delivery_id: found.delivery_id, created: false, composed: count ?? 0 }
    return compose(found.delivery_id, false)
  }
  if (!opts.compose) return { delivery_id: null, created: false }
  const made = await createDelivery({ member_id: memberId, trigger: 'anticipation', request_text: PARTY_LABEL, occasion: 'event', climate: 'cold' })
  if (!made.delivery_id) return { delivery_id: null, created: false, error: made.error ?? 'could not create the delivery' }
  return compose(made.delivery_id, true)
}

/** The looks of her party delivery, drawn whether or not they are published yet. */
export async function gatherPartyLooks(admin: any, m: PartyMember, reach?: MemberReach): Promise<PartyLooks> {
  const found = await findDelivery(admin, m.member_id)
  if (!found) return { delivery_id: null, status: null, looks: [], composed: 0, dropped: 0 }
  const r = reach ?? await loadMemberReach(admin, m.member_id)
  const { data: looks } = await admin.from('pilot_look')
    .select('look_id, position, items, image_url, response')
    .eq('delivery_id', found.delivery_id).order('position', { ascending: true })
  const all = (looks ?? []) as any[]
  const ids = [...new Set(all.flatMap((l) => ((l.items ?? []) as any[]).map((i) => i?.item_id).filter(Boolean) as string[]))]
  const rows = new Map<string, any>()
  if (ids.length) {
    const { data: items } = await admin.from('item').select('item_id, item_type, colour_family, product_name, price_gbp, brand_id, image_url, fit, length, rise, structure, shoulder, neckline, sleeve, waist_definition, leg_opening, pattern').in('item_id', ids)
    for (const it of (items ?? []) as any[]) rows.set(it.item_id, it)
  }
  const outOfReach = (l: any) => {
    const reasons = ((l.items ?? []) as any[]).map((i) => { const it = i?.item_id ? rows.get(i.item_id) : null; const why = it ? whyNotHers(r, it, { budget: false }) : null; return why ? `${i.brand ?? it?.brand_id} ${i.product_name ?? ''}: ${why}` : null }).filter(Boolean)
    if (reasons.length) console.warn(`[party-looks] look ${l.look_id} out of reach for ${m.member_id.slice(0, 8)}: ${reasons.join(' · ')}`)
    return reasons.length > 0
  }
  const kept = all.filter((l) => l.response !== 'no' && Array.isArray(l.items) && l.items.length >= 2 && !outOfReach(l)).slice(0, PARTY_LOOKS)
  return {
    delivery_id: found.delivery_id, status: found.status, composed: all.length, dropped: all.length - kept.length,
    looks: kept.map((l) => ({
      look_id: l.look_id, label: 'Party season', image_url: l.image_url ?? null,
      pieces: (l.items as any[]).slice(0, PIECES_PER_LOOK).map((i) => ({
        item_id: i.item_id ?? null, brand: i.brand ?? null, name: i.product_name ?? 'Piece',
        image_url: i.image_url ?? rows.get(i.item_id)?.image_url ?? null,
        price_gbp: i.price_gbp ?? rows.get(i.item_id)?.price_gbp ?? null,
      })),
    })),
  }
}

/** The same publish step as a member's own ask (me/looks/actions): looks visible, delivery sent, a note in the app. */
export async function publishPartyLooks(admin: any, deliveryId: string, memberId: string, lookIds: string[]): Promise<number> {
  if (!lookIds.length) return 0
  const now = new Date().toISOString()
  await admin.from('pilot_look').update({ visible_to_client: true, published_at: now }).in('look_id', lookIds).eq('visible_to_client', false)
  await admin.from('pilot_delivery').update({ status: 'sent', sent_at: now }).eq('delivery_id', deliveryId).neq('status', 'sent')
  await admin.from('pilot_notification').insert({
    member_id: memberId, kind: 'looks_ready',
    body: lookIds.length === 1 ? 'A look for party season is waiting for you.' : `${lookIds.length} looks for party season are waiting for you.`,
    look_ids: lookIds,
  })
  return lookIds.length
}

export function partySubject(pl: PartyLooks): string {
  const n = pl.looks.length
  return n === 1 ? 'A look styled for you for party season' : `${n === 3 ? 'Three' : n === 2 ? 'Two' : n} looks styled for you for party season`
}

export function partyHtml(member: PartyMember, pl: PartyLooks, site?: string): string {
  const base = site ?? siteUrl('')
  const first = greetingName(member.name)
  const n = pl.looks.length
  const parts: string[] = []
  parts.push(p(`${first ? `${esc(first)}, the` : 'The'} Christmas parties and New Year’s Eve are close, so MYRA has styled ${n === 1 ? 'a look' : `${n === 3 ? 'three' : 'two'} looks`} for them: in your size, at your prices, and checked on you before it was shown.`))
  parts.push(h('STYLED FOR PARTY SEASON'))
  for (const l of pl.looks) parts.push(lookBlock(l, base))
  parts.push(sectionLink(`${base}/me/looks`, 'SEE ALL YOUR LOOKS'))
  parts.push(h('WANT IT FOR A PARTICULAR NIGHT?'))
  parts.push(p('Tell MYRA what it is and where, and she styles for that night: the office party, a dinner, the one you are hosting.'))
  parts.push(sectionLink(`${base}/me/looks`, 'ASK FOR A LOOK'))
  parts.push(p('Reply to this email and it comes straight to Chloe.', 'margin-top:26px;'))
  return memberCardShell('Party season', parts.join('\n'))
}
