// Finding what she bought in her email — the pure parts: which messages are
// worth reading, what an extraction may contain, how one piece seen in an order
// confirmation, a payment receipt, a dispatch AND a delivery email becomes one
// find, and how a return or refund cancels it. No I/O; tested.

export interface MailMessage {
  id: string
  subject: string
  from: string
  date: string | null
  html: string | null
  text: string | null
}

export interface PurchaseItem {
  product_name: string
  brand_name: string | null
  colour: string | null
  size: string | null
  price: number | null
  currency: string | null
  image_url: string | null
  product_url: string | null
  category: string | null
}

export interface PurchaseExtraction {
  /** purchase: she bought it · return: she sent it back, was refunded or it was cancelled. */
  kind: 'purchase' | 'return' | 'other'
  is_purchase: boolean
  /** A return/refund/cancellation of the WHOLE order (items may then be empty). */
  whole_order: boolean
  retailer: string | null
  order_date: string | null
  order_id: string | null
  items: PurchaseItem[]
}

/** The kinds of piece that belong in a wardrobe. Groceries, tech and homeware do not. */
export const WARDROBE_CATEGORIES = new Set(['clothing', 'shoes', 'bag', 'jewellery', 'accessory'])

const ORDER_WORDS = /\b(order|orders|receipt|purchase|purchased|confirmed|confirmation|dispatched|shipped|shipping confirmation|on its way|on the way|delivered|thank you for (?:your )?(?:order|shopping|purchase)|invoice|payment)\b/i
const RETURN_WORDS = /\b(return|returns|returned|refund|refunds|refunded|cancel|cancelled|canceled|cancellation)\b/i
const MARKETING_OR_ACCOUNT = /\b(exchange policy|password|verify your|verification|sign[- ]?in|security alert|newsletter|% off|sale ends|last chance|new in|review your|rate your|survey|wishlist|back in stock|abandoned|still thinking|free returns)\b/i

/**
 * What kind of email a subject promises: an order (confirmation, receipt,
 * dispatch, delivery), a return (return, refund, cancellation), or neither.
 * Marketing and account emails are neither, even when they mention orders.
 */
export function emailKind(m: Pick<MailMessage, 'subject'>): 'order' | 'return' | null {
  const s = m.subject ?? ''
  if (MARKETING_OR_ACCOUNT.test(s)) return null
  if (RETURN_WORDS.test(s)) return 'return'
  if (ORDER_WORDS.test(s)) return 'order'
  return null
}

/** Worth reading for a purchase? Subject says order/receipt/dispatch, and not a return, refund or marketing. */
export function looksLikeOrderEmail(m: Pick<MailMessage, 'subject'>): boolean {
  return emailKind(m) === 'order'
}

/** Plain text of an email for the model — tags stripped, images and links kept as short references. */
export interface EmailImage { url: string; alt: string | null }

const decodeAttr = (s: string) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim()

export function emailForExtraction(m: MailMessage, maxChars = 12_000): { text: string; images: string[]; imageAlts: EmailImage[]; links: string[] } {
  const html = m.html ?? ''
  const imageAlts: EmailImage[] = []
  const links: string[] = []
  for (const match of Array.from(html.matchAll(/<img\b[^>]*>/gi))) {
    const tag = match[0]
    const src = decodeAttr(tag.match(/\ssrc=["']([^"']+)["']/i)?.[1] ?? '')
    const alt = decodeAttr(tag.match(/\salt=["']([^"']*)["']/i)?.[1] ?? '') || null
    if (/^https?:\/\//i.test(src) && !/(pixel|track|spacer|logo|icon|facebook|instagram|twitter|pinterest|tiktok|youtube|linkedin|open\.aspx|footer)/i.test(src)) {
      if (!imageAlts.some((i) => i.url === src)) imageAlts.push({ url: src, alt })
    }
  }
  for (const match of Array.from(html.matchAll(/<a[^>]+href=["'](https?:\/\/[^"']+)["']/gi))) {
    if (!/(unsubscribe|privacy|facebook|instagram|twitter|pinterest|tiktok|youtube|mailto:)/i.test(match[1])) links.push(match[1])
  }
  const fromHtml = html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&pound;/g, '£').replace(/&#163;/g, '£')
    .replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n')
  const body = (m.text && m.text.trim().length > 200 ? m.text : fromHtml).trim()
  const header = `Subject: ${m.subject}\nFrom: ${m.from}\nDate: ${m.date ?? ''}\n\n`
  return {
    text: (header + body).slice(0, maxChars),
    images: imageAlts.map((i) => i.url).slice(0, 40),
    imageAlts: imageAlts.slice(0, 40),
    links: Array.from(new Set(links)).slice(0, 40),
  }
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)
const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? parseFloat(v.replace(/[^0-9.]/g, '')) : NaN
  return Number.isFinite(n) && n > 0 ? n : null
}
const url = (v: unknown): string | null => (typeof v === 'string' && /^https?:\/\//i.test(v.trim()) ? v.trim() : null)
const isoDate = (v: unknown): string | null => {
  const s = str(v)
  if (!s) return null
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10)
}

/** Whatever the model returned, as a safe extraction — non-wardrobe pieces dropped. */
export function parseExtraction(raw: unknown): PurchaseExtraction {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const items = (Array.isArray(r.items) ? r.items : [])
    .map((x) => (x && typeof x === 'object' ? x : {}) as Record<string, unknown>)
    .map((x): PurchaseItem => ({
      product_name: str(x.product_name) ?? '',
      brand_name: str(x.brand_name),
      colour: str(x.colour),
      size: str(x.size),
      price: num(x.price),
      currency: str(x.currency)?.toUpperCase().slice(0, 3) ?? null,
      image_url: url(x.image_url),
      product_url: url(x.product_url),
      category: str(x.category)?.toLowerCase() ?? null,
    }))
    .filter((x) => x.product_name && (!x.category || WARDROBE_CATEGORIES.has(x.category)))
  const kind: PurchaseExtraction['kind'] = r.kind === 'purchase' || r.kind === 'return' ? r.kind
    : r.is_purchase === true ? 'purchase' : 'other'
  const wholeOrder = kind === 'return' && r.whole_order === true && !!str(r.order_id)
  const usable = items.length > 0 || wholeOrder
  return {
    kind: usable ? kind : 'other',
    is_purchase: kind === 'purchase' && items.length > 0,
    whole_order: wholeOrder,
    retailer: str(r.retailer),
    order_date: isoDate(r.order_date),
    order_id: str(r.order_id),
    items,
  }
}

const fold = (s: string | null | undefined) => (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

/**
 * One key per piece per order. An order confirmation and its dispatch email
 * share the order id, so the piece is found once; without an order id the
 * retailer and the day stand in for it.
 */
export function findKey(e: Pick<PurchaseExtraction, 'retailer' | 'order_id' | 'order_date'>, item: Pick<PurchaseItem, 'product_name' | 'colour' | 'size'>): string {
  const order = fold(e.order_id) || `${fold(e.retailer)}@${e.order_date ?? ''}`
  return [order, fold(item.product_name), fold(item.colour), fold(item.size)].join('|')
}

// ── One piece, many emails ──────────────────────────────────────────────────

/** Names that say nothing about the piece ("Item", "Product 1"). */
export function isGenericName(name: string | null | undefined): boolean {
  const f = fold(name)
  return !f || f.length < 3 || /^(item|items|product|products|article|your item|order item|piece)( \d+)?$/.test(f)
}

const NAME_NOISE = /\b(size|sz|uk|eu|us)\s*[a-z0-9]{1,4}\b|\bvintage\b|\bpre ?(owned|loved)\b|\bsecond ?hand\b|\bnew with tags\b|\bnwt\b/g

/** The words that name the piece itself: no size, brand, or second-hand labels. */
export function pieceWords(name: string | null | undefined, brand?: string | null): string[] {
  let f = fold(name).replace(NAME_NOISE, ' ')
  const b = fold(brand)
  if (b) f = (' ' + f + ' ').replace(' ' + b + ' ', ' ')
  return f.split(' ').filter((w) => w && !/^\d+$/.test(w))
}

/** An image URL without its sizing/cache query — the same photo across emails. */
export function imageKey(url: string | null | undefined): string | null {
  if (!url) return null
  try {
    const u = new URL(url)
    return (u.hostname + u.pathname).toLowerCase()
  } catch {
    return null
  }
}

export interface FindLike {
  retailer: string | null
  order_id?: string | null
  order_date: string | null
  product_name: string
  brand_name: string | null
  colour: string | null
  size: string | null
  image_url?: string | null
}

const daysApart = (a: string | null, b: string | null) =>
  a && b ? Math.abs(new Date(a).getTime() - new Date(b).getTime()) / 86_400_000 : 0

/**
 * The same piece seen in two emails? An order confirmation, its payment
 * receipt (often under the company's legal name), dispatch, delivery and
 * "leave feedback" emails all describe one purchase. Same photo, or the same
 * piece words with nothing contradicting (size, colour, brand) within the window.
 */
export function sameFind(a: FindLike, b: FindLike, windowDays = 45): boolean {
  if (daysApart(a.order_date, b.order_date) > windowDays) return false
  const ia = imageKey(a.image_url)
  if (ia && ia === imageKey(b.image_url)) return true
  if (fold(a.size) && fold(b.size) && fold(a.size) !== fold(b.size)) return false
  if (fold(a.brand_name) && fold(b.brand_name) && fold(a.brand_name) !== fold(b.brand_name)) return false
  if (a.order_id && b.order_id && fold(a.order_id) !== fold(b.order_id) && fold(a.retailer) === fold(b.retailer)) return false
  if (isGenericName(a.product_name) || isGenericName(b.product_name)) return false
  const wa = pieceWords(a.product_name, a.brand_name ?? b.brand_name)
  const wb = pieceWords(b.product_name, b.brand_name ?? a.brand_name)
  if (!wa.length || !wb.length) return false
  const [short, long] = wa.length <= wb.length ? [wa, wb] : [wb, wa]
  const covered = short.every((w) => long.includes(w))
  if (!covered) return false
  if (short.length >= 2) return true
  // One word ("skirt") is only enough from the same shop and the same colour.
  return fold(a.retailer) === fold(b.retailer) && fold(a.colour) === fold(b.colour)
}

type Mergeable = FindLike & { price?: number | null; currency?: string | null; product_url?: string | null }

/** What an existing find should gain from another email about the same piece. */
export function mergeFind(existing: Mergeable, incoming: Mergeable): Partial<Mergeable> {
  const patch: Partial<Mergeable> = {}
  const fill = <K extends keyof Mergeable>(k: K) => {
    if ((existing[k] == null || existing[k] === '') && incoming[k] != null && incoming[k] !== '') patch[k] = incoming[k]
  }
  ;(['brand_name', 'colour', 'size', 'price', 'currency', 'image_url', 'product_url', 'order_id'] as const).forEach(fill)
  if (isGenericName(existing.product_name) && !isGenericName(incoming.product_name)) patch.product_name = incoming.product_name
  // A payment receipt names the company; the shop's own email names the shop.
  if (!existing.brand_name && incoming.brand_name && incoming.retailer) patch.retailer = incoming.retailer
  if (incoming.order_date && existing.order_date && incoming.order_date < existing.order_date) patch.order_date = incoming.order_date
  return patch
}

/** Give each piece without a photo the email image whose alt text names it. */
export function matchImagesByAlt(items: PurchaseItem[], images: EmailImage[]): PurchaseItem[] {
  return items.map((item) => {
    if (item.image_url) return item
    const words = pieceWords(item.product_name, item.brand_name)
    if (!words.length) return item
    const hit = images.find((img) => {
      const alt = pieceWords(img.alt, item.brand_name)
      return alt.length > 0 && words.every((w) => alt.includes(w))
    })
    return hit ? { ...item, image_url: hit.url } : item
  })
}

/** Marks on a find's error field: the piece went back. */
export const RETURNED = 'Returned'
/** A return seen before its order email (inboxes are read newest first). */
export const RETURN_SEEN = 'Return seen'
