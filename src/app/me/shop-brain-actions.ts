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

import { createAdminClient } from '@/lib/supabase-server'
import { resolveClientMember } from '@/lib/client-member'
import { loadComposableLibrary, type StyledLook } from '@/app/admin/private-stylist/actions'
import { itemPseudoVector, brandCosine, loadBrandGraph, computeSimilarBrands } from '@/lib/brand-affinity'
import { isOwnedItem } from '@/lib/wardrobe/owned-items'
import { slotForItemType } from '@/lib/composer'
import { classifyExternalProduct } from '@/lib/brand-watch'
import { readPriceBands, priceVerdict } from '@/lib/pilot-stylist'
import { styleExternalPiece } from '@/lib/mirror/style'
import type { MirrorMember } from '@/lib/mirror/auth'
import { blockedName } from '@/lib/brand-onboarding-rules'
import { parseQuery } from '@/lib/search-taxonomy'
import { loadMemberSizeProfile, filterItemsForShopper } from '@/lib/size-availability'

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
const SAVED = 12
const VIEWED = 12
const SEARCHES = 6
const LOOK_DAYS = 21
const PER_SECTION = 12
/** Per saved piece, so one heavily-saved brand cannot own a whole row. */
const PER_ANCHOR = 3

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

const isShopHost = (host: string | null | undefined): boolean => {
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
function readFromName(it: any): any {
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

/** The pieces MYRA already puts to an occasion — from live outfits tagged with it. */
async function itemsInLiveOutfitsTagged(admin: any, tag: string): Promise<Set<string>> {
  const { data } = await admin.from('outfit').select('outfit_item(item_id)').eq('status', 'live').contains('occasion_tags', [tag]).limit(300)
  const out = new Set<string>()
  for (const o of (data ?? []) as any[]) for (const oi of o.outfit_item ?? []) if (oi.item_id) out.add(oi.item_id)
  return out
}

export async function loadShopBrain(asMemberId?: string): Promise<ShopBrainView> {
  const me = await resolveClientMember(asMemberId)
  if (!me) return EMPTY
  const admin = createAdminClient() as any
  try {
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
    if (savedRes.error) return { ...EMPTY, test: me.test }
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
    /** Over her ceiling for its bucket — never put forward, whatever it scores. */
    const overBudget = (i: any): boolean =>
      priceVerdict(bands, { item_type: i.item_type, price_gbp: i.price_gbp != null ? Number(i.price_gbp) : null }) === 'over'
    if (!savedItems.length && !viewedItems.length && !searches.length) return { ...EMPTY, test: me.test }

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

    /** The parts of an outfit she actually keeps — nothing else is "for her". */
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

    // ── 1. MORE OF THE SAME ──────────────────────────────────────────────
    // Closest in the 34 dimensions MYRA reads a garment on, in the same kind
    // of piece — a saved short answers with shorts, not with a coat.
    const byAnchor: (ShopPiece & { __style: string })[][] = []
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
    const brandNames = Array.from(new Set([...pool, ...anchors].map((i: any) => i.brand?.name).filter(Boolean))) as string[]
    // A label typed into a search, by plain name — the taxonomy parser is for pieces, not labels.
    const brandInQuery = (query: string): string | null => {
      const q = ` ${query.toLowerCase().replace(/[^a-z0-9&+ ]/g, ' ')} `
      return brandNames.filter((b) => b.length >= 3).sort((a, b) => b.length - a.length).find((b) => q.includes(` ${b.toLowerCase()} `)) ?? null
    }
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
          .map((x) => ({ ...pieceOf(x.i, `Like your search for \u201c${query}\u201d`), __style: styleKey(x.i) }))
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
        .map((x) => ({ ...pieceOf(x.i, `Like your search for \u201c${query}\u201d`), __style: styleKey(x.i) }))
      if (hits.length) byAnchor.push(hits)
    }
    const similar: ShopPiece[] = []
    // A duplicate row of a piece she already kept or opened is not "more of the same".
    const savedStyles = anchors.map(styleKey)
    const seen = new Set<string>(savedStyles)
    for (let round = 0; round < PER_ANCHOR; round++) {
      for (const list of byAnchor) {
        const p = list[round]
        if (!p || seen.has(p.__style) || similar.length >= PER_SECTION) continue
        seen.add(p.__style)
        similar.push(p)
      }
    }

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
    const seenStyle = new Set<string>([...savedStyles, ...similar.map((p: any) => p.__style)])
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
      similar: similar.map(({ __style, ...p }: any) => p),
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
