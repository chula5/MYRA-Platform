// EVENT NEVERS — what she does NOT want for one occasion, read onto the pieces.
//
// "Nothing fussy, not mother of the bride, no more than £600 on a dress, not
// Rixo or ME+EM — she doesn't want to look like everyone else." Three parts,
// kept on the event (0111): her words, a price cap for the piece, and brands.
// Her words are read for what they carry on their own too — a price ("no more
// than £600"), a brand she named, colours, and the fussy family (embellished,
// ball-gown, frilled, mother-of-the-bride) — so writing it once is enough.
//
// Pure: no I/O, no model. Tested in __tests__/event-nevers.test.ts.

import { parseQuery } from '@/lib/search-taxonomy'

export interface EventNeversInput {
  nevers?: string | null
  max_price_gbp?: number | string | null
  never_brands?: string[] | null
}

export interface EventNevers {
  /** The most she will spend on the piece, in pounds. */
  maxPrice: number | null
  /** Brand keys (see brandKey) she does not want for this. */
  brands: string[]
  /** Colour families she ruled out. */
  colours: string[]
  /** Nothing embellished, frilled, ball-gowned or mother-of-the-bride. */
  noFussy: boolean
  /** Her words, as written. */
  text: string
}

/** "ME+EM", "Me & Em", "me and em" → "meandem": one key however it is typed. */
export function brandKey(name: string): string {
  return (name ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[+&]/g, ' and ').replace(/[^a-z0-9]+/g, '')
}

const PRICE = /(?:no more than|not more than|not over|nothing over|under|max(?:imum)?|up to|at most|less than|not more|not)\s*£\s?(\d[\d,]*)|£\s?(\d[\d,]*)\s*(?:max|maximum|tops|or less|limit)/i
const FUSSY_WORDS = /\b(fuss(?:y|iness)?|embellish\w*|mother of (?:the )?bride|ball[- ]?gown|ball[- ]like|ball\b|frill\w*|ruffle\w*|over[- ]the[- ]top|too much|princess|meringue)\b/i
/** The names of fussy pieces. A piece called any of these is out when she said nothing fussy. */
export const FUSSY_NAME = /\b(embellish\w*|beaded|bead[- ]?work|sequin\w*|feather\w*|ruffle\w*|frill\w*|tiered|corsage|rosette\w*|appliqu[eé]\w*|tulle|ball[- ]?gown|peplum|fascinator|crystal[- ]embellished|pearl[- ]embellished|3d flower\w*|flower[- ]appliqu\w*|bow[- ]embellished|organza overlay|mother of the bride)\b/i

/**
 * Read the nevers. `knownBrands` are the brand names in her library, so a
 * brand named in her words ("not Rixo, not me and em") is caught by name.
 */
export function readNevers(input: EventNeversInput | null | undefined, knownBrands: string[] = []): EventNevers {
  const text = (input?.nevers ?? '').trim()
  const lower = text.toLowerCase()

  let maxPrice = Number(input?.max_price_gbp)
  if (!Number.isFinite(maxPrice) || maxPrice <= 0) {
    const m = text.match(PRICE)
    const n = m ? Number(String(m[1] ?? m[2]).replace(/,/g, '')) : NaN
    maxPrice = Number.isFinite(n) && n > 0 ? n : NaN
  }

  const brands = new Set((input?.never_brands ?? []).map(brandKey).filter(Boolean))
  if (lower) {
    const said = brandKey(lower)
    // Longest first, and only names of 3+ letters, so "Me" never eats "Me+Em".
    for (const b of [...knownBrands].sort((a, z) => z.length - a.length)) {
      const k = brandKey(b)
      if (k.length >= 3 && said.includes(k)) brands.add(k)
    }
  }

  // Colours only: "not long fussy ball-like" names a silhouette, not a type to
  // drop — her loved pictures may well be long.
  const colours = lower ? parseQuery(lower).colourFamilies : []

  return { maxPrice: Number.isFinite(maxPrice) ? maxPrice : null, brands: Array.from(brands), colours, noFussy: FUSSY_WORDS.test(lower), text }
}

/** Why this piece is out for the event, or null when it may be picked. */
export function neverReason(
  item: { product_name?: string | null; brand?: { name?: string | null } | null; colour_family?: string | null; description?: string | null },
  price: number | null,
  n: EventNevers,
): string | null {
  if (n.maxPrice != null && price != null && price > n.maxPrice) return `over £${n.maxPrice}`
  const brand = item.brand?.name ? brandKey(item.brand.name) : ''
  if (brand && n.brands.includes(brand)) return 'a brand she does not want for this'
  if (item.colour_family && n.colours.includes(item.colour_family)) return `not in ${item.colour_family}`
  if (n.noFussy && FUSSY_NAME.test(`${item.product_name ?? ''}`)) return 'too fussy'
  return null
}

/** True when nothing has been said. */
export function neversEmpty(n: EventNevers): boolean {
  return n.maxPrice == null && !n.brands.length && !n.colours.length && !n.noFussy
}

/** "under £600 · not Rixo, ME+EM · nothing fussy" — said back to her in one line. */
export function describeNevers(n: EventNevers, brandNames: string[] = []): string {
  const parts: string[] = []
  if (n.maxPrice != null) parts.push(`up to £${Math.round(n.maxPrice)}`)
  if (n.brands.length) {
    const byKey = new Map(brandNames.map((b) => [brandKey(b), b]))
    parts.push(`not ${n.brands.map((k) => byKey.get(k) ?? k).join(', ')}`)
  }
  if (n.colours.length) parts.push(`no ${n.colours.join(' or ')}`)
  if (n.noFussy) parts.push('nothing fussy')
  return parts.join(' · ')
}

/**
 * How much nearer a piece sits to the pictures she loves than to the ones she
 * marked "not this", as a z-score across the candidates. Full-vector cosines in
 * this space bunch up near 1, so a raw closeness says little; how a piece
 * stands against the other candidates is the honest signal.
 */
export function pictureLeans(raw: number[]): number[] {
  if (raw.length < 2) return raw.map(() => 0)
  const mean = raw.reduce((s, x) => s + x, 0) / raw.length
  const sd = Math.sqrt(raw.reduce((s, x) => s + (x - mean) ** 2, 0) / raw.length)
  if (!sd) return raw.map(() => 0)
  return raw.map((x) => Math.max(-2, Math.min(2, (x - mean) / sd)))
}
