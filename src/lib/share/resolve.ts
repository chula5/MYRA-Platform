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

export interface ResolvedProduct { url: string; title: string; brand: string | null; image: string | null; price: number | null; host: string }
export interface ResolvedBrand { handle: string; name: string | null; website: string; via: string }
export type ShareResolution =
  | { kind: 'product'; product: ResolvedProduct }
  | { kind: 'brand'; brand: ResolvedBrand }
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
  if (!page) return null
  const { website, name } = extractInstagram(page.html)
  // A login wall and a genuinely linkless bio look the same from here: no site.
  if (!website) return null
  const host = hostOf(website)
  if (!host || isSocialHost(host)) return null
  if (!isAggregatorHost(host)) return { handle: clean, name, website, via: 'the link in their bio' }
  // A link-hub is a doorway, not the shop: step through it once, to the first
  // link that is a site of its own.
  const hub = await fetchText(website)
  const onward = hub ? firstOutboundLink(hub.html, hub.url) : null
  if (!onward) return null
  return { handle: clean, name, website: onward, via: `the link in their bio, through ${hubNameOf(host)}` }
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
    : { kind: 'unknown', reason: 'I couldn’t find that brand’s own site from Instagram' }
}

export async function resolveShare(rawUrl: string): Promise<ShareResolution> {
  const c = classifyUrl(rawUrl)
  if (c.kind === 'invalid') return { kind: 'unknown', reason: c.reason }
  if (c.kind === 'instagram-profile') return brandResolution(await resolveInstagramBrand(c.handle))
  if (c.kind === 'instagram-post') {
    // A shared reel is almost always "this brand", not this piece: the author
    // is recovered from the post page and read as the profile instead.
    const page = await fetchText(c.url)
    const author = page ? instagramAuthorFromHtml(page.html) : null
    if (!author) return { kind: 'unknown', reason: 'Instagram hid who posted that — share their profile instead' }
    return brandResolution(await resolveInstagramBrand(author))
  }
  const page = await fetchText(c.url)
  if (!page) return { kind: 'unknown', reason: 'That page wouldn’t open for me' }
  const product = extractProduct(page.html, page.url)
  if (!product) return { kind: 'unknown', reason: 'I couldn’t make out a piece on that page' }
  return { kind: 'product', product }
}
