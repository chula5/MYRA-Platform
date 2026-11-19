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
//   no piece is from a label far younger than her (lib/member-style-gate —
//     Anne, 60, was sent a Reformation slip dress on 2026-11-11)
//   nothing is known to be out of her size (unconfirmed sizes are shown honestly)
//   no piece is someone's own wardrobe, and nothing pre-loved unless she switched it on
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
import { withinMemberAgeReach, loadMemberAgeRanges } from '@/lib/brand-affinity'
import { loadAgeRegisters } from '@/lib/member-style-gate'
import { isOwnedItem } from '@/lib/wardrobe/owned-items'
import { isSecondHand } from '@/lib/second-hand'
import { waitUntil } from '@vercel/functions'

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
  age?: { range: string | null; registerOf: (brandId: string | null | undefined) => number | null },
  opts: { acceptsSecondHand?: boolean } = {},
): string | null {
  if (!graph.weights.size) return 'no taste graph yet'
  if (!graph.weights.has(String(anchor.brand_id ?? ''))) return `${anchor.brand?.name ?? 'the anchor label'} is not in her graph`
  for (const it of [anchor, ...rest.map((r) => r.item)]) {
    const label = `${it.brand?.name ?? ''} ${it.product_name}`.trim()
    // A look built around someone's own wardrobe piece is theirs alone: no one else can buy it.
    if (isOwnedItem(it as any)) return `${it.product_name} is from someone's own wardrobe`
    if (isSecondHand(it as any) && !opts.acceptsSecondHand) return `${label} is pre-loved and she has not switched that on`
    if (!sellable(it)) return `${label} cannot be bought`
    if (blockedForHer(graph, it)) return `${it.brand?.name} is a label she turned away`
    const avoided = avoidReasons(taste.prefs, it as any)
    if (avoided.length) return `${label}: ${avoided[0]}`
    if (itemPriceVerdict(taste, it) === 'over') return `${label} is over her budget`
    if (age && !withinMemberAgeReach(age.range, { customer_age_register: age.registerOf(it.brand_id) })) return `${it.brand?.name} is a younger label than her`
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
  const memberIds = ((members ?? []) as { member_id: string }[]).map((m) => m.member_id)
  const [ages, registers] = await Promise.all([loadMemberAgeRanges(admin, memberIds), loadAgeRegisters(admin)])
  const registerOf = (id: string | null | undefined) => (id ? registers.get(String(id)) ?? null : null)

  const out: MemberLanding[] = []
  for (const m of (members ?? []) as { member_id: string; name: string }[]) {
    const res = (reason: string | null): MemberLanding => ({ memberId: m.member_id, name: m.name, landed: !reason, reason })
    try {
      const [taste, graph] = await Promise.all([loadMemberTasteFor(m.member_id), loadTasteGraph(admin, m.member_id)])
      if (!taste) { out.push(res('no taste profile')); continue }
      const why = whyNotForHer(taste, graph, anchor, rest, { range: ages.get(m.member_id) ?? null, registerOf })
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

/**
 * A NEW MEMBER ARRIVES TO LOOKS ALREADY WAITING. Chloe, 2026-11-19, after
 * Sarah Gasparro joined to 4 looks: "she likes quite similar brands to other
 * people, so there should be outfits waiting for her" — for every new member,
 * when she likes the brands in the looks.
 *
 * The pool is every look MYRA approved and showed another real member in the
 * last CATCH_UP_DAYS (studio looks, overnight styling, her asks — whoever it
 * was made for; Chloe's own member and synthetic members left out). A look is
 * hers when:
 *   it is led by a label she NAMED (graph weight ≥ NAMED_WEIGHT), and at least
 *     half its pieces are from labels in her graph — "she likes the brands"
 *   whyNotForHer passes (buyable, no one's own wardrobe, pre-loved only if she
 *     opted in, her avoids, budget, age reach, her rules + stylist nevers)
 *   nothing is known to be out of her size, and she doesn't already have it.
 * Ranked by how many pieces are from her named labels, then newest; no two
 * share more than one piece; at most CATCH_UP_MAX land, so a first open is a
 * shelf, not a flood. Stock and price are read fresh. Safe to run again.
 */
export const CATCH_UP_DAYS = 60
export const CATCH_UP_MAX = 12
const NAMED_WEIGHT = 0.8

export async function catchUpStudioLooks(
  admin: any, memberId: string, opts: { days?: number; max?: number; dryRun?: boolean } = {},
): Promise<{ landed: number; checked: number; suits: number; reason?: string }> {
  const days = opts.days ?? CATCH_UP_DAYS
  const max = opts.max ?? CATCH_UP_MAX
  if (memberId === REAL_MEMBER_IDS.chloe) return { landed: 0, checked: 0, suits: 0, reason: 'Chloe made them' }
  const { data: m } = await admin
    .from('pilot_member').select('member_id, is_synthetic, accepts_second_hand').eq('member_id', memberId).maybeSingle()
  if (!m || m.is_synthetic) return { landed: 0, checked: 0, suits: 0, reason: 'not a real member' }
  const { loadMemberTasteFor } = await import('@/app/admin/private-stylist/actions')
  const [taste, graph, ages, registers] = await Promise.all([
    loadMemberTasteFor(memberId), loadTasteGraph(admin, memberId),
    loadMemberAgeRanges(admin, [memberId]), loadAgeRegisters(admin),
  ])
  if (!taste) return { landed: 0, checked: 0, suits: 0, reason: 'no taste profile' }
  if (!graph.weights.size) return { landed: 0, checked: 0, suits: 0, reason: 'no taste graph yet' }
  const age = { range: ages.get(memberId) ?? null, registerOf: (id: string | null | undefined) => (id ? registers.get(String(id)) ?? null : null) }
  const named = (it: { brand_id?: string | null }) => (graph.weights.get(String(it.brand_id ?? '')) ?? 0) >= NAMED_WEIGHT
  const inGraph = (it: { brand_id?: string | null }) => graph.weights.has(String(it.brand_id ?? ''))

  const { data: realOthers } = await admin.from('pilot_member').select('member_id')
    .eq('is_synthetic', false).neq('member_id', memberId).neq('member_id', REAL_MEMBER_IDS.chloe)
  const otherIds = ((realOthers ?? []) as any[]).map((r) => r.member_id as string)
  if (!otherIds.length) return { landed: 0, checked: 0, suits: 0 }
  const since = new Date(Date.now() - days * 864e5).toISOString()
  const { data: looks } = await admin
    .from('pilot_look').select('items, created_at, delivery:delivery_id!inner(member_id)')
    .in('delivery.member_id', otherIds).eq('visible_to_client', true).not('approved_at', 'is', null)
    .gte('created_at', since).order('created_at', { ascending: false }).limit(3000)
  const sets = new Map<string, string[]>()
  for (const l of (looks ?? []) as any[]) {
    const ids = ((l.items ?? []) as any[]).map((i) => i?.item_id).filter(Boolean) as string[]
    const key = [...ids].sort().join(',')
    if (ids.length >= 2 && !sets.has(key)) sets.set(key, ids)
  }

  // Every piece in one read, then each look judged in memory.
  const allIds = Array.from(new Set(Array.from(sets.values()).flat()))
  const byId = new Map<string, ItemWithBrand>()
  for (let i = 0; i < allIds.length; i += 300) {
    const { data: rows } = await admin.from('item').select('*, brand(*)').in('item_id', allIds.slice(i, i + 300))
    for (const r of (rows ?? []) as ItemWithBrand[]) byId.set(r.item_id, r)
  }

  const suits: { ids: string[]; pieces: ItemWithBrand[]; score: number }[] = []
  for (const ids of Array.from(sets.values())) {
    const pieces = ids.map((id) => byId.get(id)).filter(Boolean) as ItemWithBrand[]
    if (pieces.length !== ids.length) continue
    const lead = pieces.findIndex(named)
    if (lead < 0) continue
    if (pieces.filter(inGraph).length * 2 < pieces.length) continue
    const anchor = pieces[lead]
    const rest = pieces.filter((_, i) => i !== lead).map((item) => ({ item, slot: slotForItemType(item.item_type) as Slot }))
    if (whyNotForHer(taste, graph, anchor, rest, age, { acceptsSecondHand: !!m.accepts_second_hand })) continue
    suits.push({ ids, pieces: [anchor, ...rest.map((r) => r.item)], score: pieces.filter(named).length })
  }
  suits.sort((a, b) => b.score - a.score) // stable: newest first within a score

  let landed = 0
  const picked: string[][] = []
  for (const s of suits) {
    if (landed >= max) break
    if (picked.some((p) => p.filter((id) => s.ids.includes(id)).length > 1)) continue
    const lookItems = s.pieces.map(toLookItem)
    const sizes = await checkSizesForMember(admin, memberId, lookItems, 'unknown')
    if (lookItems.some((p) => p.item_id && sizes.get(p.item_id)?.verdict === 'not_in_size')) continue
    if (await alreadyHers(admin, memberId, new Set(s.ids))) continue
    picked.push(s.ids)
    if (!opts.dryRun) {
      await landLook(admin, memberId, lookItems.map((p) => ({ ...p, size: (p.item_id && sizes.get(p.item_id)?.label) || p.size })), lookVectorFromItems(s.pieces as any[]))
    }
    landed++
  }
  return { landed, checked: sets.size, suits: suits.length }
}

/** catchUpStudioLooks in the background, so the save that triggered it returns at once. */
export function catchUpStudioLooksLater(admin: any, memberId: string, why: string): void {
  const run = catchUpStudioLooks(admin, memberId)
    .then((r) => console.log(`[new-member looks ${why}]`, memberId, r))
    .catch((err) => console.error(`[new-member looks ${why}]`, memberId, err))
  try { waitUntil(run) } catch { /* outside a request: the promise simply runs */ }
}
