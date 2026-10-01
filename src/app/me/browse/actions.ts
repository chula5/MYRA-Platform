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

export interface BrowseView {
  query: string
  pieces: BrowsePiece[]
  /** What MYRA read out of her words: the colours, the pieces, the cloth. */
  read: string[]
  error?: string
}

const CARD = 'item_id, product_name, image_url, price_gbp, retailer_url, colour_family, item_type, status, stock_status, available, ownership, owner_kind, brand:brand_id(name)'
/** Anything a member may be shown: published, or ingested and shoppable. */
const SHOWABLE = ['ready', 'live', 'draft']
const MOST = 24

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

/**
 * What she asked for, answered with pieces. The phrase she typed is tried
 * against product names, against brand names, and — through the taxonomy —
 * against the piece type and colour MYRA heard in the words.
 */
export async function browseSearch(query: string, asMemberId?: string): Promise<BrowseView> {
  const me = await resolveClientMember(asMemberId)
  if (!me) return { query, pieces: [], read: [], error: 'Not signed in' }

  const q = query.trim().slice(0, 120)
  if (q.length < 2) return { query: q, pieces: [], read: [] }

  const admin = createAdminClient() as any
  const parsed = parseQuery(q)
  const needle = q.toLowerCase()

  const byName = admin.from('item').select(CARD).in('status', SHOWABLE)
    .ilike('product_name', `%${q}%`).not('image_url', 'is', null).limit(60)
  const byPiece = parsed.itemTypes.length
    ? admin.from('item').select(CARD).in('status', SHOWABLE)
      .in('item_type', parsed.itemTypes).not('image_url', 'is', null).limit(60)
    : null
  const byColour = parsed.colourFamilies.length
    ? admin.from('item').select(CARD).in('status', SHOWABLE)
      .in('colour_family', parsed.colourFamilies).not('image_url', 'is', null).limit(60)
    : null

  const [named, typed, coloured, brands] = await Promise.all([
    byName, byPiece, byColour,
    admin.from('brand').select('brand_id, name').ilike('name', `%${q}%`).limit(10),
  ])

  const brandIds = ((brands?.data ?? []) as any[]).map((b) => b.brand_id)
  let byBrand: any[] = []
  if (brandIds.length) {
    const { data } = await admin.from('item').select(CARD).in('status', SHOWABLE)
      .in('brand_id', brandIds).not('image_url', 'is', null).limit(60)
    byBrand = (data ?? []) as any[]
  }

  // Everything that answered any part of the question, scored on how much of
  // it each piece accounts for.
  const seen = new Set<string>()
  const scored: { piece: BrowsePiece; score: number }[] = []
  const consider = (it: any) => {
    if (!it?.item_id || seen.has(it.item_id) || !showable(it)) return
    seen.add(it.item_id)
    let score = 0
    if (String(it.product_name ?? '').toLowerCase().includes(needle)) score += 3
    if (parsed.brand && String(it.brand?.name ?? '').toLowerCase() === parsed.brand.toLowerCase()) score += 3
    if (brandIds.includes(it.brand_id)) score += 2.5
    if (parsed.itemTypes.length && parsed.itemTypes.includes(String(it.item_type ?? ''))) score += 2
    if (parsed.colourFamilies.length && parsed.colourFamilies.includes(String(it.colour_family ?? ''))) score += 2
    if (String(it.status) === 'live') score += 0.4
    if (it.retailer_url) score += 0.2
    if (score <= 0) return
    scored.push({ piece: pieceOf(it), score })
  }
  for (const row of (named?.data ?? []) as any[]) consider(row)
  for (const row of (typed?.data ?? []) as any[]) consider(row)
  for (const row of (coloured?.data ?? []) as any[]) consider(row)
  for (const row of byBrand) consider(row)

  const pieces = scored.sort((a, b) => b.score - a.score).slice(0, MOST).map((s) => s.piece)
  const read = [
    ...parsed.colourFamilies.map((c) => c.toUpperCase()),
    ...parsed.itemTypes.map((t) => t.replace(/_/g, ' ').toUpperCase()),
    ...parsed.materials.map((m) => m.toUpperCase()),
  ].slice(0, 4)

  return { query: q, pieces, read }
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

  const res = await styleExternalPiece(item, mode === 'wardrobe' ? 'wardrobe' : 'inspiration', member, admin, { check: false })
  return { looks: res.looks ?? [], error: res.error }
}
