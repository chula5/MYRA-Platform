// WHAT THE SHOP SAYS ABOUT ITS OWN COLLECTIONS — new in, and season.
//
// Both answers come from the same place and cost the same trip, so they live
// together. Every Shopify shop exposes /collections.json; the new-in section
// tells us what it is pushing, and its season-named collections tell us what
// season a piece is, in the shop's own words.
//
// New in (Chloe's rule, September, autumn starting): don't queue summer clothes,
// because they will be destocked before anyone buys them — UNLESS they are in
// the shop's new-in section, in which case the shop is still backing them. And
// new-in pieces lead the queue.
//
// Season from collections is the strongest signal available, and the reason is
// that it is not an inference. POSSE files its stock under "end-of-summer-sale-*",
// "resort-26", "spring-summer-26", "fall-edit", "pre-fall-26"; membership of one
// of those IS the season, stated by the shop. On THE POSSE it places 205 of 231
// queued rows, against 196 for reading tags, the kind of piece and the material
// combined — and it gets right the pieces the other signals miss, which are
// exactly the plain tops and dresses that say nothing about themselves.
//
// It also fixes a class of error the tag reading cannot avoid. POSSE tags a
// cream crochet strapless top "SS26" and "KNITWEAR" at once; the shop is right
// and the word "knitwear" is the misleading one, because a cotton or crochet
// knit is summer clothing. Where the shop states a season, it wins.
//
// Names are matched, not guessed from dates: a release date is NOT a season.
// Checked against the shops' own AW/SS codes it disagrees 43% of the time, and
// worst in the months that matter (13% in January, 43% in August). Fashion runs
// ahead of the calendar.
//
// Coverage is partial and the caller must treat it that way: 12 of the 47
// Shopify brands have no new-in section, and the 14 browser-scanned brands serve
// no /collections.json at all (none of them did). Both readers return null for
// "could not ask", which is never the same as "none" — see fetchShopSignals.

const UA = 'Mozilla/5.0 (Macintosh) MYRA-BrandWatch/1.0'

/** Names that mean "just arrived". Matched against the collection handle and title. */
const NEW_IN_PATTERNS: RegExp[] = [
  /\bnew[\s_-]?arrivals?\b/i,
  /\bnew[\s_-]?in\b/i,
  /\bjust[\s_-]?in\b/i,
  /\bnew[\s_-]?this[\s_-]?week\b/i,
  /\bnew[\s_-]?season\b/i,
  /\bnew[\s_-]?collection\b/i,
  /\bnouveaut/i,
  /\bneuheiten\b/i,
  /\bwhats?[\s_-]?new\b/i,
]

/**
 * Names that mean the collection is about somebody else — menswear, children,
 * gifts, a brand collaboration edit. Several shops carry these alongside the
 * real thing ("all-styles-for-men-new-in", "beverly-nguyens-new-york-edit"), and
 * picking one would mark the wrong products.
 *
 * "mens" is spelled out because `\bmen\b` does not match it — Nili Lotan's only
 * new-in collection is "mens-new-in", and without this it would be read as hers.
 */
const NOT_OURS = /\b(mens?|man|boys?|kids?|children|baby|gift|home|beauty|sale|outlet|clearance|archive|collab|edit|exclusive|new[\s_-]?mum)\b/i

/**
 * Collections that name a season. The word has to be its own part of the handle
 * ("end-of-summer-sale", "pre-fall-26"), not a fragment, so "falling" or a colour
 * called "Winter White" cannot match.
 *
 * "holiday" is deliberately absent: at some shops it means Christmas and at
 * others it means a summer holiday, and there is no way to tell from the name.
 * Guessing would file real stock under the wrong season, which now means not
 * queueing it.
 */
const SS_COLLECTION = /(?:^|[-_ ])(?:end-of-summer|summer|spring|resort|cruise|beach|vacation|ss\d{2})(?:[-_ ]|$|\d)/i
const AW_COLLECTION = /(?:^|[-_ ])(?:fall|autumn|winter|pre-fall|pf\d{2}|aw\d{2})(?:[-_ ]|$|\d)/i
const PREORDER_COLLECTION = /(?:^|[-_ ])(?:pre[\s_-]?order|presale|pre[\s_-]?sale|back[\s_-]?order)(?:[-_ ]|$)/i

export interface NewInCollection {
  handle: string
  title: string
}

/** A handle -> the season collection it sits in, and that season's code when the
 *  collection names a year. Null means the shop could not be asked. */
export type SeasonByHandle = Map<string, { season: 'aw' | 'ss'; code: string | null }>

export interface ShopSignals {
  /** Products in the shop's new-in section. null = could not ask. */
  newIn: Set<string> | null
  /** Season per product handle, from the shop's own season collections. null = could not ask. */
  seasonByHandle: SeasonByHandle | null
  /** Products in an explicit pre-order / presale collection. */
  preOrderByHandle: Set<string> | null
}

/**
 * The collection that means "new in", or null if none does.
 *
 * Preference, in order: a name that is exactly the idea ("new-in", "new-arrivals")
 * beats one that merely contains it; anything that smells like another audience
 * is last. Ties break on the shorter handle, which is the more canonical one.
 */
export function pickNewInCollection(collections: NewInCollection[]): NewInCollection | null {
  const scored = collections
    .map((c) => {
      const handle = String(c.handle ?? '')
      const title = String(c.title ?? '')
      const hay = `${handle} ${title}`
      if (!NEW_IN_PATTERNS.some((re) => re.test(hay))) return null
      // A canonical name is a whole-word match on the handle, e.g. "new-in".
      const canonical = NEW_IN_PATTERNS.some((re) => new RegExp(`^(?:${re.source.replace(/^\\b/, '').replace(/\\b$/, '')})$`, 'i').test(handle))
      const notOurs = NOT_OURS.test(hay)
      const score = (canonical ? 100 : 0) + (notOurs ? -200 : 0) - handle.length
      return { collection: { handle, title: title || handle }, score, notOurs }
    })
    .filter((x): x is { collection: NewInCollection; score: number; notOurs: boolean } => x !== null)

  if (!scored.length) return null
  // If every candidate is about another audience, the shop has no new-in of ours.
  if (scored.every((s) => s.notOurs)) return null
  scored.sort((a, b) => b.score - a.score)
  return scored[0].collection
}

/**
 * The collections that name a season, split by season.
 *
 * A handle naming both ("spring-summer-26", "summer-to-fall") is dropped rather
 * than guessed: a piece in it would be filed under whichever word was tested
 * first, and the cost of filing a summer piece as autumn is now that it is
 * queued and reviewed, which is the thing we are trying to avoid.
 */
export function pickSeasonCollections(collections: NewInCollection[]): { ss: string[]; aw: string[] } {
  const ss: string[] = []
  const aw: string[] = []
  for (const c of collections) {
    const handle = String(c.handle ?? '')
    if (!handle) continue
    const isSS = SS_COLLECTION.test(handle)
    const isAW = AW_COLLECTION.test(handle)
    if (isSS === isAW) continue // neither, or both — not decidable from the name
    ;(isSS ? ss : aw).push(handle)
  }
  return { ss, aw }
}

/** Collections that explicitly promise future stock. */
export function pickPreOrderCollections(collections: NewInCollection[]): string[] {
  return collections
    .map((c) => ({ handle: String(c.handle ?? ''), title: String(c.title ?? '') }))
    .filter((c) => c.handle && PREORDER_COLLECTION.test(`${c.handle} ${c.title}`))
    .map((c) => c.handle)
}

/**
 * A JSON GET, retried.
 *
 * These shops throttle: a scan or a backfill asks one shop for a dozen or more
 * collection feeds in a row, and POSSE starts answering nothing. A failed read
 * here is not harmless — the caller falls back to the weaker tag signals and the
 * pieces land in different seasons, so the same shop can be read two ways on two
 * days. Retrying with a short backoff makes the answer stable.
 */
async function getJson(url: string, timeoutMs: number, attempts = 3): Promise<any | null> {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, cache: 'no-store', signal: AbortSignal.timeout(timeoutMs) })
      if (res.ok) return await res.json()
      // 404/401 mean there is nothing here — do not hammer it.
      if (res.status < 500 && res.status !== 429) return null
    } catch { /* timeout or socket — retry */ }
    if (attempt < attempts) await new Promise((r) => setTimeout(r, 400 * attempt))
  }
  return null
}

async function collectionProducts(base: string, handle: string, timeoutMs: number, maxPages: number): Promise<string[]> {
  const out: string[] = []
  for (let page = 1; page <= maxPages; page++) {
    const json = await getJson(`${base}/collections/${encodeURIComponent(handle)}/products.json?limit=250&page=${page}`, timeoutMs)
    if (!json) break
    const batch: any[] = json?.products ?? []
    for (const p of batch) if (p?.handle) out.push(String(p.handle))
    if (batch.length < 250) break
  }
  return out
}

/**
 * The handles the shop has in its new-in section.
 *
 * Returns null when the shop cannot be asked (not Shopify, blocked, no new-in
 * section) — that is "unknown", not "none". Returns an empty set only when the
 * shop was asked and its new-in section is genuinely empty.
 */
export async function fetchNewInHandles(baseUrl: string, opts: { timeoutMs?: number; maxPages?: number } = {}): Promise<Set<string> | null> {
  const timeoutMs = opts.timeoutMs ?? 15000
  const base = baseUrl.replace(/\/+$/, '')
  const collections = await getJson(`${base}/collections.json?limit=250`, timeoutMs)
  const list: NewInCollection[] = (collections?.collections ?? []).map((c: any) => ({ handle: String(c?.handle ?? ''), title: String(c?.title ?? '') }))
  if (!list.length) return null
  const pick = pickNewInCollection(list)
  if (!pick) return null
  return new Set(await collectionProducts(base, pick.handle, timeoutMs, opts.maxPages ?? 4))
}

/**
 * Both answers in one pass, sharing the single /collections.json read.
 *
 * `maxSeasonCollections` bounds the work, because each season collection is a
 * separate request and POSSE names 41 of them. It is deliberately generous: an
 * earlier version capped at 24 and ordered by the year in the handle, which was
 * worse than useless — POSSE's "end-of-summer-sale*" collections carry no year,
 * so they sorted to the back, fell off the end of the budget, and the summer
 * pieces they hold were then placed by a weaker signal and came out as autumn.
 * A collection holding more than 250 products is read one page deep, which
 * covers the pieces a queue is likely to hold.
 *
 * A product the shop lists in BOTH a summer and a winter collection counts as
 * summer. That is not a coin toss: the shops put new stock into an upcoming
 * season's edit while it is still in the current one, so the overlap is
 * dominated by summer pieces that also sit in a fall edit — POSSE's "TOMMY
 * SHORT", "MAISIE SHORT" and "TOMMY TEE" are all in one. Filing those as "sold
 * in both seasons" put them straight back in the autumn view, which is the thing
 * this is here to prevent. Summer wins the tie, and the SUMMER chip means a
 * piece filed that way is still one click away.
 */
export async function fetchShopSignals(
  baseUrl: string,
  opts: { timeoutMs?: number; maxNewInPages?: number; maxSeasonCollections?: number } = {},
): Promise<ShopSignals> {
  const timeoutMs = opts.timeoutMs ?? 15000
  const base = baseUrl.replace(/\/+$/, '')
  const collections = await getJson(`${base}/collections.json?limit=250`, timeoutMs)
  const list: NewInCollection[] = (collections?.collections ?? []).map((c: any) => ({ handle: String(c?.handle ?? ''), title: String(c?.title ?? '') }))
  if (!list.length) return { newIn: null, seasonByHandle: null, preOrderByHandle: null }

  const pick = pickNewInCollection(list)
  const newIn = pick ? new Set(await collectionProducts(base, pick.handle, timeoutMs, opts.maxNewInPages ?? 4)) : null
  const preOrderCollections = pickPreOrderCollections(list)
  const preOrderByHandle = new Set<string>()
  for (const handle of preOrderCollections) {
    for (const productHandle of await collectionProducts(base, handle, timeoutMs, 4)) preOrderByHandle.add(productHandle)
  }

  const seasons = pickSeasonCollections(list)
  const ordered: Array<{ handle: string; season: 'aw' | 'ss' }> = [
    ...seasons.ss.map((handle) => ({ handle, season: 'ss' as const })),
    ...seasons.aw.map((handle) => ({ handle, season: 'aw' as const })),
  ]

  // Summer wins when a piece sits in both seasons' collections, and the year only
  // decides how old the claim is.
  //
  // POSSE is why. It files its outgoing stock under "end-of-summer-sale-*" — which
  // carries no year — and carries some of the same pieces into "pre-fall-26". A
  // rule of "newest dated collection wins" therefore handed those to pre-fall and
  // put 57 summer pieces straight back in the autumn view, which is the thing this
  // is here to prevent. Nor is it a coin toss: the shops put new stock into an
  // upcoming season's edit while it is still in the current one, so the overlap is
  // dominated by summer pieces that also sit in a fall edit — POSSE's "TOMMY
  // SHORT", "MAISIE SHORT" and "TOMMY TEE" are all in one.
  //
  // The year still matters, but for age rather than for the choice: a piece
  // sitting ONLY in last year's collections carries that year's code, so the queue
  // can see it is last season's stock. A collection naming no year counts as the
  // oldest claim of its season, so a dated claim wins within a season.
  const best = new Map<string, { ss?: { year: number; code: string | null }; aw?: { year: number; code: string | null } }>()
  let fetched = 0
  for (const { handle, season } of ordered) {
    if (fetched >= (opts.maxSeasonCollections ?? 60)) break
    fetched++
    const year = collectionYear(handle) ?? 0
    const code = year === 0 ? null : `${season.toUpperCase()}${String(year % 100).padStart(2, '0')}`
    for (const h of await collectionProducts(base, handle, timeoutMs, 1)) {
      const entry = best.get(h) ?? {}
      const prev = entry[season]
      if (!prev || year > prev.year) entry[season] = { year, code }
      best.set(h, entry)
    }
  }

  const seasonByHandle: SeasonByHandle = new Map()
  for (const [handle, entry] of Array.from(best.entries())) {
    const chosen = entry.ss ?? entry.aw
    if (!chosen) continue
    seasonByHandle.set(handle, { season: entry.ss ? 'ss' : 'aw', code: chosen.code })
  }
  return {
    newIn,
    seasonByHandle: seasonByHandle.size ? seasonByHandle : null,
    preOrderByHandle: preOrderCollections.length ? preOrderByHandle : null,
  }
}

/**
 * The four-digit year in a collection handle — "aw26" is 2026, "aw25" is 2025.
 *
 * Bounded like the season codes are, and for the same reason: a handle ending in
 * digits is not always a year, and reading "aw85" as 2085 would date a piece
 * decades into the future — which reads as perfectly current. Out of range means
 * "no year", so the season still counts and only the age is unknown.
 */
export function collectionYear(handle: string, now: Date = new Date()): number | null {
  const m = String(handle ?? '').match(/(\d{2,4})(?!.*\d)/)
  if (!m) return null
  const n = Number(m[1])
  const year = n < 100 ? 2000 + n : n
  const ref = now.getUTCFullYear()
  return year >= ref - YEARS_BACK && year <= ref + YEARS_AHEAD ? year : null
}

/** Matches the season-code bounds in season.ts. */
const YEARS_BACK = 8
const YEARS_AHEAD = 2
