// SAVE A SCREENSHOT — the Mirror for people who will not install the Mirror.
//
// She screenshots a piece on her phone (a shop page, an Instagram post, a
// newsletter) and hands MYRA the picture; no extension, no link. The picture
// is hosted, read once by the eye (brand, name, price, cut, colour, words),
// and then MYRA tries to pin the real product: when the brand is one it
// knows the site of, the piece is looked for on the brand's rail the way an
// Instagram post's piece is (lib/share/post-piece), and a hit is kept exactly
// like a Mirror heart — a real URL, stock watched, its ways styled. When it
// cannot be pinned the screenshot itself becomes the piece: a draft item row
// with the hosted picture, named in the shop's words, so it sits on her
// SAVED shelf, is styled three ways, and feeds MORE OF THE SAME through the
// same name-reading the similar engine already does for thin Mirror saves.

import 'server-only'
import { createAdminClient } from '@/lib/supabase-server'
import { uploadImageBytesToCloudinary } from '@/lib/cloudinary-persist'
import { cloudinaryConfigured } from '@/lib/cloudinary-config'
import { readWordFromImage } from '@/lib/openai-vision'
import Anthropic from '@anthropic-ai/sdk'
import { GARMENT_TYPES, GARMENT_COLOURS, findPieceInPost, pickSamePiece, shopifyRail, type GarmentRead, type Candidate } from '@/lib/share/post-piece'
import { extractProduct, fetchText, isAggregatorHost, isSocialHost, type ResolvedProduct } from '@/lib/share/resolve'
import { fetchImageForVision } from '@/lib/vision-image'
import { loadBrandGraph, resolveBrandNames } from '@/lib/brand-affinity'
import { classifyExternalProduct } from '@/lib/brand-watch'
import { insertItemTolerantly } from '@/lib/wardrobe/store'
import { saveForMember } from '@/lib/mirror/save'
import { productFrom } from '@/lib/mirror/product'
import type { SiteProduct } from '@/lib/mirror/style'
import type { MirrorMember } from '@/lib/mirror/auth'
import type { ClientMember } from '@/lib/client-member'
import { enqueueWarmups, kickStyledWaysDrain } from '@/lib/styled-ways-queue'

export const MAX_SCREENSHOT_BYTES = 12 * 1024 * 1024
/** How a screenshot save is told apart on the shelf and in MORE OF THE SAME. */
export const SCREENSHOT_HOST = 'screenshot'

export interface ScreenshotRead {
  fashion: boolean
  brand: string | null
  name: string | null
  price_gbp: number | null
  type: string | null
  colour: string | null
  words: string[]
}

export interface ScreenshotSaveResult {
  saved?: true
  item?: { item_id: string; product_name: string; brand: string | null; image_url: string | null; price_gbp: number | null; url: string | null }
  /** True when MYRA found the real product page; false when the screenshot itself is the piece. */
  pinned?: boolean
  /** What the eye made of the picture, in a line. */
  read?: string | null
  message?: string
  error?: string
}

export const READ_PROMPT = `This is a screenshot someone took of a piece of clothing, a shoe or a bag they want to remember — from a shop's page, a social post or an email. Read what is in it. Reply with a JSON object only: {"fashion": true if a garment, shoe or bag for sale is the subject, false otherwise, "brand": the brand or label named anywhere in the screenshot (logo, header, caption, URL) or null, "name": the product's name as the shop writes it, or null if none is written, "price_gbp": the price as a number if one is shown in pounds, else null, "type": one of ${GARMENT_TYPES.join('|')} or null (the cut, not the fabric), "colour": one of ${GARMENT_COLOURS.join('|')} or null, "words": "three to six plain words a shop would use in its name for it, e.g. wool wide leg trouser"}`

/** The eye's JSON, held to the vocabularies. Exported for the test. */
export function parseScreenshotRead(text: string): ScreenshotRead | null {
  const first = text.indexOf('{'); const last = text.lastIndexOf('}')
  if (first === -1 || last <= first) return null
  let p: any
  try { p = JSON.parse(text.slice(first, last + 1)) } catch { return null }
  const str = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null)
  const price = typeof p.price_gbp === 'number' && Number.isFinite(p.price_gbp) && p.price_gbp > 0 ? Math.round(p.price_gbp * 100) / 100
    : typeof p.price_gbp === 'string' && /^\s*£?\s*\d/.test(p.price_gbp) ? parseFloat(p.price_gbp.replace(/[^\d.]/g, '')) || null : null
  return {
    fashion: p.fashion !== false,
    brand: str(p.brand, 120),
    name: str(p.name, 200),
    price_gbp: price,
    type: typeof p.type === 'string' && (GARMENT_TYPES as readonly string[]).includes(p.type) ? p.type : null,
    colour: typeof p.colour === 'string' && (GARMENT_COLOURS as readonly string[]).includes(p.colour) ? p.colour : null,
    words: String(p.words ?? '').toLowerCase().split(/[^a-z0-9+-]+/).filter((w) => w.length > 2).slice(0, 8),
  }
}

/** "Toteme · black wool scarf coat" — the read, said back to her. */
export function readLine(r: ScreenshotRead): string | null {
  const what = r.name ?? ([r.colour, r.type?.replace(/_/g, ' ')].filter(Boolean).join(' ') || null)
  return [r.brand, what || (r.words.length ? r.words.join(' ') : null)].filter(Boolean).join(' · ') || null
}

/** The name the piece is kept under: the shop's, else the eye's words. */
export function pieceName(r: ScreenshotRead, brandKnown: boolean): string {
  const base = r.name ?? ((r.words.length ? r.words.join(' ') : [r.colour, r.type?.replace(/_/g, ' ')].filter(Boolean).join(' ')) || 'Piece from a screenshot')
  const titled = base.charAt(0).toUpperCase() + base.slice(1)
  // A label MYRA does not stock has no brand row to join, so it rides in the name.
  return !brandKnown && r.brand && !titled.toLowerCase().includes(r.brand.toLowerCase()) ? `${r.brand} ${titled}`.slice(0, 200) : titled.slice(0, 200)
}

async function mirrorMemberFor(admin: any, me: ClientMember): Promise<MirrorMember | null> {
  const { data: row } = await admin.from('pilot_member')
    .select('member_id, name, auth_user_id, brands, brands_input_only, sizes').eq('member_id', me.memberId).maybeSingle()
  if (!row) return null
  return {
    member_id: row.member_id, name: row.name, auth_user_id: row.auth_user_id ?? null,
    brands: Array.isArray(row.brands) ? row.brands : [], brands_input_only: row.brands_input_only ?? [], sizes: row.sizes ?? {},
    actingAdmin: false, actorUserId: null,
  }
}

/** The brand's own site, when MYRA watches it or holds pieces from it. */
async function siteForBrand(admin: any, brandId: string | null, brandName: string | null): Promise<string | null> {
  try {
    if (brandId) {
      const { data } = await admin.from('watched_brand').select('base_url').eq('brand_id', brandId).eq('active', true).limit(1)
      if (data?.[0]?.base_url) return String(data[0].base_url)
      const { data: it } = await admin.from('item').select('retailer_url').eq('brand_id', brandId).in('status', ['ready', 'live']).not('retailer_url', 'is', null).limit(1)
      const u = it?.[0]?.retailer_url
      if (u) { try { return new URL(String(u)).origin } catch { /* not a url */ } }
    }
    if (brandName) {
      const { data } = await admin.from('watched_brand').select('base_url').ilike('name', brandName).eq('active', true).limit(1)
      if (data?.[0]?.base_url) return String(data[0].base_url)
    }
  } catch (err) { console.error('[screenshot-save] site', err) }
  return null
}

const LOCALE_SEG = /^\/(?:[a-z]{2}|int|intl|row|[a-z]{2}-[a-z]{2})(?=\/)/i
/** A product page without its storefront: "/us/cashmere-hooded-scarf" and "/int/cashmere-hooded-scarf" are one page. */
const pageKeyOf = (url: string): string => {
  try { const u = new URL(url); return `${u.host.replace(/^www\./, '')}${u.pathname.replace(LOCALE_SEG, '').replace(/\/$/, '')}` } catch { return url.split(/[?#]/)[0] }
}
/** Home storefronts first (none, /int, /gb, /uk, /en-gb), the rest after. */
const storefrontRank = (url: string): number => {
  const m = (() => { try { return new URL(url).pathname.match(LOCALE_SEG)?.[0].slice(1).toLowerCase() ?? '' } catch { return '' } })()
  if (!m) return 0
  if (/^(int|intl|gb|uk|en-gb|row)$/.test(m)) return 1
  return 2
}

/** Lower-case words, nothing else — so "Cashmere Hooded Scarf" and "Hooded Scarf" can be laid side by side. */
const nameWords = (s: string): string[] => s.toLowerCase().split(/[^a-z0-9+]+/).filter((w) => w.length > 1)

/**
 * The library piece from this brand whose name is the one the screenshot
 * shows — one clear match, or nothing. Shops pad a name differently on the
 * page and in their feed ("Cashmere Hooded Scarf" / "Hooded Scarf"), so the
 * shorter name has to sit whole inside the longer, and the longer must be
 * at least two words. Several pieces of the same name (colours) are told
 * apart by the colour the eye read; still several → the eye's rail decides.
 */
async function pinByName(admin: any, brandId: string, name: string, colour: string | null): Promise<{ retailer_url: string; product_name: string; image_url: string | null; price_gbp: number | null } | null> {
  const want = nameWords(name)
  if (want.length < 2) return null
  try {
    const { data } = await admin.from('item').select('product_name, retailer_url, image_url, price_gbp, colour_family')
      .eq('brand_id', brandId).in('status', ['ready', 'live']).not('retailer_url', 'is', null).limit(2000)
    const wantStr = ` ${want.join(' ')} `
    let rows = ((data ?? []) as any[]).filter((r) => {
      if (!r.retailer_url || !r.product_name) return false
      const have = nameWords(String(r.product_name))
      if (have.length < 2) return false
      const haveStr = ` ${have.join(' ')} `
      return wantStr.includes(haveStr) || haveStr.includes(wantStr)
    })
    if (colour && rows.length > 1) {
      const same = rows.filter((r) => r.colour_family === colour)
      if (same.length) rows = same
    }
    // The same page listed twice is one piece — and so is the same piece on
    // two storefronts (meandem.com/us/… and /int/…); different pieces are a
    // choice MYRA does not make here. The home storefront is the one kept.
    const pages = new Map<string, any>()
    for (const r of rows.slice().sort((a, b) => storefrontRank(a.retailer_url) - storefrontRank(b.retailer_url))) {
      const key = pageKeyOf(String(r.retailer_url))
      if (!pages.has(key)) pages.set(key, r)
    }
    if (pages.size !== 1) return null
    const r = Array.from(pages.values())[0]
    return { retailer_url: String(r.retailer_url), product_name: String(r.product_name), image_url: r.image_url ?? null, price_gbp: r.price_gbp == null ? null : Number(r.price_gbp) }
  } catch (err) { console.error('[screenshot-save] by name', err); return null }
}

/** The product-page URLs a search answered with, in order. Exported for the test. */
export function parseSearchedUrls(text: string): string[] {
  const cleaned = text.replace(/```[a-z]*\n?/gi, '')
  const first = cleaned.indexOf('{'); const last = cleaned.lastIndexOf('}')
  if (first === -1 || last <= first) return []
  try {
    const p = JSON.parse(cleaned.slice(first, last + 1))
    const urls = Array.isArray(p?.urls) ? p.urls : []
    return urls.filter((u: unknown): u is string => typeof u === 'string' && /^https?:\/\//.test(u)).slice(0, 4)
  } catch { return [] }
}

/**
 * A brand MYRA does not know, or a piece its rail could not place: the
 * search she would do herself. The brand and the product's name as the
 * screenshot shows them go to a web search for the product's page — the
 * brand's own site first, a retailer after — and each page found is read
 * for its product. The eye then holds the screenshot against those pages'
 * pictures and keeps the one that is the same piece, or none.
 */
async function pinByWebSearch(read: ScreenshotRead, hosted: string): Promise<ResolvedProduct | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  const what = [read.brand, read.name].filter(Boolean).join(' ')
  if (!apiKey || !read.name) return null
  let urls: string[] = []
  try {
    const client = new Anthropic({ apiKey })
    const desc = [read.colour, read.type?.replace(/_/g, ' ')].filter(Boolean).join(' ')
    const response = await client.messages.create({
      model: 'claude-sonnet-5-5',
      max_tokens: 500,
      system: 'You find the product page for one piece of clothing, a shoe or a bag that is for sale. Prefer the brand\'s own online shop; a reputable retailer that stocks it is acceptable after that. Never a social network, a search result page, a link hub, a listing of many products, a review or an article. Reply with JSON only.',
      tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 3 } as unknown as Anthropic.Messages.Tool],
      messages: [{ role: 'user', content: `Find the product page for "${what}"${desc ? ` — a ${desc}` : ''}${read.price_gbp ? `, priced around £${Math.round(read.price_gbp)}` : ''}. Reply with exactly one JSON object: {"urls": ["https://…", …]} with up to 3 product-page URLs, the most likely first, or {"urls": []}.` }],
    })
    const text = response.content.filter((b) => b.type === 'text').map((b: any) => b.text).join('\n')
    urls = parseSearchedUrls(text)
    console.info('[screenshot-save] search for', JSON.stringify(what), '→', urls.length ? urls.join(' | ') : `none (${text.replace(/\s+/g, ' ').slice(0, 160)})`)
  } catch (err) { console.error('[screenshot-save] web search', err); return null }
  urls = urls.filter((u) => { const h = (() => { try { return new URL(u).host } catch { return '' } })(); return h && !isSocialHost(h) && !isAggregatorHost(h) })
  if (!urls.length) return null

  // Every page is read at once; the ones with a product and a picture go to
  // the eye. The search gets the shop right more often than the exact page
  // (a "…-midi-dress" handle that is really "…-dress"), so each shop found is
  // also asked for the name through its own search, where it lets a server in.
  const origins = Array.from(new Set(urls.map((u) => { try { return new URL(u).origin } catch { return '' } }).filter(Boolean)))
  const [pages, ...shops] = await Promise.all([
    Promise.all(urls.map(async (u) => { const page = await fetchText(u).catch(() => null); return page ? extractProduct(page.html, page.url) : null })),
    ...origins.map((o) => shopifyRail(o, read.name!).catch(() => [] as Candidate[])),
  ])
  const found = pages.filter((p): p is ResolvedProduct => !!p && !!p.image)
  const seen = new Set(found.map((p) => pageKeyOf(p.url)))
  const rail: Candidate[] = found.map((p) => ({ url: p.url, title: p.title, image: p.image!, price: p.price, type: read.type, colour: read.colour, brand: p.brand }))
  for (const c of shops.flat()) {
    const key = pageKeyOf(c.url)
    if (seen.has(key)) continue
    seen.add(key); rail.push({ ...c, type: read.type, colour: read.colour })
    if (rail.length >= 8) break
  }
  if (!rail.length) { console.info('[screenshot-save] no product read on', urls.join(' | ')); return null }
  const shot = await fetchImageForVision(hosted, 600)
  if (!shot.image) return null
  const garment: GarmentRead = { type: read.type, colour: read.colour, words: read.words }
  const idx = await pickSamePiece(shot.image, rail, garment, read.name)
  console.info('[screenshot-save] search rail:', rail.map((c) => c.url).join(' | '), '→', idx == null ? 'none' : rail[idx].url)
  if (idx == null) return null
  const c = rail[idx]
  const host = (() => { try { return new URL(c.url).host.replace(/^www\./, '') } catch { return '' } })()
  return { url: c.url, title: c.title, brand: c.brand ?? read.brand, image: c.image, price: c.price, host }
}

/**
 * THE PRODUCT HUNT, on its own: the real product page for what the eye read
 * in a hosted screenshot — the library by name first, the brand's own rail,
 * then the web — or null when the screenshot has to be the piece. Shared by
 * the member save below and Outfit Review's screenshot intake.
 */
export async function findProductForRead(admin: any, read: ScreenshotRead, hosted: string): Promise<{ product: SiteProduct; brand: { brand_id: string; name: string } | null; via: string } | null> {
  const graph = await loadBrandGraph(admin)
  const brand = read.brand ? (resolveBrandNames(graph, [read.brand]).matched[0] as { brand_id: string; name: string } | undefined) ?? null : null
  const named = brand && read.name ? await pinByName(admin, brand.brand_id, read.name, read.colour) : null
  if (named) {
    const product = productFrom({ url: named.retailer_url, title: named.product_name, brand: brand!.name, image: named.image_url, price: named.price_gbp ?? read.price_gbp })
    if (product) return { product, brand, via: 'MYRA already holds it' }
  }
  const site = read.brand ? await siteForBrand(admin, brand?.brand_id ?? null, read.brand) : null
  if (site) {
    const garment: GarmentRead = { type: read.type, colour: read.colour, words: read.words.length ? read.words : (read.name ?? '').toLowerCase().split(/[^a-z0-9+-]+/).filter((w) => w.length > 2).slice(0, 8) }
    const pinned = await findPieceInPost({ site, brandName: brand?.name ?? read.brand, caption: read.name, image: hosted, reads: Promise.resolve([garment]) }).catch((err) => { console.error('[screenshot-save] pin', err); return null })
    if (pinned) {
      const product = productFrom({ url: pinned.url, title: pinned.title, brand: pinned.brand, image: pinned.image, price: pinned.price ?? read.price_gbp })
      if (product) return { product, brand, via: `found on ${pinned.host}` }
    }
  }
  const searched = await pinByWebSearch(read, hosted)
  if (searched) {
    const product = productFrom({ url: searched.url, title: searched.title, brand: searched.brand, image: searched.image, price: searched.price ?? read.price_gbp })
    if (product) return { product, brand, via: `found on ${searched.host}` }
  }
  return null
}

export async function saveFromScreenshot(me: ClientMember, bytes: Buffer, contentType: string): Promise<ScreenshotSaveResult> {
  if (!cloudinaryConfigured()) return { error: 'Saving screenshots is not set up on the server yet' }
  if (!process.env.OPENAI_API_KEY) return { error: 'MYRA cannot read pictures on the server yet' }
  const admin = createAdminClient() as any
  const member = await mirrorMemberFor(admin, me)
  if (!member) return { error: 'Not signed in' }

  // 1. Host it: the eye reads from a URL, and the piece keeps the picture.
  const hosted = await uploadImageBytesToCloudinary(bytes, contentType || 'image/png', { folder: 'screenshot-saves', publicId: `shot-${me.memberId.slice(0, 8)}-${Date.now()}` })
  if (!hosted) return { error: 'Could not keep that picture — try again' }

  // 2. Read it once, in detail: the words a shop would use are the whole value.
  const r = await readWordFromImage(hosted, READ_PROMPT, { maxTokens: 220, detail: 'high' })
  if (r.error) console.error('[screenshot-save] read', r.error)
  const read = r.word ? parseScreenshotRead(r.word) : null
  if (!read) return { error: 'MYRA could not read that screenshot — try one that shows the piece clearly' }
  if (!read.fashion || (!read.type && !read.words.length && !read.name)) return { error: 'MYRA cannot see a piece of clothing, a shoe or a bag in that screenshot' }

  // 3. The real product. A shop screenshot carries the product's own name,
  //    so MYRA's library is asked for it by name first — a ME+EM "Cashmere
  //    Hooded Scarf" sat in the library and the eye's rail still missed it.
  const graph = await loadBrandGraph(admin)
  const brand = read.brand ? resolveBrandNames(graph, [read.brand]).matched[0] ?? null : null
  const named = brand && read.name ? await pinByName(admin, brand.brand_id, read.name, read.colour) : null
  if (named) {
    const product = productFrom({ url: named.retailer_url, title: named.product_name, brand: brand!.name, image: named.image_url, price: named.price_gbp ?? read.price_gbp })
    if (product) {
      const res = await saveForMember(member, product)
      if (res.item_id) {
        return {
          saved: true, pinned: true, read: readLine(read),
          item: { item_id: res.item_id, product_name: product.title, brand: brand!.name, image_url: product.image ?? null, price_gbp: product.price ?? null, url: product.url },
          message: `Kept “${product.title}” from ${brand!.name} — MYRA already holds it.`,
        }
      }
    }
  }
  const site = read.brand ? await siteForBrand(admin, brand?.brand_id ?? null, read.brand) : null
  if (site) {
    const garment: GarmentRead = { type: read.type, colour: read.colour, words: read.words.length ? read.words : (read.name ?? '').toLowerCase().split(/[^a-z0-9+-]+/).filter((w) => w.length > 2).slice(0, 8) }
    const pinned = await findPieceInPost({ site, brandName: brand?.name ?? read.brand, caption: read.name, image: hosted, reads: Promise.resolve([garment]) }).catch((err) => { console.error('[screenshot-save] pin', err); return null })
    if (pinned) {
      const product = productFrom({ url: pinned.url, title: pinned.title, brand: pinned.brand, image: pinned.image, price: pinned.price ?? read.price_gbp })
      if (product) {
        const res = await saveForMember(member, product)
        if (res.item_id) {
          return {
            saved: true, pinned: true, read: readLine(read),
            item: { item_id: res.item_id, product_name: product.title, brand: product.brand ?? null, image_url: product.image ?? null, price_gbp: product.price ?? null, url: product.url },
            message: `Kept “${product.title}”${product.brand ? ` from ${product.brand}` : ''} — found on ${pinned.host}.`,
          }
        }
      }
    }
  }

  // 3b. Any brand at all: search the web for the page, as she would.
  const searched = await pinByWebSearch(read, hosted)
  if (searched) {
    const product = productFrom({ url: searched.url, title: searched.title, brand: searched.brand, image: searched.image, price: searched.price ?? read.price_gbp })
    if (product) {
      const res = await saveForMember(member, product)
      if (res.item_id) {
        return {
          saved: true, pinned: true, read: readLine(read),
          item: { item_id: res.item_id, product_name: product.title, brand: product.brand ?? null, image_url: product.image ?? null, price_gbp: product.price ?? null, url: product.url },
          message: `Kept “${product.title}”${product.brand ? ` from ${product.brand}` : ''} — found on ${searched.host}.`,
        }
      }
    }
  }

  // 4. The screenshot is the piece. Colour and material from the words, as
  //    the similar engine reads a thin Mirror save (readFromName).
  const name = pieceName(read, !!brand)
  const scanned = classifyExternalProduct({
    url: `https://screenshot.myra/${encodeURIComponent(read.words.join('-') || 'piece')}`, title: name, description: '', category: read.type ?? '',
    brand: brand?.name ?? read.brand ?? null, price: read.price_gbp, currency: read.price_gbp != null ? 'GBP' : null, images: [hosted], available: true,
  })
  const itemType = read.type ?? scanned.itemType ?? null
  if (!itemType) return { error: "MYRA can't tell what kind of piece that is yet" }
  const ins = await insertItemTolerantly(admin, {
    brand_id: brand?.brand_id ?? null,
    item_type: itemType,
    product_name: name,
    retailer_url: null,
    image_url: hosted,
    price: read.price_gbp, currency: 'GBP', price_gbp: read.price_gbp,
    colour_family: read.colour ?? scanned.colourFamily ?? null,
    material_category: scanned.materialCategory ?? null,
    material_primary: scanned.materialPrimary ?? null,
    stock_status: 'in_stock', available: true,
    status: 'draft',
    source: 'retailer_api',
    in_inventory: false,
    discovery_source: 'screenshot',
    admin_notes: `Saved from a screenshot by ${member.name}${read.brand && !brand ? ` (brand "${read.brand}" not in MYRA)` : ''}`,
  })
  if (!ins.itemId) return { error: ins.error ?? 'Could not keep a note of this piece' }

  const { error } = await admin.from('member_saved_item')
    .upsert({ member_id: member.member_id, item_id: ins.itemId, source_host: SCREENSHOT_HOST }, { onConflict: 'member_id,item_id' })
  if (error) return { error: /schema cache|does not exist/i.test(error.message) ? 'Run migration 0060 in Supabase first' : error.message }
  if (member.auth_user_id) {
    try { await admin.from('saved_item').upsert({ user_id: member.auth_user_id, item_id: ins.itemId }, { onConflict: 'user_id,item_id' }) } catch { /* optional mirror */ }
  }
  // Styled now, like any save — never lets a queue problem fail the save.
  try {
    const q = await enqueueWarmups(admin, member.member_id, [ins.itemId], 'save')
    if (q.queued.length) kickStyledWaysDrain()
  } catch (err) { console.error('[screenshot-save] styled ways', err) }

  const brandName = brand?.name ?? read.brand ?? null
  return {
    saved: true, pinned: false, read: readLine(read),
    item: { item_id: ins.itemId, product_name: name, brand: brand?.name ?? null, image_url: hosted, price_gbp: read.price_gbp, url: null },
    message: `Kept “${name}”${brandName && !name.toLowerCase().includes(brandName.toLowerCase()) ? ` from ${brandName}` : ''} from your screenshot.`,
  }
}
