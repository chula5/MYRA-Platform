// SEASON — which half of the year a piece belongs to.
//
// Brand Watch queues what the shop is selling now, which in September is half
// a summer catalogue on its way out. Chloe won't take summer into the library
// as autumn starts, so each queued piece carries a season and the queue leads
// with the one we are heading into.
//
// Read, in order: the shop's own season codes and words (AW26, SS25,
// automne-hiver, résort…) in its tags, type and title; then the kind of piece
// (shorts and sandals are summer, coats and knitwear are winter); then the
// material (linen and raffia against wool and shearling); then whether the shop
// is clearing it. A piece that says nothing is left null and treated as in
// season — better shown than hidden.
//
// The clearance step is the one that makes this work on a real queue. Plenty of
// pieces say nothing about their season — a plain blouse is a plain blouse — and
// on THE POSSE that left 319 of 437 queued rows unplaced, all of them shown as
// in-season. But a shop that is clearing stock is clearing LAST season's stock,
// and it says so in a tag. Measured across 13,526 products from nine shops, of
// the pieces that state a season code and sit in the sale, 428 of 429 state
// summer against 61% for full-price pieces. So a clearance tag places a piece in
// the season that is NOT the one we are heading into.
//
// That is deliberately the last resort, so it can only ever fill in pieces that
// would otherwise be null. It is a judgement about the calendar, not a fact
// about the garment, which is why it records basis 'sale' rather than pretending
// the shop said so.
//
// A release date is NOT used. It looks like the obvious signal and it is not:
// checked against the shops' own AW/SS codes it disagrees 43% of the time, and
// worst in the months that matter (13% in January, 43% in August). Fashion runs
// ahead of the calendar, so a date is not a season.

export type Season = 'aw' | 'ss' | 'all'

/** August to January is autumn/winter; February to July is spring/summer. */
export function currentSeason(now: Date = new Date()): 'aw' | 'ss' {
  const m = now.getUTCMonth() + 1
  return m >= 8 || m <= 1 ? 'aw' : 'ss'
}

/** The season behind us — where clearing-sale stock belongs. */
function opposite(s: 'aw' | 'ss'): 'aw' | 'ss' {
  return s === 'aw' ? 'ss' : 'aw'
}

const AW_CODE = /(?:^|[^a-z0-9])(aw|fw|ah|ai|hw)[\s_-]?(\d{4}|\d{2})(?![0-9])/gi
const SS_CODE = /(?:^|[^a-z0-9])(ss|pe|sp|hs|pv)[\s_-]?(\d{4}|\d{2})(?![0-9])/gi
const AW_WORDS = /\b(autumn|automne|fall|winter|hiver|inverno|invierno|herbst|pre-?fall|holiday|noel|noël|christmas|xmas)\b/i
const SS_WORDS = /\b(spring|printemps|summer|été|ete|estate|verano|sommer|resort|cruise|swim|swimwear|beach|high\s?summer|vacances)\b/i
const PREORDER_WORDS = /\b(pre[\s_-]?order|presale|pre[\s_-]?sale|back[\s_-]?order)\b/i

const SS_TYPES = new Set(['shorts', 'sandal', 'swimsuit', 'bikini', 'swimwear', 'espadrille', 'flip_flop', 'sarong', 'kaftan'])
const AW_TYPES = new Set(['coat', 'knitwear', 'gilet', 'boot', 'scarf', 'gloves', 'cape', 'poncho', 'jumper', 'cardigan', 'puffer', 'parka', 'shearling', 'beanie'])
const SS_MATERIALS = /\b(linen|lin|voile|seersucker|raffia|raphia|crochet|broderie anglaise|eyelet|gauze|terry|towelling)\b/i
const AW_MATERIALS = /\b(wool|laine|cashmere|cachemire|shearling|mouton|fur|fourrure|tweed|velvet|velours|corduroy|mohair|alpaca|alpaga|fleece|flannel|flanelle|bouclé|boucle|quilted|down|duvet)\b/i

// Two different questions, and they need two different marker sets. Getting this
// wrong is not cosmetic: the clearance reading places a piece in the season being
// cleared, and an out-of-season piece is now not queued at all.
//
// CAMPAIGN_TAG asks "does this tag name a promotion rather than a season?" — used
// only to stop a season code inside a campaign tag ("SS26-SALE", "SS26-CLR") from
// being read as the piece's own season. Deliberately broad: a false positive here
// only costs us a code we could have read, and the kind of piece and its material
// still place it.
//
// CLEARANCE_TAG asks "is the shop clearing this piece?" — the last-resort season
// signal, so it must be narrow. It excludes "clr", because FRAME tags every
// product "clr-dscrp::BLACK", which means colour description, not clearance;
// reading that as clearance filed 400-odd FRAME pieces as last season's stock.
// Negations are excluded too, because "non-sale" contains "sale" and means the
// opposite — and shops tag whole catalogues that way.
const CAMPAIGN_TAG = /\b(sale|eoss?\d*|end[-_ ]?of[-_ ]?season|final[-_ ]?sale|clearance|clr|last[-_ ]?chance|outlet|archive)\b/i
const CLEARANCE_TAG = /\b(eoss?\d*|end[-_ ]?of[-_ ]?season|final[-_ ]?sale|clearance|last[-_ ]?chance|outlet|archive)\b/i
const PLAIN_SALE = /\bsale\b/i
const NOT_ON_SALE = /\bnon[\s_-]?sale\b/i

/** The tag names a promotion, so a season code inside it is a campaign name. */
const isCampaignTag = (t: string): boolean => CAMPAIGN_TAG.test(t)

/** The shop is clearing this piece. Measured: of season-coded pieces, 428 of 429
 *  carrying a plain "sale" tag were summer, against 61% of full-price pieces. */
function isClearingTag(t: string): boolean {
  if (NOT_ON_SALE.test(t)) return false
  return CLEARANCE_TAG.test(t) || PLAIN_SALE.test(t)
}

export interface SeasonInput {
  tags?: string[] | null
  title?: string | null
  productType?: string | null
  itemType?: string | null
  materialCategory?: string | null
  materialPrimary?: string | null
  /**
   * The season the shop filed this piece under, from its own season-named
   * collections (src/lib/brand-watch-collections.ts). The strongest signal
   * there is, because it is stated rather than inferred — pass it whenever it
   * is known, and it decides.
   */
  collectionSeason?: 'aw' | 'ss' | null
  /**
   * That collection's season code when it names a year ("AW26", "AW25"), so a
   * piece sitting only in last year's collection reads as last season's stock.
   */
  collectionCode?: string | null
  /** The shop explicitly marks this piece as pre-order / presale. */
  preOrder?: boolean | null
}

export interface SeasonRead {
  season: Season | null
  /** The shop's own code when it gave one — "AW26". */
  code: string | null
  /** Where the answer came from, for the admin page. */
  basis: 'collection' | 'code' | 'words' | 'type' | 'material' | 'sale' | 'preorder' | null
}

type Half = 'aw' | 'ss'

const year = (y: string) => (y.length === 2 ? 2000 + Number(y) : Number(y))

/**
 * How far either side of now a season code's year may fall before it is treated
 * as something other than a year.
 *
 * Shops tag internal drop and style codes that look exactly like season codes.
 * 16arlington tags a piece "AW25 | AW25 - Pre Collection | AW25PRE | AW44" — AW44
 * is a product line, and reading 44 as the year 2044 made it the LATEST code on
 * the piece, so it beat the real AW25 and last year's stock read as current. Two
 * digits cannot be trusted on their own; a plausible year can.
 */
const YEARS_BACK = 8
const YEARS_AHEAD = 2

/**
 * The season codes the shop states, ignoring any code that appears inside a
 * sale or clearance tag.
 *
 * A code inside a clearance label is a campaign name, not a season. Brora tags
 * 378 products "SS26-SALE" or "SS26-CLR", and they include cashmere scarves,
 * cashmere jumpers and a block-print jacket — the tag says which promotion the
 * piece is in, not what season it is. Reading it as a season called a cashmere
 * scarf summer. That was cosmetic while season only sorted the queue; now that
 * an out-of-season piece is not queued at all, it would lose real stock.
 */
function readCode(tags: string[], extra: string[], now: Date = new Date()): { season: Season; code: string } | null {
  const hay = [...tags.filter((t) => !isCampaignTag(t)), ...extra].join(' | ')
  const refYear = now.getUTCFullYear()
  // A code whose "year" is decades away is a product line, not a season. Without
  // this, 16arlington's "AW44" beat its real "AW25" and last year's stock read as
  // current.
  const plausible = (y: number) => y >= refYear - YEARS_BACK && y <= refYear + YEARS_AHEAD
  // Both families present: the later year wins; a tie is a carry-over sold in
  // both, so 'all'.
  const aw = Array.from(hay.matchAll(AW_CODE)).map((m) => ({ code: `${m[1].toUpperCase()}${m[2].slice(-2)}`, y: year(m[2]) })).filter((c) => plausible(c.y))
  const ss = Array.from(hay.matchAll(SS_CODE)).map((m) => ({ code: `${m[1].toUpperCase()}${m[2].slice(-2)}`, y: year(m[2]) })).filter((c) => plausible(c.y))
  const latest = (xs: { code: string; y: number }[]) => xs.reduce<{ code: string; y: number } | null>((a, b) => (!a || b.y > a.y ? b : a), null)
  const la = latest(aw), ls = latest(ss)
  if (la && ls) {
    if (la.y > ls.y) return { season: 'aw', code: la.code }
    if (ls.y > la.y) return { season: 'ss', code: ls.code }
    return { season: 'all', code: la.code }
  }
  if (la) return { season: 'aw', code: la.code }
  if (ls) return { season: 'ss', code: ls.code }
  return null
}

/** Season words in the tags or the shop's type — never the title alone, where
 *  "Winter" is a colour name at some shops and "Riviera" is a style name. */
function readWords(tags: string[], productType: string | null): Half | null {
  const hay = [...tags, productType ?? ''].join(' | ')
  const aw = AW_WORDS.test(hay), ss = SS_WORDS.test(hay)
  if (aw && !ss) return 'aw'
  if (ss && !aw) return 'ss'
  return null
}

/** The kind of piece. */
function readType(itemType: string | null | undefined): Half | null {
  const t = (itemType ?? '').toLowerCase()
  if (SS_TYPES.has(t)) return 'ss'
  if (AW_TYPES.has(t)) return 'aw'
  return null
}

/** The material. */
function readMaterial(p: SeasonInput): Half | null {
  const mat = `${p.materialPrimary ?? ''} ${p.materialCategory ?? ''} ${p.title ?? ''}`
  if (AW_MATERIALS.test(mat)) return 'aw'
  if (SS_MATERIALS.test(mat)) return 'ss'
  return null
}

/** The season of one piece, from what the shop says and what the piece is. */
export function seasonOf(p: SeasonInput, now: Date = new Date()): SeasonRead {
  const tags = p.tags ?? []
  const extra = [p.productType ?? '', p.title ?? '']

  // 0. A pre-order is an explicit promise of future stock. It can legitimately
  // sit in a summer collection while being sold ahead of time, so it outranks
  // an old season code and is represented as "all" in the queue.
  if (p.preOrder || PREORDER_WORDS.test([...tags, ...extra].join(' | '))) {
    return { season: 'all', code: null, basis: 'preorder' }
  }

  // 1. The season collection the shop filed it under. Stated, not inferred, so
  //    it outranks everything — including a season word, which can be wrong.
  //    POSSE tags a cream crochet strapless top both "SS26" and "KNITWEAR", and
  //    the misleading word there is "knitwear": a cotton or crochet knit is
  //    summer clothing. Where the shop names a season, it wins.
  if (p.collectionSeason) return { season: p.collectionSeason, code: p.collectionCode ?? null, basis: 'collection' }

  // 2. The shop's own codes.
  const code = readCode(tags, extra, now)
  if (code) return { season: code.season, code: code.code, basis: 'code' }

  // 3. Season words in the tags or the type.
  const words = readWords(tags, p.productType ?? null)
  if (words) return { season: words, code: null, basis: 'words' }

  // 4. The kind of piece.
  const type = readType(p.itemType)
  if (type) return { season: type, code: null, basis: 'type' }

  // 5. The material.
  const material = readMaterial(p)
  if (material) return { season: material, code: null, basis: 'material' }

  // 6. Last resort: the shop is clearing it, so it is last season's stock. Only
  //    reached when nothing about the piece itself places it, so this can never
  //    override a real signal.
  if (tags.some(isClearingTag)) {
    return { season: opposite(currentSeason(now)), code: null, basis: 'sale' }
  }

  return { season: null, code: null, basis: null }
}

/** Whether a piece belongs in the season we are heading into. Unknown counts as yes. */
export function inSeason(season: Season | null | undefined, now: Date = new Date()): boolean {
  if (!season || season === 'all') return true
  return season === currentSeason(now)
}

/**
 * The season we are heading into, as a shop would write it — "AW26".
 *
 * Watch the year. Autumn/winter runs from August into January, so a piece in
 * January belongs to the PREVIOUS calendar year's autumn: AW26 is August 2026
 * through January 2027.
 */
export function currentSeasonCode(now: Date = new Date()): string {
  const m = now.getUTCMonth() + 1
  const y = now.getUTCFullYear()
  if (m >= 8) return `AW${String(y % 100).padStart(2, '0')}`
  if (m <= 1) return `AW${String((y - 1) % 100).padStart(2, '0')}`
  return `SS${String(y % 100).padStart(2, '0')}`
}

/** The four-digit year in a season code — "AW26" is 2026, "SS24" is 2024. */
export function seasonCodeYear(code: string | null | undefined): number | null {
  const m = String(code ?? '').trim().match(/(\d{2,4})$/)
  if (!m) return null
  const n = Number(m[1])
  return n < 100 ? 2000 + n : n
}

/**
 * The shop has filed this piece under a season that has already been and gone.
 *
 * The season test above only knows the two halves of the year, so it asks "is
 * this the opposite season?" — which catches summer in September and misses last
 * autumn entirely. Antik Batik shows why that matters: its queue held 1,249
 * pieces across AW26 (281), AW25 (202) and AW24 (21), so 223 of them were autumn
 * stock from years past that read as perfectly in-season. Chloe's own check —
 * "the fall collection on their website is 250-odd" — lands on AW26, which is the
 * 281, not the 504 the season test was letting through.
 *
 * A code with no year, or none at all, is never stale: an absent date is not
 * evidence of an old one.
 */
export function isStaleSeasonCode(code: string | null | undefined, now: Date = new Date()): boolean {
  const y = seasonCodeYear(code)
  if (y === null) return false
  return y < (seasonCodeYear(currentSeasonCode(now)) ?? 0)
}

/** A dated future collection, such as SS27 while the current season is AW26. */
export function isFutureSeasonCode(code: string | null | undefined, now: Date = new Date()): boolean {
  const y = seasonCodeYear(code)
  const current = seasonCodeYear(currentSeasonCode(now))
  return y !== null && current !== null && y > current
}

/**
 * Whether a piece belongs in the season we are heading into right now — the one
 * test the queue, the keep-all and the admin filter should all use.
 *
 * Unknown counts as yes, so a piece the shop never placed is still shown rather
 * than silently hidden.
 */
export function inCurrentSeason(
  season: Season | null | undefined,
  code: string | null | undefined,
  now: Date = new Date(),
): boolean {
  // A future-dated collection is upcoming stock, even when its half-year is
  // different from the calendar half we are currently entering.
  if (isFutureSeasonCode(code, now)) return true
  if (!inSeason(season, now)) return false
  return !isStaleSeasonCode(code, now)
}
