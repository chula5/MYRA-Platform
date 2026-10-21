'use server'

// WHAT MYRA DID WHILE SHE WAS SHOPPING.
//
// She hearts things on other people's sites through the Mirror — or just
// looks: the Mirror also notes the pieces she lingers on and what she types
// into a shop's search (migration 0072). By the time she opens MYRA the work
// is already done: pieces close to the ones she kept or looked at, more from
// the labels she was reading, and her pieces actually styled. Nothing here
// asks her for anything — it is the answer to a question she has not typed
// yet. Saves speak loudest; a look counts for half; a search is a hint.
//
// Everything is scoped to the signed-in member (or, for Chloe testing from HER
// VIEW, the member she names — honoured only for the admin). Her candidates
// are the SAME pool the composer uses: ready and live, in her size.

import { unstable_cache } from 'next/cache'
import { createAdminClient } from '@/lib/supabase-server'
import { resolveClientMember, type ClientMember } from '@/lib/client-member'
import type { StyledLook } from '@/app/admin/private-stylist/actions'
import { loadBrandGraph, computeSimilarBrands } from '@/lib/brand-affinity'
import { isOwnedItem } from '@/lib/wardrobe/owned-items'
import { slotForItemType } from '@/lib/composer'
import { styleExternalPiece } from '@/lib/mirror/style'
import type { MirrorMember } from '@/lib/mirror/auth'
import { blockedName } from '@/lib/brand-onboarding-rules'
import { loadMemberSizeProfile, filterItemsForShopper } from '@/lib/size-availability'
// The signals, the pool and MORE OF THE SAME live in a plain module so the
// Mirror's panel (/api/mirror/similar) reads the very same answer as this door.
import { buildShopContext, moreOfTheSame, stripStyle, styleKey, pieceOf, PER_SECTION, type ShopPiece } from '@/lib/shop-brain/similar'

export type { ShopPiece }

export interface ShopBrainView {
  /** The pieces she kept out there, newest first — the anchors for styling. */
  saved: ShopPiece[]
  /** Close to what she kept. */
  similar: ShopPiece[]
  /** More from the labels she was reading — or, when MYRA stocks none of
   *  them, the labels that stand next to hers. */
  fromBrands: ShopPiece[]
  fromBrandsKind: 'same' | 'like'
  /** Those labels, most-saved first — the heading says them out loud. */
  brands: string[]
  /** What she typed into shops' search boxes lately. */
  searches: string[]
  /** She has saved nothing yet — everything here comes from looking. */
  fromLooking: boolean
  test: boolean
}

const EMPTY: ShopBrainView = { saved: [], similar: [], fromBrands: [], fromBrandsKind: 'same', brands: [], searches: [], fromLooking: false, test: false }

// FOR YOU opens on this, so it must answer at once. Built from cold it reads
// the whole retail library first (13s+ on a fresh server), which left her a
// blank page under a lifted curtain. So her last view is kept in the shared
// data cache and handed back straight away; the page then asks for a fresh
// one (`fresh`) in the background and swaps it in if anything changed.
const SHOP_BRAIN_KEEP_S = 600

export async function loadShopBrain(asMemberId?: string, opts?: { fresh?: boolean }): Promise<ShopBrainView> {
  const me = await resolveClientMember(asMemberId)
  if (!me) return EMPTY
  const admin = createAdminClient() as any
  if (opts?.fresh) {
    const v = await buildShopBrain(me)
    await keepShopBrain(admin, me, v)
    return v
  }
  // Kept on her row (migration 0098), so it survives deploys — the data
  // cache below is emptied by every one. Read in one row, answered at once.
  const { data: row, error } = await admin.from('pilot_member').select('shop_brain_view').eq('member_id', me.memberId).maybeSingle()
  if (!error && row?.shop_brain_view) return { ...(row.shop_brain_view as ShopBrainView), test: me.test }
  const kept = unstable_cache(
    () => buildShopBrain(me),
    ['shop-brain-v1', me.memberId, me.test ? 'test' : 'self'],
    { revalidate: SHOP_BRAIN_KEEP_S },
  )
  const v = await kept()
  if (!error) await keepShopBrain(admin, me, v)
  return v
}

/** Writes her view back to her row — never an empty one (a failed rebuild)
 *  over one that had pieces in it. Pre-0098 the column is missing: skipped. */
async function keepShopBrain(admin: any, me: ClientMember, v: ShopBrainView): Promise<void> {
  try {
    const has = v.saved.length > 0 || v.similar.length > 0 || v.fromBrands.length > 0
    if (!has) {
      const { data } = await admin.from('pilot_member').select('shop_brain_view').eq('member_id', me.memberId).maybeSingle()
      const prev = data?.shop_brain_view as ShopBrainView | null
      if (prev && (prev.saved?.length || prev.similar?.length || prev.fromBrands?.length)) return
    }
    await admin.from('pilot_member')
      .update({ shop_brain_view: { ...v, test: false }, shop_brain_at: new Date().toISOString() })
      .eq('member_id', me.memberId)
  } catch (err) { console.error('[shop-brain] keep', err) }
}

async function buildShopBrain(me: ClientMember): Promise<ShopBrainView> {
  const admin = createAdminClient() as any
  try {
    // What she kept, looked at and searched for, and her candidate pool —
    // ready and live, in her size, under her ceiling. Nothing to go on (or the
    // tables not there yet): no sections, never an error page.
    const ctx = await buildShopContext(admin, { memberId: me.memberId, authUserId: me.authUserId })
    if (!ctx) return { ...EMPTY, test: me.test }
    const { savedItems, viewedItems, searches, anchors, anchorIds, pool, savedSlots, overBudget, closeness, brandInQuery } = ctx

    // ── 1. MORE OF THE SAME ──────────────────────────────────────────────
    // Closest in the 34 dimensions MYRA reads a garment on, in the same kind
    // of piece — lib/shop-brain/similar.ts, the answer the Mirror panel shows too.
    const similar = await moreOfTheSame(ctx)
    // A duplicate row of a piece she already kept or opened is not "more of the same".
    const savedStyles = anchors.map(styleKey)

    // ── 2. MORE FROM THESE LABELS ────────────────────────────────────────
    // She kept an Ulla Johnson short: the answer is Ulla Johnson first. The
    // live library rarely holds much of a label she found out there, so the
    // label's Brand Watch drafts count too — only ones with a picture, a shop
    // link, in stock and in her size. Closest to what she kept comes first:
    // the same kind of piece, then the same part of an outfit, then the rest.
    const brandCount = new Map<string, { name: string; n: number }>()
    for (const s of anchors) {
      if (!s.brand_id) continue
      const weight = s.__kind === 'saved' ? 2 : 1
      const hit = brandCount.get(s.brand_id)
      if (hit) hit.n += weight
      else brandCount.set(s.brand_id, { name: s.brand?.name ?? '', n: weight })
    }
    // A label she typed into a search counts too.
    const brandIdByName = new Map<string, string>()
    for (const i of [...pool, ...anchors] as any[]) if (i.brand_id && i.brand?.name) brandIdByName.set(String(i.brand.name).toLowerCase(), i.brand_id)
    for (const query of searches) {
      const b = brandInQuery(query)
      const id = b ? brandIdByName.get(b.toLowerCase()) : null
      if (!id) continue
      const hit = brandCount.get(id)
      if (hit) hit.n += 1
      else brandCount.set(id, { name: b!, n: 1 })
    }
    const brandIds = Array.from(brandCount.entries()).sort((a, b) => b[1].n - a[1].n).map(([id]) => id)
    // She may keep and style a Zara piece; MYRA never puts one forward. Labels
    // on the house blocklist get no "more from" pieces — only their neighbours.
    const stockable = brandIds.filter((id) => !blockedName('', brandCount.get(id)?.name))

    const liveDirect = pool.filter((i: any) => i.brand_id && stockable.includes(i.brand_id))
    let draftDirect: any[] = []
    if (stockable.length) {
      const { data: drafts } = await admin
        .from('item')
        .select('*, brand(*)')
        .in('brand_id', stockable)
        .eq('status', 'draft')
        .is('owner_kind', null)
        .not('image_url', 'is', null)
        .not('retailer_url', 'is', null)
        .limit(200)
      const shoppable = ((drafts ?? []) as any[]).filter((i) =>
        !anchorIds.has(i.item_id) && i.available !== false && i.stock_status !== 'out_of_stock' && !isOwnedItem(i) && !overBudget(i))
      const ctx = await loadMemberSizeProfile(me.memberId)
      draftDirect = await filterItemsForShopper(shoppable, ctx, { strict: true })
    }

    const anchorsFor = (brandId: string) => anchors.filter((s) => s.brand_id === brandId)
    const direct = [...liveDirect, ...draftDirect]
      .map((i: any) => ({ i, score: closeness(i, anchorsFor(i.brand_id)) + (i.status === 'live' ? 0.05 : 0) }))
      .sort((a, b) => b.score - a.score)
      .map((x) => x.i)

    // Then a few from the labels that stand beside hers — the same kind of
    // piece only, so a saved short never answers with earrings.
    const graph = await loadBrandGraph(admin)
    const nextTo = new Map<string, string>() // neighbour brand → the saved label it stands beside
    for (const [savedBrandId, meta] of Array.from(brandCount.entries())) {
      for (const n of computeSimilarBrands(savedBrandId, graph, 8)) {
        if (!nextTo.has(n.brand_id) && !brandIds.includes(n.brand_id)) nextTo.set(n.brand_id, meta.name)
      }
    }
    const standIns = pool
      .filter((i: any) => i.brand_id && nextTo.has(i.brand_id) && savedSlots.has(slotForItemType(i.item_type)))
      .map((i: any) => ({ i, score: closeness(i, anchors) }))
      .sort((a, b) => b.score - a.score)
      .map((x) => ({ item: x.i, like: nextTo.get(x.i.brand_id)! }))

    const NEIGHBOURS = 4
    const fromBrands: ShopPiece[] = []
    const seenStyle = new Set<string>([...savedStyles, ...similar.map((p) => p.__style)])
    for (const it of direct) {
      const style = styleKey(it)
      if (seenStyle.has(style) || fromBrands.length >= PER_SECTION - Math.min(NEIGHBOURS, standIns.length)) continue
      seenStyle.add(style)
      fromBrands.push(pieceOf(it, it.brand?.name ?? undefined))
    }
    const perBrand = new Map<string, number>()
    for (const { item: it, like } of standIns) {
      const n = perBrand.get(it.brand_id) ?? 0
      const style = styleKey(it)
      if (n >= 2 || seenStyle.has(style) || fromBrands.length >= PER_SECTION) continue
      seenStyle.add(style)
      perBrand.set(it.brand_id, n + 1)
      fromBrands.push(pieceOf(it, `Like ${like}`))
    }
    const fromBrandsKind: 'same' | 'like' = direct.length ? 'same' : 'like'

    // STYLED FOR YOU: her saves, topped up with what she looked at most, so
    // there is always something of hers to style.
    const toStyle = [...savedItems, ...viewedItems.slice(0, Math.max(0, 3 - savedItems.length))]
    return {
      saved: toStyle.map((i) => ({ ...pieceOf(i), host: i.__host ?? null, kind: i.__kind })),
      similar: similar.map(stripStyle),
      fromBrands,
      fromBrandsKind,
      brands: brandIds.map((id) => brandCount.get(id)!.name).filter(Boolean).slice(0, 4),
      searches: searches.slice(0, 3),
      fromLooking: !savedItems.length,
      test: me.test,
    }
  } catch {
    return { ...EMPTY, test: me.test }
  }
}

/**
 * Outfits around one piece she kept while browsing — the composer the Mirror's
 * own panel uses, so what she saw on the shop's site is what she sees here.
 * Only her own saved pieces: the id is checked against her list first.
 */
export async function styleSavedPieceFor(itemId: string, asMemberId?: string): Promise<{ looks: StyledLook[]; error?: string }> {
  const me = await resolveClientMember(asMemberId)
  if (!me) return { looks: [], error: 'Not signed in' }
  const admin = createAdminClient() as any
  const [{ data: mine }, { data: seen }] = await Promise.all([
    admin.from('member_saved_item').select('item_id').eq('member_id', me.memberId).eq('item_id', itemId).maybeSingle(),
    admin.from('recently_viewed').select('item_id').eq('member_id', me.memberId).eq('item_id', itemId).maybeSingle(),
  ])
  if (!mine && !seen) return { looks: [], error: 'Not one of your pieces' }
  const { data: item } = await admin.from('item').select('*').eq('item_id', itemId).maybeSingle()
  if (!item) return { looks: [], error: 'That piece is no longer here' }
  const { data: row } = await admin
    .from('pilot_member').select('member_id, name, auth_user_id, brands, brands_input_only, sizes')
    .eq('member_id', me.memberId).maybeSingle()
  if (!row) return { looks: [], error: 'Not signed in' }
  const member: MirrorMember = {
    member_id: row.member_id,
    name: row.name,
    auth_user_id: row.auth_user_id ?? null,
    brands: Array.isArray(row.brands) ? row.brands : [],
    brands_input_only: row.brands_input_only ?? [],
    sizes: row.sizes ?? {},
    actingAdmin: false,
    actorUserId: null,
  }
  // BLEND, not wardrobe-only. Styling a piece she found out there against her
  // own clothes alone answers "what have I got for this" — useful, and not
  // what this section is for. She wants to see the piece living in her style,
  // so her wardrobe and the pieces MYRA carries in her persona's eye compete
  // for every slot, and a look can be half hers and half new.
  const res = await styleExternalPiece(item, 'blend', member, admin, { check: false })
  return { looks: res.looks ?? [], error: res.error }
}
