// ── Per-size availability from retailer pages (pure) ─────────────────────────
//
// checkStockDetailed reads Shopify `<url>.js` first and JSON-LD offers second.
// Measured 2026-09-15, 1,114 of 2,561 sized library pieces still had no size
// rows, because the retailers carrying most of them do neither:
//
//   · Salesforce Commerce (By Malene Birger, Adolfo Dominguez, agnès b.) render
//     every size as a selector carrying `dwvar_<pid>_size=` with the sold-out
//     state in its class (`size--unavailable`, `disabled--unavailable`,
//     `notify-me`) — no JSON at all.
//   · ME+EM (Next.js on Centra) ship `"variants":[{"name":"8","status":
//     "OutOfStock"}]` inside the React Server Component stream.
//   · Sessùn embed the Kleep size widget's config: `"sizes":[{"variantId":"S",
//     "quantity":true}]`.
//   · Shopify stores whose labels the size filter rejected (Wyse "1R", Skall
//     "XS/S") or whose storefront is headless (Varley — `.js` lives on the
//     myshopify domain named in the page).
//
// Everything here is string-in, sizes-out, so each extractor is tested against
// the markup it was written from. stock-check.ts does the fetching.

export type SizeLevel = 'in_stock' | 'low' | 'sold_out' | 'unknown'

export interface PageSize {
  label: string
  inStock: boolean
  level: SizeLevel
}

/**
 * True size labels only — S/M/L family (incl. "XS/S"), one-size, numeric (incl.
 * UK/US/EU shoe sizes), length-suffixed numerics ("8R", "1L"), jeans waist
 * ("27W/32L"), and labels a host normaliser has annotated ("1R (UK 8)").
 * Rejects colours and other variant option values.
 */
export const SIZE_RE =
  /^(x{0,3}s|x{0,3}l|xl|m|(x{0,2}s|m|x{0,2}l)\/(x{0,2}s|m|x{0,2}l)|o\/?s|one[\s-]?size|onesize|free[\s-]?size|\d{1,3}(\.\d)?[srl]?|(uk|us|eu|it|fr)[\s-]?\d{1,3}(\.\d)?[srl]?|(uk|us|eu|it|fr)[\s-]?\d{1,2}-\d{1,2}|\d{1,3}[\s-]?(uk|us|eu|it|fr)|\d{2}w(\/\d{2}l)?|\d[rl] \(uk \d{1,2}\))$/i

const hostOf = (url: string): string => {
  try { return new URL(url).host.replace(/^www\./, '').toLowerCase() } catch { return '' }
}

/**
 * A retailer's raw size string → the label we store. Verbatim, except where the
 * retailer's own sizing needs its system spelled out to canonicalise correctly
 * — the label is what she sees, so an annotation keeps the retailer's number.
 *
 *   Wyse London   "1R" → "1R (UK 8)"   size n = UK 6+2n (their size guide);
 *                                      R/L is the length, not the size
 *   ME+EM         "8"  → "US 8" on /us/ pages, "UK 8" elsewhere — a bare 8
 *                                      would otherwise always read as US
 *   agnès b.      "1"  → "1 (UK 8)"    their 0–6 run, per their size chart
 *                                      (0 = UK 6 … 6 = UK 24); a bare 1 would
 *                                      read as US 1. Their 34–44 run is left
 *                                      bare: FR 36 = UK 8 there, which is how
 *                                      a bare 36 already canonicalises.
 *   legacy        "black / 34" → "34"  old Shopify variant titles
 *
 * Returns null when the string isn't a size.
 */
export function normaliseSizeLabel(raw: string, url: string): string | null {
  let s = String(raw ?? '').trim().replace(/\s+/g, ' ')
  if (!s || /^default title$/i.test(s)) return null
  // "black / 34", "Black/Scarlet Red / 41" — the size is the last segment.
  if (s.includes(' / ')) s = s.split(' / ').pop()!.trim()
  const host = hostOf(url)
  let m: RegExpMatchArray | null

  if (host.endsWith('wyselondon.com') && (m = s.match(/^(\d)([RL])?$/i))) {
    // Coats and knits run 0–6 with no length letter; same scale.
    return `${m[1]}${(m[2] ?? '').toUpperCase()} (UK ${6 + 2 * Number(m[1])})`
  }
  // ME+EM shoes: "4.5 (37.5)" is UK 4.5 with the EU size in brackets.
  if (host.endsWith('meandem.com') && (m = s.match(/^(\d{1,2}(?:\.5)?) \((\d{2}(?:\.5)?)\)$/))) {
    return `UK ${m[1]} (EU ${m[2]})`
  }
  // ME+EM dress sizes run 0–18; 22 and up is a jeans waist, left bare.
  if (host.endsWith('meandem.com') && (m = s.match(/^(\d{1,2})([SRL])?$/i)) && Number(m[1]) <= 20) {
    const system = /^\/us(\/|$)/i.test(safePath(url)) ? 'US' : 'UK'
    return `${system} ${m[1]}${(m[2] ?? '').toUpperCase()}`
  }
  if (host.endsWith('agnesb.com') && (m = s.match(/^([0-6])$/))) {
    // A size spanning two (2 = UK 10–12) canonicalises on its first.
    const uk = ['6', '8', '10-12', '14', '16-18', '20-22', '24-26'][Number(m[1])]
    return `${m[1]} (UK ${uk})`
  }

  return SIZE_RE.test(s) || /\((uk|fr|us|eu|it) \d{1,2}\)$/i.test(s) ? s.toUpperCase() : null
}

function safePath(url: string): string {
  try { return new URL(url).pathname } catch { return '' }
}

/** Collapse duplicates (a size on two colourways): available in any = available. */
function merge(entries: PageSize[]): PageSize[] {
  const out = new Map<string, PageSize>()
  const rank = { in_stock: 3, low: 2, unknown: 1, sold_out: 0 } as const
  for (const e of entries) {
    const prev = out.get(e.label)
    if (!prev || rank[e.level] > rank[prev.level]) out.set(e.label, e)
  }
  return Array.from(out.values())
}

const stripTags = (s: string) => s.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()

// ── Salesforce Commerce ──────────────────────────────────────────────────────

const SFCC_SOLD = /(^|\s)(size--unavailable|disabled--unavailable|notify-me|unselectable|out-of-stock|not-available)(\s|$)/i
const SFCC_LOW = /(^|\s)(stock-last-units|low-stock|last-units)(\s|$)/i

/**
 * Size selectors on a Salesforce Commerce product page. Only the main product's
 * selectors count: recommendation carousels and quick-shop panels render their
 * own (`js-quickshop-option`, a different `dwvar_<pid>`), and reading those
 * would report another garment's stock.
 */
export function sizesFromSfccHtml(html: string, url: string): PageSize[] {
  const tagRe = /<(div|button|a|li|span|option)\b([^>]*?dwvar_([A-Za-z0-9_-]+?)_size=[^>]*)>/g
  const out: PageSize[] = []
  let mainPid: string | null = null
  for (const m of Array.from(html.matchAll(tagRe))) {
    const attrs = m[2]
    const pid = m[3]
    const cls = (attrs.match(/\bclass="([^"]*)"/) ?? [])[1] ?? ''
    if (/js-quickshop-option/.test(cls)) continue
    if (mainPid == null) mainPid = pid
    if (pid !== mainPid) continue

    const aria = (attrs.match(/\baria-label="([^"]*)"/) ?? [])[1]
    const after = html.slice((m.index ?? 0) + m[0].length, (m.index ?? 0) + m[0].length + 400)
    const inner = stripTags(after.split(new RegExp(`</${m[1]}>`, 'i'))[0] ?? '')
    const candidates = [aria?.replace(/^select size\s*/i, ''), inner, (attrs.match(/\bdata-attr-value="([^"]*)"/) ?? [])[1]]
    let label: string | null = null
    for (const c of candidates) {
      if (!c) continue
      // "34 Last units" — the size is the first word when the whole isn't one.
      if ((label = normaliseSizeLabel(c, url) ?? normaliseSizeLabel(c.split(' ')[0], url))) break
    }
    if (!label) continue

    const sold = SFCC_SOLD.test(cls) || /\sdisabled(\s|=|$)/.test(attrs) || /aria-disabled="true"/.test(attrs)
    const low = !sold && SFCC_LOW.test(cls)
    out.push({ label, inStock: !sold, level: sold ? 'sold_out' : low ? 'low' : 'in_stock' })
  }
  return merge(out)
}

// ── Next.js RSC stream (ME+EM / Centra) ──────────────────────────────────────

/** The page's React Server Component payload, decoded to one string. */
export function decodeRscStream(html: string): string {
  let s = ''
  for (const m of Array.from(html.matchAll(/self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)/g))) {
    try { s += JSON.parse(`"${m[1]}"`) } catch { /* a malformed chunk is skipped */ }
  }
  return s
}

/**
 * `"variants":[{"name":"8","status":"OutOfStock"}, …]` — the first block is the
 * product on the page (later ones belong to recommendations).
 */
export function sizesFromRscVariants(html: string, url: string): PageSize[] {
  if (!html.includes('self.__next_f')) return []
  const rsc = decodeRscStream(html)
  const block = rsc.match(/"variants":(\[\{"name":"[^"]*","status":"[^"]*"\}(?:,\{"name":"[^"]*","status":"[^"]*"\})*\])/)
  if (!block) return []
  let variants: { name: string; status: string }[]
  try { variants = JSON.parse(block[1]) } catch { return [] }
  const out: PageSize[] = []
  for (const v of variants) {
    const label = normaliseSizeLabel(v.name, url)
    if (!label) continue
    const status = String(v.status ?? '')
    const sold = /out.?of.?stock|sold.?out|unavailable/i.test(status)
    const low = !sold && /low/i.test(status)
    out.push({ label, inStock: !sold, level: sold ? 'sold_out' : low ? 'low' : 'in_stock' })
  }
  return merge(out)
}

// ── Kleep size widget config (Sessùn) ────────────────────────────────────────

/** `"sizes":[{"variantId":"XS","quantity":true}, …]` — quantity is true/false or a count. */
export function sizesFromKleepConfig(html: string, url: string): PageSize[] {
  const block = html.match(/"sizes":(\[\{"variantId":"[^"]*","quantity":(?:true|false|\d+)\}(?:,\{"variantId":"[^"]*","quantity":(?:true|false|\d+)\})*\])/)
  if (!block) return []
  let sizes: { variantId: string; quantity: boolean | number }[]
  try { sizes = JSON.parse(block[1]) } catch { return [] }
  const out: PageSize[] = []
  for (const s of sizes) {
    const label = normaliseSizeLabel(s.variantId, url)
    if (!label) continue
    const inStock = typeof s.quantity === 'number' ? s.quantity > 0 : !!s.quantity
    const low = typeof s.quantity === 'number' && s.quantity > 0 && s.quantity <= 2
    out.push({ label, inStock, level: !inStock ? 'sold_out' : low ? 'low' : 'in_stock' })
  }
  return merge(out)
}

// ── Page dispatch ────────────────────────────────────────────────────────────

/**
 * Every structured size reading a product page offers, first match wins.
 * Returns the extractor's name with the sizes so the signal says where they
 * came from.
 */
export function sizesFromPage(html: string, url: string): { via: string; sizes: PageSize[] } | null {
  const readers: [string, (h: string, u: string) => PageSize[]][] = [
    ['sfcc', sizesFromSfccHtml],
    ['rsc', sizesFromRscVariants],
    ['kleep', sizesFromKleepConfig],
  ]
  for (const [via, read] of readers) {
    const sizes = read(html, url)
    if (sizes.length) return { via, sizes }
  }
  return null
}

/** The myshopify domain a headless storefront names in its page, for `.js`. */
export function myshopifyDomainIn(html: string): string | null {
  return (html.match(/\b([a-z0-9][a-z0-9-]*\.myshopify\.com)\b/i) ?? [])[1]?.toLowerCase() ?? null
}

/**
 * A Shopify variant's size label: the first option that is a size. Wyse-style
 * lengths and slash sizes are accepted; colours are not.
 */
export function sizeLabelFromVariant(v: any, url: string): string | null {
  for (const key of ['option1', 'option2', 'option3']) {
    const label = normaliseSizeLabel(String(v?.[key] ?? ''), url)
    if (label) return label
  }
  return null
}
