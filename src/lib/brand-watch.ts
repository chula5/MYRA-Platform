// Brand Watch — scan a Shopify storefront's full catalogue via /products.json,
// map products onto the MYRA item taxonomy, score them against the house style,
// and queue new on-taste pieces as draft items for review at /admin/brand-watch.
//
// Same scan + scoring scheme as tools/brand-scanner (the standalone scratchpad
// tool); this is the in-app version the Monday cron runs.

import { createAdminClient } from '@/lib/supabase-server'
import { toGbpAmount } from '@/lib/currency'
import { classifyProductGender, type GenderRead } from '@/app/admin/ai/classify-gender'
import { classifyProductColour } from '@/app/admin/ai/classify-colour'
import {
  discoverProductUrls, fetchNewProductPages, urlHash, type ParsedProduct,
} from '@/lib/brand-watch-browser'
import { buildLearning, type DecidedRow } from '@/lib/brand-watch-learning'

// ---------------------------------------------------------------- types

export interface ScannedProduct {
  shopifyProductId: string
  handle: string
  title: string
  vendor: string
  productType: string
  tags: string[]
  url: string
  price: number | null
  publishedAt: string | null
  images: string[]
  stockStatus: 'in_stock' | 'low_stock' | 'out_of_stock'
  sizesInStock: string[]
  currency?: string | null // browser route: from JSON-LD; shopify route: inferred from domain
  // derived
  itemType: string | null
  colourFamily: string | null
  materialCategory: string | null
  materialPrimary: string | null
  score: number
  reasons: string[]
  nonFashion: boolean
  menswear: boolean
  optionColours: string[] // raw colour names from the feed, for the lexicon to learn from
}

export interface WatchedBrandRow {
  watched_brand_id: string
  brand_id: string | null
  name: string
  base_url: string
  active: boolean
  min_score: number
  last_checked_at: string | null
  last_new_count: number
  platform?: 'shopify' | 'browser'
  scan_state?: { running?: boolean; done?: number; total?: number; remaining?: number; started_at?: string } | null
}

export interface BrandCheckResult {
  name: string
  scanned: number
  newProducts: number
  queued: number
  belowScore: number
  skippedStock: number // new on-taste pieces NOT queued because low/out of stock
  suppressedByLearning: number // predicted-skip by your keep/skip history — left unseen, re-evaluated as the model evolves
  restocked: number // existing library items that went out-of-stock → back in stock
  visionColours?: number // colours read from the product image because the feed stated none
  note?: string // e.g. browser scan chunking: "350 of 812 pages this run"
  error?: string
}

/**
 * Why a scan queued nothing. The score sums three dimensions — colour (3),
 * material (2), silhouette (2) — so a feed that never states a colour caps
 * every piece at 4, so nothing can clear a min score of 5, however on-taste
 * the brand is. That's a limitation of the brand's feed, not a verdict on the
 * brand, and it should say so rather than looking like a flat rejection.
 */
function scanDiagnostic(
  fashion: ScannedProduct[],
  minScore: number,
  queued: number,
): string | undefined {
  if (queued > 0 || !fashion.length) return undefined
  // Judge on what could actually have been queued. A brand whose only
  // high-scoring pieces are sold out reads as "nothing on taste" otherwise.
  const buyable = fashion.filter((p) => p.stockStatus === 'in_stock')
  if (!buyable.length) return `nothing in stock — ${fashion.length} pieces scanned, all sold out or low`
  const top = buyable.reduce((m, p) => Math.max(m, p.score), 0)
  if (top >= minScore) return undefined
  const atTop = buyable.filter((p) => p.score === top).length
  const withColour = fashion.filter((p) => p.colourFamily).length
  const pct = Math.round((withColour / fashion.length) * 100)
  // The image pass fills most of this gap now, so a feed that still reads as
  // colourless is one where the photographs could not be read either.
  const colourCapped = withColour / fashion.length < 0.25
  const lead = colourCapped
    ? `no colour could be read on ${100 - pct}% of pieces, from the feed or the images, so in-stock scores cap at ${top}`
    : `nothing in stock scored above ${top}`
  return `${lead} — drop min score to ${top} to see ${atTop} pieces`
}

// ---------------------------------------------------------------- house style

const HOUSE_STYLE = {
  weights: { colour: 3, material: 2, silhouette: 2 },
  houseColours: ['black', 'white', 'ivory', 'cream', 'ecru', 'bone', 'off white', 'off-white', 'beige', 'taupe', 'sand', 'camel', 'tan', 'caramel', 'chocolate', 'brown', 'cognac', 'grey', 'gray', 'charcoal', 'navy', 'khaki', 'olive', 'burgundy', 'bordeaux', 'oxblood'],
  offColours: ['neon', 'fluo', 'lime', 'fuchsia', 'hot pink', 'bright pink', 'turquoise', 'rainbow', 'multicolour', 'multicolor', 'leopard', 'zebra', 'animal print', 'cow print', 'snake print', 'glitter', 'holographic', 'iridescent', 'metallic silver', 'metallic gold'],
  houseMaterials: ['leather', 'suede', 'calf', 'nappa', 'lambskin', 'nubuck', 'shearling', 'wool', 'cashmere', 'merino', 'mohair', 'silk', 'cotton', 'linen', 'poplin', 'denim'],
  offMaterials: ['sequin', 'diamante', 'rhinestone', 'pvc', 'vinyl', 'faux fur', 'marabou', 'feather', 'lurex', 'glitter'],
  houseSilhouettes: ['pointed', 'pointy', 'slingback', 'kitten heel', 'stiletto', 'ballet', 'ballerina', 'loafer', 'riding boot', 'knee boot', 'ankle boot', 'column', 'straight leg', 'wide leg', 'tailored', 'blazer', 'trench', 'slip dress', 'shirt dress', 'square toe', 'minimal', 'clean', 'structured', 'longline'],
  // 'chunky' alone punished chunky KNITS — a house staple. The penalty is
  // about footwear silhouettes, so it names them.
  offSilhouettes: ['platform', 'flatform', 'chunky sole', 'chunky sneaker', 'chunky trainer', 'chunky boot', 'chunky loafer', 'chunky sandal', 'wedge sneaker', 'extreme crop', 'cut-out', 'cut out', 'ruffle', 'bow embellished', 'ultra mini', 'micro mini'],
  // Categories that are not clothing. Matched on whole words (see NON_FASHION_RE)
  // so fashion vocabulary can't be caught by accident: "linen" is a fabric and
  // only "bed linen" is homeware, "slip" is a dress, "cupro" a fibre.
  skipCategories: [
    // accessories and care that MYRA doesn't style
    'sock', 'hair clip', 'hair claw', 'hairband', 'scrunchie', 'gift card', 'giftcard',
    'care kit', 'shoe care', 'cleaner', 'insole', 'shoelace', 'protector',
    'keyring', 'key ring', 'phone case', 'kids', 'child', 'children', 'baby',
    // beauty and fragrance
    'beauty', 'skincare', 'skin care', 'cosmetic', 'fragrance', 'perfume', 'parfum',
    'parfume', 'eau de parfum', 'eau de toilette', 'cologne', 'scent', 'diffuser',
    'body lotion', 'body oil', 'hand cream', 'soap dispenser', 'shampoo',
    'serum', 'moisturiser', 'moisturizer', 'deodorant', 'incense',
    // home
    'homeware', 'interior', 'tableware', 'vase', 'plate', 'bowl', 'mug', 'tray',
    'jug', 'carafe', 'coaster', 'napkin', 'tablecloth', 'placemat', 'cutlery',
    'bed linen', 'bedding', 'duvet', 'pillowcase', 'pillow', 'towel', 'blanket',
    'cushion', 'doormat', 'ornament', 'sculpture', 'artwork', 'poster',
    'stationery', 'notebook',
  ],
  newDays: 60,
}

// Non-fashion match: whole words with an optional plural, so 'plate' catches
// "Marble Plate" and "Plates" but 'lace' can't fire on "necklace" and 'scent'
// can't fire on "scented". Substring matching had no such protection.
const NON_FASHION_RE = new RegExp(
  '\\b(' + HOUSE_STYLE.skipCategories
    .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+'))
    .join('|') + ')(s|es)?\\b',
  'i',
)

// Gender read. "women" never trips the men pattern — the boundary before "men"
// inside "women" isn't a word boundary — and a WOMEN marker always wins, so a
// piece labelled for both stays. Season codes (MSS26, WAW25) are how some
// brands mark it. Unknown gender is treated as womenswear: a brand that says
// nothing is assumed in scope rather than silently dropped.
const WOMEN_RE = /\b(women|womens|women's|woman|femme|femmes|ladies|damen|donna|mujer|w(?:ss|aw|fw)\d{2})\b/i
const MEN_RE = /\b(men|mens|men's|man|menswear|homme|hommes|herren|uomo|hombre|m(?:ss|aw|fw)\d{2})\b/i

// ---------------------------------------------------------------- taxonomy mapping

const TYPE_RULES: Array<[RegExp, string]> = [
  [/\btrench/, 'trench'], [/\bcoat|parka|puffer/, 'coat'], [/\bblazer/, 'blazer'],
  [/\bgilet|waistcoat|\bvest\b/, 'gilet'], [/\bcape|poncho/, 'cape'],
  [/\bouterwear/, 'jacket'], // umbrella category (Munthe et al) — jacket as the safe default
  [/\bboot/, 'boot'], [/sneaker|trainer/, 'sneaker'], [/\bmule/, 'mule'],
  [/\bsandal|\bslide\b|flip.?flop/, 'sandal'],
  [/\bpump|stiletto|\bheel|slingback/, 'heel'],
  [/ballerina|ballet|mary.?jane|loafer|\bflat\b|\bflats\b/, 'flat'],
  [/\btote/, 'tote'], [/\bclutch|\bpouch/, 'clutch'], [/cross.?body/, 'crossbody'],
  [/shoulder bag/, 'shoulder_bag'], [/\bhandbag|\bbag\b|\bbags\b/, 'structured_bag'],
  [/shirt.?dress/, 'shirt_dress'], [/slip.?dress/, 'slip_dress'],
  [/maxi.?dress|\bgown/, 'maxi_dress'], [/mini.?dress/, 'mini_dress'],
  [/midi.?dress/, 'midi_dress'], [/\bdress/, 'midi_dress'],
  [/\bcorset/, 'corset'], [/bodysuit/, 'bodysuit'],
  [/t.?shirt|\btee\b/, 't-shirt'],
  [/knit|sweater|jumper|cardigan|pullover|turtleneck|roll.?neck/, 'knitwear'],
  [/\bblouse|camisole|\bcami\b|\btop\b|\btops\b|\btank\b/, 'blouse'], [/\bshirt/, 'shirt'],
  [/\bjeans|\bdenim\b/, 'jeans'], [/trouser|\bpants|chino|legging/, 'trousers'],
  [/\bshorts/, 'shorts'], [/\bskirt/, 'skirt'],
  [/\bjacket|bomber|anorak|windbreaker/, 'jacket'],
  [/\bbelt/, 'belt'], [/\bscarf|shawl|bandana/, 'scarf'],
  [/necklace|pendant|choker|\bchain\b/, 'necklace'], [/earring|ear cuff|\bhoop/, 'earrings'],
  [/bracelet|bangle|\bcuff\b/, 'bracelet'], [/brooch/, 'brooch'], [/\bring\b|\brings\b/, 'ring'],
  [/hair/, 'hair_accessory'], [/\bhat\b|beanie|\bcap\b|beret/, 'hat'],
  [/glove/, 'gloves'], [/sunglass|eyewear|glasses/, 'sunglasses'],
]


// ── COLOUR LEXICON ──────────────────────────────────────────────────────────
// Brands name colours poetically — "French toast", "Port Royale", "Skyway",
// "Rust combo" — and the plain-word rules below can't read any of them. Colour
// is 3 of the 7 available points, so an unreadable name caps a piece at 4 and
// it can never clear a min score of 5. Measured on Rabens Saloner: 101 of 302
// in-stock pieces scored ZERO, almost all of them readable by eye.
//
// Checked BEFORE the plain-word rules so specific names win. Earthy names
// (rust, terracotta, tobacco) resolve to brown rather than orange: in a
// wardrobe they sit with the browns, while orange stays coral/apricot/bright.
const COLOUR_LEXICON: Array<[RegExp, string]> = [
  // browns, rusts, earths
  [/french toast|\btoast\b|cocoa|toffee|fudge|demitasse|tannin|chipmunk|cowhide|brindle|pine bark|petrified oak|bracken|subterranean|incense|tobacco|cinnamon|hazel|acorn|pecan|umber|sepia|truffle|cacao|bison|otter|teak|walnut wood/, 'brown'],
  [/\brust\b|terracotta|burnt (?:brick|russet|sienna|ochre)|russet|paprika|henna|copper|amber|ginger|marmalade|clay|adobe|rosin|autumn/, 'brown'],
  // beiges, sands, creams
  [/sesame|doeskin|toasted coconut|oat|oatmeal|birch|parchment|alabaster|pristine|ermine|nature|natural|biscotti|warm kit|soft kit|shortbread|almond|wheat|flax|putty|greige|desert|dune|safari/, 'camel'],
  // Cream under another name — 'pearl' and 'porcelain' are house neutrals, not whites.
  [/\bpearl\b|porcelain|chalk|milk\b|coconut milk/, 'cream'],
  // greys, near-blacks
  [/phantom|falcon|shadow|thunderstorm|aluminum|aluminium|asphalt|sharkskin|cement|boulder|castlerock|bungee cord|vulcan|antracite|anthracite|pewter|gunmetal|smoke|ash\b|steel|silver birch|urban chic|rain drum|eventide|moonless|dusk(?! blue)\b|dusky/, 'grey'],
  [/india ink|total eclipse|midnight|deep well|dark sapphire|blue nights|maritime|peacoat/, 'navy'],
  // blues
  [/skyway|clear sky|regatta|brunnera|crown blue|vintage indigo|indigo|denim|chambray|cornflower|periwinkle|azure|aegean|cerulean|niagara|placid|dusk blue|forget.?me.?not|spellbound|hydrangea|(?:light|mid|dark|stone) wash/, 'blue'],
  // greens
  [/grape leaf|four leaf clover|watercress|kelp|scarab|turf green|amazon|\bsag\b|sage|moss|fern|eucalyptus|seaweed|artichoke|basil|juniper|cypress|loden|bottle green|bottiglia|sea turtle|seafoam|sea foam|foxtrot/, 'green'],
  // reds, wines
  [/port royale|cabernet|merlot|claret|sangria|rhubarb|garnet|brick red|tawny port|syrah/, 'burgundy'],
  [/cranberry|poppy red|lipstick/, 'red'],
  // pinks, purples
  [/ballet slipper|peachy|blush|powder pink|dusty rose|sweet grape|orchid|mauve|heather/, 'pink'],
  [/aubergine|eggplant|amethyst|iris\b|wisteria/, 'purple'],
  // yellows
  [/lemon icing|straw|honey|turmeric|saffron|ochre|dijon|citron/, 'yellow'],
  // brights that stay OFF-taste
  [/carrot|tangerine|papaya|marigold/, 'orange'],
]

const COLOUR_RULES: Array<[RegExp, string]> = [
  [/\bblack|onyx|noir|\bnero\b/, 'black'],
  [/off.?white|ivory|cream|ecru|\bbone\b|eggshell|vanilla/, 'cream'],
  [/\bwhite|\bblanc/, 'white'],
  [/charcoal|\bgrey|\bgray|slate|graphite/, 'grey'],
  [/\bnavy|midnight|marine/, 'navy'],
  [/camel|\btan\b|beige|taupe|\bsand\b|\bnude\b|caramel|biscuit|latte|stone/, 'camel'],
  [/chocolate|cognac|mocha|espresso|coffee|chestnut|walnut|bronze|copper|\bbrown/, 'brown'],
  [/olive|khaki|sage|forest|emerald|pistachio|\bgreen/, 'green'],
  [/burgundy|bordeaux|\bwine\b|oxblood|maroon|merlot/, 'burgundy'],
  [/scarlet|crimson|cherry|\bred\b/, 'red'],
  [/cobalt|royal blue|sky blue|light blue|\bblue\b/, 'blue'],
  [/blush|\brose\b|fuchsia|\bpink/, 'pink'],
  [/mustard|butter|\bgold\b|\byellow/, 'yellow'],
  [/\brust\b|terracotta|coral|apricot|\borange/, 'orange'],
  [/lilac|lavender|violet|\bplum\b|\bpurple/, 'purple'],
  [/multi|leopard|zebra|print|striped|check/, 'multicolour'],
]

function tagValue(tags: string[], key: string): string | null {
  const k = key.toLowerCase() + ':'
  for (const t of tags) {
    if (t.toLowerCase().startsWith(k)) return t.slice(t.indexOf(':') + 1).trim()
  }
  return null
}

function mapMaterialCategory(materialStr: string | null, hay: string, itemType: string | null): string | null {
  const m = (materialStr || hay || '').toLowerCase()
  if (/leather|suede|calf|nappa|lamb\s?skin|lambskin|nubuck|shearling|goat|patent|croc/.test(m)) return 'leather_suede'
  if (/neoprene|scuba|gore|technical|ripstop|performance/.test(m)) return 'technical'
  const knit = itemType === 'knitwear' || /knit|jersey|\brib\b|ribbed/.test(m)
  const natural = /wool|cashmere|merino|mohair|alpaca|silk|cotton|linen|viscose|lyocell|tencel|modal|hemp/.test(m)
  const synthetic = /polyester|polyamide|nylon|acrylic|elastane|spandex|pvc|vinyl/.test(m)
  if (natural && synthetic) return 'mixed'
  if (natural) return knit ? 'natural_knit' : 'natural_woven'
  if (synthetic) return knit ? 'synthetic_knit' : 'synthetic_woven'
  return null
}

// ---------------------------------------------------------------- scoring

interface CompiledTerm { t: string; re: RegExp }
function compileTerms(list: string[]): CompiledTerm[] {
  return list.map((t) => ({
    t,
    re: new RegExp('\\b' + t.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b'),
  }))
}
// Which resolved colour families are on-taste. Derived from houseColours above
// (black, ivory/cream, beige→camel, chocolate→brown, grey, navy, khaki/olive→
// green, burgundy) plus BLUE: denim and pale blue run right through the looks
// MYRA actually builds, and excluding them was hiding whole brands.
// Bright orange, pink, red, yellow, purple and multicolour stay out — earthy
// rusts resolve to brown in the lexicon, so they are not caught by that.
const HOUSE_COLOUR_FAMILIES = new Set([
  'black', 'white', 'cream', 'grey', 'navy', 'brown', 'camel', 'green', 'burgundy', 'blue',
])

const COMPILED: Array<[CompiledTerm[], CompiledTerm[], number]> = [
  [compileTerms(HOUSE_STYLE.houseColours), compileTerms(HOUSE_STYLE.offColours), HOUSE_STYLE.weights.colour],
  [compileTerms(HOUSE_STYLE.houseMaterials), compileTerms(HOUSE_STYLE.offMaterials), HOUSE_STYLE.weights.material],
  [compileTerms(HOUSE_STYLE.houseSilhouettes), compileTerms(HOUSE_STYLE.offSilhouettes), HOUSE_STYLE.weights.silhouette],
]

// ---------------------------------------------------------------- scanning

// Stock from /products.json variants (`available` boolean, size in `title` —
// no quantities). Same shape the stock sentinel and shopify sync use, but a
// single-variant piece (one-size) in stock is NOT low stock.
function stockFromVariants(variants: any[]): { stockStatus: ScannedProduct['stockStatus']; sizesInStock: string[] } {
  const vs = variants ?? []
  const available = vs.filter((v) => v?.available !== false)
  const sizesInStock = available
    .map((v) => String(v?.title ?? '').trim())
    .filter((t) => t && t.toLowerCase() !== 'default title')
  if (available.length === 0) return { stockStatus: 'out_of_stock', sizesInStock }
  if (vs.length > 2 && available.length <= 2) return { stockStatus: 'low_stock', sizesInStock }
  return { stockStatus: 'in_stock', sizesInStock }
}

/**
 * The colourway hiding in the URL slug.
 *
 * THE POSSE names 624 products "MAEVE LONG SLEEVE TOP" with no colour option,
 * no colour tag and an empty-ish description — but handles them
 * `maeve-long-sleeve-top-vintage-white`. Reading the slug is free and exact
 * where the feed says nothing.
 *
 * Only the part AFTER the slugified title counts. Matching colour words
 * anywhere in the slug reads product names as colours — OLIVIA is not olive,
 * ROSIE is not rose — and a wrong colour is worse than none, because it both
 * scores the piece and files it in the library.
 */
export function slugColourway(handle: string, title: string): string {
  const slugTokens = String(handle ?? '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
  const titleTokens = new Set(String(title ?? '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean))
  if (!slugTokens.length || !titleTokens.size) return ''
  // Everything after the LAST token the title accounts for. A plain prefix
  // test is too strict for real stores: THE POSSE titles a piece "EMMA BUTTON
  // DOWN DRESS" and handles it emma-button-down-MINI-dress-black, so the
  // colour sitting in plain sight went unread.
  let last = -1
  slugTokens.forEach((t, i) => { if (titleTokens.has(t)) last = i })
  if (last < 0) return ''
  return slugTokens.slice(last + 1).join(' ')
}

function classifyAndScore(p: {
  id: unknown; handle: string; title: string; vendor: string; product_type: string
  tags: string[]; url: string; price: number | null; published_at: string | null; images: string[]
  variants: any[]; bodyText: string; optionColours: string[]
  // Ordered category texts by authority (browser route): the source's own
  // category label first, URL path second, raw title last — so a colourway
  // called "Ballerina" can never turn a top into a ballet flat.
  categoryTiers?: string[]
}): ScannedProduct {
  const hay = [p.product_type, p.tags.join(' '), p.title].join(' ').toLowerCase()
  // Some feeds (Isabel Marant) carry no descriptive text in title/type/tags —
  // colour lives in the Color variant option and material/silhouette in the
  // description. Score against the wider haystack; keep the nonFashion check
  // and type rules on the narrow one so body prose can't misfile an item.
  const scoreHay = [hay, p.optionColours.join(' '), p.bodyText].join(' ').toLowerCase()
  const catHay = [
    tagValue(p.tags, 'category') ?? '', tagValue(p.tags, 'main category') ?? '',
    tagValue(p.tags, 'sub category') ?? '', p.product_type, p.title,
    String(p.handle ?? '').replace(/-/g, ' '), // handles carry the category on many stores
  ].join(' ').toLowerCase()

  let itemType: string | null = null
  for (const tier of p.categoryTiers ?? []) {
    const tierHay = tier.toLowerCase()
    if (!tierHay.trim()) continue
    for (const [re, t] of TYPE_RULES) { if (re.test(tierHay)) { itemType = t; break } }
    if (itemType) break
  }
  if (!itemType) for (const [re, t] of TYPE_RULES) { if (re.test(catHay)) { itemType = t; break } }
  if (!itemType) for (const [re, t] of TYPE_RULES) { if (re.test(hay)) { itemType = t; break } }

  const colTag = (tagValue(p.tags, 'color') ?? tagValue(p.tags, 'colour') ?? '').toLowerCase()
  const optCol = p.optionColours.join(' ').toLowerCase()
  const slugCol = slugColourway(p.handle, p.title)
  let colourFamily: string | null = null
  // Lexicon first — a specific marketing name beats a plain-word guess.
  const colourText = [colTag, p.optionColours.join(' '), slugCol, p.title].join(' ').toLowerCase()
  for (const [re, c] of COLOUR_LEXICON) { if (re.test(colourText)) { colourFamily = c; break } }
  if (!colourFamily) for (const [re, c] of COLOUR_RULES) { if (colTag && re.test(colTag)) { colourFamily = c; break } }
  if (!colourFamily) for (const [re, c] of COLOUR_RULES) { if (optCol && re.test(optCol)) { colourFamily = c; break } }
  if (!colourFamily) for (const [re, c] of COLOUR_RULES) { if (slugCol && re.test(slugCol)) { colourFamily = c; break } }
  if (!colourFamily) for (const [re, c] of COLOUR_RULES) { if (re.test(p.title.toLowerCase())) { colourFamily = c; break } }

  const materialPrimary = tagValue(p.tags, 'material')
  const materialCategory = mapMaterialCategory(materialPrimary, scoreHay, itemType)

  let score = 0
  const reasons: string[] = []

  // Colour is scored from the RESOLVED family, so a piece named "French toast"
  // counts as the brown it is. Raw-text matching could only ever see literal
  // colour words, which is why poetic names scored zero.
  const [, colourNeg, colourWeight] = COMPILED[0]
  const offColour = colourNeg.find((x) => x.re.test(scoreHay))
  if (offColour) {
    score -= colourWeight
    reasons.push(`−${colourWeight} ${offColour.t}`)
  } else if (colourFamily && HOUSE_COLOUR_FAMILIES.has(colourFamily)) {
    score += colourWeight
    reasons.push(`+${colourWeight} ${colourFamily}`)
  }

  for (const [pos, neg, w] of COMPILED.slice(1)) {
    const hp = pos.find((x) => x.re.test(scoreHay))
    if (hp) { score += w; reasons.push(`+${w} ${hp.t}`) }
    const hn = neg.find((x) => x.re.test(scoreHay))
    if (hn) { score -= w; reasons.push(`−${w} ${hn.t}`) }
  }

  // Read on structured fields only, and strip the machine tags first: care and
  // composition tags carry words like "Hand wash" and "Dry clean" that read as
  // product categories and were excluding real garments — every Isabel Marant
  // piece tagged care_handwash was being dropped as homeware.
  const categoryTags = p.tags.filter((t) => !/^(care|composition|__id|model|cat_shoes)_/i.test(t))
  const nonFashion = NON_FASHION_RE.test([p.product_type, categoryTags.join(' '), p.title].join(' '))
  // MYRA is womenswear only for now. Mixed-gender feeds are common (Isabel
  // Marant types 135 of its products "Men"; CMMN SWDN is menswear with a small
  // women's line), and menswear was reaching the library and even composed
  // looks. Read on structured fields only — never body copy, where a women's
  // piece can mention menswear in passing.
  const genderHay = [p.product_type, p.tags.join(' '), p.title, p.handle].join(' ').toLowerCase()
  const menswear = !WOMEN_RE.test(genderHay) && MEN_RE.test(genderHay)

  return {
    shopifyProductId: String(p.id), handle: p.handle, title: p.title, vendor: p.vendor,
    productType: p.product_type, tags: p.tags, url: p.url, price: p.price,
    publishedAt: p.published_at, images: p.images,
    ...stockFromVariants(p.variants),
    itemType, colourFamily, materialCategory, materialPrimary, score, reasons, nonFashion, menswear,
    optionColours: p.optionColours ?? [],
  }
}

// Browser-route products (sitemap + JSON-LD) into the same ScannedProduct
// shape. No structured tags — category comes from the JSON-LD category and
// the de-slugged URL path (e.g. /catalogue/dresses/robin-rosamuse.html), the
// description feeds the wider scoring haystack like a Shopify body would.
export function classifyExternalProduct(p: ParsedProduct): ScannedProduct {
  const path = (() => { try { return new URL(p.url).pathname } catch { return '' } })()
  const pathText = path.replace(/\.html?$/, '').split('/').filter(Boolean).map((s) => s.replace(/[-_]+/g, ' ')).join(' ')
  const handle = path.replace(/\.html?$/, '').split('/').filter(Boolean).pop() ?? p.url
  // JSON-LD names often carry SEO boilerplate ("ROBIN Rosamuse | Dress |
  // SESSÙN Official website") — first segment is the name, the rest is
  // category signal for the type rules.
  const titleParts = p.title.split('|').map((s) => s.trim()).filter(Boolean)
  const cleanTitle = titleParts[0] ?? p.title
  const titleExtra = titleParts.slice(1).filter((s) => !/official|website|shop online|e-?shop/i.test(s)).join(' ')
  const product = classifyAndScore({
    id: urlHash(p.url),
    handle,
    title: cleanTitle,
    vendor: '',
    product_type: [p.category, titleExtra, pathText].filter(Boolean).join(' '),
    tags: [],
    url: p.url,
    price: p.price,
    published_at: null,
    images: p.images,
    variants: [{ available: p.available, title: 'Default Title' }],
    bodyText: p.description ?? '',
    optionColours: [],
    categoryTiers: [[p.category, titleExtra].filter(Boolean).join(' '), pathText, cleanTitle],
  })
  product.currency = p.currency ?? null
  return product
}

// Domain label → provisional display name, skipping locale/storefront
// subdomains so en.munthe.com yields "Munthe", never "En". Only a placeholder
// until the first scan adopts the site's own name.
const GENERIC_SUBDOMAINS = new Set(['www', 'en', 'uk', 'us', 'eu', 'de', 'fr', 'es', 'it', 'nl', 'dk', 'se', 'no', 'shop', 'store', 'int', 'intl', 'global', 'world', 'row', 'com'])
export function provisionalNameFromUrl(base: string): string {
  const labels = new URL(base).hostname.toLowerCase().split('.')
  const label = labels.find((l) => !GENERIC_SUBDOMAINS.has(l)) ?? labels[0]
  return label.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

// After a scan we know what the brand calls itself (Shopify vendor mode, or
// JSON-LD brand / og:site_name on the browser route). If the watchlist name is
// still an auto-generated provisional, adopt the real name — and repair the
// linked brand row: rename it if it was auto-created, or re-link to an
// existing brand of that name (moving queue/item rows off the orphan).
async function adoptRealBrandName(
  admin: any, watched: WatchedBrandRow, candidate: string | null | undefined,
): Promise<{ name: string; brand_id: string | null }> {
  const current = { name: watched.name, brand_id: watched.brand_id }
  const clean = (candidate ?? '').trim()
  if (!clean || clean.toLowerCase() === watched.name.toLowerCase()) return current
  const autoNames = new Set([
    provisionalNameFromUrl(watched.base_url).toLowerCase(),
    new URL(watched.base_url).hostname.replace(/^www\./, '').split('.')[0].replace(/-/g, ' ').toLowerCase(),
  ])
  if (!autoNames.has(watched.name.toLowerCase())) return current // hand-edited — respect it

  await admin.from('watched_brand').update({ name: clean }).eq('watched_brand_id', watched.watched_brand_id)
  if (!watched.brand_id) return { name: clean, brand_id: null }

  const { data: existing } = await admin.from('brand').select('brand_id').ilike('name', clean).limit(1)
  const target = (existing ?? [])[0]
  if (target && target.brand_id !== watched.brand_id) {
    // an established brand already exists — re-link and move rows off the orphan
    await admin.from('watched_brand').update({ brand_id: target.brand_id }).eq('watched_brand_id', watched.watched_brand_id)
    await admin.from('brand_watch_queue').update({ brand_id: target.brand_id }).eq('brand_id', watched.brand_id)
    await admin.from('item').update({ brand_id: target.brand_id }).eq('brand_id', watched.brand_id)
    return { name: clean, brand_id: target.brand_id }
  }
  const { data: linked } = await admin.from('brand').select('name').eq('brand_id', watched.brand_id).single()
  if (linked && autoNames.has(String(linked.name).toLowerCase())) {
    await admin.from('brand').update({ name: clean }).eq('brand_id', watched.brand_id)
  }
  return { name: clean, brand_id: watched.brand_id }
}

function vendorMode(products: ScannedProduct[]): string | null {
  const counts = new Map<string, { n: number; name: string }>()
  for (const p of products) {
    const v = (p.vendor ?? '').trim()
    if (!v) continue
    const k = v.toLowerCase()
    const c = counts.get(k) ?? { n: 0, name: v }
    c.n++
    counts.set(k, c)
  }
  let best: { n: number; name: string } | null = null
  const all = Array.from(counts.values())
  for (const c of all) if (!best || c.n > best.n) best = c
  return best?.name ?? null
}

export function normaliseBaseUrl(url: string): string | null {
  let u = (url ?? '').trim()
  if (!u) return null
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u
  try { return new URL(u).origin } catch { return null }
}

// Fetch the whole catalogue, 250 products a page. Throws with a readable
// message when the store isn't Shopify or the feed is blocked.
export async function fetchCatalogue(baseUrl: string): Promise<ScannedProduct[]> {
  const out: ScannedProduct[] = []
  for (let page = 1; page <= 40; page++) {
    const res = await fetch(`${baseUrl}/products.json?limit=250&page=${page}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh) MYRA-BrandWatch/1.0', Accept: 'application/json' },
      cache: 'no-store',
    })
    if (!res.ok) {
      if (page === 1) throw new Error(`${baseUrl} returned HTTP ${res.status} for /products.json — not a Shopify store, or the feed is blocked`)
      break
    }
    let batch: any[]
    try { batch = (await res.json())?.products ?? [] }
    catch {
      if (page === 1) throw new Error(`${baseUrl} answered /products.json with something that isn't JSON — not Shopify, or blocked`)
      break
    }
    for (const p of batch) {
      let price: number | null = null
      for (const v of p.variants ?? []) {
        const vp = parseFloat(v.price)
        if (!isNaN(vp) && (price === null || vp < price)) price = vp
      }
      const tags: string[] = Array.isArray(p.tags) ? p.tags : String(p.tags ?? '').split(',').map((s: string) => s.trim()).filter(Boolean)
      const bodyText = String(p.body_html ?? '').replace(/<[^>]*>/g, ' ')
      const optionColours = ((p.options ?? []) as any[])
        .filter((o) => /colou?r/i.test(String(o?.name ?? '')))
        .flatMap((o) => (o?.values ?? []).map((v: unknown) => String(v)))
      out.push(classifyAndScore({
        id: p.id, handle: p.handle, title: p.title ?? '', vendor: p.vendor ?? '',
        product_type: p.product_type ?? '', tags,
        url: `${baseUrl}/products/${p.handle}`, price,
        published_at: p.published_at ?? p.created_at ?? null,
        images: (p.images ?? []).map((i: any) => i?.src).filter(Boolean).slice(0, 8),
        variants: p.variants ?? [], bodyText, optionColours,
      }))
    }
    if (batch.length < 250) break
  }
  if (!out.length) throw new Error(`no products found at ${baseUrl}/products.json`)
  return out
}

// ---------------------------------------------------------------- queueing

/**
 * Brand identity survives formatting: "By Malene Birger", "bymalenebirger" and
 * "BY MALENE BIRGER" are one brand. Auto-created brand rows have split on
 * exactly this — a domain-derived name next to a display name — and a split
 * brand BLINDS the queue dedupe, which is brand-scoped: her Adrienna blazer
 * sat in the library under one row while the scan re-queued it under the other.
 */
export function foldBrandName(name: string | null | undefined): string {
  return String(name ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '')
}

/** Every brand row that is, by folded name, the same brand. */
async function siblingBrandIds(admin: ReturnType<typeof createAdminClient>, brandId: string): Promise<string[]> {
  const { data: rows } = await (admin as any).from('brand').select('brand_id, name')
  const me = ((rows ?? []) as any[]).find((r) => r.brand_id === brandId)
  if (!me) return [brandId]
  const key = foldBrandName(me.name)
  return ((rows ?? []) as any[]).filter((r) => foldBrandName(r.name) === key).map((r) => r.brand_id)
}

async function resolveBrandId(admin: ReturnType<typeof createAdminClient>, name: string): Promise<string> {
  const clean = name.trim()
  // Fold-compare against every brand, not ilike — spacing and casing variants
  // must resolve to the same row or the library splits.
  const { data: all } = await (admin as any).from('brand').select('brand_id, name')
  const match = ((all ?? []) as any[]).find((r) => foldBrandName(r.name) === foldBrandName(clean))
  if (match) return match.brand_id
  const { data: created } = await admin
    .from('brand')
    .insert([{ name: clean, price_tier: 3, era_orientation: 3, aesthetic_output: 3, cultural_legibility: 3, creative_behaviour: 3 }] as any)
    .select('brand_id')
    .single()
  return (created as any).brand_id
}

export function urlSlug(url: string | null): string | null {
  if (!url) return null
  try {
    const seg = new URL(url).pathname.split('/').filter(Boolean).pop()
    return seg ? seg.toLowerCase() : null
  } catch { return null }
}

export function normName(name: string | null): string | null {
  if (!name) return null
  const words = name.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean).sort()
  return words.length ? words.join(' ') : null
}

// names maps a normalised product name to the colour families already owned in
// it — so a NEW colourway of an owned piece still comes through, while the same
// colourway under a differently-formatted name is caught as a duplicate.
export interface KnownKeys { pids: Set<string>; urls: Set<string>; slugs: Set<string>; names: Map<string, Set<string>> }

export function isKnown(
  k: KnownKeys,
  p: { pid?: string | null; url?: string | null; name?: string | null; colour?: string | null },
): boolean {
  if (p.pid && k.pids.has(String(p.pid))) return true
  if (p.url && k.urls.has(p.url.split('?')[0])) return true
  const slug = urlSlug(p.url ?? null)
  if (slug && k.slugs.has(slug)) return true
  const n = normName(p.name ?? null)
  if (n) {
    const colours = k.names.get(n)
    // Unknown colour on either side → assume duplicate rather than risk one.
    if (colours && (!p.colour || colours.has(p.colour) || colours.has(''))) return true
  }
  return false
}

// All dedupe keys already present for one brand, across the item library and
// the brand-watch queue (any status — skipped stays skipped).
export async function fetchKnownForBrand(
  admin: ReturnType<typeof createAdminClient>,
  brandId: string,
): Promise<KnownKeys> {
  const k: KnownKeys = { pids: new Set(), urls: new Set(), slugs: new Set(), names: new Map() }
  // A split brand (name variants across rows) must not blind the dedupe.
  const brandIds = await siblingBrandIds(admin, brandId)
  for (const table of ['item', 'brand_watch_queue']) {
    for (let from = 0; ; from += 1000) {
      const { data } = await (admin as any)
        .from(table)
        .select('shopify_product_id, retailer_url, product_name, colour_family')
        .in('brand_id', brandIds)
        .order(table === 'item' ? 'item_id' : 'queue_id')
        .range(from, from + 999)
      for (const r of data ?? []) {
        if (r.shopify_product_id != null) k.pids.add(String(r.shopify_product_id))
        if (r.retailer_url) {
          // Affiliate links carry ?cjevent=…&utm_… — the same page must match.
          k.urls.add(r.retailer_url.split('?')[0])
          const slug = urlSlug(r.retailer_url)
          if (slug) k.slugs.add(slug)
        }
        const n = normName(r.product_name)
        if (n) {
          const set = k.names.get(n) ?? new Set<string>()
          set.add(r.colour_family ?? '')
          k.names.set(n, set)
        }
      }
      if (!data || data.length < 1000) break
    }
  }
  return k
}

function isGbpStore(baseUrl: string): boolean {
  return /\.uk(\/|$)/.test(baseUrl) || /\.co\.uk/.test(baseUrl)
}

/**
 * The currency a store actually prices in. /products.json never says, so a
 * Danish store's "2200" was stored as a bare number with no currency and read
 * as £2200 in the queue — OpéraSPORT prices in DKK, where 2200 is about £250.
 *
 * Shopify's /cart.js reports the storefront's active currency; the .uk domain
 * check is the fallback, and an unknown currency stays null rather than being
 * guessed as GBP.
 */
async function detectStoreCurrency(baseUrl: string): Promise<string | null> {
  try {
    const res = await fetch(`${baseUrl}/cart.js`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh) MYRA-BrandWatch/1.0', Accept: 'application/json' },
      cache: 'no-store',
    })
    if (res.ok) {
      const cur = (await res.json())?.currency
      if (typeof cur === 'string' && /^[A-Z]{3}$/.test(cur)) return cur
    }
  } catch { /* fall through to the domain heuristic */ }
  return isGbpStore(baseUrl) ? 'GBP' : null
}

// Insert scanned products into the brand_watch_queue for review. NOT the item
// table — only a KEEP decision creates a library item; skips stay here as
// decisions so the piece never resurfaces and never touches the library.
// Dedupes against the queue (any status) and existing library items by
// shopify_product_id, then retailer_url.
async function queueProducts(
  admin: ReturnType<typeof createAdminClient>,
  watched: WatchedBrandRow,
  products: ScannedProduct[],
): Promise<number> {
  if (!products.length) return 0
  const brandId = watched.brand_id ?? (await resolveBrandId(admin, watched.name))
  if (!watched.brand_id) {
    await (admin as any).from('watched_brand').update({ brand_id: brandId } as any).eq('watched_brand_id', watched.watched_brand_id)
  }

  // Everything already known for this brand — library items (manual adds
  // included) and queue rows in any state. Matched four ways so a piece added
  // by hand from a different storefront domain still counts as "already have":
  // shopify_product_id, exact URL, the URL's product slug (colourway-precise,
  // identical across Shopify domains), and the normalised product name
  // ("TOP DOUNA" = "Douna Top" — safe because it's scoped to one brand).
  const known = await fetchKnownForBrand(admin, brandId)

  // The store's real currency, not a guess from the domain.
  const storeCurrency = await detectStoreCurrency(watched.base_url)
  const rows = products
    .filter((p) => !isKnown(known, { pid: p.shopifyProductId, url: p.url, name: p.title, colour: p.colourFamily }))
    .map((p) => ({
      watched_brand_id: watched.watched_brand_id,
      brand_id: brandId,
      shopify_product_id: p.shopifyProductId,
      shopify_handle: p.handle,
      product_name: p.title,
      retailer_url: p.url,
      image_url: p.images[0] ?? '',
      price: p.price != null ? String(p.price) : null,
      currency: p.currency ?? storeCurrency,
      // Converted at queue time so every price in the queue is comparable.
      price_gbp: toGbpAmount(p.price, p.currency ?? storeCurrency),
      item_type: p.itemType, // null = unmapped — honest in the queue; the keep flow defaults at item-creation
      colour_family: p.colourFamily,
      material_category: p.materialCategory,
      material_primary: p.materialPrimary,
      stock_status: p.stockStatus,
      stock_sizes: p.sizesInStock,
      discovery_score: p.score,
      discovered_at: new Date().toISOString(),
      admin_notes: `Brand Watch ${p.score > 0 ? '+' : ''}${p.score}${p.reasons.length ? ` (${p.reasons.join(', ')})` : ''} — score the 1–5 dimensions before READY.`,
    }))

  for (let i = 0; i < rows.length; i += 100) {
    const { error } = await (admin as any).from('brand_watch_queue').insert(rows.slice(i, i + 100) as any)
    if (error) throw new Error(`queue insert failed: ${error.message}`)
  }
  return rows.length
}

// Forget product ids so a later check treats them as new again — used for
// on-taste pieces held back for stock, including ones seen by earlier scans.
async function unmarkSeen(
  admin: ReturnType<typeof createAdminClient>,
  watchedBrandId: string,
  ids: string[],
): Promise<void> {
  for (let i = 0; i < ids.length; i += 200) {
    await (admin as any)
      .from('brand_watch_seen')
      .delete()
      .eq('watched_brand_id', watchedBrandId)
      .in('shopify_product_id', ids.slice(i, i + 200))
  }
}

async function markSeen(
  admin: ReturnType<typeof createAdminClient>,
  watchedBrandId: string,
  products: ScannedProduct[],
): Promise<void> {
  const rows = products.map((p) => ({ watched_brand_id: watchedBrandId, shopify_product_id: p.shopifyProductId }))
  for (let i = 0; i < rows.length; i += 500) {
    await (admin as any)
      .from('brand_watch_seen')
      .upsert(rows.slice(i, i + 500) as any, { onConflict: 'watched_brand_id,shopify_product_id', ignoreDuplicates: true })
  }
}

// ---------------------------------------------------------------- scan-time learning
// The same keep/skip model that re-ranks the review queue also gates what a
// scan queues: a piece the model is confident you'd skip (delta ≤ −2, 15+
// decisions) is suppressed at scan time. Suppressed pieces are NOT marked
// seen — every later scan re-evaluates them against the CURRENT model, so a
// shift in your taste lets them through. Cross-brand by design: decisions on
// one site inform scans of every other site.
async function loadLearnedSkipper(admin: any): Promise<(p: ScannedProduct, brandName: string) => boolean> {
  const rows: any[] = []
  try {
    for (let from = 0; ; from += 1000) {
      const { data, error } = await admin
        .from('brand_watch_queue')
        .select('product_name, item_type, colour_family, material_category, price, status, brand:brand_id(name)')
        .in('status', ['kept', 'skipped'])
        .order('queue_id')
        .range(from, from + 999)
      if (error) return () => false
      rows.push(...(data ?? []))
      if (!data || data.length < 1000) break
    }
  } catch { return () => false }
  const decided: DecidedRow[] = rows.map((r) => ({
    kept: r.status === 'kept',
    brandName: r.brand?.name ?? null,
    productName: r.product_name,
    itemType: r.item_type,
    colourFamily: r.colour_family,
    materialCategory: r.material_category,
    price: r.price,
  }))
  const learn = buildLearning(decided)
  return (p, brandName) => learn({
    brandName,
    productName: p.title,
    itemType: p.itemType,
    colourFamily: p.colourFamily,
    materialCategory: p.materialCategory,
    price: p.price != null ? String(p.price) : null,
  }).predictedSkip
}

// ---------------------------------------------------------------- stock refresh

// The catalogue scan carries live availability for every product, so each run
// also refreshes stock on the library items we already have for this brand
// (matched by shopify_product_id) and counts restocks: out_of_stock → back in.
// Only the stock_* fields are written — item.status transitions stay with the
// stock sentinel, which already handles oos_strikes / status_before_oos.
async function refreshBrandStock(
  admin: ReturnType<typeof createAdminClient>,
  products: ScannedProduct[],
): Promise<number> {
  const byPid = new Map(products.map((p) => [p.shopifyProductId, p]))
  const pids = Array.from(byPid.keys())
  let restocked = 0
  for (let i = 0; i < pids.length; i += 100) {
    const chunk = pids.slice(i, i + 100)
    const { data: rows } = await (admin as any)
      .from('item')
      .select('item_id, shopify_product_id, stock_status')
      .in('shopify_product_id', chunk)
    for (const r of rows ?? []) {
      const p = byPid.get(String(r.shopify_product_id))
      if (!p || r.stock_status === p.stockStatus) continue
      if (r.stock_status === 'out_of_stock' && p.stockStatus !== 'out_of_stock') restocked++
      await (admin as any)
        .from('item')
        .update({
          stock_status: p.stockStatus,
          stock_sizes: p.sizesInStock,
          stock_checked_at: new Date().toISOString(),
          available: p.stockStatus !== 'out_of_stock',
          stock_signal: 'brand_watch',
        } as any)
        .eq('item_id', r.item_id)
    }
  }
  return restocked
}

// ---------------------------------------------------------------- entry points

/**
 * What may enter the queue by stock state. In stock, obviously. LOW stock is
 * buyable right now — holding it for the restock cycle meant never seeing it.
 * And an unavailable piece PUBLISHED in the last 60 days reads as COMING SOON
 * on a live storefront — the most valuable moment to see it (the Goldie boots
 * scored a perfect 7 and were silently held for being pre-launch). Only old
 * unavailable stock stays held for restock. The queue card badges the state.
 */
function queueableStock(p: ScannedProduct): boolean {
  if (p.stockStatus === 'in_stock' || p.stockStatus === 'low_stock') return true
  return isRecent(p, HOUSE_STYLE.newDays)
}

function isRecent(p: ScannedProduct, days: number): boolean {
  if (!p.publishedAt) return false
  return Date.now() - Date.parse(p.publishedAt) < days * 86_400_000
}

// Add a brand: scan, queue only the last 60 days of on-taste pieces (so a
// 2,000-product back catalogue doesn't land at once), mark everything seen.
export async function baselineBrand(watched: WatchedBrandRow): Promise<BrandCheckResult> {
  if (watched.platform === 'browser') return browserScanAndQueue(watched, 'watch')
  return scanAndQueue(watched, (p) => p.score >= watched.min_score && isRecent(p, HOUSE_STYLE.newDays))
}

// Onboard a brand: queue every on-taste piece in the catalogue regardless of
// publish date. The threshold is the brand's min_score — lower it and run
// again to pull in the next band down (already-queued pieces are deduped).
export async function onboardBrand(watched: WatchedBrandRow): Promise<BrandCheckResult> {
  if (watched.platform === 'browser') return browserScanAndQueue(watched, 'scan')
  return scanAndQueue(watched, (p) => p.score >= watched.min_score)
}

/**
 * Record colour names the lexicon couldn't read. Never throws and never blocks
 * a scan — this turns "some pieces score low" into a ranked list of exactly
 * which names to teach it next.
 */
async function logUnresolvedColours(
  admin: ReturnType<typeof createAdminClient>,
  brandName: string,
  products: ScannedProduct[],
): Promise<void> {
  try {
    const counts = new Map<string, { n: number; sample: string }>()
    for (const p of products) {
      if (p.colourFamily) continue
      for (const raw of p.optionColours ?? []) {
        const name = String(raw).trim()
        if (!name || name.length > 40) continue
        const cur = counts.get(name) ?? { n: 0, sample: p.title }
        cur.n++
        counts.set(name, cur)
      }
    }
    if (!counts.size) return
    const names = Array.from(counts.keys())
    const { data: existing } = await (admin as any)
      .from('unresolved_colour').select('name, seen_count, brands').in('name', names)
    const prev = new Map(((existing ?? []) as any[]).map((r) => [r.name, r]))
    const rows = Array.from(counts.entries()).map(([name, info]) => {
      const before = prev.get(name) as any
      return {
        name,
        seen_count: (before?.seen_count ?? 0) + info.n,
        brands: Array.from(new Set([...(before?.brands ?? []), brandName])),
        sample_product: info.sample,
        last_seen: new Date().toISOString(),
      }
    })
    for (let i = 0; i < rows.length; i += 100) {
      await (admin as any).from('unresolved_colour').upsert(rows.slice(i, i + 100), { onConflict: 'name' })
    }
  } catch (err) {
    console.error('[logUnresolvedColours]', err)
  }
}

async function scanAndQueue(
  watchedIn: WatchedBrandRow,
  wanted: (p: ScannedProduct) => boolean,
): Promise<BrandCheckResult> {
  const admin = createAdminClient()
  const products = await fetchCatalogue(watchedIn.base_url)
  const adopted = await adoptRealBrandName(admin as any, watchedIn, vendorMode(products))
  const watched = { ...watchedIn, ...adopted }
  const visionColours = await applyVisionColour(products, watched.min_score)
  const fashion = products.filter((p) => !p.nonFashion && !p.menswear)
  const onTaste = fashion.filter(wanted)
  // Low or out of stock isn't worth adding — it gets another chance on a
  // later check if it restocks (queueing only marks items, not seen state).
  const inStock = onTaste.filter((p) => queueableStock(p))
  const shouldSuppress = await loadLearnedSkipper(admin as any)
  // The learned skipper may thin the queue, but it may not VETO the house
  // style: scan-time suppression removes a piece invisibly (unlike the queue's
  // predicted-skip toggle, which only hides), and it was swallowing 7-score
  // pieces on generic tokens — 'wide' and 'light' learned negative from bag
  // skips took out a wide-leg jean. Anything two points clear of the brand's
  // min score always queues; the queue-time learning can still fold it away.
  const vetoed = (p: ScannedProduct) => shouldSuppress(p, watched.name) && p.score < watched.min_score + 2
  const candidates = inStock.filter((p) => !vetoed(p))
  const suppressed = new Set(inStock.filter((p) => vetoed(p)).map((p) => p.shopifyProductId))
  const queued = await queueProducts(admin, watched, candidates)
  await logUnresolvedColours(admin, watched.name, fashion)
  const restocked = await refreshBrandStock(admin, products)
  // Stock-held and learning-suppressed pieces are NOT marked seen — later
  // scans re-evaluate them (restock lets one through; a taste shift lets the
  // other through).
  const stockHeld = new Set(
    fashion.filter((p) => p.score >= watched.min_score && p.stockStatus !== 'in_stock').map((p) => p.shopifyProductId),
  )
  const held = new Set([...Array.from(stockHeld), ...Array.from(suppressed)])
  await unmarkSeen(admin, watched.watched_brand_id, Array.from(held))
  await markSeen(admin, watched.watched_brand_id, products.filter((p) => !held.has(p.shopifyProductId)))
  await (admin as any)
    .from('watched_brand')
    .update({ last_checked_at: new Date().toISOString(), last_new_count: queued } as any)
    .eq('watched_brand_id', watched.watched_brand_id)
  return {
    name: watched.name, scanned: products.length, newProducts: onTaste.length,
    queued, belowScore: fashion.length - onTaste.length,
    skippedStock: stockHeld.size, suppressedByLearning: suppressed.size, restocked, visionColours,
    note: scanDiagnostic(fashion, watched.min_score, queued),
  }
}

// ── browser route (non-Shopify stores) ──────────────────────────────────────
// Sitemap discovery + per-page JSON-LD, in resumable chunks. Progress lives in
// watched_brand.scan_state — the scan runs server-side to completion whether
// or not the admin page stays open, and a re-run continues where it stopped
// because every evaluated page is in brand_watch_seen.
// mode 'watch': baseline only — mark every discovered product URL seen, queue
// nothing (no publish dates exist off-Shopify, so "last 60 days" has no
// meaning; new drops queue from the next check onward).
// mode 'scan': fetch unseen pages, queue on-taste in-stock pieces.
// ── colour from the image ───────────────────────────────────────────────────

const VISION_COLOUR_CAP = 600

/**
 * Read the colour off the photograph for pieces whose feed never states one.
 *
 * Colour is 3 of the 7 house-style points, so an unreadable colour caps a
 * piece at 4 and it can never clear a min score of 5 — a whole brand reads as
 * off-taste when in truth its feed is just quiet. THE POSSE scanned 624
 * products and queued nothing for exactly this reason.
 *
 * Only pieces where the colour would actually change the verdict are worth a
 * call, so the gate is tight: no colour from any text, womenswear, in stock,
 * and within reach of the brand's min score. A piece already carrying the
 * off-colour penalty is left alone — the feed did state a colour there, and it
 * was a loud one.
 */
async function applyVisionColour(products: ScannedProduct[], minScore: number): Promise<number> {
  const w = HOUSE_STYLE.weights.colour
  const candidates = products.filter((p) =>
    !p.colourFamily &&
    !p.nonFashion && !p.menswear &&
    !!p.images[0] &&
    queueableStock(p) &&
    p.score + w >= minScore &&
    !p.reasons.some((r) => r.startsWith(`−${w} `)),
  )
  if (!candidates.length) return 0
  const capped = candidates.slice(0, VISION_COLOUR_CAP)

  const admin = createAdminClient() as any
  const cache = await loadColourReads(admin, capped.map((p) => p.images[0]))
  const fresh: Array<{ image_url: string; colour_family: string | null }> = []

  const CONC = 6
  for (let i = 0; i < capped.length; i += CONC) {
    const chunk = capped.slice(i, i + CONC)
    const reads = await Promise.all(chunk.map(async (p) => {
      const url = p.images[0]
      if (cache.has(url)) return cache.get(url) ?? null
      const { colour, error } = await classifyProductColour(url)
      // Cache a genuine "cannot tell" so a broken image is not paid for twice,
      // but NEVER cache an outage: an API with no credit left would otherwise
      // poison every image it touched during the outage, permanently.
      const transient = error && /credit|rate.?limit|overloaded|timeout|429|5\d\d/i.test(error)
      if (!transient) fresh.push({ image_url: url, colour_family: colour })
      return colour
    }))
    reads.forEach((colour, j) => {
      if (!colour) return
      const p = chunk[j]
      p.colourFamily = colour
      if (HOUSE_COLOUR_FAMILIES.has(colour)) {
        p.score += w
        p.reasons.push(`+${w} ${colour} (from image)`)
      }
    })
  }

  await saveColourReads(admin, fresh)
  return capped.filter((p) => p.colourFamily).length
}

/** Colours already read from these images on an earlier scan. */
async function loadColourReads(admin: any, urls: string[]): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>()
  const unique = Array.from(new Set(urls.filter(Boolean)))
  for (let i = 0; i < unique.length; i += 200) {
    try {
      const { data } = await admin
        .from('brand_watch_colour_read').select('image_url, colour_family')
        .in('image_url', unique.slice(i, i + 200))
      for (const r of data ?? []) out.set(String(r.image_url), r.colour_family ?? null)
    } catch { /* an unavailable cache costs money, not correctness */ }
  }
  return out
}

async function saveColourReads(admin: any, rows: Array<{ image_url: string; colour_family: string | null }>): Promise<void> {
  for (let i = 0; i < rows.length; i += 200) {
    try {
      await admin.from('brand_watch_colour_read')
        .upsert(rows.slice(i, i + 200), { onConflict: 'image_url' })
    } catch { /* same — never fail a scan over the cache */ }
  }
}

/**
 * MYRA is womenswear only, and most feeds say the gender in a product type,
 * tag or URL path — read for free in classifyAndScore. Some sites say it
 * NOWHERE: Adolfo Domínguez publishes flat URLs, numeric category codes and a
 * JS-rendered women's section, and 168 men's pieces reached the queue because
 * "no signal" was treated as womenswear.
 *
 * For those, the product image is the only evidence. One cheap vision call per
 * otherwise-unknowable product, and only when the brand shows no textual gender
 * signal at all — a feed that labels its women's pieces never pays for this.
 */
async function applyVisionGender(products: ScannedProduct[]): Promise<number> {
  const anySignal = products.some((p) => p.menswear) ||
    products.some((p) => WOMEN_RE.test([p.productType, p.tags.join(' '), p.title, p.handle].join(' ')))
  if (anySignal) return 0

  // On a site that states gender NOWHERE, only a positive women's read gets
  // through. Excluding the confirmed men's reads was not enough: a flat-lay
  // trench or a cropped shot returns "unclear", and Adolfo Domínguez's queue
  // filled with menswear again. MYRA is womenswear only — an item nobody can
  // confirm as women's is not worth showing, and a brand that labels its
  // sections never reaches this code at all.
  // Read everything first, decide afterwards. "Not confirmed women's" only
  // means menswear when the reader was actually working — and when it is not,
  // this rule excludes an ENTIRE catalogue. Bimba y Lola scanned 350 pages and
  // queued nothing because the API was out of credit and every call came back
  // as an error, which this then read as 350 men's products.
  const verdicts: Array<{ gender: GenderRead; error?: string }> = []
  const CONC = 6
  for (let i = 0; i < products.length; i += CONC) {
    const chunk = products.slice(i, i + CONC)
    verdicts.push(...await Promise.all(chunk.map((p) =>
      p.images[0] ? classifyProductGender(p.images[0]) : Promise.resolve({ gender: 'unclear' as const, error: 'no image' }))))
  }

  // Infrastructure failures — no credit, no key, a timeout — are not evidence
  // about a garment. If the pass is broadly broken, it gets no vote at all.
  const infraFailed = verdicts.filter((v) => v.error && !/no image/i.test(v.error)).length
  if (verdicts.length && infraFailed / verdicts.length > 0.25) {
    throw new Error(
      `womenswear check could not run — ${infraFailed} of ${verdicts.length} image reads failed ` +
      `(${verdicts.find((v) => v.error)?.error ?? 'unknown'}). Nothing was queued rather than guessing at gender.`,
    )
  }

  let excluded = 0
  verdicts.forEach((r, j) => {
    if (r.gender !== 'women') { products[j].menswear = true; excluded++ }
  })
  return excluded
}

async function browserScanAndQueue(watchedRow: WatchedBrandRow, mode: 'watch' | 'scan'): Promise<BrandCheckResult> {
  const admin = createAdminClient() as any
  const writeState = (state: unknown) =>
    admin.from('watched_brand').update({ scan_state: state }).eq('watched_brand_id', watchedRow.watched_brand_id)
  const markHashes = async (hashes: string[]) => {
    const rows = hashes.map((h) => ({ watched_brand_id: watchedRow.watched_brand_id, shopify_product_id: h }))
    for (let i = 0; i < rows.length; i += 500) {
      await admin.from('brand_watch_seen').upsert(rows.slice(i, i + 500), { onConflict: 'watched_brand_id,shopify_product_id', ignoreDuplicates: true })
    }
  }
  const stamp = () =>
    admin.from('watched_brand')
      .update({ last_checked_at: new Date().toISOString() })
      .eq('watched_brand_id', watchedRow.watched_brand_id)

  if (mode === 'watch') {
    const urls = await discoverProductUrls(watchedRow.base_url)
    await markHashes(urls.map(urlHash))
    await stamp()
    return {
      name: watchedRow.name, scanned: urls.length, newProducts: 0, queued: 0,
      belowScore: 0, skippedStock: 0, suppressedByLearning: 0, restocked: 0,
      note: `${urls.length} product pages baselined — watching from now (browser route)`,
    }
  }

  const seen = new Set<string>()
  for (let from = 0; ; from += 1000) {
    const { data } = await admin.from('brand_watch_seen').select('shopify_product_id')
      .eq('watched_brand_id', watchedRow.watched_brand_id).order('shopify_product_id').range(from, from + 999)
    for (const r of data ?? []) seen.add(String(r.shopify_product_id))
    if (!data || data.length < 1000) break
  }

  const startedAt = new Date().toISOString()
  await writeState({ running: true, done: 0, total: null, started_at: startedAt })
  try {
    const res = await fetchNewProductPages(watchedRow.base_url, seen, {
      onProgress: (done, total) => writeState({ running: true, done, total, started_at: startedAt }),
    })
    const brandNames = res.parsed.map((p) => p.brand).filter(Boolean) as string[]
    const adopted = await adoptRealBrandName(admin, watchedRow, brandNames.length ? vendorMode(brandNames.map((v) => ({ vendor: v } as ScannedProduct))) : null)
    const watched = { ...watchedRow, ...adopted }
    const products = res.parsed.map(classifyExternalProduct)
    // Sites with no textual gender signal get one vision call per product.
    await applyVisionGender(products)
    const visionColours = await applyVisionColour(products, watched.min_score)
    const fashion = products.filter((p) => !p.nonFashion && !p.menswear)
    const onTaste = fashion.filter((p) => p.score >= watched.min_score)
    const inStock = onTaste.filter((p) => queueableStock(p))
    const shouldSuppress = await loadLearnedSkipper(admin)
    // The learned skipper may thin the queue, but it may not VETO the house
  // style: scan-time suppression removes a piece invisibly (unlike the queue's
  // predicted-skip toggle, which only hides), and it was swallowing 7-score
  // pieces on generic tokens — 'wide' and 'light' learned negative from bag
  // skips took out a wide-leg jean. Anything two points clear of the brand's
  // min score always queues; the queue-time learning can still fold it away.
  const vetoed = (p: ScannedProduct) => shouldSuppress(p, watched.name) && p.score < watched.min_score + 2
  const candidates = inStock.filter((p) => !vetoed(p))
    const suppressed = new Set(inStock.filter((p) => vetoed(p)).map((p) => p.shopifyProductId))
    const queued = await queueProducts(admin, watched, candidates)
    const restocked = await refreshBrandStock(admin, products)
    // stock-held and learning-suppressed pieces stay unseen — restocks and
    // taste shifts both get another chance on later scans
    const stockHeld = new Set(onTaste.filter((p) => !queueableStock(p)).map((p) => p.shopifyProductId))
    const held = new Set([...Array.from(stockHeld), ...Array.from(suppressed)])
    await markHashes(res.processedUrls.map(urlHash).filter((h) => !held.has(h)))
    await admin.from('watched_brand')
      .update({
        last_checked_at: new Date().toISOString(),
        last_new_count: queued,
        scan_state: res.remaining > 0 ? { remaining: res.remaining } : null,
      })
      .eq('watched_brand_id', watched.watched_brand_id)
    return {
      name: watched.name, scanned: res.discovered, newProducts: onTaste.length, queued,
      belowScore: fashion.length - onTaste.length, skippedStock: stockHeld.size,
      suppressedByLearning: suppressed.size, restocked, visionColours,
      note: res.remaining > 0
        ? `${res.processedUrls.length} pages this run, ${res.remaining} remaining — run FULL SCAN again to continue`
        : undefined,
    }
  } catch (e) {
    await writeState(null)
    throw e
  }
}

// Weekly check: anything not in brand_watch_seen is new. On-taste new pieces
// are queued as drafts; everything is marked seen either way.
export async function checkWatchedBrand(watchedIn: WatchedBrandRow): Promise<BrandCheckResult> {
  if (watchedIn.platform === 'browser') return browserScanAndQueue(watchedIn, 'scan')
  const admin = createAdminClient()
  const products = await fetchCatalogue(watchedIn.base_url)
  const adopted = await adoptRealBrandName(admin as any, watchedIn, vendorMode(products))
  const watched = { ...watchedIn, ...adopted }

  // Page through the seen ids — PostgREST caps a single response at 1,000 rows,
  // and a full catalogue is easily double that.
  const seen = new Set<string>()
  for (let from = 0; ; from += 1000) {
    const { data: seenRows } = await (admin as any)
      .from('brand_watch_seen')
      .select('shopify_product_id')
      .eq('watched_brand_id', watched.watched_brand_id)
      .order('shopify_product_id')
      .range(from, from + 999)
    for (const r of seenRows ?? []) seen.add(String(r.shopify_product_id))
    if (!seenRows || seenRows.length < 1000) break
  }

  const fresh = products.filter((p) => !seen.has(p.shopifyProductId))
  // Only the new pieces are worth a vision call on a weekly check.
  const visionColours = await applyVisionColour(fresh, watched.min_score)
  const onTaste = fresh.filter((p) => !p.nonFashion && !p.menswear && p.score >= watched.min_score)
  // Low or out of stock isn't worth adding — and it is NOT marked seen, so a
  // later check queues it the moment it restocks. Stock-held is computed over
  // the WHOLE catalogue (not just unseen products) so pieces marked seen by
  // earlier scans are released from the seen list too.
  const inStock = onTaste.filter((p) => queueableStock(p))
  const shouldSuppress = await loadLearnedSkipper(admin as any)
  // The learned skipper may thin the queue, but it may not VETO the house
  // style: scan-time suppression removes a piece invisibly (unlike the queue's
  // predicted-skip toggle, which only hides), and it was swallowing 7-score
  // pieces on generic tokens — 'wide' and 'light' learned negative from bag
  // skips took out a wide-leg jean. Anything two points clear of the brand's
  // min score always queues; the queue-time learning can still fold it away.
  const vetoed = (p: ScannedProduct) => shouldSuppress(p, watched.name) && p.score < watched.min_score + 2
  const candidates = inStock.filter((p) => !vetoed(p))
  const suppressed = new Set(inStock.filter((p) => vetoed(p)).map((p) => p.shopifyProductId))
  const queued = await queueProducts(admin, watched, candidates)
  const restocked = await refreshBrandStock(admin, products)
  const stockHeld = new Set(
    products
      .filter((p) => !p.nonFashion && !p.menswear && p.score >= watched.min_score && !queueableStock(p))
      .map((p) => p.shopifyProductId),
  )
  const held = new Set([...Array.from(stockHeld), ...Array.from(suppressed)])
  await unmarkSeen(admin, watched.watched_brand_id, Array.from(held))
  await markSeen(admin, watched.watched_brand_id, products.filter((p) => !held.has(p.shopifyProductId)))
  await (admin as any)
    .from('watched_brand')
    .update({ last_checked_at: new Date().toISOString(), last_new_count: queued } as any)
    .eq('watched_brand_id', watched.watched_brand_id)

  return {
    name: watched.name, scanned: products.length, newProducts: fresh.length,
    queued, belowScore: fresh.length - onTaste.length,
    skippedStock: stockHeld.size, suppressedByLearning: suppressed.size, restocked, visionColours,
    note: scanDiagnostic(products.filter((p) => !p.nonFashion && !p.menswear), watched.min_score, queued),
  }
}

// Run the whole watchlist (the Monday cron, and RUN CHECK NOW in admin).
export async function runBrandWatch(): Promise<BrandCheckResult[]> {
  const admin = createAdminClient()
  const { data } = await (admin as any)
    .from('watched_brand')
    .select('*')
    .eq('active', true)
    .order('name')
  const results: BrandCheckResult[] = []
  for (const w of (data ?? []) as unknown as WatchedBrandRow[]) {
    try {
      results.push(await checkWatchedBrand(w))
    } catch (e) {
      results.push({ name: w.name, scanned: 0, newProducts: 0, queued: 0, belowScore: 0, skippedStock: 0, suppressedByLearning: 0, restocked: 0, error: e instanceof Error ? e.message : String(e) })
    }
  }
  return results
}
