// MYRA search understanding layer (from the Search & Occasion Tagging spec).
// Translates free-text queries onto the taxonomy MYRA already stores, then
// scores every outfit so search ALWAYS returns something relevant (never zero).
//
// Deterministic (dictionary + fuzzy typo match) — runs instantly client-side,
// no API cost. Extend the dictionaries as the search logs grow.

import type { OutfitWithItems } from '@/types/database'

// ── Controlled vocabulary / synonym dictionaries ─────────────────────────────

// Colour word/phrase → colour_family value. Exported because the admin picks
// search needs the same synonym table — "mint" has to find a piece whose
// colour_family is 'green' there exactly as it does in the public search.
export const COLOUR: Record<string, string> = {
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
  multicolour: 'multicolour', multicolor: 'multicolour', multicoloured: 'multicolour', multicolored: 'multicolour',
}

const _DRESS = ['mini_dress', 'midi_dress', 'maxi_dress', 'shirt_dress', 'slip_dress']
const _TOPS = ['shirt', 'blouse', 't-shirt', 'knitwear', 'corset', 'bodysuit']
const _SHOES = ['boot', 'heel', 'flat', 'sneaker', 'mule', 'sandal']
const _BAGS = ['tote', 'shoulder_bag', 'clutch', 'crossbody', 'structured_bag']
const _JEWEL = ['necklace', 'earrings', 'bracelet', 'ring', 'brooch']

// Item word → item_type enum values.
export const TYPE: Record<string, string[]> = {
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
export const MATERIAL: Record<string, string> = {
  lace: 'lace', lacey: 'lace', feather: 'feather', feathered: 'feather', feathers: 'feather',
  sequin: 'sequin', sequinned: 'sequin', sequined: 'sequin', sparkly: 'sequin', sparkle: 'sequin',
  satin: 'satin', silk: 'silk', velvet: 'velvet', leather: 'leather', suede: 'suede', denim: 'denim',
  linen: 'linen', cotton: 'cotton', wool: 'wool', tweed: 'tweed', crochet: 'crochet', knitted: 'knit',
  mesh: 'mesh', organza: 'organza', chiffon: 'chiffon', cashmere: 'cashmere', jersey: 'jersey',
}

// Canonical material tag → every word on a label that COUNTS as that cloth.
// "silk" has to find a skirt whose label says "silk charmeuse" or "crêpe de
// chine", and must never be satisfied by a cotton one. Matched whole-word
// against material_primary and the product name.
export const MATERIAL_TERMS: Record<string, string[]> = {
  silk: ['silk', 'charmeuse', 'crepe de chine', 'crêpe de chine', 'habotai', 'mulberry silk', 'silk satin', 'silk twill', 'georgette', 'dupion', 'dupioni'],
  satin: ['satin', 'duchesse', 'duchess satin'],
  leather: ['leather', 'nappa', 'calfskin', 'lambskin', 'calf leather', 'lamb leather', 'patent'],
  suede: ['suede', 'nubuck'],
  wool: ['wool', 'merino', 'lambswool', 'virgin wool', 'wool blend', 'boiled wool', 'flannel', 'alpaca', 'mohair', 'yak'],
  cashmere: ['cashmere'],
  cotton: ['cotton', 'poplin', 'organic cotton', 'cotton blend', 'chambray', 'broderie anglaise', 'pique', 'piqué'],
  linen: ['linen', 'linen blend'],
  denim: ['denim', 'jean', 'jeans'],
  velvet: ['velvet', 'velour'],
  lace: ['lace', 'guipure', 'broderie'],
  sequin: ['sequin', 'sequins', 'sequinned', 'sequined', 'paillette', 'paillettes'],
  feather: ['feather', 'feathers', 'feathered', 'marabou', 'ostrich'],
  tweed: ['tweed', 'bouclé', 'boucle'],
  crochet: ['crochet', 'crocheted'],
  knit: ['knit', 'knitted', 'rib knit', 'ribbed'],
  mesh: ['mesh', 'tulle'],
  organza: ['organza'],
  chiffon: ['chiffon'],
  jersey: ['jersey'],
}

// Cloths that can share a name without contradicting each other. A word for
// one family in the NAME only counts when nothing from another family is
// named too: "Kalua Silk Yak" is a knit with silk in it, not a silk skirt
// (Chloe, 2026-10-09: "silk slip skirt" showed the MKDT knit).
const MATERIAL_GROUP: Record<string, string> = {
  silk: 'fine', satin: 'fine', lace: 'fine', velvet: 'fine', sequin: 'fine', feather: 'fine',
  wool: 'knit', cashmere: 'knit', knit: 'knit', tweed: 'knit', jersey: 'knit',
  cotton: 'woven', linen: 'woven', denim: 'woven',
  leather: 'skin', suede: 'skin',
}
function namesAnotherCloth(text: string | null | undefined, material: string): boolean {
  const group = MATERIAL_GROUP[material]
  return Object.entries(MATERIAL_TERMS).some(([family, ts]) =>
    family !== material && (MATERIAL_GROUP[family] ?? family) !== (group ?? material) && ts.some((t) => hasWord(text, t)))
}

/**
 * Does this piece count as the cloth she named? The label decides when it
 * can: a label that names this cloth holds, a label that names a cloth from
 * another family fails. Otherwise the name, unless the name itself says the
 * piece is really something else.
 */
export function hasMaterial(item: { material_primary?: string | null; product_name?: string | null }, material: string): boolean {
  const terms = MATERIAL_TERMS[material] ?? [material]
  if (terms.some((t) => hasWord(item.material_primary, t))) return true
  if (item.material_primary && namesAnotherCloth(item.material_primary, material)) return false
  if (!terms.some((t) => hasWord(item.product_name, t))) return false
  return !namesAnotherCloth(item.product_name, material)
}

// Two-word pieces, read before the single words so "slip skirt" is a SKIRT
// (and "slip" stays a descriptor she wants in the name), never a slip dress
// standing next to a skirt. A plain "slip" on its own is still a slip dress.
interface TypePhrase { types: string[]; descriptor?: string }
const TYPE_PHRASES: Record<string, TypePhrase> = {
  'slip skirt': { types: ['skirt'], descriptor: 'slip' },
  'slip dress': { types: ['slip_dress'] },
  'slip top': { types: _TOPS, descriptor: 'slip' },
  'shirt dress': { types: ['shirt_dress'] },
  'midi dress': { types: ['midi_dress'] },
  'maxi dress': { types: ['maxi_dress'] },
  'mini dress': { types: ['mini_dress'] },
  'midi skirt': { types: ['skirt'], descriptor: 'midi' },
  'maxi skirt': { types: ['skirt'], descriptor: 'maxi' },
  'mini skirt': { types: ['skirt'], descriptor: 'mini' },
  'pencil skirt': { types: ['skirt'], descriptor: 'pencil' },
  'wrap skirt': { types: ['skirt'], descriptor: 'wrap' },
  'wrap dress': { types: _DRESS, descriptor: 'wrap' },
  'wide leg trousers': { types: ['trousers'], descriptor: 'wide leg' },
  'wide leg trouser': { types: ['trousers'], descriptor: 'wide leg' },
  'wide leg pants': { types: ['trousers'], descriptor: 'wide leg' },
  'wide leg jeans': { types: ['jeans'], descriptor: 'wide leg' },
  'tank top': { types: _TOPS, descriptor: 'tank' },
  'ankle boots': { types: ['boot'], descriptor: 'ankle' },
  'ankle boot': { types: ['boot'], descriptor: 'ankle' },
  'knee high boots': { types: ['boot'], descriptor: 'knee' },
  'ballet flats': { types: ['flat'], descriptor: 'ballet' },
  'kitten heels': { types: ['heel'], descriptor: 'kitten' },
  'kitten heel': { types: ['heel'], descriptor: 'kitten' },
}

// Occasion/setting/season phrase → keywords to match against the outfit's
// occasion_tags + aesthetic label (which are human-readable free text).
const OCCASION: Record<string, string[]> = {
  work: ['work', 'office'], office: ['work', 'office'], professional: ['work', 'office'], 'work meeting': ['work', 'office'],
  wedding: ['wedding'], 'wedding guest': ['wedding'],
  date: ['date'], 'date night': ['date'], 'casual date': ['date'],
  dinner: ['dinner'], lunch: ['lunch', 'brunch'], brunch: ['brunch', 'lunch'],
  drinks: ['drinks', 'cocktail'], cocktail: ['cocktail', 'drinks'], party: ['party'],
  // NB: black tie / gala / formal are handled purely as FORMALITY (below) — no
  // outfit is tagged "black tie", so adding a tag group here only dilutes the score.
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
  professional: [3, 3], formal: [4, 5], 'black tie': [4, 5], 'black-tie': [4, 5], blacktie: [4, 5], gala: [4, 5], ball: [4, 5], dressy: [3, 4], 'white tie': [5, 5],
}

// Named OCCASIONS that imply formality / season / a tag concept all at once.
// These carry the real intent of a search: an outfit doesn't need a matching
// occasion TAG — matching the implied formality + season is enough to surface
// the right looks (e.g. "beach wedding guest" → summer, formal-ish dresses).
interface OccasionRule { groups?: string[][]; formality?: [number, number]; seasons?: string[]; time?: number }
const OCCASION_RULES: Record<string, OccasionRule> = {
  // Weddings — formal, wedding-leaning; "beach" adds summer.
  wedding: { groups: [['wedding']], formality: [3, 4] },
  'wedding guest': { groups: [['wedding']], formality: [3, 4] },
  'beach wedding': { groups: [['wedding']], formality: [3, 4], seasons: ['summer'] },
  'beach wedding guest': { groups: [['wedding']], formality: [3, 4], seasons: ['summer'] },
  'boho beach wedding guest': { groups: [['wedding']], formality: [3, 4], seasons: ['summer'] },
  'black tie wedding': { groups: [['wedding']], formality: [4, 5] },
  'summer wedding': { groups: [['wedding']], formality: [3, 4], seasons: ['summer'] },
  'mother of the bride': { groups: [['wedding']], formality: [4, 5] },
  'mother of the groom': { groups: [['wedding']], formality: [4, 5] },
  'wedding reception': { groups: [['wedding']], formality: [4, 5] },
  // Formal life events — dressy, summer-leaning.
  graduation: { formality: [3, 4], seasons: ['summer'] },
  'police graduation': { formality: [3, 4], seasons: ['summer'] },
  christening: { groups: [['christening', 'wedding']], formality: [3, 4], seasons: ['summer'] },
  communion: { groups: [['christening']], formality: [3, 4], seasons: ['summer'] },
  // Summer events / festivals — relaxed, warm-weather.
  coachella: { formality: [1, 2], seasons: ['summer'] },
  festival: { formality: [1, 2], seasons: ['summer'] },
  'boat day': { formality: [2, 3], seasons: ['summer'] },
  cruise: { formality: [2, 3], seasons: ['summer'] },
  // Sporting / social — smart daywear.
  wimbledon: { groups: [['wimbledon', 'tennis', 'garden']], formality: [3, 4], seasons: ['summer'] },
  'cricket match': { formality: [3, 4], seasons: ['summer'] },
  'race day': { groups: [['race', 'ascot', 'races']], formality: [4, 5] },
  'polo match': { formality: [3, 4], seasons: ['summer'] },
  concert: { formality: [2, 3], time: 4 },
  'airport look': { formality: [1, 2] },
  'airport outfit': { formality: [1, 2] },
}

// Time-of-day cue → value on the 1..5 axis (1 morning … 5 night).
const TIME: Record<string, number> = {
  morning: 2, daytime: 2, day: 2, brunch: 2, lunch: 2, afternoon: 3,
  evening: 4, dinner: 4, cocktail: 4, rooftop: 4, night: 5, 'date night': 4,
}

export const STOPWORDS = new Set([
  'a', 'an', 'the', 'my', 'for', 'to', 'in', 'on', 'at', 'of', 'and', 'with', 'i', 'need', 'want', 'looking', 'some', 'something',
  'outfit', 'outfits', 'look', 'wear', 'during', 'this', 'that', 'me',
  // How she asks: "what should I wear to a wedding", "find me a silk skirt please".
  'what', 'should', 'could', 'would', 'can', 'do', 'does', 'go', 'going', 'have', 'has', 'is', 'it', 'be', 'am', 'are', 'im',
  'please', 'find', 'show', 'get', 'like', 'piece', 'pieces', 'clothes', 'ideas', 'idea', 'options', 'from', 'by', 'or', 'as',
])

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

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\function normalise(raw: string): string {')
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
  /** Seasons she named or implied ("winter", "beach wedding" → summer), as
   *  their own facet so a single PIECE can be held to them, not only a look's tags. */
  seasons: string[]
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
    occasionGroups: [], seasons: [], formalityRange: null, timeOfDay: null, intentTerms: [], raw,
  }

  const consume = (phrase: string) => { text = text.replace(new RegExp(`\\b${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g'), ' ').replace(/\s+/g, ' ').trim() }
  const add = (arr: string[], vals: string[]) => { for (const v of vals) if (!arr.includes(v)) arr.push(v) }
  const addGroup = (vals: string[]) => { const k = vals.join('|'); if (!p.occasionGroups.some((g) => g.join('|') === k)) p.occasionGroups.push(vals) }

  // 1. Multi-word phrases first (longest first), across all phrase dictionaries.
  // OCCASION_RULES go first so a full occasion ("beach wedding guest") is matched
  // and consumed before its sub-phrases ("wedding guest", "beach").
  const phraseDicts: Array<[Record<string, any>, 'colour' | 'occasion' | 'setting' | 'formality' | 'time' | 'rule' | 'type']> = [
    [OCCASION_RULES, 'rule'], [TYPE_PHRASES, 'type'], [COLOUR, 'colour'], [OCCASION, 'occasion'], [SETTING, 'setting'], [FORMALITY, 'formality'], [TIME, 'time'],
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

  // 2. Known brands (multi-word aware). A label is matched the way the text
  // was normalised — lower-case, punctuation as spaces — so "J.Crew" is found
  // in "j.crew", "j crew" and "jcrew" alike, and "Isabel Marant" in either case.
  for (const b of knownBrands.slice().sort((a, c) => c.length - a.length)) {
    const key = normalise(b)
    if (key.length < 3) continue
    const compact = key.replace(/[\s-]+/g, '')
    if (new RegExp(`\\b${escapeRe(key)}\\b`).test(text)) { p.brand = b; consume(key); break }
    if (compact !== key && compact.length >= 4 && new RegExp(`\\b${escapeRe(compact)}\\b`).test(text)) { p.brand = b; consume(compact); break }
  }

  // 3. Single tokens (with fuzzy typo tolerance).
  for (const tok of text.split(' ').filter(Boolean)) {
    if (STOPWORDS.has(tok)) continue
    const c = fuzzyGet(COLOUR, tok); if (c) { add(p.colourFamilies, [c]); continue }
    const t = fuzzyGet(TYPE, tok); if (t) { add(p.itemTypes, t); continue }
    const m = fuzzyGet(MATERIAL, tok); if (m) { add(p.materials, [m]); continue }
    const rule = fuzzyGet(OCCASION_RULES, tok); if (rule) { applyRule(p, addGroup, rule); continue }
    const o = fuzzyGet(OCCASION, tok); if (o) { addGroup(o); continue }
    const s = fuzzyGet(SETTING, tok); if (s) { addGroup(s); continue }
    if (SEASON.includes(tok)) { const season = tok === 'fall' ? 'autumn' : tok; addGroup([season]); add(p.seasons, [season]); continue }
    const f = fuzzyGet(FORMALITY, tok); if (f) { p.formalityRange = mergeRange(p.formalityRange, f); continue }
    const td = fuzzyGet(TIME, tok); if (td != null) { p.timeOfDay = td; continue }
    if (tok.length > 2) p.intentTerms.push(tok) // leftover adjective → soft signal
  }
  return p
}

function applyHit(p: ParsedQuery, add: (a: string[], v: string[]) => void, addGroup: (v: string[]) => void, kind: string, val: any) {
  if (kind === 'colour') add(p.colourFamilies, [val])
  else if (kind === 'type') {
    const tp = val as TypePhrase
    add(p.itemTypes, tp.types)
    if (tp.descriptor && !p.intentTerms.includes(tp.descriptor)) p.intentTerms.push(tp.descriptor)
  }
  else if (kind === 'occasion' || kind === 'setting') addGroup(val)
  else if (kind === 'formality') p.formalityRange = mergeRange(p.formalityRange, val)
  else if (kind === 'time') p.timeOfDay = val
  else if (kind === 'rule') applyRule(p, addGroup, val as OccasionRule)
}

// Apply a named-occasion rule: its tag concepts + implied season (as a group) +
// formality range + time-of-day.
function applyRule(p: ParsedQuery, addGroup: (v: string[]) => void, rule: OccasionRule) {
  if (rule.groups) for (const g of rule.groups) addGroup(g)
  if (rule.seasons) for (const s of rule.seasons) { addGroup([s]); if (!p.seasons.includes(s)) p.seasons.push(s) }
  if (rule.formality) p.formalityRange = mergeRange(p.formalityRange, rule.formality)
  if (rule.time != null) p.timeOfDay = rule.time
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

// Formality (1 casual … 5 black-tie) inferred from the ACTUAL items, because the
// outfit-level `formality` column is unreliable (new outfits default to 3). Item
// type is the base signal; material_formality and product-name cues refine it.
// The result leans toward the dressiest piece — a gown makes a look formal even
// with flat sandals — while very casual staples pull it back down.
export const TYPE_FORMALITY: Record<string, number> = {
  't-shirt': 1, shorts: 1, sneaker: 1, jeans: 2, sandal: 2, gilet: 2, knitwear: 2, flat: 2,
  shirt: 3, blouse: 3, bodysuit: 3, skirt: 3, trousers: 3, mini_dress: 3, shirt_dress: 3,
  jacket: 3, trench: 3, coat: 3, tote: 3, crossbody: 3, shoulder_bag: 3, mule: 3, boot: 3,
  scarf: 3, hat: 3, belt: 3,
  blazer: 4, midi_dress: 4, slip_dress: 4, corset: 4, heel: 4, structured_bag: 4, cape: 4,
  clutch: 4, maxi_dress: 4,
}
const FORMAL_WORDS = ['gown', 'tuxedo', 'sequin', 'sequined', 'satin', 'silk', 'velvet', 'tulle', 'beaded', 'embellished', 'evening', 'cocktail', 'floor-length', 'floor length', 'ball', 'chiffon', 'lace', 'crystal']
const CASUAL_WORDS = ['denim', 'jersey', 'sweat', 'hoodie', 'beach', 'cargo', 'athletic', 'sport', 'flip-flop', 'fleece', 'terry']

/**
 * One piece's formality, 1 casual … 5 black tie, from what it is, what it is
 * made of and what its name says. null for a piece we cannot place.
 */
export function estimateItemFormality(it: any): number | null {
  return estimateFormality([it])
}

/** Which pieces a formality range leads with when no piece was named: a
 *  wedding or black tie search answers with dresses first, then heels and
 *  clutches, before blazers and trousers. */
export const OCCASION_LEAD_TYPES = ['maxi_dress', 'midi_dress', 'slip_dress', 'mini_dress', 'heel', 'clutch']

function estimateFormality(items: any[]): number | null {
  const vals: number[] = []
  for (const it of items) {
    let v = TYPE_FORMALITY[String(it.item_type)] ?? null
    if (typeof it.material_formality === 'number') v = v == null ? it.material_formality : (v + it.material_formality) / 2
    if (v == null) continue
    const name = String(it.product_name ?? '').toLowerCase()
    if (FORMAL_WORDS.some((w) => name.includes(w))) v = Math.min(5, v + 1)
    if (CASUAL_WORDS.some((w) => name.includes(w))) v = Math.max(1, v - 1)
    vals.push(v)
  }
  if (!vals.length) return null
  const avg = vals.reduce((a, b) => a + b, 0) / vals.length
  return (avg + Math.max(...vals)) / 2
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
  if (p.materials.length) part(0.18, items.some((it: any) => p.materials.some((m) => hasMaterial(it, m))) ? 1 : 0)
  if (p.brand) part(0.18, items.some((it: any) => hasWord(it.brand?.name, p.brand!)) ? 1 : 0)

  if (p.occasionGroups.length) {
    // Fraction of CONCEPTS matched (each group hits if any of its synonyms match).
    const matched = p.occasionGroups.filter((g) => g.some((k) => hasWord(tagBlob, k))).length
    part(0.36, matched / p.occasionGroups.length)
  }
  if (p.formalityRange) {
    const [lo, hi] = p.formalityRange
    // Prefer the item-derived estimate — the outfit column defaults to 3 and
    // doesn't discriminate. dist/2 keeps formal searches STRICT (a casual look is
    // ~0 for "black tie") while still ranking the dressiest first among fallbacks.
    const f = estimateFormality(items) ?? outfit.formality ?? 3
    const dist = f < lo ? lo - f : f > hi ? f - hi : 0
    part(0.16, Math.max(0, 1 - dist / 2))
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

  // Nothing genuinely matched → NEVER empty, but the "closest" must still be
  // ranked BY THE QUERY, not by the default feed. Sorting by scoreOutfit means a
  // "black tie" search surfaces the most formal/elevated looks first (long gowns
  // before day dresses) instead of random casual outfits from the general feed.
  // matchCount stays 0 so admin still sees the genuine content gap.
  const closest = scored.slice(0, MIN_SHOWN).map((x) => x.o)
  return { outfits: closest, relaxed: true, matchCount: 0 }
}
