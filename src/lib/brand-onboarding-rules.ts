// BRAND ONBOARDING — the rules a shop must pass before MYRA watches it.
//
// A brand comes in two ways: Chloe adds it from the Mirror (no gate — it goes
// straight on the watchlist and a full scan runs), or a member asks for it.
// A member's ask is judged here, from a read of the catalogue, with no eyes
// on it unless the rules cannot decide:
//
//   DECLINED  high street / fast fashion by name (Zara, H&M, PLT and their
//             peers), a catalogue too large to be a label, or not a womenswear
//             shop at all. MYRA says no and records why.
//   ACCEPTED  a label MYRA already carries, one a member named as a favourite,
//             or one whose catalogue resonates — enough pieces score on the
//             house style. It goes on the watchlist and its pieces queue with
//             a confidence score, like any other brand. Nothing reaches the
//             library until Chloe keeps it or the brand earns AUTO-ADD.
//   REVIEW    everything in between: a multi-brand retailer, prices below what
//             MYRA carries, or a catalogue that only half resonates. Left for
//             Chloe with the numbers.
//
// Pure functions — the network read lives in brand-onboarding.ts.

export const MAX_CATALOGUE_PRODUCTS = 3000
export const MIN_FASHION_PRODUCTS = 12
export const MIN_FASHION_SHARE = 0.4
export const MIN_ON_TASTE = 12
/** Shopify feeds carry scoring vocabulary; browser-route pages mostly don't
 *  (a good piece routinely scores 0 there), so the bar differs by route. */
export const ON_TASTE_SCORE = { shopify: 5, browser: 0 } as const
export const MIN_ON_TASTE_SHARE = { shopify: 0.15, browser: 0.6 } as const
export const LOW_MEDIAN_PRICE_GBP = 50

/** Names MYRA never carries — checked against the host and the shop's own name. */
export const BLOCKED_BRANDS: { label: string; match: RegExp }[] = [
  { label: 'Zara', match: /(^|[^a-z])zara([^a-z]|$)/ },
  { label: 'H&M', match: /(^|\.)(hm|h-m)\.|h\s*&\s*m|h&amp;m/ },
  { label: 'PrettyLittleThing', match: /prettylittlething|pretty\s*little\s*thing/ },
  { label: 'Shein', match: /(^|[^a-z])shein([^a-z]|$)/ },
  { label: 'Boohoo', match: /boohoo/ },
  { label: 'Primark', match: /primark/ },
  { label: 'Missguided', match: /missguided/ },
  { label: 'Fashion Nova', match: /fashion\s*nova/ },
  { label: 'Temu', match: /(^|\.)temu\./ },
  { label: 'Amazon', match: /(^|\.)amazon\./ },
  { label: 'eBay', match: /(^|\.)ebay\./ },
  { label: 'AliExpress', match: /aliexpress/ },
  { label: 'ASOS', match: /(^|\.)asos\./ },
  { label: 'Nasty Gal', match: /nasty\s*gal/ },
  { label: 'Forever 21', match: /forever\s*21/ },
  { label: 'New Look', match: /newlook\.|new\s*look\b/ },
  { label: 'River Island', match: /river\s*island/ },
  { label: 'Bershka', match: /bershka/ },
  { label: 'Pull&Bear', match: /pull\s*(&|and)\s*bear/ },
  { label: 'Stradivarius', match: /stradivarius/ },
  { label: 'Mango', match: /(^|\.)mango\.|shop\.mango/ },
  { label: 'Uniqlo', match: /uniqlo/ },
  { label: 'Gap', match: /(^|\.)gap\./ },
  { label: 'Matalan', match: /matalan/ },
  { label: 'TK Maxx', match: /tk\s*maxx|tj\s*maxx/ },
]

/** Multi-brand retailers and marketplaces: not a label, so Chloe decides. */
export const RETAILERS: { label: string; match: RegExp }[] = [
  { label: 'Net-a-Porter', match: /net-a-porter/ },
  { label: 'The Outnet', match: /theoutnet/ },
  { label: 'Mytheresa', match: /mytheresa/ },
  { label: 'Farfetch', match: /farfetch/ },
  { label: 'Matches', match: /matches(fashion)?\.com/ },
  { label: 'SSENSE', match: /ssense/ },
  { label: 'Selfridges', match: /selfridges/ },
  { label: 'Harvey Nichols', match: /harveynichols/ },
  { label: 'Harrods', match: /harrods/ },
  { label: 'Liberty', match: /libertylondon/ },
  { label: 'Zalando', match: /zalando/ },
  { label: 'Lyst', match: /(^|\.)lyst\./ },
  { label: 'John Lewis', match: /johnlewis/ },
  { label: 'YOOX', match: /(^|\.)yoox\./ },
  { label: 'LuisaViaRoma', match: /luisaviaroma/ },
  { label: '24S', match: /(^|\.)24s\./ },
  { label: 'Browns', match: /brownsfashion/ },
  { label: 'END.', match: /endclothing/ },
  { label: 'Flannels', match: /flannels/ },
  { label: 'Nordstrom', match: /nordstrom/ },
  { label: 'Saks', match: /saks(fifthavenue)?\./ },
  { label: 'Neiman Marcus', match: /neimanmarcus/ },
  { label: 'Shopbop', match: /shopbop/ },
  { label: 'Revolve', match: /(^|\.)revolve\./ },
  { label: 'Vinted', match: /(^|\.)vinted\./ },
  { label: 'Depop', match: /(^|\.)depop\./ },
  { label: 'Vestiaire Collective', match: /vestiaire/ },
  { label: 'The RealReal', match: /therealreal/ },
]

const fold = (s: string | null | undefined) => (s ?? '').toLowerCase().replace(/^www\./, '').trim()

/** The blocked name a host or shop name belongs to, or null. */
export function blockedName(host: string, shopName?: string | null): string | null {
  const hay = [fold(host), fold(shopName)]
  for (const b of BLOCKED_BRANDS) if (hay.some((h) => h && b.match.test(h))) return b.label
  return null
}

/** The retailer a host belongs to, or null. */
export function retailerName(host: string): string | null {
  const h = fold(host)
  for (const r of RETAILERS) if (r.match.test(h)) return r.label
  return null
}

export interface CatalogueAssessment {
  host: string
  /** What the shop calls itself — Shopify vendor, or JSON-LD brand. */
  brandName: string | null
  route: 'shopify' | 'browser' | 'unreadable'
  /** Products in the catalogue (browser route: product URLs found). */
  total: number
  /** Products actually read and scored. */
  sampled: number
  /** Of the sample: womenswear pieces (not non-fashion, menswear, or house-banned). */
  fashion: number
  fashionShare: number
  /** Of the fashion pieces: those scoring at or above the route's on-taste bar. */
  onTaste: number
  onTasteShare: number
  medianPriceGbp: number | null
  /** The shop's name already exists as a MYRA brand. */
  knownBrand: boolean
  /** A member named this label among her favourites. */
  memberFavourite: boolean
  /** The read stopped at the scanner's ceiling — the catalogue is at least this big. */
  hitCatalogueCap: boolean
}

export type Verdict = 'accepted' | 'review' | 'declined' | 'unreadable'

export interface VerdictResult {
  verdict: Verdict
  /** Short, plain, upper-cased by the admin page. */
  reason: string
}

const pct = (share: number) => `${Math.round(share * 100)}%`

/** The decision for one assessed shop. */
export function verdictFor(a: CatalogueAssessment): VerdictResult {
  const blocked = blockedName(a.host, a.brandName)
  if (blocked) return { verdict: 'declined', reason: `High street / fast fashion — MYRA doesn't carry ${blocked}` }
  if (a.route === 'unreadable') return { verdict: 'unreadable', reason: "MYRA can't read this shop" }
  // Links found but no page would open: nothing to judge on. For Chloe.
  if (a.sampled === 0) return { verdict: 'unreadable', reason: `Found ${a.total.toLocaleString('en-GB')} product links but could not read the pages` }
  // A label MYRA already carries, or one a member named, is a label — the
  // size and womenswear checks exist to catch shops that are not.
  if (a.knownBrand) return { verdict: 'accepted', reason: 'Already a MYRA label' }
  if (a.memberFavourite) return { verdict: 'accepted', reason: "A member's favourite label" }
  if (a.route === 'shopify' && (a.hitCatalogueCap || a.total > MAX_CATALOGUE_PRODUCTS)) {
    return { verdict: 'declined', reason: `Too large to be a label — ${a.total.toLocaleString('en-GB')}${a.hitCatalogueCap ? '+' : ''} products (limit ${MAX_CATALOGUE_PRODUCTS.toLocaleString('en-GB')})` }
  }
  if (a.fashion < MIN_FASHION_PRODUCTS || a.fashionShare < MIN_FASHION_SHARE) {
    return { verdict: 'declined', reason: `Not a womenswear shop — ${a.fashion} of ${a.sampled} pieces are womenswear` }
  }
  const retailer = retailerName(a.host)
  if (retailer) return { verdict: 'review', reason: `${retailer} is a multi-brand retailer, not a label` }
  // The browser route counts sitemap links, which locales and colourways
  // multiply — a ceiling there is a question, not an answer.
  if (a.route === 'browser' && (a.hitCatalogueCap || a.total > MAX_CATALOGUE_PRODUCTS)) {
    return { verdict: 'review', reason: `Sitemap lists ${a.total.toLocaleString('en-GB')}${a.hitCatalogueCap ? '+' : ''} product pages — a label or a marketplace?` }
  }
  if (a.medianPriceGbp != null && a.medianPriceGbp < LOW_MEDIAN_PRICE_GBP) {
    return { verdict: 'review', reason: `Prices sit below what MYRA carries — median £${Math.round(a.medianPriceGbp)}` }
  }
  const minShare = MIN_ON_TASTE_SHARE[a.route]
  if (a.onTaste >= MIN_ON_TASTE && a.onTasteShare >= minShare) {
    return { verdict: 'accepted', reason: `${a.onTaste} of ${a.fashion} pieces on taste (${pct(a.onTasteShare)})` }
  }
  return { verdict: 'review', reason: `Only ${a.onTaste} of ${a.fashion} pieces on taste (${pct(a.onTasteShare)}) — needs your eye` }
}

/** Summarise a read of the catalogue into the numbers the verdict needs. */
export function summariseCatalogue(
  input: {
    host: string
    brandName: string | null
    route: 'shopify' | 'browser'
    total: number
    products: { score: number; nonFashion: boolean; menswear: boolean; banned: boolean; priceGbp: number | null }[]
    knownBrand: boolean
    memberFavourite: boolean
    hitCatalogueCap: boolean
  },
): CatalogueAssessment {
  const fashion = input.products.filter((p) => !p.nonFashion && !p.menswear && !p.banned)
  const bar = ON_TASTE_SCORE[input.route]
  const onTaste = fashion.filter((p) => p.score >= bar)
  const prices = fashion.map((p) => p.priceGbp).filter((v): v is number => v != null && Number.isFinite(v) && v > 0).sort((x, y) => x - y)
  const median = prices.length ? (prices.length % 2 ? prices[(prices.length - 1) / 2] : (prices[prices.length / 2 - 1] + prices[prices.length / 2]) / 2) : null
  return {
    host: input.host,
    brandName: input.brandName,
    route: input.route,
    total: input.total,
    sampled: input.products.length,
    fashion: fashion.length,
    fashionShare: input.products.length ? fashion.length / input.products.length : 0,
    onTaste: onTaste.length,
    onTasteShare: fashion.length ? onTaste.length / fashion.length : 0,
    medianPriceGbp: median,
    knownBrand: input.knownBrand,
    memberFavourite: input.memberFavourite,
    hitCatalogueCap: input.hitCatalogueCap,
  }
}
