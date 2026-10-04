'use server'

// BROWSE — she looks something up, and MYRA does the finding.
//
// The words she types are read the way the rest of MYRA reads them (the same
// taxonomy the feed and the looks search use), so "a black dress for a winter
// wedding" is understood as a colour and a piece, not as a string to match.
// Candidates come from the catalogue MYRA carries — never her own wardrobe,
// because she is here to look at something new — and the results are ranked
// by how much of what she said each piece answers.
//
// Then she picks one and says how she wants to see it: around what she already
// owns, or around something new. Both routes run the same composer the Mirror
// uses on a piece she found out in the shops.

import { createAdminClient } from '@/lib/supabase-server'
import { resolveClientMember } from '@/lib/client-member'
import { parseQuery } from '@/lib/search-taxonomy'
import { isOwnedItem } from '@/lib/wardrobe/owned-items'
import { styleExternalPiece } from '@/lib/mirror/style'
import { loadMemberSizeProfile, loadSizeRowsFor } from '@/lib/size-availability'
import { CLOTHING_LADDER, SHOE_LADDER, sizeCategoryFor, acceptedValues } from '@/lib/size-canonical'
import type { MirrorMember } from '@/lib/mirror/auth'
import type { StyledLook } from '@/app/admin/private-stylist/actions'

export interface BrowsePiece {
  item_id: string
  product_name: string
  brand: string | null
  image_url: string | null
  price_gbp: number | null
  url: string | null
}

/** The ways she can narrow a search once MYRA has answered it. */
export interface BrowseFilters {
  brands?: string[]
  colours?: string[]
  types?: string[]
  /** Canonical UK clothing sizes (4..22). */
  clothingSizes?: number[]
  /** Canonical UK shoe sizes (2..9). */
  shoeSizes?: number[]
}

/** The options a filter panel can offer, drawn from what the search answered. */
export interface BrowseFacets {
  brands: string[]
  colours: string[]
  types: string[]
}

/** Size options, pre-filled with HER sizes so she can mix one in for a search. */
export interface BrowseSizes {
  clothing: number[]
  shoes: number[]
  mineClothing: number[]
  mineShoes: number[]
  hasClothing: boolean
  hasShoes: boolean
}

export interface BrowseView {
  query: string
  pieces: BrowsePiece[]
  /** What MYRA read out of her words: the colours, the pieces, the cloth. */
  read: string[]
  facets: BrowseFacets
  sizes: BrowseSizes
  error?: string
}

const CARD = 'item_id, product_name, image_url, price_gbp, retailer_url, colour_family, item_type, material_primary, status, stock_status, available, ownership, owner_kind, brand_id, brand:brand_id(name)'
/** Anything a member may be shown: published, or ingested and shoppable. */
const SHOWABLE = ['ready', 'live', 'draft']
const MOST = 24
// A piece must satisfy MOST of what she asked. With colour + piece both named
// (weights 1 + 1), matching only one scores 0.5 and falls below this — so a
// yellow dress never answers "black dress", and a black bag never answers it
// either. One facet alone (just "dress") still passes at 1.0.
const STRONG = 0.6

const CLOTHING_CATS = new Set(['tops', 'bottoms', 'outerwear'])

const EMPTY_SIZES: BrowseSizes = {
  clothing: [...CLOTHING_LADDER], shoes: [...SHOE_LADDER],
  mineClothing: [], mineShoes: [], hasClothing: false, hasShoes: false,
}

const pieceOf = (it: any): BrowsePiece => ({
  item_id: it.item_id,
  product_name: it.product_name ?? 'Piece',
  brand: it.brand?.name ?? null,
  image_url: it.image_url ?? null,
  price_gbp: it.price_gbp != null ? Number(it.price_gbp) : null,
  url: it.retailer_url ?? null,
})

const showable = (it: any) =>
  !!it.image_url && it.available !== false && it.stock_status !== 'out_of_stock' && !isOwnedItem(it)

// Whole-word match so "red" doesn't light up on "altered". Mirrors the looks
// search in search-taxonomy.ts.
function hasWord(hay: string | null | undefined, needle: string): boolean {
  if (!hay) return false
  return new RegExp(`\\b${needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(hay)
}

/**
 * What she asked for, answered with pieces. The phrase she typed is read the
 * way the looks search reads it — colour, piece, cloth, label — and each facet
 * MYRA heard becomes a REQUIREMENT, not a hint: a piece has to answer most of
 * what she said to show at all, so "black dress" returns black dresses, never a
 * yellow one that merely happens to be a dress.
 *
 * Once answered she can narrow by brand, colour, piece and size; her own sizes
 * come pre-filled and she can add another to mix it up for one search.
 */
export async function browseSearch(
  query: string,
  filters: BrowseFilters = {},
  asMemberId?: string,
): Promise<BrowseView> {
  const me = await resolveClientMember(asMemberId)
  if (!me) return { query, pieces: [], read: [], facets: { brands: [], colours: [], types: [] }, sizes: EMPTY_SIZES, error: 'Not signed in' }

  const q = query.trim().slice(0, 120)
  const empty = (error?: string): BrowseView => ({ query: q, pieces: [], read: [], facets: { brands: [], colours: [], types: [] }, sizes: EMPTY_SIZES, error })
  if (q.length < 2) return empty()

  const admin = createAdminClient() as any
  const needle = q.toLowerCase()
  // Every word she typed counts on its own, so "silk slip skirt" still finds a
  // slip whose name never says all three words together.
  const safe = needle.replace(/[^a-z0-9]+/g, ' ').trim()
  if (!safe) return empty()
  const words = Array.from(new Set(safe.split(' ').filter((w) => w.length >= 3))).slice(0, 6)
  const nameFilter = words.length > 1
    ? words.map((w) => `product_name.ilike.%${w}%`).join(',')
    : `product_name.ilike.%${words[0] ?? safe}%`

  // The labels she may have named, looked up first so the taxonomy can spot
  // one of them in her words.
  const { data: brandRows } = await admin
    .from('brand').select('brand_id, name')
    .or((words.length ? words : [safe]).map((w) => `name.ilike.%${w}%`).join(','))
    .limit(12)
  const brands = ((brandRows ?? []) as any[]).filter((b) => b?.name)
  const brandIds = brands.map((b) => b.brand_id)
  const parsed = parseQuery(q, brands.map((b) => String(b.name)))

  const byName = admin.from('item').select(CARD).in('status', SHOWABLE)
    .or(nameFilter).not('image_url', 'is', null).limit(80)
  const byPiece = parsed.itemTypes.length
    ? admin.from('item').select(CARD).in('status', SHOWABLE)
      .in('item_type', parsed.itemTypes).not('image_url', 'is', null).limit(80)
    : null
  const byColour = parsed.colourFamilies.length
    ? admin.from('item').select(CARD).in('status', SHOWABLE)
      .in('colour_family', parsed.colourFamilies).not('image_url', 'is', null).limit(80)
    : null

  const [named, typed, coloured] = await Promise.all([byName, byPiece, byColour])

  let byBrand: any[] = []
  if (brandIds.length) {
    const { data } = await admin.from('item').select(CARD).in('status', SHOWABLE)
      .in('brand_id', brandIds).not('image_url', 'is', null).limit(80)
    byBrand = (data ?? []) as any[]
  }

  // How much of what she said this one piece answers, as a fraction of the
  // facets she actually named — only present facets count, and each must agree.
  const hasFacets = !!(parsed.colourFamilies.length || parsed.itemTypes.length || parsed.materials.length || parsed.brand)
  const score = (it: any): number => {
    const name = String(it.product_name ?? '').toLowerCase()
    let sum = 0, weight = 0
    const part = (w: number, hit: boolean) => { sum += w * (hit ? 1 : 0); weight += w }

    if (parsed.colourFamilies.length) {
      part(1, parsed.colourFamilies.includes(String(it.colour_family ?? '')) || parsed.colourFamilies.some((c) => hasWord(name, c)))
    }
    if (parsed.itemTypes.length) {
      part(1, parsed.itemTypes.includes(String(it.item_type ?? '')))
    }
    if (parsed.materials.length) {
      part(0.6, parsed.materials.some((m) => hasWord(it.material_primary, m) || hasWord(name, m)))
    }
    if (parsed.brand) {
      part(0.9, hasWord(it.brand?.name, parsed.brand) || brandIds.includes(it.brand_id))
    }
    // No colour/piece/cloth/brand understood → she typed a name or a label we
    // don't know. Fall back to how much of the raw phrase the name carries.
    if (!hasFacets) {
      return words.length ? words.filter((w) => name.includes(w)).length / words.length : (name.includes(needle) ? 1 : 0)
    }
    const base = weight > 0 ? sum / weight : 0
    // Tie-breakers that never lift a piece over the bar on their own.
    let bonus = 0
    if (name.includes(needle)) bonus += 0.04
    if (String(it.status) === 'live') bonus += 0.02
    return base + bonus
  }

  const seen = new Set<string>()
  const kept: { it: any; piece: BrowsePiece; score: number }[] = []
  const consider = (it: any) => {
    if (!it?.item_id || seen.has(it.item_id) || !showable(it)) return
    seen.add(it.item_id)
    const s = score(it)
    if (s < STRONG) return
    kept.push({ it, piece: pieceOf(it), score: s })
  }
  for (const row of (named?.data ?? []) as any[]) consider(row)
  for (const row of (typed?.data ?? []) as any[]) consider(row)
  for (const row of (coloured?.data ?? []) as any[]) consider(row)
  for (const row of byBrand) consider(row)

  kept.sort((a, b) => b.score - a.score)

  // Filter options come from everything that genuinely matched, so narrowing
  // never hides a choice the results actually contain.
  const facets: BrowseFacets = {
    brands: dedupe(kept.map((k) => k.it.brand?.name).filter(Boolean)).slice(0, 24),
    colours: dedupe(kept.map((k) => k.it.colour_family).filter(Boolean)),
    types: dedupe(kept.map((k) => k.it.item_type).filter(Boolean)),
  }
  const hasClothing = kept.some((k) => CLOTHING_CATS.has(sizeCategoryFor(k.it.item_type) ?? ''))
  const hasShoes = kept.some((k) => sizeCategoryFor(k.it.item_type) === 'shoes')

  // Her sizes, pre-filled so the panel opens already set to what fits her.
  const sizeCtx = await loadMemberSizeProfile(me.memberId)
  const mineClothing = dedupe([
    ...acceptedValues(sizeCtx.profile, 'tops'),
    ...acceptedValues(sizeCtx.profile, 'bottoms'),
    ...acceptedValues(sizeCtx.profile, 'outerwear'),
  ]).sort((a, b) => a - b)
  const mineShoes = acceptedValues(sizeCtx.profile, 'shoes').slice().sort((a, b) => a - b)
  const sizes: BrowseSizes = {
    clothing: [...CLOTHING_LADDER], shoes: [...SHOE_LADDER],
    mineClothing, mineShoes, hasClothing, hasShoes,
  }

  // Apply her chosen filters as hard constraints over what matched.
  const brandSel = new Set((filters.brands ?? []).map((b) => b.toLowerCase()))
  const colourSel = new Set(filters.colours ?? [])
  const typeSel = new Set(filters.types ?? [])
  const clothingSel = filters.clothingSizes ?? []
  const shoeSel = filters.shoeSizes ?? []
  const wantsSize = clothingSel.length > 0 || shoeSel.length > 0

  let narrowed = kept.filter((k) => {
    if (brandSel.size && !brandSel.has(String(k.it.brand?.name ?? '').toLowerCase())) return false
    if (colourSel.size && !colourSel.has(String(k.it.colour_family ?? ''))) return false
    if (typeSel.size && !typeSel.has(String(k.it.item_type ?? ''))) return false
    return true
  })

  if (wantsSize && narrowed.length) {
    const rows = await loadSizeRowsFor(narrowed.map((k) => k.it.item_id))
    narrowed = narrowed.filter((k) => {
      const cat = sizeCategoryFor(k.it.item_type)
      if (!cat) return true // bags, jewellery — no size to narrow on
      const want = cat === 'shoes' ? shoeSel : clothingSel
      if (!want.length) return true
      const list = rows.get(k.it.item_id) ?? []
      if (!list.length) return true // size unknown never hides a piece
      const inStock = new Set<number>()
      for (const r of list) if (r.in_stock) for (const v of (r.canonical_values ?? [])) inStock.add(Number(v))
      if (!inStock.size) return true // confirmed but unparsed → unknown
      return want.some((w) => inStock.has(w))
    })
  }

  const pieces = narrowed.slice(0, MOST).map((k) => k.piece)
  const read = [
    ...parsed.colourFamilies.map((c) => c.toUpperCase()),
    ...parsed.itemTypes.map((t) => t.replace(/_/g, ' ').toUpperCase()),
    ...parsed.materials.map((m) => m.toUpperCase()),
  ].slice(0, 4)

  return { query: q, pieces, read, facets, sizes }
}

const dedupe = (xs: any[]): any[] => Array.from(new Set(xs.map((x) => String(x))))

/**
 * Keep a piece she found while browsing. The item already lives in the
 * catalogue, so this is a direct save — no re-reading the shop's page — into
 * her cross-site saved list (and her login's shelf when she has one).
 */
export async function saveBrowsedPiece(itemId: string, asMemberId?: string): Promise<{ saved: boolean; error?: string }> {
  const me = await resolveClientMember(asMemberId)
  if (!me) return { saved: false, error: 'Not signed in' }

  const admin = createAdminClient() as any
  const { data: item } = await admin.from('item')
    .select('item_id, retailer_url').eq('item_id', itemId).in('status', SHOWABLE).maybeSingle()
  if (!item) return { saved: false, error: 'That piece is no longer here' }

  const host = (() => { try { return new URL(item.retailer_url).host.replace(/^www\./, '') } catch { return null } })()
  const { error } = await admin.from('member_saved_item')
    .upsert({ member_id: me.memberId, item_id: itemId, source_host: host }, { onConflict: 'member_id,item_id' })
  if (error) return { saved: false, error: /schema cache|does not exist|member_saved_item/i.test(error.message) ? 'Run migration 0060 in Supabase first' : error.message }

  if (me.authUserId) {
    try { await admin.from('saved_item').upsert({ user_id: me.authUserId, item_id: itemId }, { onConflict: 'user_id,item_id' }) } catch { /* optional mirror */ }
  }
  return { saved: true }
}

/**
 * The two ways to see a piece she found: around what she owns, or around
 * something new. The same composer the Mirror runs on a piece from a shop.
 */
export async function styleBrowsedPiece(
  itemId: string,
  mode: 'wardrobe' | 'new',
  asMemberId?: string,
): Promise<{ looks: StyledLook[]; error?: string }> {
  const me = await resolveClientMember(asMemberId)
  if (!me) return { looks: [], error: 'Not signed in' }

  const admin = createAdminClient() as any
  // Only a piece she could have found in Browse: no archived rows, and none of
  // her own wardrobe, however the id reached the browser.
  const { data: item } = await admin.from('item').select('*')
    .eq('item_id', itemId).in('status', SHOWABLE).maybeSingle()
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

  const res = await styleExternalPiece(item, mode === 'wardrobe' ? 'wardrobe' : 'inspiration', member, admin, { check: false })
  return { looks: res.looks ?? [], error: res.error }
}
