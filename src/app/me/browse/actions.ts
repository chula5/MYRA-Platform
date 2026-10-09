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
import { parseQuery, STOPWORDS, MATERIAL_TERMS, TYPE_FORMALITY, COLOUR, TYPE, MATERIAL, type ParsedQuery } from '@/lib/search-taxonomy'
import { rankPieces, facetCount, type RankContext, type Scored } from '@/lib/browse-rank'
import { brandKey, loadBrandGraph, computeSimilarBrands } from '@/lib/brand-affinity'
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
  /** The answers: every facet she named holds on each of these. */
  pieces: BrowsePiece[]
  /** What comes close without answering everything — shown only when she asks. */
  similar: BrowsePiece[]
  /** Why the similar pieces are there: labels like the one she named, or
   *  pieces that answer most of her words. */
  similarKind: 'brands' | 'close' | null
  /** The label she named, as MYRA knows it. */
  brand: string | null
  /** What MYRA read out of her words: the label, the colours, the pieces, the cloth, the occasion. */
  read: string[]
  facets: BrowseFacets
  sizes: BrowseSizes
  error?: string
}

const CARD = 'item_id, product_name, image_url, price_gbp, retailer_url, colour_family, item_type, material_primary, material_formality, material_weight, sleeve, pattern, status, stock_status, available, ownership, owner_kind, brand_id, brand:brand_id(name)'
/** Anything a member may be shown: published, or ingested and shoppable. */
const SHOWABLE = ['ready', 'live', 'draft']
const MOST = 24
const POOL = 80
const STRICT_POOL = 160

const CLOTHING_CATS = new Set(['tops', 'bottoms', 'outerwear'])
const EMPTY_FACETS: BrowseFacets = { brands: [], colours: [], types: [] }
const EMPTY_SIZES: BrowseSizes = {
  clothing: [...CLOTHING_LADDER], shoes: [...SHOE_LADDER],
  mineClothing: [], mineShoes: [], hasClothing: true, hasShoes: true,
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
  !!it?.item_id && !!it.image_url && it.available !== false && it.stock_status !== 'out_of_stock' && !isOwnedItem(it)

const dedupe = (xs: any[]): any[] => Array.from(new Set(xs.map((x) => String(x))))

// ── The labels MYRA knows ─────────────────────────────────────────────────────

interface KnownBrand { brand_id: string; name: string; keys: string[] }
let brandCache: { at: number; rows: KnownBrand[] } | null = null
const BRAND_TTL = 5 * 60_000

/** Every label in the catalogue with its aliases, keyed the way brand-affinity
 *  keys them, so "j.crew", "j crew" and "jcrew" all reach J.Crew. Cached for a
 *  few minutes — the list barely changes and every search needs it. */
async function loadKnownBrands(admin: any): Promise<KnownBrand[]> {
  if (brandCache && Date.now() - brandCache.at < BRAND_TTL) return brandCache.rows
  const { data } = await admin.from('brand').select('brand_id, name, aliases').limit(3000)
  const rows: KnownBrand[] = ((data ?? []) as any[]).filter((b) => b?.name).map((b) => ({
    brand_id: b.brand_id,
    name: String(b.name),
    keys: dedupe([brandKey(String(b.name)), ...((Array.isArray(b.aliases) ? b.aliases : []) as string[]).map((a) => brandKey(String(a)))]).filter(Boolean),
  }))
  brandCache = { at: Date.now(), rows }
  return rows
}

/** A label whose name is itself a colour, a piece or a cloth ("Black",
 *  "Dress", "Silk") is never read as a brand from a bare word — the word
 *  means the thing. */
const isPlainWord = (key: string) => key in COLOUR || key in TYPE || key in MATERIAL || STOPWORDS.has(key)

/** The labels whose name or alias appears in her words, longest first. */
function brandsInQuery(q: string, known: KnownBrand[]): { names: string[]; byKey: Map<string, KnownBrand[]> } {
  // Her words, keyed the same way: "j.crew" and "J Crew" both become "j crew";
  // "jcrew" stays one word and meets the label's compact key instead.
  const text = ` ${brandKey(q)} `
  const byKey = new Map<string, KnownBrand[]>()
  const names: string[] = []
  for (const b of known) {
    for (const k of b.keys) {
      if (k.length < 3 || isPlainWord(k)) continue
      const compact = k.replace(/\s+/g, '')
      const hit = text.includes(` ${k} `) || (compact !== k && compact.length >= 4 && text.includes(` ${compact} `))
      if (!hit) continue
      const list = byKey.get(k) ?? []
      list.push(b)
      byKey.set(k, list)
      if (!names.includes(k)) names.push(k)
    }
  }
  names.sort((a, b) => b.length - a.length)
  return { names, byKey }
}

// ── Reading the question back to her ─────────────────────────────────────────

function formalityLabel(range: [number, number]): string {
  const [lo, hi] = range
  if (lo >= 4 && hi >= 5) return 'BLACK TIE'
  if (lo >= 4) return 'FORMAL'
  if (lo >= 3) return 'DRESSED UP'
  if (hi <= 2) return 'CASUAL'
  return 'SMART CASUAL'
}

function readOf(parsed: ParsedQuery, brandName: string | null): string[] {
  return [
    ...(brandName ? [brandName.toUpperCase()] : []),
    ...parsed.colourFamilies.map((c) => c.toUpperCase()),
    ...parsed.itemTypes.map((t) => t.replace(/_/g, ' ').toUpperCase()),
    ...parsed.materials.map((m) => m.toUpperCase()),
    ...parsed.occasionGroups.map((g) => g[0].toUpperCase()),
    ...(parsed.formalityRange ? [formalityLabel(parsed.formalityRange)] : []),
  ].filter((v, i, a) => a.indexOf(v) === i).slice(0, 6)
}

// ── Pulling candidates ────────────────────────────────────────────────────────

/** A PostgREST or() filter value — quoted when it carries a space. */
const orVal = (v: string) => (/[\s,()]/.test(v) ? `"%${v}%"` : `%${v}%`)

/** Pieces whose label or name carries any word for the cloths she named. */
function materialOr(materials: string[]): string {
  const terms = dedupe(materials.flatMap((m) => MATERIAL_TERMS[m] ?? [m]))
  return terms.flatMap((t) => [`material_primary.ilike.${orVal(t)}`, `product_name.ilike.${orVal(t)}`]).join(',')
}

/** Piece types that could sit in a formality range once cloth and name are counted. */
function typesInRange(range: [number, number]): string[] {
  const top = range[1] >= 4 ? 5 : range[1]
  return Object.entries(TYPE_FORMALITY).filter(([, v]) => v >= range[0] - 1.5 && v <= top + 1.5).map(([t]) => t)
}

/**
 * What she asked for, answered with pieces. Every facet MYRA heard — label,
 * piece, colour, cloth, how dressed-up — must hold for a piece to be an
 * answer. Pieces that answer most of it are returned separately as similar.
 * Once answered she can narrow by brand, colour, piece and size; her own
 * sizes come pre-filled and she can add another to mix it up for one search.
 */
export async function browseSearch(
  query: string,
  filters: BrowseFilters = {},
  asMemberId?: string,
): Promise<BrowseView> {
  const me = await resolveClientMember(asMemberId)
  const blank = (q: string, error?: string): BrowseView => ({
    query: q, pieces: [], similar: [], similarKind: null, brand: null, read: [], facets: EMPTY_FACETS, sizes: EMPTY_SIZES, error,
  })
  if (!me) return blank(query, 'Not signed in')

  const q = query.trim().slice(0, 120)
  if (q.length < 2) return blank(q)

  const admin = createAdminClient() as any
  const needle = q.toLowerCase()
  const safe = needle.replace(/[^a-z0-9]+/g, ' ').trim()
  if (!safe) return blank(q)
  // The words she typed, minus the ones that only carry the question.
  const words = Array.from(new Set(safe.split(' ').filter((w) => w.length >= 2 && !STOPWORDS.has(w)))).slice(0, 8)
  const nameWords = words.filter((w) => w.length >= 3)

  // 1. Read her words: which label, piece, colour, cloth and occasion she named.
  const known = await loadKnownBrands(admin)
  const inQuery = brandsInQuery(q, known)
  const parsed = parseQuery(q, inQuery.names)
  const brandRows = parsed.brand ? (inQuery.byKey.get(brandKey(parsed.brand)) ?? []) : []
  const brandIds = brandRows.map((b) => b.brand_id)
  const brandName = brandRows[0]?.name ?? null
  const facets = facetCount(parsed)
  const ctx: RankContext = { brandIds: new Set(brandIds), words, needle }

  // 2. Pull candidates. One strict query carries every facet at once (so the
  //    answers are not lost behind a page of near-misses), and looser pools —
  //    one per facet — supply what comes close.
  const base = () => admin.from('item').select(CARD).in('status', SHOWABLE).not('image_url', 'is', null)
  const withFacets = (qb: any, skipBrand = false) => {
    if (brandIds.length && !skipBrand) qb = qb.in('brand_id', brandIds)
    if (parsed.itemTypes.length) qb = qb.in('item_type', parsed.itemTypes)
    else if (parsed.formalityRange) qb = qb.in('item_type', typesInRange(parsed.formalityRange))
    if (parsed.colourFamilies.length) qb = qb.in('colour_family', parsed.colourFamilies)
    if (parsed.materials.length) qb = qb.or(materialOr(parsed.materials))
    return qb
  }

  const pools: Promise<any>[] = []
  if (facets > 0) pools.push(withFacets(base()).limit(STRICT_POOL))
  if (nameWords.length) pools.push(base().or(nameWords.map((w) => `product_name.ilike.${orVal(w)}`).join(',')).limit(POOL))
  if (facets >= 2) {
    if (brandIds.length) pools.push(base().in('brand_id', brandIds).limit(POOL))
    if (parsed.itemTypes.length) pools.push(base().in('item_type', parsed.itemTypes).limit(POOL))
    if (parsed.colourFamilies.length) pools.push(base().in('colour_family', parsed.colourFamilies).limit(POOL))
    if (parsed.materials.length) pools.push(base().or(materialOr(parsed.materials)).limit(POOL))
  }
  if (parsed.formalityRange && !parsed.itemTypes.length) {
    pools.push(withFacets(base()).gte('material_formality', Math.max(1, parsed.formalityRange[0] - 1)).limit(POOL))
  }
  // A season is read off the piece, not filtered in the database, so the pool
  // for "winter dress" leans towards the pieces most likely to be winter:
  // the dark colours and the heavier cloths. The scorer still decides.
  if (parsed.seasons.length && !parsed.colourFamilies.length) {
    const cold = parsed.seasons.some((x) => x === 'winter' || x === 'autumn')
    const colours = cold ? ['black', 'navy', 'burgundy', 'brown', 'grey', 'green', 'purple', 'red', 'camel'] : ['white', 'cream', 'yellow', 'pink', 'orange', 'blue', 'multicolour']
    pools.push(withFacets(base()).in('colour_family', colours).limit(STRICT_POOL))
    if (cold) pools.push(withFacets(base()).gte('material_weight', 3).limit(POOL))
    else pools.push(withFacets(base()).lte('material_weight', 2).limit(POOL))
  }
  // Labels that stand next to the one she named: the SEE SIMILAR for a brand
  // search is other brands like it, still held to every other facet.
  const likeBrands: Promise<string[]> = brandIds.length
    ? loadBrandGraph(admin).then((graph) => computeSimilarBrands(brandIds[0], graph, 10).map((s) => s.brand_id)).catch(() => [])
    : Promise.resolve([])

  const [results, similarBrandIds] = await Promise.all([Promise.all(pools), likeBrands])
  const candidates: any[] = []
  for (const r of results) for (const row of ((r?.data ?? []) as any[])) if (showable(row)) candidates.push(row)

  // 3. Rank: exact answers, then what comes close.
  const ranked = rankPieces(candidates, parsed, ctx)
  let similar: Scored<any>[] = ranked.similar
  let similarKind: BrowseView['similarKind'] = similar.length ? 'close' : null

  if (similarBrandIds.length) {
    const { data } = await withFacets(base().in('brand_id', similarBrandIds), true).limit(POOL)
    const rows = ((data ?? []) as any[]).filter(showable)
    const fromLikeBrands = rankPieces(rows, { ...parsed, brand: null }, ctx).exact
    if (fromLikeBrands.length) {
      const taken = new Set(fromLikeBrands.map((s) => s.it.item_id))
      similar = [...fromLikeBrands, ...similar.filter((s) => !taken.has(s.it.item_id))]
      similarKind = 'brands'
    }
  }
  const exactIds = new Set(ranked.exact.map((s) => s.it.item_id))
  similar = similar.filter((s) => !exactIds.has(s.it.item_id))

  // 4. Filter options come from everything that genuinely matched, so
  //    narrowing never hides a choice the results contain. When nothing
  //    matched at all they come from the catalogue, so the panel is never bare.
  let facetSource: any[] = [...ranked.exact.map((s) => s.it), ...similar.map((s) => s.it)]
  if (!facetSource.length) {
    const { data } = await base().limit(240)
    facetSource = ((data ?? []) as any[]).filter(showable)
  }
  const brandCount = new Map<string, number>()
  for (const it of facetSource) { const n = it.brand?.name; if (n) brandCount.set(n, (brandCount.get(n) ?? 0) + 1) }
  const facetsOut: BrowseFacets = {
    brands: Array.from(brandCount.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([n]) => n).slice(0, 24),
    colours: dedupe(facetSource.map((it) => it.colour_family).filter(Boolean)),
    types: dedupe(facetSource.map((it) => it.item_type).filter(Boolean)),
  }
  const hasClothing = !facetSource.length || facetSource.some((it) => CLOTHING_CATS.has(sizeCategoryFor(it.item_type) ?? ''))
  const hasShoes = !facetSource.length || facetSource.some((it) => sizeCategoryFor(it.item_type) === 'shoes')

  // Her sizes, pre-filled so the panel opens already set to what fits her.
  const sizeCtx = await loadMemberSizeProfile(me.memberId)
  const mineClothing = dedupe([
    ...acceptedValues(sizeCtx.profile, 'tops'),
    ...acceptedValues(sizeCtx.profile, 'bottoms'),
    ...acceptedValues(sizeCtx.profile, 'outerwear'),
  ]).map(Number).sort((a, b) => a - b)
  const mineShoes = acceptedValues(sizeCtx.profile, 'shoes').slice().sort((a, b) => a - b)
  const sizes: BrowseSizes = {
    clothing: [...CLOTHING_LADDER], shoes: [...SHOE_LADDER],
    mineClothing, mineShoes, hasClothing, hasShoes,
  }

  // 5. Apply her chosen filters as hard constraints over both lists.
  const brandSel = new Set((filters.brands ?? []).map((b) => b.toLowerCase()))
  const colourSel = new Set(filters.colours ?? [])
  const typeSel = new Set(filters.types ?? [])
  const clothingSel = filters.clothingSizes ?? []
  const shoeSel = filters.shoeSizes ?? []
  const wantsSize = clothingSel.length > 0 || shoeSel.length > 0

  const narrow = (list: Scored<any>[]) => list.filter((k) => {
    if (brandSel.size && !brandSel.has(String(k.it.brand?.name ?? '').toLowerCase())) return false
    if (colourSel.size && !colourSel.has(String(k.it.colour_family ?? ''))) return false
    if (typeSel.size && !typeSel.has(String(k.it.item_type ?? ''))) return false
    return true
  })
  let exactN = narrow(ranked.exact)
  let similarN = narrow(similar)

  if (wantsSize && (exactN.length || similarN.length)) {
    const rows = await loadSizeRowsFor([...exactN, ...similarN].map((k) => k.it.item_id))
    const fits = (k: Scored<any>) => {
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
    }
    exactN = exactN.filter(fits)
    similarN = similarN.filter(fits)
  }

  return {
    query: q,
    pieces: exactN.slice(0, MOST).map((k) => pieceOf(k.it)),
    similar: similarN.slice(0, MOST).map((k) => pieceOf(k.it)),
    similarKind: similarN.length ? similarKind ?? 'close' : null,
    brand: brandName,
    read: readOf(parsed, brandName),
    facets: facetsOut,
    sizes,
  }
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
