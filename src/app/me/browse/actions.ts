'use server'

// BROWSE — she looks something up, and MYRA does the finding.
//
// The words she types are read the way the Edit's looks search reads them
// (search-taxonomy.ts — the same dictionaries, occasion rules and brand
// matching), so "a black dress for a winter wedding" is understood as a
// colour, a piece and a formality, not as a string to match. Every facet MYRA
// hears is a REQUIREMENT (lib/browse-rank.ts): a piece has to answer ALL of
// what she said to be shown as an answer. "silk slip skirt" is silk skirts;
// "j.crew" is J.Crew; "what to wear to a wedding" is dressed-up pieces, the
// dresses first. What answers most of her words — a cotton skirt, a silk
// blouse, a label like the one she named — waits behind SEE SIMILAR.
//
// Candidates come from the catalogue MYRA carries — never her own wardrobe,
// because she is here to look at something new.
//
// Then she picks one and says how she wants to see it: around what she already
// owns, or around something new. Both routes run the same composer the Mirror
// uses on a piece she found out in the shops.

import { createAdminClient } from '@/lib/supabase-server'
import { resolveClientMember } from '@/lib/client-member'
import { styleExternalPiece } from '@/lib/mirror/style'
import type { MirrorMember } from '@/lib/mirror/auth'
import type { StyledLook } from '@/app/admin/private-stylist/actions'
import { newInForMember, NEW_IN_DAYS } from '@/lib/new-in'
import {
  searchForMember, blankView, pieceOf, dedupe, SHOWABLE, EMPTY_FACETS, EMPTY_SIZES,
  type BrowsePiece, type BrowseFilters, type BrowseFacets, type BrowseView,
} from '@/lib/member-search'

export type { BrowsePiece, BrowseFilters, BrowseFacets, BrowseSizes, BrowseView } from '@/lib/member-search'

/** What she asked for, answered with pieces (lib/member-search). */
export async function browseSearch(
  query: string,
  filters: BrowseFilters = {},
  asMemberId?: string,
): Promise<BrowseView> {
  const me = await resolveClientMember(asMemberId)
  if (!me) return blankView(query, 'Not signed in')
  return searchForMember(createAdminClient() as any, me.memberId, query, filters)
}

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

  // Watched in her size from here on: low, sold out, back (lib/stock-alerts).
  try {
    const { subscribeToItems } = await import('@/lib/stock-alerts')
    const { loadMemberSizeProfile } = await import('@/lib/size-availability')
    const { data: typed } = await admin.from('item').select('item_type').eq('item_id', itemId).maybeSingle()
    await subscribeToItems(me.authUserId ?? me.memberId, [{ item_id: itemId, item_type: typed?.item_type ?? null }], 'saved_item', null, await loadMemberSizeProfile(me.memberId))
  } catch (err) { console.error('[saveBrowsedPiece] stock watch', err) }

  // Saved means she will come back to it: its ways are styled now (blend, the
  // pool her saved shelf opens in). A queue problem never fails the save.
  try {
    const { enqueueWarmups, kickStyledWaysDrain } = await import('@/lib/styled-ways-queue')
    const q = await enqueueWarmups(admin, me.memberId, [itemId], 'save')
    if (q.queued.length) kickStyledWaysDrain()
  } catch (err) { console.error('[saveBrowsedPiece] styled ways', err) }
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

/**
 * NEW IN FROM HER BRANDS — where the Monday push opens (/me/browse?new=<since>).
 * The same pieces the push counted (lib/new-in): from the brands she named,
 * since that morning's week began, buyable in her size. Shown as a Browse
 * answer, so every card can be kept or styled like any other; her filters
 * narrow it by brand, colour and piece.
 */
export async function browseNewIn(since: string, filters: BrowseFilters = {}, asMemberId?: string): Promise<BrowseView> {
  const label = 'New in from your brands'
  const me = await resolveClientMember(asMemberId)
  const view = (pieces: BrowsePiece[], facets: BrowseFacets, read: string[], error?: string): BrowseView => ({
    query: label, pieces, similar: [], similarKind: null, brand: null, read, facets, sizes: EMPTY_SIZES, error,
  })
  if (!me) return view([], EMPTY_FACETS, [], 'Not signed in')
  const at = Date.parse(since)
  // A week back from the push, at most a month: an old link still opens on something sensible.
  const from = new Date(Number.isFinite(at) ? Math.max(at, Date.now() - 31 * 24 * 3600_000) : Date.now() - NEW_IN_DAYS * 24 * 3600_000).toISOString()
  const admin = createAdminClient() as any
  const { data: m } = await admin.from('pilot_member')
    .select('member_id, brands, brands_input_only, brands_never').eq('member_id', me.memberId).maybeSingle()
  if (!m) return view([], EMPTY_FACETS, [])
  const found = await newInForMember(admin, m, from)
  const all = found.items
  const facets: BrowseFacets = {
    brands: found.brands.map((b) => b.name),
    colours: dedupe(all.map((it) => it.colour_family).filter(Boolean)),
    types: dedupe(all.map((it) => it.item_type).filter(Boolean)),
  }
  const brandSel = new Set((filters.brands ?? []).map((b) => b.toLowerCase()))
  const colourSel = new Set(filters.colours ?? [])
  const typeSel = new Set(filters.types ?? [])
  const pieces = all.filter((it) => {
    if (brandSel.size && !brandSel.has(String(it.brand?.name ?? '').toLowerCase())) return false
    if (colourSel.size && !colourSel.has(String(it.colour_family ?? ''))) return false
    if (typeSel.size && !typeSel.has(String(it.item_type ?? ''))) return false
    return true
  })
  return view(pieces.slice(0, 96).map(pieceOf), facets, ['NEW IN', ...found.brands.slice(0, 4).map((b) => b.name.toUpperCase())])
}
