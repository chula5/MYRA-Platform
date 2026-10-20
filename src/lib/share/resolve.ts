// MYRA Mirror — what the iOS share sheet actually shared.
//
// The share sheet hands over a bare URL and nothing else. This is the read
// that turns it into something MYRA can file: an Instagram profile or post
// becomes the brand behind it (found through the link in their bio, stepping
// through a link-hub when that is where the bio points), and any other page
// is read as a piece for sale through its own og tags and JSON-LD.
//
// Nothing here throws. A page that will not open, a login wall, a hub of
// links with no shop behind it — each becomes a plain sentence the share
// sheet can show, because silence there reads as broken.

import 'server-only'
import Anthropic from '@anthropic-ai/sdk'
import { describeGarment, findPieceInPost, readInstagramPost } from './post-piece'

export interface ResolvedProduct { url: string; title: string; brand: string | null; image: string | null; price: number | null; host: string }
export interface ResolvedBrand { handle: string; name: string | null; website: string; via: string }
export type ShareResolution =
  /** `post` is set when the piece was found inside an Instagram post rather than read off its own page. */
  | { kind: 'product'; product: ResolvedProduct; post?: { author: string; brand: ResolvedBrand } }
  /** `post` is set when a post's piece could not be pinned, so the brand stands in for it. */
  | { kind: 'brand'; brand: ResolvedBrand; post?: { author: string; pieceNotFound: true } }
  | { kind: 'unknown'; reason: string }

// A desktop browser, because shops and Instagram answer a server politely when
// it looks like one and with a login wall when it does not.
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
// Enough for the head of any page; past this the og tags are long gone.
const MAX_BODY = 600_000
const FETCH_TIMEOUT_MS = 8000

const hostOf = (url: string): string | null => {
  try { return new URL(url).host.toLowerCase().replace(/^www\./, '') } catch { return null }
}

// Link-hubs stand between the bio and the shop, so one is followed — but a
// hub is never filed as the brand's own site.
const AGGREGATOR_HOSTS = ['linktr.ee', 'linktree.com', 'beacons.ai', 'bio.link', 'taplink.cc', 'stan.store', 'linkin.bio', 'milkshake.app', 'carrd.co', 'allmylinks.com', 'withkoji.com', 'bio.site', 'lnk.bio']
// A social profile is somewhere Instagram already is, never the shop itself.
const SOCIAL_HOSTS = ['instagram.com', 'facebook.com', 'tiktok.com', 'twitter.com', 'x.com', 'youtube.com', 'pinterest.com', 'threads.net', 'snapchat.com']

const hostMatches = (host: string | null, list: string[]): boolean =>
  !!host && list.some((h) => host === h || host.endsWith(`.${h}`))

export function isAggregatorHost(host: string): boolean { return hostMatches(host.toLowerCase().replace(/^www\./, ''), AGGREGATOR_HOSTS) }
export function isSocialHost(host: string): boolean { return hostMatches(host.toLowerCase().replace(/^www\./, ''), SOCIAL_HOSTS) }

// How a hub is named in the sentence back to the share sheet.
const HUB_NAMES: Record<string, string> = {
  'linktr.ee': 'Linktree', 'linktree.com': 'Linktree', 'beacons.ai': 'Beacons', 'bio.link': 'Bio.link',
  'linkin.bio': 'Linkin.bio', 'stan.store': 'Stan Store', 'lnk.bio': 'Lnk.bio', 'carrd.co': 'Carrd',
}
const hubNameOf = (host: string): string => HUB_NAMES[host] ?? host

// ── CLASSIFY ─────────────────────────────────────────────────────────────────

export type ClassifiedUrl =
  | { kind: 'instagram-profile'; handle: string }
  | { kind: 'instagram-post'; url: string }
  | { kind: 'web'; url: string }
  | { kind: 'invalid'; reason: string }

// Instagram words that sit where a handle would but are the app's own pages.
const INSTAGRAM_RESERVED = new Set(['p', 'reel', 'reels', 'stories', 'explore', 'tv'])

export function classifyUrl(rawUrl: string): ClassifiedUrl {
  // The share sheet is trusted with very little: one line, capped, http only.
  const raw = (rawUrl ?? '').trim().slice(0, 800)
  let u: URL
  try { u = new URL(raw) } catch { return { kind: 'invalid', reason: 'That doesn’t look like a link' } }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { kind: 'invalid', reason: 'Only web links can be kept' }
  const host = u.host.toLowerCase().replace(/^www\./, '')
  if (host !== 'instagram.com') return { kind: 'web', url: u.href }
  const parts = u.pathname.split('/').filter(Boolean)
  if (parts.length === 1 && !INSTAGRAM_RESERVED.has(parts[0].toLowerCase())) {
    return { kind: 'instagram-profile', handle: parts[0].toLowerCase() }
  }
  if (parts.length >= 2 && ['p', 'reel', 'tv'].includes(parts[0].toLowerCase())) {
    // Canonicalised, so the resolver fetches one clean page however it arrived.
    return { kind: 'instagram-post', url: `https://www.instagram.com/${parts[0].toLowerCase()}/${parts[1]}/` }
  }
  // Instagram's web links carry the account first: /meandem/p/CODE/, /meandem/reel/CODE/.
  if (parts.length >= 3 && ['p', 'reel', 'tv'].includes(parts[1].toLowerCase()) && !INSTAGRAM_RESERVED.has(parts[0].toLowerCase())) {
    return { kind: 'instagram-post', url: `https://www.instagram.com/${parts[1].toLowerCase()}/${parts[2]}/` }
  }
  return { kind: 'invalid', reason: 'That Instagram page isn’t a profile or a post' }
}

// ── READING PAGES ────────────────────────────────────────────────────────────

// Instagram's embedded JSON escapes urls twice over: \/ for /, \u0026 for &.
const unescapeJson = (s: string): string =>
  s.replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\\//g, '/')

const decodeEntities = (s: string): string =>
  s.replace(/&amp;/g, '&').replace(/&#0?39;/g, '’').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')

const str = (v: any): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)

function metaContent(html: string, prop: string): string | null {
  // Pages write property and content in either order, so read whole tags.
  for (const m of Array.from(html.matchAll(/<meta\s[^>]*>/gi))) {
    const tag = m[0]
    const propM = tag.match(/(?:property|name)\s*=\s*["']([^"']+)["']/i)
    if (!propM || propM[1].toLowerCase() !== prop) continue
    const contentM = tag.match(/content\s*=\s*["']([^"']*)["']/i)
    if (contentM) return contentM[1]
  }
  return null
}

const titleTag = (html: string): string | null => html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() || null

const jsonStringAt = (html: string, key: string): string | null => {
  const m = html.match(new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`))
  return m ? unescapeJson(m[1]) : null
}

// The first "url":"https…" inside a window of the page, starting at `from`.
function urlNear(html: string, from: number, windowSize = 4000): string | null {
  if (from < 0) return null
  const m = html.slice(from, from + windowSize).match(/"url"\s*:\s*"((?:[^"\\]|\\.)*)"/)
  if (!m) return null
  const u = unescapeJson(m[1])
  return /^https?:\/\//.test(u) ? u : null
}

// ── INSTAGRAM ────────────────────────────────────────────────────────────────

export interface InstagramPageRead { website: string | null; name: string | null }

export function extractInstagram(html: string): InstagramPageRead {
  // external_url is the brand's own declared site, so it leads; bio_links is
  // the same link as Instagram renders it; the url sitting beside the
  // biography is the last resort some embeds still carry.
  let website: string | null = null
  const ext = jsonStringAt(html, 'external_url')
  if (ext && /^https?:\/\//.test(ext)) website = ext
  if (!website) website = urlNear(html, html.indexOf('"bio_links"'))
  if (!website) website = urlNear(html, html.indexOf('"biography"'))

  // The display name sits in og:title as "Name (@handle) • Instagram …".
  let name: string | null = null
  const ogTitle = metaContent(html, 'og:title')
  if (ogTitle) {
    const stripped = ogTitle.replace(/\s*\(@[^)]+\)\s*•[\s\S]*$/, '').trim()
    if (stripped) name = decodeEntities(stripped)
  }
  if (!name) name = str(jsonStringAt(html, 'full_name'))
  return { website, name }
}

export function instagramAuthorFromHtml(html: string): string | null {
  // The media's owner travels in the embedded JSON; a plain username near the
  // top is the fallback when the owner block is shaped differently.
  const owner = html.match(/"owner"\s*:\s*\{[^}]*?"username"\s*:\s*"([^"]+)"/)
  if (owner?.[1]) return owner[1].toLowerCase()
  const plain = html.match(/"username"\s*:\s*"([^"]+)"/)
  return plain?.[1] ? plain[1].toLowerCase() : null
}

export function firstOutboundLink(html: string, baseUrl: string): string | null {
  const baseHost = hostOf(baseUrl)
  const candidates: string[] = []
  for (const m of Array.from(html.matchAll(/<a[^>]+href\s*=\s*["'](https?:\/\/[^"']+)["']/gi))) candidates.push(decodeEntities(m[1]))
  // Hubs sometimes keep their buttons in script data rather than anchors.
  if (!candidates.length) for (const m of Array.from(html.matchAll(/https?:\/\/[^\s"'<>\\]+/g))) candidates.push(m[0])
  for (const href of candidates) {
    const h = hostOf(href)
    if (!h || h === baseHost) continue
    if (isAggregatorHost(h) || isSocialHost(h)) continue
    return href
  }
  return null
}

export async function resolveInstagramBrand(handle: string): Promise<ResolvedBrand | null> {
  const clean = handle.replace(/^@/, '').trim().toLowerCase()
  if (!/^[a-z0-9._]{1,30}$/.test(clean)) return null
  const page = await fetchText(`https://www.instagram.com/${clean}/`)
  const { website, name } = page ? extractInstagram(page.html) : { website: null, name: null }
  // A login wall and a genuinely linkless bio look the same from here: no
  // site. Instagram now shows a server the wall for every profile, so the
  // bio link is a bonus and the handle itself is the usual way in.
  const fromBio = website ? await siteFromBioLink(website) : null
  if (fromBio) return { handle: clean, name, ...fromBio }
  return findBrandSiteFromHandle(clean, name)
}

async function siteFromBioLink(website: string): Promise<{ website: string; via: string } | null> {
  const host = hostOf(website)
  if (!host || isSocialHost(host)) return null
  if (!isAggregatorHost(host)) return { website, via: 'the link in their bio' }
  // A link-hub is a doorway, not the shop: step through it once, to the first
  // link that is a site of its own.
  const hub = await fetchText(website)
  const onward = hub ? firstOutboundLink(hub.html, hub.url) : null
  if (!onward) return null
  return { website: onward, via: `the link in their bio, through ${hubNameOf(host)}` }
}

// ── THE HANDLE AS THE CLUE ───────────────────────────────────────────────────
//
// A brand's handle is nearly always its domain: @meandem is meandem.com,
// @sezane is sezane.com. So the handle is tried as a domain first, and the
// page checked to be a shop of that name rather than a parked domain. When
// no guess answers, a web search for the name finds the site the way she
// would herself.

// Words brands bolt onto a taken handle; none of them are in the domain.
const HANDLE_DECORATIONS = ['official', 'theofficial', 'uk', 'london', 'paris', 'shop', 'store', 'studio', 'brand', 'clothing', 'thelabel', 'label', 'collection', 'co']

export function domainGuessesFor(handle: string): string[] {
  const compact = handle.toLowerCase().replace(/[^a-z0-9]/g, '')
  if (!compact) return []
  const stems = [compact]
  for (const d of HANDLE_DECORATIONS) {
    if (compact.length > d.length + 2 && compact.endsWith(d)) stems.push(compact.slice(0, -d.length))
    if (compact.length > d.length + 2 && compact.startsWith(d)) stems.push(compact.slice(d.length))
  }
  // Dots and underscores often stand for hyphens in the real domain.
  const hyphened = handle.toLowerCase().replace(/[._]+/g, '-').replace(/^-+|-+$/g, '')
  if (/^[a-z0-9-]+$/.test(hyphened) && hyphened.includes('-')) stems.push(hyphened)
  const out: string[] = []
  for (const stem of Array.from(new Set(stems))) {
    for (const tld of ['com', 'co.uk', 'co']) out.push(`https://${stem}.${tld}`)
  }
  return out
}

// What separates a brand's shop from a parked domain or a magazine of the
// same name: somewhere to buy something.
export function looksLikeShop(html: string): boolean {
  return /"@type"\s*:\s*"Product"|add to (bag|basket|cart)|\/cart\b|\/checkout\b|cdn\.shopify\.com|\/collections\/|\/products\/|product:price|og:price/i.test(html)
}

// The shop's own name, as the page states it, is the handle: "ME+EM" and
// @meandem, "Sézane" and @sezane. A name that merely contains the handle
// ("RIXO Bryggan" for @rixo) is some other shop.
const compactName = (s: string) =>
  s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[+&]/g, 'and').replace(/[^a-z0-9]/g, '')

export function handleStems(handle: string): string[] {
  const h = compactName(handle)
  if (h.length < 3) return []
  const stems = [h]
  for (const d of HANDLE_DECORATIONS) {
    if (h.length > d.length + 2 && h.endsWith(d)) stems.push(h.slice(0, -d.length))
    if (h.length > d.length + 2 && h.startsWith(d)) stems.push(h.slice(d.length))
  }
  return stems
}

export function siteNameMatchesHandle(html: string, handle: string): boolean {
  const stems = handleStems(handle)
  if (!stems.length) return false
  // Titles carry the name among other words ("Trousers | ME+EM"), so each
  // segment between separators is a candidate name on its own.
  const segments: string[] = []
  for (const raw of [metaContent(html, 'og:site_name'), metaContent(html, 'og:title'), titleTag(html)]) {
    if (!raw) continue
    for (const seg of decodeEntities(raw).split(/[|–—:·•]|\s-\s/)) { const c = compactName(seg); if (c) segments.push(c) }
  }
  // "Sézane Official Site" is still Sézane: a decoration either side is allowed.
  const dressed = (seg: string, st: string) => {
    if (seg === st) return true
    if (seg.startsWith(st)) return HANDLE_DECORATIONS.some((d) => seg.slice(st.length) === d || seg.slice(st.length) === `official${d}` || seg.slice(st.length) === `${d}official`) || ['officialsite', 'officialwebsite', 'officialstore', 'officialonlineshop', 'onlineshop', 'onlinestore'].includes(seg.slice(st.length))
    if (seg.endsWith(st)) return HANDLE_DECORATIONS.includes(seg.slice(0, -st.length)) || seg.slice(0, -st.length) === 'the'
    return false
  }
  return segments.some((seg) => stems.some((st) => dressed(seg, st)))
}

// The host the guess landed on, as a name: "www.sezane.com" → "sezane".
const hostLabel = (host: string): string => host.replace(/^www\./, '').split('.')[0].replace(/[^a-z0-9]/g, '')

// Bot walls answer a server with these and a human with the shop.
const WALLED = new Set([401, 403, 405, 429, 503])

async function fetchStatus(url: string): Promise<{ status: number; html: string; url: string } | null> {
  try {
    const res = await fetch(url, {
      headers: { 'user-agent': UA, 'accept': 'text/html,application/xhtml+xml', 'accept-language': 'en-GB,en;q=0.9' },
      redirect: 'follow',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    const html = res.ok ? (await res.text()).slice(0, MAX_BODY) : ''
    return { status: res.status, html, url: res.url }
  } catch { return null }
}

// A guessed domain is the brand when it answers as a shop carrying the
// handle's name, or hides behind a bot wall (which a parked domain never does).
async function confirmGuess(guess: string, handle: string): Promise<string | null> {
  const r = await fetchStatus(guess)
  if (!r) return null
  const landedHost = hostOf(r.url)
  if (!landedHost || isSocialHost(landedHost) || isAggregatorHost(landedHost)) return null
  // Behind a wall there is no name to read, so only a host that *is* the
  // handle is trusted (sezane.com, not wherever rixo.com forwards to).
  if (WALLED.has(r.status)) return handleStems(handle).includes(hostLabel(landedHost)) ? r.url : null
  if (r.status !== 200 || !r.html) return null
  if (!looksLikeShop(r.html)) return null
  if (!siteNameMatchesHandle(r.html, handle)) return null
  return r.url
}

export interface SearchedSite { website: string | null; name: string | null }

export function parseSearchedSite(text: string): SearchedSite | null {
  const cleaned = text.replace(/```[a-z]*\n?/gi, '')
  const first = cleaned.indexOf('{'); const last = cleaned.lastIndexOf('}')
  if (first === -1 || last <= first) return null
  try {
    const p = JSON.parse(cleaned.slice(first, last + 1))
    const website = typeof p?.website === 'string' && /^https?:\/\//.test(p.website) ? p.website : null
    return { website, name: str(p?.name) }
  } catch { return null }
}

// The search she would do herself: the brand's name, its official site.
async function searchBrandSite(handle: string, name: string | null): Promise<SearchedSite | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return null
  try {
    const client = new Anthropic({ apiKey })
    const who = name ? `the fashion brand "${name}" (Instagram @${handle})` : `the fashion brand behind the Instagram account @${handle}`
    const response = await client.messages.create({
      model: 'claude-sonnet-5-5',
      max_tokens: 600,
      system: 'You find a fashion brand\'s own official website. Never a retailer, marketplace, social network, link hub, Wikipedia or press page. If you cannot find the brand\'s own site with confidence, say so. Reply with JSON only.',
      tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 3 } as unknown as Anthropic.Messages.Tool],
      messages: [{ role: 'user', content: `Find the official website of ${who}. Reply with exactly one JSON object: {"website": "https://…", "name": "Brand name"} or {"website": null, "name": null}.` }],
    })
    const text = response.content.filter((b) => b.type === 'text').map((b: any) => b.text).join('\n')
    return parseSearchedSite(text)
  } catch (e) {
    console.error('[share/resolve] search failed for', handle, e)
    return null
  }
}

export async function findBrandSiteFromHandle(handle: string, name: string | null): Promise<ResolvedBrand | null> {
  for (const guess of domainGuessesFor(handle)) {
    const site = await confirmGuess(guess, handle)
    if (site) return { handle, name, website: site, via: 'their handle' }
  }
  const found = await searchBrandSite(handle, name)
  if (!found?.website) return null
  const host = hostOf(found.website)
  if (!host || isSocialHost(host) || isAggregatorHost(host)) return null
  // The search's answer is checked the way a guess is, minus the name test:
  // the search already matched the name.
  const r = await fetchStatus(found.website)
  if (!r) return null
  if (!WALLED.has(r.status) && (r.status !== 200 || !looksLikeShop(r.html))) return null
  return { handle, name: name ?? found.name, website: r.url, via: 'a search for their name' }
}

// ── PRODUCT PAGES ────────────────────────────────────────────────────────────

function findProductLd(node: any): any | null {
  if (!node) return null
  if (Array.isArray(node)) {
    for (const n of node) { const found = findProductLd(n); if (found) return found }
    return null
  }
  if (typeof node === 'object') {
    const t = node['@type']
    if (t === 'Product' || (Array.isArray(t) && t.includes('Product'))) return node
    return findProductLd(node['@graph'])
  }
  return null
}

function jsonLdProduct(html: string): any | null {
  for (const m of Array.from(html.matchAll(/<script[^>]+type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi))) {
    let parsed: any
    try { parsed = JSON.parse(m[1]) } catch { continue }
    const found = findProductLd(parsed)
    if (found) return found
  }
  return null
}

function imageFromLd(image: any): string | null {
  if (typeof image === 'string') return image
  if (Array.isArray(image)) {
    for (const i of image) { const found = imageFromLd(i); if (found) return found }
    return null
  }
  if (image && typeof image === 'object') return str(image.url)
  return null
}

function priceFromLd(offers: any): number | null {
  const o = Array.isArray(offers) ? offers[0] : offers
  const raw = o?.price ?? o?.lowPrice
  const n = typeof raw === 'number' ? raw : parseFloat(String(raw ?? ''))
  return Number.isFinite(n) ? n : null
}

const numberFromString = (s: string | null): number | null => {
  if (!s) return null
  const n = parseFloat(s.replace(/[^0-9.]/g, ''))
  return Number.isFinite(n) ? n : null
}

const absoluteUrl = (src: string | null, base: string): string | null => {
  if (!src) return null
  try { return new URL(src, base).href } catch { return null }
}

export function extractProduct(html: string, pageUrl: string): ResolvedProduct | null {
  // JSON-LD is the page describing itself to machines, so it outranks og tags.
  const ld = jsonLdProduct(html)
  const title = str(ld?.name) ?? metaContent(html, 'og:title') ?? titleTag(html)
  const image = absoluteUrl(str(ld ? imageFromLd(ld.image) : null) ?? metaContent(html, 'og:image'), pageUrl)
  // Without both there is nothing a saved item could be made from.
  if (!title || !image) return null
  const brand = str(ld?.brand) ?? str(ld?.brand?.name) ?? metaContent(html, 'og:site_name')
  const price = (ld ? priceFromLd(ld.offers) : null) ?? numberFromString(metaContent(html, 'product:price:amount'))
  const url = metaContent(html, 'og:url') ?? pageUrl
  return {
    url: url.slice(0, 500),
    title: decodeEntities(title).slice(0, 300),
    brand: brand ? decodeEntities(brand).slice(0, 120) : null,
    image: image.slice(0, 800),
    price,
    host: hostOf(pageUrl) ?? '',
  }
}

// ── THE RESOLVER ─────────────────────────────────────────────────────────────

async function fetchText(url: string): Promise<{ html: string; url: string } | null> {
  try {
    const res = await fetch(url, {
      headers: { 'user-agent': UA, 'accept': 'text/html,application/xhtml+xml', 'accept-language': 'en-GB,en;q=0.9' },
      redirect: 'follow',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    if (!res.ok) return null
    const html = (await res.text()).slice(0, MAX_BODY)
    return { html, url: res.url }
  } catch { return null }
}

function brandResolution(brand: ResolvedBrand | null): ShareResolution {
  return brand
    ? { kind: 'brand', brand }
    : { kind: 'unknown', reason: 'I couldn’t find that brand’s own site — share their website instead' }
}

export async function resolveShare(rawUrl: string): Promise<ShareResolution> {
  const c = classifyUrl(rawUrl)
  if (c.kind === 'invalid') return { kind: 'unknown', reason: c.reason }
  if (c.kind === 'instagram-profile') return brandResolution(await resolveInstagramBrand(c.handle))
  if (c.kind === 'instagram-post') {
    // A post is a brand showing a piece. The author names the brand; the
    // picture, held against that brand's rail, names the piece — and when it
    // cannot be pinned, the brand is what is kept, as before.
    const post = await readInstagramPost(c.url)
    let author = post.author
    if (!author) {
      const page = await fetchText(c.url)
      author = page ? instagramAuthorFromHtml(page.html) : null
    }
    if (!author) return { kind: 'unknown', reason: 'Instagram hid who posted that — share their profile instead' }
    // The eye reads the picture while the brand's site is being found.
    const read = post.image ? describeGarment(post.image) : null
    const brand = await resolveInstagramBrand(author)
    if (!brand) return brandResolution(null)
    const piece = post.image && read ? await findPieceInPost({ site: brand.website, brandName: brand.name, caption: post.caption, image: post.image, read }) : null
    if (piece) return { kind: 'product', product: piece, post: { author, brand } }
    return { kind: 'brand', brand, post: { author, pieceNotFound: true } }
  }
  const page = await fetchText(c.url)
  if (!page) return { kind: 'unknown', reason: 'That page wouldn’t open for me' }
  const product = extractProduct(page.html, page.url)
  if (!product) return { kind: 'unknown', reason: 'I couldn’t make out a piece on that page' }
  return { kind: 'product', product }
}
