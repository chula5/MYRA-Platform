// FROM THE STUDIO — an outfit Chloe says YES to in Outfit Review lands in the
// Looks of every member it suits.
//
// Chloe, 2026-10-25: she built ME+EM outfits in Outfit Review ("an ME+EM anchor
// with similar brands around it") and wanted them in Fiona's Looks to like,
// pass on or save — and, from then on, every Review outfit to reach whoever it
// is relevant to, without sending it by hand.
//
// Relevant means all of:
//   the anchor's label is in her taste graph (named, or next to what she named)
//   every piece can be bought (lib/stock-sellable) and none is from a label she turned away
//   every piece clears her own gates: avoided colours/shapes/types, hidden and
//     input-only labels, her price ceiling
//   the whole look clears her rule layer and her stylist's nevers (memberGate)
//   nothing is known to be out of her size (unconfirmed sizes are shown honestly)
// A member with no taste graph yet gets nothing: "everything is hers" is right
// for Browse, wrong for putting a look in front of her.
//
// Chloe made the look, so it never lands back in her own member Looks.

import 'server-only'
import type { ItemWithBrand } from '@/lib/admin-queries'
import { memberGate, itemPriceVerdict, toLookItem, type MemberTaste } from '@/lib/pilot-composer'
import { avoidReasons } from '@/lib/pilot-stylist'
import { slotForItemType, type Slot } from '@/lib/composer'
import { sellable } from '@/lib/stock-sellable'
import { loadTasteGraph, blockedForHer, type TasteGraph } from '@/lib/taste-graph'
import { checkSizesForMember } from '@/lib/look-size-check'
import { lookVectorFromItems } from '@/lib/taste-vector'
import { REAL_MEMBER_IDS } from '@/lib/outfit-quality/identities'

/** Every studio delivery's request_text starts with this — one delivery per member per day. */
export const STUDIO_PREFIX = 'From the studio'

export interface MemberLanding {
  memberId: string
  name: string
  landed: boolean
  /** Why it did not land, in words — empty when it did. */
  reason: string | null
}

const isoDay = (d = new Date()) => d.toISOString().slice(0, 10)

/** Why this look is not for her, or null when it is. Pure: no reads. */
export function whyNotForHer(
  taste: MemberTaste,
  graph: TasteGraph,
  anchor: ItemWithBrand,
  rest: { item: ItemWithBrand; slot: Slot }[],
): string | null {
  if (!graph.weights.size) return 'no taste graph yet'
  if (!graph.weights.has(String(anchor.brand_id ?? ''))) return `${anchor.brand?.name ?? 'the anchor label'} is not in her graph`
  for (const it of [anchor, ...rest.map((r) => r.item)]) {
    const label = `${it.brand?.name ?? ''} ${it.product_name}`.trim()
    if (!sellable(it)) return `${label} cannot be bought`
    if (blockedForHer(graph, it)) return `${it.brand?.name} is a label she turned away`
    const avoided = avoidReasons(taste.prefs, it as any)
    if (avoided.length) return `${label}: ${avoided[0]}`
    if (itemPriceVerdict(taste, it) === 'over') return `${label} is over her budget`
  }
  if (!memberGate(taste, anchor, rest)) return 'her rules or her stylist\'s nevers'
  return null
}

/**
 * Land one Review outfit with every member it suits. Safe to run twice: a
 * member who already has these exact pieces as a look is skipped.
 */
export async function landReviewOutfitForMembers(admin: any, outfitId: string): Promise<MemberLanding[]> {
  const { data: links } = await admin
    .from('outfit_item').select('item_id, slot, sort_order').eq('outfit_id', outfitId).order('sort_order')
  const ids = ((links ?? []) as any[]).map((l) => l.item_id as string)
  if (ids.length < 2) return []
  const { data: rows } = await admin.from('item').select('*, brand(*)').in('item_id', ids)
  const byId = new Map(((rows ?? []) as ItemWithBrand[]).map((r) => [r.item_id, r]))
  const pieces = ids.map((id) => byId.get(id)).filter(Boolean) as ItemWithBrand[]
  if (pieces.length !== ids.length) return []

  // The anchor is the outfit's first piece (approveCandidate writes it at sort_order 0).
  const [anchor, ...others] = pieces
  const rest = others.map((item) => ({ item, slot: slotForItemType(item.item_type) as Slot }))
  const lookItems = pieces.map(toLookItem)
  const itemSet = new Set(ids)
  const vector = lookVectorFromItems(pieces as any[])

  const { data: members } = await admin
    .from('pilot_member').select('member_id, name').eq('is_synthetic', false).neq('member_id', REAL_MEMBER_IDS.chloe)
  const { loadMemberTasteFor } = await import('@/app/admin/private-stylist/actions')

  const out: MemberLanding[] = []
  for (const m of (members ?? []) as { member_id: string; name: string }[]) {
    const res = (reason: string | null): MemberLanding => ({ memberId: m.member_id, name: m.name, landed: !reason, reason })
    try {
      const [taste, graph] = await Promise.all([loadMemberTasteFor(m.member_id), loadTasteGraph(admin, m.member_id)])
      if (!taste) { out.push(res('no taste profile')); continue }
      const why = whyNotForHer(taste, graph, anchor, rest)
      if (why) { out.push(res(why)); continue }

      const sizes = await checkSizesForMember(admin, m.member_id, lookItems, 'unknown')
      const tooSmall = lookItems.find((p) => p.item_id && sizes.get(p.item_id)?.verdict === 'not_in_size')
      if (tooSmall) { out.push(res(`${tooSmall.brand} ${tooSmall.product_name} is not in her size`)); continue }

      if (await alreadyHers(admin, m.member_id, itemSet)) { out.push(res('she already has this look')); continue }
      await landLook(admin, m.member_id, lookItems.map((p) => ({ ...p, size: (p.item_id && sizes.get(p.item_id)?.label) || p.size })), vector)
      out.push(res(null))
    } catch (err) {
      console.error('[review-to-members]', m.member_id, err)
      out.push(res(err instanceof Error ? err.message : 'failed'))
    }
  }
  return out
}

async function alreadyHers(admin: any, memberId: string, itemSet: Set<string>): Promise<boolean> {
  const { data } = await admin
    .from('pilot_look').select('items, delivery:delivery_id!inner(member_id)').eq('delivery.member_id', memberId)
  return ((data ?? []) as any[]).some((l) => {
    const got = ((l.items ?? []) as any[]).map((i) => i?.item_id).filter(Boolean) as string[]
    return got.length === itemSet.size && got.every((id) => itemSet.has(id))
  })
}

/** Today's studio delivery for her (made on first use, with one note), then the look on the end of it. */
async function landLook(admin: any, memberId: string, items: ReturnType<typeof toLookItem>[], vector: number[] | null): Promise<void> {
  const label = `${STUDIO_PREFIX} · ${isoDay()}`
  const now = new Date().toISOString()
  let { data: delivery } = await admin
    .from('pilot_delivery').select('delivery_id').eq('member_id', memberId).eq('request_text', label).maybeSingle()
  if (!delivery) {
    const made = await admin.from('pilot_delivery').insert({
      member_id: memberId,
      // MYRA's own initiative, not her ask — it shows with her FOR YOU looks.
      trigger: 'anticipation',
      request_text: label,
      occasion: null,
      status: 'sent',
      sent_at: now,
    }).select('delivery_id').single()
    if (made.error) throw new Error(made.error.message)
    delivery = made.data
    await admin.from('pilot_notification').insert({
      member_id: memberId, kind: 'looks_ready', body: 'New looks from your stylist.',
    })
  }
  const { data: last } = await admin
    .from('pilot_look').select('position').eq('delivery_id', delivery.delivery_id)
    .order('position', { ascending: false }).limit(1).maybeSingle()
  const { error } = await admin.from('pilot_look').insert({
    delivery_id: delivery.delivery_id,
    position: (last?.position ?? 0) + 1,
    taste_vector: vector,
    items,
    notes: null,
    approved_at: now,
    visible_to_client: true,
    published_at: now,
  })
  if (error) throw new Error(error.message)
}
