// Finding what she bought in her email — the pure parts: which messages are
// worth reading, what an extraction may contain, and how one piece seen in an
// order confirmation AND its dispatch email becomes one find. No I/O; tested.

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
  is_purchase: boolean
  retailer: string | null
  order_date: string | null
  order_id: string | null
  items: PurchaseItem[]
}

/** The kinds of piece that belong in a wardrobe. Groceries, tech and homeware do not. */
export const WARDROBE_CATEGORIES = new Set(['clothing', 'shoes', 'bag', 'jewellery', 'accessory'])

const ORDER_WORDS = /\b(order|orders|receipt|purchase|confirmed|confirmation|dispatched|shipped|shipping confirmation|on its way|on the way|delivered|thank you for (?:your )?(?:order|shopping|purchase)|invoice)\b/i
const NOT_A_PURCHASE = /\b(return|returns|returned|refund|refunded|cancel|cancelled|canceled|cancellation|exchange|password|verify|verification|sign[- ]?in|security|newsletter|unsubscribe|% off|sale ends|last chance|new in|review your|rate your|survey|wishlist|back in stock|abandoned|still thinking)\b/i

/** Worth an extraction call? Subject says order/receipt/dispatch, and not a return, refund or marketing. */
export function looksLikeOrderEmail(m: Pick<MailMessage, 'subject'>): boolean {
  const s = m.subject ?? ''
  return ORDER_WORDS.test(s) && !NOT_A_PURCHASE.test(s)
}

/** Plain text of an email for the model — tags stripped, images and links kept as short references. */
export function emailForExtraction(m: MailMessage, maxChars = 12_000): { text: string; images: string[]; links: string[] } {
  const html = m.html ?? ''
  const images: string[] = []
  const links: string[] = []
  for (const match of Array.from(html.matchAll(/<img[^>]+src=["']([^"']+)["'][^>]*>/gi))) {
    const src = match[1]
    if (/^https?:\/\//i.test(src) && !/(pixel|track|spacer|logo|icon|facebook|instagram|twitter|pinterest|tiktok|youtube)/i.test(src)) images.push(src)
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
    images: Array.from(new Set(images)).slice(0, 40),
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
  return {
    is_purchase: r.is_purchase === true && items.length > 0,
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
