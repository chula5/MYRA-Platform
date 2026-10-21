// MORE OF THE SAME — the pieces in MYRA's library closest to what she kept or
// looked at through the Mirror, and to what she typed into shops' search
// boxes. Lifted out of the FOR YOU server action so the Mirror's own panel can
// ask for the same answer through /api/mirror/similar: one computation, two
// doors. No session is read here — the caller has already resolved the member
// (resolveClientMember in the app, memberFromRequest on the mirror route).
//
// Saves speak loudest; a look counts for half; a search is a hint. Her
// candidates are the SAME pool the composer uses: ready and live, in her size,
// under her price ceiling.

import { loadComposableLibrary } from '@/app/admin/private-stylist/actions'
import { itemPseudoVector, brandCosine } from '@/lib/brand-affinity'
import { isOwnedItem } from '@/lib/wardrobe/owned-items'
import { slotForItemType } from '@/lib/composer'
import { classifyExternalProduct } from '@/lib/brand-watch'
import { readPriceBands, priceVerdict } from '@/lib/pilot-stylist'
import { parseQuery } from '@/lib/search-taxonomy'

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
  /** How MYRA came by it: she kept it, or only looked at it. */
  kind?: 'saved' | 'viewed'
}

/** The member the pieces are for — what loadComposableLibrary needs to gate her size. */
export interface ShopMember { memberId: string; authUserId: string | null }

export const SAVED = 12
export const VIEWED = 12
export const SEARCHES = 6
export const LOOK_DAYS = 21
export const PER_SECTION = 12
/** Per saved piece, so one heavily-saved brand cannot own a whole row. */
export const PER_ANCHOR = 3

/**
 * A SEARCH IS ONLY A STYLE BRIEF ON A SHOP.
 *
 * The Mirror notes what she types into any search box on any site it runs on,
 * and a search engine is where most typing happens. Her recorded searches were
 * "anna wintour podcast" and "factory ai does not work from mobile?" — read as
 * briefs, the second one matched the word WORK and asked MYRA to dress her for
 * the office, which is how a crossbody bag and a grey skirt arrived under MORE
 * OF THE SAME. What she types at a shop is about clothes; what she types at
 * Google is about anything at all.
 */
const SEARCH_ENGINE = /(^|\.)(google\.[a-z.]+|bing\.com|duckduckgo\.com|search\.(yahoo|aol)\.[a-z.]+|yandex\.[a-z.]+|ecosia\.org|baidu\.com|qwant\.com|startpage\.com|brave\.com|perplexity\.ai|chatgpt\.com|openai\.com|claude\.ai|reddit\.com|pinterest\.[a-z.]+|youtube\.com|instagram\.com|tiktok\.com|facebook\.com)$/i

export const isShopHost = (host: string | null | undefined): boolean => {
  const h = String(host ?? '').replace(/^www\./i, '').toLowerCase()
  return !!h && !SEARCH_ENGINE.test(h)
}

/**
 * What a piece IS, when nothing has read it yet.
 *
 * A piece kept through the Mirror is written down instantly and scored later,
 * or never — six of her seven saves carry no colour, no material and no
 * measured dimensions at all. Matching on a vector that is almost entirely
 * defaults is matching on nothing. The same rules Brand Watch uses to read a
 * product page are pure text, so they can recover colour and material from the
 * name she saved it under ("faux fur gilet", "silk-twill shorts") without a
 * single call out.
 */
export function readFromName(it: any): any {
  if (it.colour_family && it.material_category) return it
  try {
    const read = classifyExternalProduct({
      url: it.retailer_url ?? 'https://x/products/x',
      title: String(it.product_name ?? ''),
      description: '',
      category: String(it.item_type ?? ''),
      brand: it.brand?.name ?? null,
      price: null, currency: null, images: [], available: true,
    })
    return {
      ...it,
      colour_family: it.colour_family ?? read.colourFamily,
      material_category: it.material_category ?? read.materialCategory,
      material_primary: it.material_primary ?? read.materialPrimary,
    }
  } catch { return it }
}

/** "AMUN SHOULDER BAG - RAINBOW MULTI" and "- BLACK" are one idea, not two. */
export const styleKey = (it: any): string =>
  `${it.brand?.name ?? ''}|${String(it.product_name ?? '').split(/\s+[-–—]\s+/)[0].toLowerCase().trim()}`

export const pieceOf = (it: any, because?: string): ShopPiece => ({
  item_id: it.item_id,
  product_name: it.product_name ?? 'Piece',
  brand: it.brand?.name ?? null,
  image_url: it.image_url ?? null,
  price_gbp: it.price_gbp != null ? Number(it.price_gbp) : null,
  url: it.retailer_url ?? null,
  ...(because ? { because } : {}),
})

/** "your Ulla Johnson shorts" — what she would call the piece herself. */
export const shortName = (it: any): string => {
  const brand = it.brand?.name
  const type = String(it.item_type ?? 'piece').replace(/_/g, ' ')
  return brand ? `${brand} ${type}` : (it.product_name ?? 'piece')
}

/** The pieces MYRA already puts to an occasion — from live outfits tagged with it. */
async function itemsInLiveOutfitsTagged(admin: any, tag: string): Promise<Set<string>> {
  const { data } = await admin.from('outfit').select('outfit_item(item_id)').eq('status', 'live').contains('occasion_tags', [tag]).limit(300)
  const out = new Set<string>()
  for (const o of (data ?? []) as any[]) for (const oi of o.outfit_item ?? []) if (oi.item_id) out.add(oi.item_id)
  return out
}

export type StyledPiece = ShopPiece & { __style: string }

/**
 * Everything the three FOR YOU sections read: what she kept, looked at and
 * searched for, her candidate pool, and the closeness measure between them.
 * Built once, then handed to moreOfTheSame and to the brand sections.
 */
export interface ShopContext {
  admin: any
  me: ShopMember
  /** Her saves, newest first, each tagged with the shop it came from. */
  savedItems: any[]
  /** What she lingered on, most-viewed first — never a save, never her own. */
  viewedItems: any[]
  /** What she typed into shops' search boxes, latest first. */
  searches: string[]
  /** Saves then views, colour and material read from the name when unscored. */
  anchors: any[]
  anchorIds: Set<string>
  /** Ready and live, in her size, under her ceiling, not hers already. */
  pool: any[]
  /** The parts of an outfit she actually keeps — nothing else is "for her". */
  savedSlots: Set<string>
  /** Over her ceiling for its bucket — never put forward, whatever it scores. */
  overBudget: (i: any) => boolean
  /** How close a piece is to the ones she kept. */
  closeness: (it: any, against: any[]) => number
  brandNames: string[]
  /** A label typed into a search, by plain name. */
  brandInQuery: (query: string) => string | null
}

/**
 * Reads her Mirror signals and the library. Returns null when there is nothing
 * to go on — no saves, no looks, no searches — or when the tables are not
 * there yet (pre-0060): the caller shows nothing rather than an error.
 */
export async function buildShopContext(admin: any, me: ShopMember): Promise<ShopContext | null> {
  const since = new Date(Date.now() - LOOK_DAYS * 24 * 3600 * 1000).toISOString()
  const itemSel = 'item:item_id(*, brand:brand_id(name))'
  const [savedRes, viewedFirst, searchRes, bandRes] = await Promise.all([
    admin.from('member_saved_item').select(`saved_at, source_host, ${itemSel}`).eq('member_id', me.memberId).order('saved_at', { ascending: false }).limit(SAVED),
    admin.from('recently_viewed').select(`viewed_at, host, dwell_ms, views, ${itemSel}`).eq('member_id', me.memberId).gte('viewed_at', since).order('viewed_at', { ascending: false }).limit(VIEWED),
    // Read more than we will use: the ones typed at a search engine are
    // dropped below, and dropping them must not leave the list empty.
    admin.from('mirror_search').select('host, query, times_searched, last_searched_at').eq('member_id', me.memberId).gte('last_searched_at', since).order('last_searched_at', { ascending: false }).limit(SEARCHES * 4),
    admin.from('pilot_member').select('price_bands').eq('member_id', me.memberId).maybeSingle(),
  ])
  // Pre-0060 the table is not there yet: no sections, never an error page.
  if (savedRes.error) return null
  // Pre-0072 the counters are missing: read the views without them.
  const viewedRes = viewedFirst.error && /dwell_ms|views/.test(viewedFirst.error.message)
    ? await admin.from('recently_viewed').select(`viewed_at, host, ${itemSel}`).eq('member_id', me.memberId).gte('viewed_at', since).order('viewed_at', { ascending: false }).limit(VIEWED)
    : viewedFirst

  const savedItems = ((savedRes.data ?? []) as any[]).map((r) => ({ ...r.item, __host: r.source_host, __kind: 'saved' as const })).filter((i) => i?.item_id)
  const savedIds = new Set(savedItems.map((i) => i.item_id))
  const viewedItems = ((viewedRes.data ?? []) as any[])
    .filter((r) => r.item?.item_id && !savedIds.has(r.item.item_id) && !isOwnedItem(r.item))
    .sort((a, b) => (Number(b.views ?? 1) - Number(a.views ?? 1)) || (Number(b.dwell_ms ?? 0) - Number(a.dwell_ms ?? 0)))
    .map((r) => ({ ...r.item, __host: r.host, __kind: 'viewed' as const }))
  const searches: string[] = ((searchRes.data ?? []) as any[])
    .filter((r) => isShopHost(r.host))
    .map((r) => String(r.query))
    .filter(Boolean)
    .slice(0, SEARCHES)
  // What she will not pay for this kind of piece, set on her own profile.
  const bands = readPriceBands(bandRes?.data ?? null)
  const overBudget = (i: any): boolean =>
    priceVerdict(bands, { item_type: i.item_type, price_gbp: i.price_gbp != null ? Number(i.price_gbp) : null }) === 'over'
  if (!savedItems.length && !viewedItems.length && !searches.length) return null

  // Saves first, then what she looked at most. A piece nothing has scored
  // yet has its colour and material read out of its own name, so the match
  // below has something true to work with.
  const anchors = [...savedItems, ...viewedItems].map(readFromName)
  const anchorIds = new Set(anchors.map((i) => i.item_id))

  const member = { member_id: me.memberId, auth_user_id: me.authUserId }
  const library = await loadComposableLibrary(member)
  // Her size is already a hard gate inside loadComposableLibrary. Her price
  // ceiling was not one anywhere: a £1,005 dress was being put in front of a
  // woman whose dress ceiling is £400. A piece she has told us she would not
  // buy is not a recommendation, so it never enters the pool.
  const pool = library.filter((i: any) => !anchorIds.has(i.item_id) && !isOwnedItem(i) && !overBudget(i))

  const savedSlots = new Set(anchors.map((s) => slotForItemType(s.item_type)))

  // How close a piece is to the ones she kept: same kind wins, then same
  // part of an outfit, then the masked cosine.
  const closeness = (it: any, against: any[]): number => {
    const v = itemPseudoVector(it)
    let best = -Infinity
    for (const a of against) {
      const kind = it.item_type === a.item_type ? 2 : slotForItemType(it.item_type) === slotForItemType(a.item_type) ? 1 : 0
      const c = brandCosine(v, itemPseudoVector(a))
      const score = kind + (Number.isFinite(c) ? c : 0)
      if (score > best) best = score
    }
    return best
  }

  const brandNames = Array.from(new Set([...pool, ...anchors].map((i: any) => i.brand?.name).filter(Boolean))) as string[]
  // A label typed into a search, by plain name — the taxonomy parser is for pieces, not labels.
  const brandInQuery = (query: string): string | null => {
    const q = ` ${query.toLowerCase().replace(/[^a-z0-9&+ ]/g, ' ')} `
    return brandNames.filter((b) => b.length >= 3).sort((a, b) => b.length - a.length).find((b) => q.includes(` ${b.toLowerCase()} `)) ?? null
  }

  return { admin, me, savedItems, viewedItems, searches, anchors, anchorIds, pool, savedSlots, overBudget, closeness, brandNames, brandInQuery }
}

/**
 * MORE OF THE SAME. Closest in the 34 dimensions MYRA reads a garment on, in
 * the same kind of piece — a saved short answers with shorts, not with a coat.
 * Each piece keeps its style key so the sections after it can refuse a
 * duplicate; strip it before it leaves the server.
 */
export async function moreOfTheSame(ctx: ShopContext): Promise<StyledPiece[]> {
  const { admin, anchors, pool, searches, savedSlots, closeness, brandNames, brandInQuery } = ctx
  const byAnchor: StyledPiece[][] = []
  for (const anchor of anchors.slice(0, 8)) {
    const v = itemPseudoVector(anchor)
    if (!v.length) continue
    const slot = slotForItemType(anchor.item_type)
    const sameKind = pool.filter((i: any) => i.item_type === anchor.item_type)
    const candidates = sameKind.length >= PER_ANCHOR ? sameKind : pool.filter((i: any) => slotForItemType(i.item_type) === slot)
    // A piece she only looked at has not been read by the scorer yet, so its
    // vector is mostly defaults: colour and material carry it until then.
    const near = candidates
      .map((i: any) => ({
        i,
        // brandCosine, not cosine. A single-item pseudo-vector holds eleven
        // outfit-only dimensions at a constant 0.5, which lifts plain cosine
        // above 0.97 for every candidate on the page and leaves the ordering
        // to rounding — the reason a khaki skirt came back for an aqua one.
        // Masking those dimensions is what gives an honest spread; see the
        // note on brandCosine in brand-affinity.ts.
        c: brandCosine(itemPseudoVector(i), v)
          + (anchor.colour_family && i.colour_family === anchor.colour_family ? 0.15 : 0)
          + (anchor.material_category && i.material_category === anchor.material_category ? 0.1 : 0)
          // THE FINISH SHE REACHED FOR. Colour family is coarse — aqua and
          // khaki are both "green" — and the family of a material says only
          // "woven". The material itself is the thing she recognises: satin
          // answers satin, faux fur answers faux fur, which is why those are
          // the matches that landed. It outweighs both family signals.
          + (anchor.material_primary && i.material_primary
            && String(anchor.material_primary).toLowerCase() === String(i.material_primary).toLowerCase() ? 0.3 : 0),
      }))
      .filter((x) => Number.isFinite(x.c))
      .sort((a, b) => b.c - a.c)
      .slice(0, PER_ANCHOR)
      .map((x) => ({
        ...pieceOf(x.i, anchor.__kind === 'viewed' ? `Like the ${shortName(anchor)} you looked at` : `Like your ${shortName(anchor)}`),
        __style: styleKey(x.i),
      }))
    if (near.length) byAnchor.push(near)
  }
  // What she typed into a shop's search, read onto MYRA's taxonomy: "linen
  // midi dress" answers with linen midi dresses from the library.
  for (const query of searches.slice(0, 3)) {
    const q = parseQuery(query, brandNames)
    const qBrand = brandInQuery(query)
    const pieceWords = q.itemTypes.length + q.colourFamilies.length + q.materials.length > 0
    if (!pieceWords && !q.occasionGroups.length && !q.formalityRange) continue
    if (!pieceWords) {
      // An occasion — "wedding guest": first the pieces from live outfits MYRA
      // already puts to it, then anything in the pool dressed to its formality
      // (3–4 for a wedding; 5 is black tie).
      const tag = q.occasionGroups[0]?.[0]
      const tagged = tag ? await itemsInLiveOutfitsTagged(admin, tag) : new Set<string>()
      const [lo, hi] = q.formalityRange ?? [3, 5]
      const dressed = pool
        // A formality number is not a brief. Every bag and every skirt in
        // the library sits at some formality, so this asked only "is this
        // piece dressy enough" and then ranked on a tie — which is however
        // the pool happened to be stacked. It has to be a kind of piece she
        // actually keeps, and among those the closest to what she has been
        // keeping comes first.
        .filter((i: any) => savedSlots.has(slotForItemType(i.item_type)))
        .map((i: any) => {
          const f = i.material_formality != null ? Number(i.material_formality) : null
          const fits = (tagged.has(i.item_id) ? 2 : 0) + (f == null ? 0 : f >= lo && f <= hi ? 1 : -9)
          return { i, c: fits <= 0 ? fits : fits + closeness(i, anchors) }
        })
        .filter((x) => x.c > 0)
        .sort((a, b) => b.c - a.c)
        .slice(0, PER_ANCHOR)
        .map((x) => ({ ...pieceOf(x.i, `Like your search for “${query}”`), __style: styleKey(x.i) }))
      if (dressed.length) byAnchor.push(dressed)
      continue
    }
    const hits = pool
      .map((i: any) => ({
        i,
        c: (q.itemTypes.length ? (q.itemTypes.includes(i.item_type) ? 2 : -9) : 0)
          + (q.colourFamilies.length ? (q.colourFamilies.includes(i.colour_family) ? 1 : -0.5) : 0)
          + (q.materials.length ? (q.materials.includes(i.material_category) || q.materials.includes(i.material_primary) ? 1 : -0.5) : 0)
          + (qBrand && i.brand?.name && qBrand.toLowerCase() === String(i.brand.name).toLowerCase() ? 1 : 0),
      }))
      .filter((x) => x.c > 0)
      .sort((a, b) => b.c - a.c)
      .slice(0, PER_ANCHOR)
      .map((x) => ({ ...pieceOf(x.i, `Like your search for “${query}”`), __style: styleKey(x.i) }))
    if (hits.length) byAnchor.push(hits)
  }
  const similar: StyledPiece[] = []
  // A duplicate row of a piece she already kept or opened is not "more of the same".
  const seen = new Set<string>(anchors.map(styleKey))
  for (let round = 0; round < PER_ANCHOR; round++) {
    for (const list of byAnchor) {
      const p = list[round]
      if (!p || seen.has(p.__style) || similar.length >= PER_SECTION) continue
      seen.add(p.__style)
      similar.push(p)
    }
  }
  return similar
}

/** Strips the server-only style key before a piece leaves. */
export const stripStyle = ({ __style, ...p }: StyledPiece): ShopPiece => p

/**
 * The MORE OF THE SAME door on its own, built fresh: what /api/mirror/similar
 * answers with when nothing is kept on her row yet. Empty when she has nothing
 * MYRA can read, never a throw.
 */
export async function similarPiecesFor(admin: any, me: ShopMember): Promise<ShopPiece[]> {
  try {
    const ctx = await buildShopContext(admin, me)
    if (!ctx) return []
    return (await moreOfTheSame(ctx)).map(stripStyle)
  } catch (err) {
    console.error('[shop-brain] similar', err)
    return []
  }
}
