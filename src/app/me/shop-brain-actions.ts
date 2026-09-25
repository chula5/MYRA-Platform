'use server'

// WHAT MYRA DID WHILE SHE WAS SHOPPING.
//
// She hearts things on other people's sites through the Mirror. By the time
// she opens MYRA the work is already done: pieces close to the ones she kept,
// more from the labels she was reading, and her saved pieces actually styled.
// Nothing here asks her for anything — it is the answer to a question she has
// not typed yet.
//
// Everything is scoped to the signed-in member (or, for Chloe testing from HER
// VIEW, the member she names — honoured only for the admin). Her candidates
// are the SAME pool the composer uses: ready and live, in her size.

import { createAdminClient } from '@/lib/supabase-server'
import { resolveClientMember } from '@/lib/client-member'
import { loadComposableLibrary, type StyledLook } from '@/app/admin/private-stylist/actions'
import { itemPseudoVector, loadBrandGraph, computeSimilarBrands } from '@/lib/brand-affinity'
import { cosine } from '@/lib/taste-vector'
import { isOwnedItem } from '@/lib/wardrobe/owned-items'
import { slotForItemType } from '@/lib/composer'
import { styleExternalPiece } from '@/lib/mirror/style'
import type { MirrorMember } from '@/lib/mirror/auth'

export interface ShopPiece {
  item_id: string
  product_name: string
  brand: string | null
  image_url: string | null
  price_gbp: number | null
  url: string | null
  /** The shop she found it on — saved pieces only. */
  host?: string | null
  /** Why MYRA put it here: "Like your Ulla Johnson shorts". */
  because?: string
}

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
  test: boolean
}

const EMPTY: ShopBrainView = { saved: [], similar: [], fromBrands: [], fromBrandsKind: 'same', brands: [], test: false }
const SAVED = 12
const PER_SECTION = 12
/** Per saved piece, so one heavily-saved brand cannot own a whole row. */
const PER_ANCHOR = 3

/** "AMUN SHOULDER BAG - RAINBOW MULTI" and "- BLACK" are one idea, not two. */
const styleKey = (it: any): string =>
  `${it.brand?.name ?? ''}|${String(it.product_name ?? '').split(/\s+[-–—]\s+/)[0].toLowerCase().trim()}`

const pieceOf = (it: any, because?: string): ShopPiece => ({
  item_id: it.item_id,
  product_name: it.product_name ?? 'Piece',
  brand: it.brand?.name ?? null,
  image_url: it.image_url ?? null,
  price_gbp: it.price_gbp != null ? Number(it.price_gbp) : null,
  url: it.retailer_url ?? null,
  ...(because ? { because } : {}),
})

/** "your Ulla Johnson shorts" — what she would call the piece herself. */
const shortName = (it: any): string => {
  const brand = it.brand?.name
  const type = String(it.item_type ?? 'piece').replace(/_/g, ' ')
  return brand ? `${brand} ${type}` : (it.product_name ?? 'piece')
}

export async function loadShopBrain(asMemberId?: string): Promise<ShopBrainView> {
  const me = await resolveClientMember(asMemberId)
  if (!me) return EMPTY
  const admin = createAdminClient() as any
  try {
    const { data: savedRows, error } = await admin
      .from('member_saved_item')
      .select('saved_at, source_host, item:item_id(*, brand:brand_id(name))')
      .eq('member_id', me.memberId)
      .order('saved_at', { ascending: false })
      .limit(SAVED)
    // Pre-0060 the table is not there yet: no sections, never an error page.
    if (error) return { ...EMPTY, test: me.test }

    const savedItems = ((savedRows ?? []) as any[]).map((r) => ({ ...r.item, __host: r.source_host })).filter((i) => i?.item_id)
    if (!savedItems.length) return { ...EMPTY, test: me.test }

    const member = { member_id: me.memberId, auth_user_id: me.authUserId }
    const library = await loadComposableLibrary(member)
    const savedIds = new Set(savedItems.map((i) => i.item_id))
    const pool = library.filter((i: any) => !savedIds.has(i.item_id) && !isOwnedItem(i))

    // ── 1. MORE OF THE SAME ──────────────────────────────────────────────
    // Closest in the 34 dimensions MYRA reads a garment on, in the same kind
    // of piece — a saved short answers with shorts, not with a coat.
    const byAnchor: (ShopPiece & { __style: string })[][] = []
    for (const anchor of savedItems.slice(0, 6)) {
      const v = itemPseudoVector(anchor)
      if (!v.length) continue
      const slot = slotForItemType(anchor.item_type)
      const sameKind = pool.filter((i: any) => i.item_type === anchor.item_type)
      const candidates = sameKind.length >= PER_ANCHOR ? sameKind : pool.filter((i: any) => slotForItemType(i.item_type) === slot)
      const near = candidates
        .map((i: any) => ({ i, c: cosine(itemPseudoVector(i), v) }))
        .filter((x) => Number.isFinite(x.c))
        .sort((a, b) => b.c - a.c)
        .slice(0, PER_ANCHOR)
        .map((x) => ({ ...pieceOf(x.i, `Like your ${shortName(anchor)}`), __style: styleKey(x.i) }))
      if (near.length) byAnchor.push(near)
    }
    const similar: ShopPiece[] = []
    const seen = new Set<string>()
    for (let round = 0; round < PER_ANCHOR; round++) {
      for (const list of byAnchor) {
        const p = list[round]
        if (!p || seen.has(p.__style) || similar.length >= PER_SECTION) continue
        seen.add(p.__style)
        similar.push(p)
      }
    }

    // ── 2. MORE FROM THESE LABELS ────────────────────────────────────────
    const brandCount = new Map<string, { name: string; n: number }>()
    for (const s of savedItems) {
      if (!s.brand_id) continue
      const hit = brandCount.get(s.brand_id)
      if (hit) hit.n++
      else brandCount.set(s.brand_id, { name: s.brand?.name ?? '', n: 1 })
    }
    const brandIds = Array.from(brandCount.entries()).sort((a, b) => b[1].n - a[1].n).map(([id]) => id)
    const newestFirst = (rows: any[]) =>
      rows.sort((a: any, b: any) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')))
    const direct = newestFirst(pool.filter((i: any) => i.brand_id && brandIds.includes(i.brand_id)))

    // She keeps things from labels MYRA does not stock — that is the point of
    // her shopping out there. Rather than an empty shelf, the brand graph
    // answers with the label's own neighbours, and says so.
    let standIns: { item: any; like: string }[] = []
    if (direct.length < 4) {
      const graph = await loadBrandGraph(admin)
      const nextTo = new Map<string, string>() // neighbour brand → the saved label it stands beside
      for (const [savedBrandId, meta] of Array.from(brandCount.entries())) {
        for (const n of computeSimilarBrands(savedBrandId, graph, 8)) {
          if (!nextTo.has(n.brand_id) && !brandIds.includes(n.brand_id)) nextTo.set(n.brand_id, meta.name)
        }
      }
      standIns = newestFirst(pool.filter((i: any) => i.brand_id && nextTo.has(i.brand_id)))
        .map((item: any) => ({ item, like: nextTo.get(item.brand_id)! }))
    }

    const fromBrands: ShopPiece[] = []
    const perBrand = new Map<string, number>()
    const seenStyle = new Set<string>(similar.map((p: any) => p.__style))
    for (const entry of [...direct.map((item: any) => ({ item, like: null as string | null })), ...standIns]) {
      const it = entry.item
      const n = perBrand.get(it.brand_id) ?? 0
      const style = styleKey(it)
      if (n >= 4 || seenStyle.has(style) || fromBrands.length >= PER_SECTION) continue
      seenStyle.add(style)
      perBrand.set(it.brand_id, n + 1)
      fromBrands.push(pieceOf(it, entry.like ? `Like ${entry.like}` : (it.brand?.name ?? undefined)))
    }
    const fromBrandsKind: 'same' | 'like' = direct.length ? 'same' : 'like'

    return {
      saved: savedItems.map((i) => ({ ...pieceOf(i), host: i.__host ?? null })),
      similar: similar.map(({ __style, ...p }: any) => p),
      fromBrands,
      fromBrandsKind,
      brands: brandIds.map((id) => brandCount.get(id)!.name).filter(Boolean).slice(0, 4),
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
  const { data: mine } = await admin
    .from('member_saved_item').select('item_id')
    .eq('member_id', me.memberId).eq('item_id', itemId).maybeSingle()
  if (!mine) return { looks: [], error: 'Not one of your saved pieces' }
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
  const res = await styleExternalPiece(item, 'wardrobe', member, admin, { check: false })
  return { looks: res.looks ?? [], error: res.error }
}
