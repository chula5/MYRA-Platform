// MYRA search understanding layer (from the Search & Occasion Tagging spec).
// Translates free-text queries onto the taxonomy MYRA already stores, then
// scores every outfit so search ALWAYS returns something relevant (never zero).
//
// Deterministic (dictionary + fuzzy typo match) — runs instantly client-side,
// no API cost. Extend the dictionaries as the search logs grow.

import type { OutfitWithItems } from '@/types/database'

// ── Controlled vocabulary / synonym dictionaries ─────────────────────────────

// Colour word/phrase → colour_family enum value.
const COLOUR: Record<string, string> = {
  white: 'white', 'off-white': 'cream', 'off white': 'cream', ivory: 'cream', cream: 'cream', ecru: 'cream', oatmeal: 'cream', beige: 'camel',
  black: 'black', grey: 'grey', gray: 'grey', charcoal: 'grey', slate: 'grey',
  navy: 'navy', blue: 'blue', cobalt: 'blue', teal: 'blue', 'baby blue': 'blue', 'powder blue': 'blue', 'sky blue': 'blue', sky: 'blue', powder: 'blue',
  brown: 'brown', chocolate: 'brown', camel: 'camel', tan: 'camel', taupe: 'camel', sand: 'camel',
  green: 'green', olive: 'green', sage: 'green', khaki: 'green', emerald: 'green', forest: 'green', mint: 'green', 'light green': 'green',
  burgundy: 'burgundy', wine: 'burgundy', maroon: 'burgundy', oxblood: 'burgundy',
  red: 'red', scarlet: 'red', crimson: 'red',
  pink: 'pink', blush: 'pink', rose: 'pink', 'dusty pink': 'pink', fuchsia: 'pink',
  yellow: 'yellow', mustard: 'yellow', lemon: 'yellow',
  orange: 'orange', rust: 'orange', terracotta: 'orange', coral: 'orange',
  purple: 'purple', lilac: 'purple', lavender: 'purple', violet: 'purple', plum: 'purple', mauve: 'purple',
}

const _DRESS = ['mini_dress', 'midi_dress', 'maxi_dress', 'shirt_dress', 'slip_dress']
const _TOPS = ['shirt', 'blouse', 't-shirt', 'knitwear', 'corset', 'bodysuit']
const _SHOES = ['boot', 'heel', 'flat', 'sneaker', 'mule', 'sandal']
const _BAGS = ['tote', 'shoulder_bag', 'clutch', 'crossbody', 'structured_bag']
const _JEWEL = ['necklace', 'earrings', 'bracelet', 'ring', 'brooch']

// Item word → item_type enum values.
const TYPE: Record<string, string[]> = {
  dress: _DRESS, dresses: _DRESS, gown: ['maxi_dress'], gowns: ['maxi_dress'],
  maxi: ['maxi_dress'], midi: ['midi_dress'], mini: ['mini_dress'], slip: ['slip_dress'],
  skirt: ['skirt'], skirts: ['skirt'], trouser: ['trousers'], trousers: ['trousers'], pant: ['trousers'], pants: ['trousers'],
  jean: ['jeans'], jeans: ['jeans'], short: ['shorts'], shorts: ['shorts'],
  top: _TOPS, tops: _TOPS, shirt: ['shirt'], blouse: ['blouse'], tee: ['t-shirt'], tshirt: ['t-shirt'],
  knit: ['knitwear'], knitwear: ['knitwear'], jumper: ['knitwear'], sweater: ['knitwear'], cardigan: ['knitwear'], corset: ['corset'], bodysuit: ['bodysuit'],
  coat: ['coat'], trench: ['trench'], jacket: ['jacket'], blazer: ['blazer'], gilet: ['gilet'], cape: ['cape'],
  shoe: _SHOES, shoes: _SHOES, boot: ['boot'], boots: ['boot'], heel: ['heel'], heels: ['heel'], pump: ['heel'], flat: ['flat'], flats: ['flat'], sneaker: ['sneaker'], trainer: ['sneaker'], mule: ['mule'], sandal: ['sandal'], sandals: ['sandal'],
  bag: _BAGS, bags: _BAGS, handbag: _BAGS, tote: ['tote'], clutch: ['clutch'], crossbody: ['crossbody'],
  jewellery: _JEWEL, jewelry: _JEWEL, necklace: ['necklace'], earrings: ['earrings'], bracelet: ['bracelet'], ring: ['ring'], brooch: ['brooch'],
  belt: ['belt'], scarf: ['scarf'], hat: ['hat'], sunglasses: ['sunglasses'],
}

// Material word → canonical material tag (matched against material_primary text).
const MATERIAL: Record<string, string> = {
  lace: 'lace', lacey: 'lace', feather: 'feather', feathered: 'feather', feathers: 'feather',
  sequin: 'sequin', sequinned: 'sequin', sequined: 'sequin', sparkly: 'sequin', sparkle: 'sequin',
  satin: 'satin', silk: 'silk', velvet: 'velvet', leather: 'leather', suede: 'suede', denim: 'denim',
  linen: 'linen', cotton: 'cotton', wool: 'wool', tweed: 'tweed', crochet: 'crochet', knitted: 'knit',
  mesh: 'mesh', organza: 'organza', chiffon: 'chiffon',
}

// Occasion/setting/season phrase → keywords to match against the outfit's
// occasion_tags + aesthetic label (which are human-readable free text).
const OCCASION: Record<string, string[]> = {
  work: ['work', 'office'], office: ['work', 'office'], professional: ['work', 'office'], 'work meeting': ['work', 'office'],
  wedding: ['wedding'], 'wedding guest': ['wedding'],
  date: ['date'], 'date night': ['date'], 'casual date': ['date'],
  dinner: ['dinner'], lunch: ['lunch', 'brunch'], brunch: ['brunch', 'lunch'],
  drinks: ['drinks', 'cocktail'], cocktail: ['cocktail', 'drinks'], party: ['party'],
  'black tie': ['black tie', 'gala', 'formal'], gala: ['gala', 'black tie'], ball: ['ball', 'gala'],
  holiday: ['holiday', 'vacation', 'getaway', 'break'], vacation: ['holiday', 'vacation'], 'girls holiday': ['holiday', 'getaway'], 'girls trip': ['holiday', 'getaway'],
  'weekend away': ['weekend'], weekend: ['weekend'], 'city break': ['city', 'break'], city: ['city'],
  'fashion week': ['fashion'], 'fashion event': ['fashion'], fashion: ['fashion'],
  gallery: ['gallery', 'exhibition'], 'gallery opening': ['gallery'], 'gallery night': ['gallery'],
  'garden party': ['garden'], garden: ['garden'], races: ['race', 'ascot', 'races'], 'race day': ['race', 'ascot', 'races'], ascot: ['ascot', 'race'], wimbledon: ['wimbledon', 'tennis'],
  beach: ['beach'], boat: ['boat'], 'boat day': ['boat'], pool: ['pool'], poolside: ['pool'],
  rooftop: ['rooftop'], restaurant: ['restaurant', 'dinner'], bar: ['bar', 'drinks'], countryside: ['countryside', 'country'],
  everyday: ['everyday', 'casual'], errands: ['everyday', 'casual'],
}

// Location/setting phrase → keywords (+ implied climate handled as keywords too).
const SETTING: Record<string, string[]> = {
  italy: ['mediterranean', 'italy', 'amalfi', 'riviera'], amalfi: ['mediterranean', 'amalfi'], positano: ['mediterranean', 'amalfi'],
  mediterranean: ['mediterranean'], 'south of france': ['mediterranean', 'riviera'], 'the south': ['mediterranean', 'riviera'],
  riviera: ['mediterranean', 'riviera'], greece: ['mediterranean', 'greece'], mykonos: ['mediterranean'],
  scandinavia: ['scandi', 'nordic'], 'southern sweden': ['scandi', 'nordic'], sweden: ['scandi', 'nordic'],
}

const SEASON = ['spring', 'summer', 'autumn', 'fall', 'winter', 'transitional']

// Formality adjective → [min,max] on the 1..5 axis.
const FORMALITY: Record<string, [number, number]> = {
  casual: [1, 2], relaxed: [1, 2], easy: [1, 2], laidback: [1, 2], 'laid-back': [1, 2], everyday: [1, 2], comfy: [1, 2],
  smart: [3, 3], elevated: [3, 3], polished: [3, 4], 'smart casual': [2, 3],
  professional: [3, 3], formal: [4, 5], 'black tie': [4, 5], gala: [4, 5], dressy: [3, 4],
}

// Time-of-day cue → value on the 1..5 axis (1 morning … 5 night).
const TIME: Record<string, number> = {
  morning: 2, daytime: 2, day: 2, brunch: 2, lunch: 2, afternoon: 3,
  evening: 4, dinner: 4, cocktail: 4, rooftop: 4, night: 5, 'date night': 4,
}

const STOPWORDS = new Set(['a', 'an', 'the', 'my', 'for', 'to', 'in', 'on', 'at', 'of', 'and', 'with', 'i', 'need', 'want', 'looking', 'some', 'something', 'outfit', 'outfits', 'look', 'wear', 'during', 'this', 'that', 'me'])

// ── Normalisation + fuzzy matching ───────────────────────────────────────────

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length
  if (Math.abs(m - n) > 1) return 2 // we only care about ≤1
  const dp = Array.from({ length: m + 1 }, (_, i) => i)
  for (let j = 1; j <= n; j++) {
    let prev = dp[0]; dp[0] = j
    for (let i = 1; i <= m; i++) {
      const tmp = dp[i]
      dp[i] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[i], dp[i - 1])
      prev = tmp
    }
  }
  return dp[m]
}

// Fuzzy-lookup a token in a dictionary (exact, then Levenshtein ≤ 1 for typos).
function fuzzyGet<T>(dict: Record<string, T>, token: string): T | undefined {
  if (dict[token] !== undefined) return dict[token]
  if (token.length < 4) return undefined // don't fuzzy tiny tokens
  for (const key of Object.keys(dict)) {
    if (!key.includes(' ') && Math.abs(key.length - token.length) <= 1 && levenshtein(key, token) <= 1) return dict[key]
  }
  return undefined
}

function normalise(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').replace(/\s+/g, ' ').trim()
}

// ── Parsed query ─────────────────────────────────────────────────────────────

export interface ParsedQuery {
  colourFamilies: string[]
  itemTypes: string[]
  materials: string[]
  brand: string | null
  // Each group is one CONCEPT's synonyms (e.g. italy → [mediterranean,italy,amalfi]).
  // A group "hits" if ANY of its words match — so synonyms don't dilute the score.
  occasionGroups: string[][]
  formalityRange: [number, number] | null
  timeOfDay: number | null
  intentTerms: string[]
  raw: string
}

// Parse a free-text query into MYRA's taxonomy. Deterministic.
export function parseQuery(raw: string, knownBrands: string[] = []): ParsedQuery {
  let text = normalise(raw)
  const p: ParsedQuery = {
    colourFamilies: [], itemTypes: [], materials: [], brand: null,
    occasionGroups: [], formalityRange: null, timeOfDay: null, intentTerms: [], raw,
  }

  const consume = (phrase: string) => { text = text.replace(new RegExp(`\\b${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g'), ' ').replace(/\s+/g, ' ').trim() }
  const add = (arr: string[], vals: string[]) => { for (const v of vals) if (!arr.includes(v)) arr.push(v) }
  const addGroup = (vals: string[]) => { const k = vals.join('|'); if (!p.occasionGroups.some((g) => g.join('|') === k)) p.occasionGroups.push(vals) }

  // 1. Multi-word phrases first (longest first), across all phrase dictionaries.
  const phraseDicts: Array<[Record<string, any>, 'colour' | 'occasion' | 'setting' | 'formality' | 'time']> = [
    [COLOUR, 'colour'], [OCCASION, 'occasion'], [SETTING, 'setting'], [FORMALITY, 'formality'], [TIME, 'time'],
  ]
  const phrases: Array<{ phrase: string; dict: Record<string, any>; kind: string }> = []
  for (const [dict, kind] of phraseDicts) for (const key of Object.keys(dict)) if (key.includes(' ')) phrases.push({ phrase: key, dict, kind })
  phrases.sort((a, b) => b.phrase.length - a.phrase.length)
  for (const { phrase, dict, kind } of phrases) {
    if (new RegExp(`\\b${phrase}\\b`).test(text)) {
      applyHit(p, add, addGroup, kind, dict[phrase])
      consume(phrase)
    }
  }

  // 2. Known brands (multi-word aware).
  for (const b of knownBrands.slice().sort((a, c) => c.length - a.length)) {
    if (b.length >= 3 && new RegExp(`\\b${b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(text)) { p.brand = b; consume(b); break }
  }

  // 3. Single tokens (with fuzzy typo tolerance).
  for (const tok of text.split(' ').filter(Boolean)) {
    if (STOPWORDS.has(tok)) continue
    const c = fuzzyGet(COLOUR, tok); if (c) { add(p.colourFamilies, [c]); continue }
    const t = fuzzyGet(TYPE, tok); if (t) { add(p.itemTypes, t); continue }
    const m = fuzzyGet(MATERIAL, tok); if (m) { add(p.materials, [m]); continue }
    const o = fuzzyGet(OCCASION, tok); if (o) { addGroup(o); continue }
    const s = fuzzyGet(SETTING, tok); if (s) { addGroup(s); continue }
    if (SEASON.includes(tok)) { addGroup([tok === 'fall' ? 'autumn' : tok]); continue }
    const f = fuzzyGet(FORMALITY, tok); if (f) { p.formalityRange = mergeRange(p.formalityRange, f); continue }
    const td = fuzzyGet(TIME, tok); if (td != null) { p.timeOfDay = td; continue }
    if (tok.length > 2) p.intentTerms.push(tok) // leftover adjective → soft signal
  }
  return p
}

function applyHit(p: ParsedQuery, add: (a: string[], v: string[]) => void, addGroup: (v: string[]) => void, kind: string, val: any) {
  if (kind === 'colour') add(p.colourFamilies, [val])
  else if (kind === 'occasion' || kind === 'setting') addGroup(val)
  else if (kind === 'formality') p.formalityRange = mergeRange(p.formalityRange, val)
  else if (kind === 'time') p.timeOfDay = val
}

function mergeRange(a: [number, number] | null, b: [number, number]): [number, number] {
  return a ? [Math.min(a[0], b[0]), Math.max(a[1], b[1])] : b
}

// ── Scoring ──────────────────────────────────────────────────────────────────

// Whole-word match (so "ski" doesn't match "skirt"). Needle may be multi-word.
function hasWord(hay: string | null | undefined, needle: string): boolean {
  if (!hay) return false
  return new RegExp(`\\b${needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(hay)
}

// Score one outfit against a parsed query, 0..1. Only facets PRESENT in the
// query contribute (their weights are normalised), so "mint" is judged on colour
// while "relaxed summer wedding" is judged on occasion + season + formality.
export function scoreOutfit(outfit: OutfitWithItems, p: ParsedQuery): number {
  const items = (outfit.outfit_item ?? []).filter((oi: any) => oi.item).map((oi: any) => oi.item)
  const tagBlob = (outfit.occasion_tags ?? []).join(' ') + ' ' + (outfit.aesthetic_label ?? '')

  let sum = 0, weight = 0
  const part = (w: number, hit: number) => { sum += w * hit; weight += w }

  if (p.colourFamilies.length) part(0.24, items.some((it: any) => p.colourFamilies.includes(it.colour_family) || p.colourFamilies.some((c) => hasWord(it.product_name, c))) ? 1 : 0)
  if (p.itemTypes.length) part(0.24, items.some((it: any) => p.itemTypes.includes(String(it.item_type))) ? 1 : 0)
  if (p.materials.length) part(0.18, items.some((it: any) => p.materials.some((m) => hasWord(it.material_primary, m) || hasWord(it.product_name, m))) ? 1 : 0)
  if (p.brand) part(0.18, items.some((it: any) => hasWord(it.brand?.name, p.brand!)) ? 1 : 0)

  if (p.occasionGroups.length) {
    // Fraction of CONCEPTS matched (each group hits if any of its synonyms match).
    const matched = p.occasionGroups.filter((g) => g.some((k) => hasWord(tagBlob, k))).length
    part(0.36, matched / p.occasionGroups.length)
  }
  if (p.formalityRange) {
    const [lo, hi] = p.formalityRange
    const f = outfit.formality ?? 3
    const dist = f < lo ? lo - f : f > hi ? f - hi : 0
    part(0.12, Math.max(0, 1 - dist / 2))
  }
  if (p.timeOfDay != null) {
    const dist = Math.abs((outfit.time_of_day ?? 3) - p.timeOfDay)
    part(0.06, Math.max(0, 1 - dist / 2))
  }
  if (p.intentTerms.length) {
    const matched = p.intentTerms.filter((k) => hasWord(tagBlob, k) || items.some((it: any) => hasWord(it.product_name, k) || hasWord(it.material_primary, k))).length
    part(0.10, matched / p.intentTerms.length)
  }

  return weight > 0 ? sum / weight : 0
}

// `matchCount` = genuinely relevant outfits (0 = a real content gap, even though
// `outfits` is padded with closest matches so the UI is never empty).
export interface SearchResult { outfits: OutfitWithItems[]; relaxed: boolean; matchCount: number }

// Rank outfits for a query and NEVER return empty. `fallbackOrder` supplies the
// default ordering (taste / recency) used when nothing matches — those are
// returned as "closest matches" so the search bar always shows something.
// A "genuine match" satisfies most of the query's active facets.
const STRONG = 0.55
const MIN_SHOWN = 8

export function searchOutfits(
  outfits: OutfitWithItems[],
  p: ParsedQuery,
  fallbackOrder: (list: OutfitWithItems[]) => OutfitWithItems[],
): SearchResult {
  const hasSignal = p.colourFamilies.length || p.itemTypes.length || p.materials.length || p.brand || p.occasionGroups.length || p.formalityRange || p.timeOfDay != null || p.intentTerms.length
  if (!hasSignal) return { outfits: fallbackOrder(outfits), relaxed: false, matchCount: outfits.length }

  const scored = outfits.map((o) => ({ o, s: scoreOutfit(o, p) })).sort((a, b) => b.s - a.s)

  // Genuine matches (satisfy most active facets) → show exactly those.
  const matched = scored.filter((x) => x.s >= STRONG)
  if (matched.length > 0) return { outfits: matched.map((x) => x.o), relaxed: false, matchCount: matched.length }

  // Nothing genuinely matched → NEVER empty: show the closest partial matches,
  // else the default feed. matchCount stays 0 so admin sees the content gap.
  const partial = scored.filter((x) => x.s > 0).slice(0, MIN_SHOWN).map((x) => x.o)
  const closest = partial.length > 0 ? partial : fallbackOrder(outfits).slice(0, MIN_SHOWN)
  return { outfits: closest, relaxed: true, matchCount: 0 }
}
