// MYRA Mirror — the piece in an Instagram post.
//
// Instagram shows a server nothing of a post's product tags, so the piece has
// to be found the way she would find it herself: look at the picture, know
// whose post it is, and go to that brand's rail. The rail is MYRA's own
// library first (a watched brand's pieces are already here, pictures and
// all), and the shop's own search when the shop is Shopify. A vision read
// then points at the one that is the same garment — or at none, in which
// case the post is filed as the brand, as before.
//
// Nothing here throws. No candidate, no key, a wall — each is a null the
// resolver turns into the brand-only answer.

import 'server-only'
import { createAdminClient } from '@/lib/supabase-server'
import { fetchImageForVision, type VisionImage } from '@/lib/vision-image'
import { readWordFromImage, VISION_WORD_MODEL } from '@/lib/openai-vision'
import type { ResolvedProduct } from './resolve'

// Instagram's embed answers a plain client; the desktop-browser string the
// rest of the resolver wears gets the login wall instead.
const EMBED_UA = 'MYRA/1.0 (+https://www.myraassistant.co.uk)'
// The post page itself only speaks (og tags, caption, owner) to a crawler.
const CRAWLER_UA = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'
const FETCH_TIMEOUT_MS = 8000
const MAX_BODY = 600_000

const decodeEntities = (s: string): string =>
  s.replace(/&amp;/g, '&').replace(/&#0?39;/g, '’').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')

const stripTags = (s: string): string => s.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim()

// ── READING THE POST ─────────────────────────────────────────────────────────

export interface InstagramPost { author: string | null; caption: string | null; image: string | null }

/** The embed page, as Instagram renders it for a captioned embed. */
export function parseInstagramEmbed(html: string): InstagramPost {
  const author = html.match(/data-ios-link="user\?username=([^&"]+)/)?.[1]
    ?? html.match(/class="CaptionUsername"[^>]*href="https:\/\/www\.instagram\.com\/([^/?"]+)/)?.[1]
    ?? null
  let caption: string | null = null
  const cap = html.match(/<div class="Caption">([\s\S]*?)(?:<div class="CaptionComments"|<\/div>)/)
  if (cap) {
    // The username leads the caption as a link; the words are what follow it.
    const text = stripTags(cap[1].replace(/<a class="CaptionUsername"[\s\S]*?<\/a>/, ''))
    caption = text ? decodeEntities(text).slice(0, 1500) : null
  }
  const img = html.match(/class="EmbeddedMediaImage"[^>]*src="([^"]+)"/)?.[1] ?? null
  return { author: author ? author.toLowerCase() : null, caption, image: img ? decodeEntities(img) : null }
}

/** The post page's og tags, as served to a crawler: "Name on Instagram: "caption"". */
export function parseInstagramOg(html: string): InstagramPost {
  const meta = (prop: string): string | null => {
    for (const m of Array.from(html.matchAll(/<meta\s[^>]*>/gi))) {
      const tag = m[0]
      const p = tag.match(/(?:property|name)\s*=\s*["']([^"']+)["']/i)
      if (!p || p[1].toLowerCase() !== prop) continue
      const c = tag.match(/content\s*=\s*["']([^"']*)["']/i)
      if (c) return decodeEntities(c[1])
    }
    return null
  }
  const title = meta('og:title')
  const caption = title?.match(/on Instagram:\s*["“]([\s\S]*)["”]\s*$/)?.[1]?.trim() || null
  const author = html.match(/"username"\s*:\s*"([^"]+)"/)?.[1]?.toLowerCase()
    ?? meta('og:description')?.match(/-\s*([a-z0-9._]+)\s+on\s/i)?.[1]?.toLowerCase()
    ?? null
  return { author, caption: caption ? caption.slice(0, 1500) : null, image: meta('og:image') }
}

async function fetchWith(url: string, ua: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { 'user-agent': ua, accept: 'text/html,application/xhtml+xml', 'accept-language': 'en-GB,en;q=0.9' },
      redirect: 'follow',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    if (!res.ok) return null
    return (await res.text()).slice(0, MAX_BODY)
  } catch { return null }
}

/** Who posted it, what they wrote, and the picture — from the embed, else the page. */
export async function readInstagramPost(postUrl: string): Promise<InstagramPost> {
  const base = postUrl.endsWith('/') ? postUrl : `${postUrl}/`
  const embed = await fetchWith(`${base}embed/captioned/`, EMBED_UA)
  const fromEmbed = embed ? parseInstagramEmbed(embed) : { author: null, caption: null, image: null }
  if (fromEmbed.author && fromEmbed.image) return fromEmbed
  const page = await fetchWith(base, CRAWLER_UA)
  const fromPage = page ? parseInstagramOg(page) : { author: null, caption: null, image: null }
  return {
    author: fromEmbed.author ?? fromPage.author,
    caption: fromEmbed.caption ?? fromPage.caption,
    image: fromEmbed.image ?? fromPage.image,
  }
}

// ── WHAT IS IN THE PICTURE ───────────────────────────────────────────────────

export const GARMENT_TYPES = ['coat', 'trench', 'jacket', 'blazer', 'gilet', 'cape', 'shirt', 'blouse', 't-shirt', 'knitwear', 'corset', 'bodysuit', 'trousers', 'jeans', 'shorts', 'skirt', 'mini_dress', 'midi_dress', 'maxi_dress', 'shirt_dress', 'slip_dress', 'heel', 'flat', 'sandal', 'mule', 'boot', 'sneaker', 'tote', 'shoulder_bag', 'clutch', 'crossbody', 'structured_bag'] as const
export const GARMENT_COLOURS = ['black', 'white', 'cream', 'grey', 'navy', 'brown', 'camel', 'green', 'burgundy', 'red', 'blue', 'pink', 'yellow', 'orange', 'purple', 'multicolour'] as const

export interface GarmentRead { type: string | null; colour: string | null; words: string[] }

// Types that stand in for one another on a rail: a shirt dress is a dress.
const TYPE_FAMILY: Record<string, string> = {
  mini_dress: 'dress', midi_dress: 'dress', maxi_dress: 'dress', shirt_dress: 'dress', slip_dress: 'dress',
  coat: 'outer', trench: 'outer', jacket: 'outer', blazer: 'outer', gilet: 'outer', cape: 'outer',
  shirt: 'top', blouse: 'top', 't-shirt': 'top', knitwear: 'top', corset: 'top', bodysuit: 'top',
  trousers: 'bottom', jeans: 'bottom', shorts: 'bottom', skirt: 'bottom',
  heel: 'shoe', flat: 'shoe', sandal: 'shoe', mule: 'shoe', boot: 'shoe', sneaker: 'shoe',
  tote: 'bag', shoulder_bag: 'bag', clutch: 'bag', crossbody: 'bag', structured_bag: 'bag',
}
const familyOf = (t: string | null): string | null => (t ? TYPE_FAMILY[t] ?? t : null)

const STOP = new Set(['the', 'a', 'an', 'and', 'with', 'in', 'of', 'on', 'for', 'to', 'our', 'new', 'this', 'that', 'is', 'it', 'at', 'by', 'from', 'piece', 'look', 'style', 'wear', 'season', 'collection', 'shop', 'now', 'link', 'bio'])

export function parseGarmentRead(text: string): GarmentRead | null {
  const first = text.indexOf('{'); const last = text.lastIndexOf('}')
  if (first === -1 || last <= first) return null
  let p: any
  try { p = JSON.parse(text.slice(first, last + 1)) } catch { return null }
  const type = typeof p?.type === 'string' && (GARMENT_TYPES as readonly string[]).includes(p.type) ? p.type : null
  const colour = typeof p?.colour === 'string' && (GARMENT_COLOURS as readonly string[]).includes(p.colour) ? p.colour : null
  const words = String(p?.words ?? '').toLowerCase().split(/[^a-z0-9+-]+/).filter((w) => w.length > 2 && !STOP.has(w)).slice(0, 8)
  if (!type && !colour && !words.length) return null
  return { type, colour, words }
}

const DESCRIBE_PROMPT = `This is a fashion brand's Instagram picture. Name the ONE garment, shoe or bag for sale that the picture is mainly about. Reply with JSON only: {"type": one of ${GARMENT_TYPES.join('|')} or null, "colour": one of ${GARMENT_COLOURS.join('|')} or null, "words": "three to six plain words a shop would use in its name for it, e.g. wool wide leg trouser"}`

/** What the eye makes of the post's picture: a type, a colour, a shop's words. */
export async function describeGarment(imageUrl: string): Promise<GarmentRead | null> {
  const r = await readWordFromImage(imageUrl, DESCRIBE_PROMPT, { maxTokens: 80, detail: 'low' })
  if (r.error || !r.word) { if (r.error) console.error('[share/post-piece] describe', r.error); return null }
  return parseGarmentRead(r.word)
}

// ── THE RAIL ─────────────────────────────────────────────────────────────────

export interface Candidate { url: string; title: string; image: string; price: number | null; type: string | null; colour: string | null; brand?: string | null }

/** Caption words that read like a product's name: "the Pippa dress", "our Aria blazer". */
export function captionNameWords(caption: string | null): string[] {
  if (!caption) return []
  return caption.toLowerCase().split(/[^a-z0-9+-]+/).filter((w) => w.length > 2 && !STOP.has(w)).slice(0, 24)
}

/** Order a rail by how much each piece agrees with the picture's read; ties keep rail order. */
export function rankCandidates(rail: Candidate[], read: GarmentRead, caption: string | null = null, limit = 10): Candidate[] {
  const capWords = new Set(captionNameWords(caption))
  const scored = rail.map((c, i) => {
    const name = c.title.toLowerCase()
    let s = 0
    if (read.type && c.type) {
      if (c.type === read.type) s += 3
      else if (familyOf(c.type) === familyOf(read.type)) s += 1.5
      else s -= 2
    }
    if (read.colour && c.colour) s += c.colour === read.colour ? 2 : -1
    for (const w of read.words) if (name.includes(w)) s += 1
    // A caption that names the piece outranks the picture's guess at it.
    for (const w of name.split(/[^a-z0-9+-]+/)) if (w.length > 2 && capWords.has(w)) s += 1.5
    return { c, s, i }
  })
  return scored.sort((a, b) => b.s - a.s || a.i - b.i).filter((x) => x.s > 0).slice(0, limit).map((x) => x.c)
}

const hostOf = (url: string): string | null => { try { return new URL(url).host.toLowerCase().replace(/^www\./, '') } catch { return null } }

/** Every piece MYRA already holds from this brand's site. */
async function libraryRail(site: string): Promise<Candidate[]> {
  const host = hostOf(site)
  if (!host) return []
  try {
    const admin = createAdminClient() as any
    const { data } = await admin.from('item')
      .select('product_name, item_type, colour_family, retailer_url, image_url, price_gbp, brand:brand_id(name)')
      .ilike('retailer_url', `%${host}%`).in('status', ['ready', 'live']).not('image_url', 'is', null)
      .limit(1500)
    return ((data ?? []) as any[]).filter((r) => r.retailer_url && r.image_url && r.product_name).map((r) => ({
      url: String(r.retailer_url), title: String(r.product_name), image: String(r.image_url),
      price: r.price_gbp == null ? null : Number(r.price_gbp), type: r.item_type ?? null, colour: r.colour_family ?? null,
      brand: r.brand?.name ?? null,
    }))
  } catch (err) { console.error('[share/post-piece] library', err); return [] }
}

/** Shopify's own predictive search, when the shop is Shopify and lets a server in. */
async function shopifyRail(site: string, q: string): Promise<Candidate[]> {
  let origin: string
  try { origin = new URL(site).origin } catch { return [] }
  try {
    const url = `${origin}/search/suggest.json?q=${encodeURIComponent(q)}&resources%5Btype%5D=product&resources%5Blimit%5D=8`
    const res = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (Macintosh) MYRA/1.0', accept: 'application/json' }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
    if (!res.ok) return []
    const j: any = await res.json().catch(() => null)
    const products: any[] = j?.resources?.results?.products ?? []
    return products.filter((p) => p?.url && p?.title && p?.image).map((p) => ({
      url: new URL(String(p.url).split('?')[0], origin).href, title: String(p.title), image: String(p.image).replace(/^\/\//, 'https://'),
      price: Number.isFinite(parseFloat(p.price)) ? parseFloat(p.price) : null, type: null, colour: null,
    }))
  } catch { return [] }
}

// ── THE EYE ──────────────────────────────────────────────────────────────────

/** One vision call over the post picture and the shortlist: which is the same piece? Returns the index, or null. */
export function parsePick(text: string, count: number): number | null {
  const n = parseInt(text.match(/-?\d+/)?.[0] ?? '', 10)
  if (!Number.isFinite(n) || n < 1 || n > count) return null
  return n - 1
}

async function pickSamePiece(postImage: string, shortlist: Candidate[]): Promise<number | null> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey || !shortlist.length) return null
  const [post, ...rail] = await Promise.all([fetchImageForVision(postImage, 600), ...shortlist.map((c) => fetchImageForVision(c.image, 400))])
  if (!post.image) return null
  const content: any[] = [{ type: 'text', text: `The first picture is a brand's Instagram post. The pictures after it are numbered 1 to ${shortlist.length}: pieces from that brand's shop. Which numbered picture shows the SAME garment, shoe or bag as the main one worn or shown in the first picture — same cut and same colour, not merely similar? Reply with the number alone, or 0 if none of them is it.` }]
  const part = (img: VisionImage) => ({ type: 'image_url', image_url: { url: `data:${img.mediaType};base64,${img.data}`, detail: 'low' } })
  content.push(part(post.image))
  const kept: number[] = []
  rail.forEach((r, i) => { if (r.image) { kept.push(i); content.push({ type: 'text', text: `${kept.length}.` }); content.push(part(r.image)) } })
  if (!kept.length) return null
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: VISION_WORD_MODEL, max_completion_tokens: 8, reasoning_effort: 'none', messages: [{ role: 'user', content }] }),
      signal: AbortSignal.timeout(25000),
    })
    const j: any = await res.json().catch(() => ({}))
    if (!res.ok) { console.error('[share/post-piece] pick', res.status, String(j?.error?.message ?? '').slice(0, 160)); return null }
    const idx = parsePick(String(j.choices?.[0]?.message?.content ?? ''), kept.length)
    return idx == null ? null : kept[idx]
  } catch (err) { console.error('[share/post-piece] pick', err); return null }
}

// ── PUTTING IT TOGETHER ──────────────────────────────────────────────────────

export interface PostPieceAsk {
  site: string
  brandName: string | null
  caption: string | null
  image: string
  /** The eye's read, when the caller started it early (it needs only the picture, not the brand). */
  read?: Promise<GarmentRead | null>
}

/** The piece in the post, as a product MYRA can keep — or null when it cannot be pinned. */
export async function findPieceInPost(ask: PostPieceAsk): Promise<ResolvedProduct | null> {
  const read = await (ask.read ?? describeGarment(ask.image))
  if (!read) return null
  const query = read.words.length ? read.words.join(' ') : [read.colour, read.type?.replace(/_/g, ' ')].filter(Boolean).join(' ')
  const [library, shop] = await Promise.all([libraryRail(ask.site), query ? shopifyRail(ask.site, query) : Promise.resolve([])])
  // The library is ranked by what MYRA knows of each piece; the shop's own
  // search already matched the words, so its answers ride along unranked.
  const seen = new Set<string>()
  const shortlist: Candidate[] = []
  for (const c of [...rankCandidates(library, read, ask.caption, 8), ...shop.slice(0, 4)]) {
    const key = c.url.split(/[?#]/)[0]
    if (seen.has(key)) continue
    seen.add(key); shortlist.push(c)
  }
  if (!shortlist.length) { console.info('[share/post-piece] no rail for', ask.site, JSON.stringify(read)); return null }
  const idx = await pickSamePiece(ask.image, shortlist.slice(0, 10))
  console.info('[share/post-piece]', JSON.stringify(read), 'rail:', shortlist.slice(0, 10).map((c) => c.title).join(' | '), '→', idx == null ? 'none' : shortlist[idx].title)
  if (idx == null) return null
  const c = shortlist[idx]
  return { url: c.url, title: c.title, brand: c.brand ?? ask.brandName, image: c.image, price: c.price, host: hostOf(c.url) ?? '' }
}
