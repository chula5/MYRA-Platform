// ── MYRA HOUSE STYLE CONSTITUTION ────────────────────────────────────────────
//
// Generative principles and hard constraints that apply BEFORE vector
// similarity scoring. The composer builds FROM these rules; the confidence gate
// then scores what survives. Written rules override learned statistics when the
// two conflict — a combination the model has "learned" is fine still fails if
// it breaks a hard constraint here.
//
// THE CORE PRINCIPLE
//   Every MYRA outfit = one deliberate surprise + a quiet, coherent base +
//   at least one visible echo holding it together. It should read as
//   "I wouldn't have expected that, but it works perfectly."
//   Never chaotic, never trashy, never bland.
//
// Severity model (mirrors the constitution's own language):
//   • VIOLATION — "hard constraint" / "automatic reject" / "never" / "fails
//     composition". The candidate is discarded before it is ever scored.
//   • PENALTY  — "heavy penalty" / "soft". Subtracted at the confidence gate
//     and surfaced as a reason in the standard review lane.
//
// Pure logic: no DB, no framework, fully unit-testable.

// ── Item shape ────────────────────────────────────────────────────────────────
// Decoupled from the DB row so tests and the composer can both use it.
export interface HouseItem {
  item_id: string
  slot: string
  item_type?: string | null
  product_name?: string | null
  brand_name?: string | null
  colour_family?: string | null
  colour_hex?: string | null
  colour_depth?: number | null
  pattern?: number | null
  surface?: number | null
  sheen?: number | null
  fit?: number | null
  structure?: number | null
  waist_definition?: number | null
  leg_opening?: number | null
  length?: number | null
  material_category?: string | null
  material_primary?: string | null
  material_formality?: number | null
  material_weight?: number | null
  jewellery_scale?: number | null
  jewellery_finish?: string | null
  jewellery_style?: string | null
  price?: number | string | null
  price_tier?: number | null
  // Admin flags (migration 0021)
  print_flag?: string | null      // 'tasteful' allows leopard / polka dot
  neckline?: string | null        // 'high' | 'covered' | 'crew' | 'turtleneck' | …
  is_activewear?: boolean | null
}

export interface RuleHit {
  code: string
  rule: string       // which article of the constitution
  message: string    // human-readable, shown in the review lane
  weight?: number    // penalties only
}

export interface HouseVerdict {
  pass: boolean
  violations: RuleHit[]
  penalties: RuleHit[]
  penaltyTotal: number
  statement: { itemId: string; kind: string } | null
  statementCount: number
  echoes: string[]
  textureCount: number
  hues: string[]
  scheme: ColourScheme
}

const num = (v: unknown): number | null =>
  typeof v === 'number' && !Number.isNaN(v) ? v : null

const name = (i: HouseItem) =>
  [i.brand_name, i.product_name].filter(Boolean).join(' ') || i.item_type || 'item'

const lower = (s: unknown) => String(s ?? '').toLowerCase()

// ── COLOUR ENGINE ─────────────────────────────────────────────────────────────
// Colour relationships on a wheel, not a static pair list.

export const NEUTRALS = new Set(['white', 'cream', 'black', 'grey', 'navy', 'brown', 'camel', 'beige'])

// Hue angles for the catalogue's colour families.
const HUE_ANGLE: Record<string, number> = {
  red: 0, orange: 30, yellow: 55, green: 120, blue: 220, purple: 285, pink: 330, burgundy: 350,
}

export type ColourScheme =
  | 'neutral' | 'tonal' | 'analogous' | 'complementary'
  | 'triadic' | 'tetradic' | 'exploratory' | 'discordant' | 'rainbow'

export const isNeutral = (c?: string | null) => !!c && NEUTRALS.has(lower(c))

function hueGap(a: number, b: number): number {
  const d = Math.abs(a - b) % 360
  return d > 180 ? 360 - d : d
}

// Distinct non-neutral hue families present in the outfit.
export function huesOf(items: HouseItem[]): string[] {
  const out = new Set<string>()
  for (const i of items) {
    const c = lower(i.colour_family)
    if (!c || isNeutral(c)) continue
    if (c === 'multicolour') { out.add('multicolour'); continue }
    if (HUE_ANGLE[c] != null) out.add(c)
  }
  return [...out]
}

export function classifyScheme(hues: string[]): ColourScheme {
  const real = hues.filter((h) => h !== 'multicolour')
  // multicolour behaves like a crowd of hues on its own
  if (hues.includes('multicolour') && real.length >= 2) return 'rainbow'
  if (real.length === 0) return hues.includes('multicolour') ? 'exploratory' : 'neutral'
  if (real.length === 1) return 'tonal'
  const angles = real.map((h) => HUE_ANGLE[h])
  const gaps: number[] = []
  for (let i = 0; i < angles.length; i++)
    for (let j = i + 1; j < angles.length; j++) gaps.push(hueGap(angles[i], angles[j]))
  const maxGap = Math.max(...gaps)
  const minGap = Math.min(...gaps)

  if (real.length === 2) {
    if (maxGap <= 60) return 'analogous'
    if (maxGap >= 150) return 'complementary'
    return 'discordant'
  }
  if (real.length === 3) {
    if (maxGap <= 60) return 'analogous'
    if (minGap >= 90) return 'triadic'
    return 'exploratory'
  }
  if (real.length === 4) return maxGap <= 60 ? 'analogous' : 'tetradic'
  return 'rainbow'
}

// Fuchsia is banned in every slot. Detect by name, or by a hot magenta hex.
export function isFuchsia(item: HouseItem): boolean {
  const text = `${lower(item.product_name)} ${lower(item.material_primary)}`
  if (/fuchsia|fuscia|magenta|hot pink|shocking pink/.test(text)) return true
  const hex = lower(item.colour_hex).replace('#', '')
  if (!/^[0-9a-f]{6}$/.test(hex)) return false
  const r = parseInt(hex.slice(0, 2), 16) / 255
  const g = parseInt(hex.slice(2, 4), 16) / 255
  const b = parseInt(hex.slice(4, 6), 16) / 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  const d = max - min
  if (d < 0.35) return false                       // not saturated enough
  let h = 0
  if (max === r) h = 60 * (((g - b) / d) % 6)
  else if (max === g) h = 60 * ((b - r) / d + 2)
  else h = 60 * ((r - g) / d + 4)
  if (h < 0) h += 360
  const light = (max + min) / 2
  // Hot magenta/fuchsia band, bright and saturated.
  return h >= 290 && h <= 335 && light > 0.35 && d > 0.45
}

// ── STATEMENT BUDGET ──────────────────────────────────────────────────────────
// Exactly ONE statement element: a hero piece, a bold accessory, or a colour
// pop. Everything else recedes.

export function statementKind(item: HouseItem, _hues: string[] = []): string | null {
  const js = num(item.jewellery_scale)
  if (js != null && js >= 4) return 'bold accessory'
  const pattern = num(item.pattern) ?? 1
  const surface = num(item.surface) ?? 1
  if (pattern >= 4 || surface >= 4) return 'hero piece'
  if ((num(item.sheen) ?? 1) >= 5) return 'hero piece'
  const depth = num(item.colour_depth) ?? 1
  if (!isNeutral(item.colour_family) && item.colour_family && depth >= 4) return 'colour pop'
  return null
}

// A textured/patterned surface for the texture budget (max 2, never 3).
export const isTextured = (i: HouseItem) => (num(i.surface) ?? 1) >= 3 || (num(i.pattern) ?? 1) >= 3

// ── MATERIAL PAIRING TABLE ────────────────────────────────────────────────────

export type MaterialFamily =
  | 'silk' | 'linen' | 'denim' | 'leather' | 'raffia' | 'knit' | 'tailoring'
  | 'cotton' | 'satin' | 'velvet' | 'lace' | 'technical' | 'suede' | 'other'

export function materialFamily(item: HouseItem): MaterialFamily {
  const t = `${lower(item.material_primary)} ${lower(item.material_category)} ${lower(item.product_name)}`
  if (/raffia|straw|wicker/.test(t)) return 'raffia'
  if (/suede/.test(t)) return 'suede'
  if (/leather|shearling|calfskin/.test(t)) return 'leather'
  if (/denim/.test(t)) return 'denim'
  if (/silk|charmeuse|mousseline|georgette|chiffon|crepe de chine|crêpe de chine/.test(t)) return 'silk'
  if (/satin|duchesse/.test(t)) return 'satin'
  if (/velvet/.test(t)) return 'velvet'
  if (/lace|broderie|guipure|tulle/.test(t)) return 'lace'
  if (/linen/.test(t)) return 'linen'
  if (/gabardine|grain de poudre|tailoring|worsted|twill suit/.test(t)) return 'tailoring'
  if (/knit|cashmere|merino|wool jersey|rib/.test(t)) return 'knit'
  if (/cotton|poplin|canvas/.test(t)) return 'cotton'
  if (/technical|nylon|polyester|tpu|neoprene/.test(t)) return 'technical'
  if (lower(item.material_category) === 'leather_suede') return 'leather'
  if (lower(item.material_category).includes('knit')) return 'knit'
  return 'other'
}

const pairKey = (a: MaterialFamily, b: MaterialFamily) => [a, b].sort().join('+')

// Seeded from the constitution. Grows as Chloé approves / swaps pairings.
export const APPROVED_MATERIAL_PAIRS = new Set([
  pairKey('silk', 'linen'), pairKey('silk', 'denim'), pairKey('linen', 'linen'),
  pairKey('linen', 'raffia'), pairKey('leather', 'silk'), pairKey('knit', 'tailoring'),
])
export const REJECTED_MATERIAL_PAIRS = new Set([pairKey('leather', 'raffia')])

// ── PRICE INTEGRITY ───────────────────────────────────────────────────────────

export function priceOf(item: HouseItem): number | null {
  if (typeof item.price === 'number') return Number.isNaN(item.price) ? null : item.price
  if (typeof item.price === 'string') {
    const n = parseFloat(item.price.replace(/[^0-9.]/g, ''))
    return Number.isNaN(n) ? null : n
  }
  return null
}

export const PRICE_FLOOR = 150
export const PRICE_CEILING = 1000

// ── CATEGORY BANS ─────────────────────────────────────────────────────────────

const ACTIVEWEAR_RE = /legging|sports bra|tracksuit|track pant|track top|gym |yoga|activewear|running|sweatpant|athletic|performance tight/i
const LEOPARD_RE = /leopard|cheetah|animal print|ocelot/i
const POLKA_RE = /polka/i

export const isActivewear = (i: HouseItem) =>
  i.is_activewear === true || ACTIVEWEAR_RE.test(`${i.product_name ?? ''} ${i.material_primary ?? ''}`)

export const restrictedPrint = (i: HouseItem): string | null => {
  const t = `${i.product_name ?? ''} ${i.material_primary ?? ''}`
  if (LEOPARD_RE.test(t)) return 'leopard'
  if (POLKA_RE.test(t)) return 'polka dot'
  return null
}

// ── ECHO RULE ─────────────────────────────────────────────────────────────────

export function findEchoes(items: HouseItem[]): string[] {
  const echoes: string[] = []
  const bySlot = (s: string) => items.filter((i) => i.slot === s)
  const shoe = bySlot('shoe')[0]
  const bag = bySlot('bag')[0]
  const top = bySlot('top')[0] ?? bySlot('dress')[0]

  if (shoe?.colour_family && bag?.colour_family && lower(shoe.colour_family) === lower(bag.colour_family)) {
    echoes.push(`shoes and bag both ${lower(shoe.colour_family)}`)
  }
  if (shoe?.colour_family && top?.colour_family && lower(shoe.colour_family) === lower(top.colour_family)) {
    echoes.push(`shoes pick up the ${lower(top.colour_family)} of the ${top.slot}`)
  }
  // A single colour story: at most one non-neutral hue running through the look.
  const hues = huesOf(items)
  if (hues.length <= 1) {
    echoes.push(hues.length === 1 ? `single colour story with one ${hues[0]} pop` : 'single neutral colour story')
  }
  return echoes
}

// ── SILHOUETTE BALANCE ────────────────────────────────────────────────────────

export const isVolumous = (i: HouseItem) =>
  (num(i.fit) ?? 3) >= 4 || (num(i.leg_opening) ?? 3) >= 4 || (num(i.structure) ?? 3) >= 5
export const isCounterweight = (i: HouseItem) =>
  (num(i.fit) ?? 3) <= 2 || (num(i.waist_definition) ?? 3) <= 2 || (num(i.structure) ?? 3) <= 2

// ── OCCASION NOTES ────────────────────────────────────────────────────────────

export interface OccasionGuidance {
  note: string | null
  wantsLightJacket: boolean       // wet British summer, outdoor occasions
  avoidAllWhite: boolean          // Wimbledon = polished summer daytime, not literal whites
  skewCute: boolean               // date night → dress / skirt
}

const OUTDOOR_RE = /wimbledon|garden|picnic|races|outdoor|festival|beach|park|regatta|walk/i
const DATE_RE = /date night|date/i

export function occasionGuidance(occasion?: string | null): OccasionGuidance {
  const o = lower(occasion)
  return {
    note: /wimbledon/.test(o)
      ? 'Wimbledon reads polished summer daytime — not literal tennis whites.'
      : DATE_RE.test(o)
        ? 'Date night skews cuter — dress or skirt led. Dinner can go trouser-led.'
        : OUTDOOR_RE.test(o)
          ? 'Outdoor and British: a lightweight jacket layer earns its place.'
          : null,
    wantsLightJacket: OUTDOOR_RE.test(o),
    avoidAllWhite: /wimbledon/.test(o),
    skewCute: DATE_RE.test(o),
  }
}

// ── WHOSE CONSTITUTION IS THIS? ─────────────────────────────────────────────
//
// Chloe's. Every rule below is her taste written down, not a universal fact
// about clothes, and that distinction is the whole point of the learning
// layers: a Chloe client inherits all of it, a client under another stylist
// inherits none of it. It lives in code because it started here; the catalogue
// is published so the stylist RECORD can own it, be versioned, and be compared
// against another stylist's.
//
// Global scope holds only what has no opinion — in stock, in her size, no
// duplicate slots, vector scoring, brand families.
export interface ConstitutionRule { code: string; family: string; kind: 'violation' | 'penalty' }

export const CONSTITUTION_RULES: ConstitutionRule[] = [
  { code: 'category.activewear', family: 'Category bans', kind: 'violation' },
  { code: 'category.print', family: 'Category bans', kind: 'violation' },
  { code: 'colour.fuchsia', family: 'Colour engine', kind: 'violation' },
  { code: 'colour.rainbow', family: 'Colour engine', kind: 'violation' },
  { code: 'colour.exploratory', family: 'Colour engine', kind: 'violation' },
  { code: 'colour.complementary_balanced', family: 'Colour engine', kind: 'penalty' },
  { code: 'colour.discordant', family: 'Colour engine', kind: 'penalty' },
  { code: 'colour.white_cream', family: 'Colour engine', kind: 'penalty' },
  { code: 'colour.learned_skip', family: 'Colour engine', kind: 'penalty' },
  { code: 'statement.multiple', family: 'Statement budget', kind: 'violation' },
  { code: 'statement.none', family: 'Statement budget', kind: 'violation' },
  { code: 'texture.budget', family: 'Statement budget', kind: 'violation' },
  { code: 'echo.none', family: 'Echo rule', kind: 'violation' },
  { code: 'silhouette.loose_on_loose', family: 'Silhouette balance', kind: 'violation' },
  { code: 'material.rejected', family: 'Material pairing', kind: 'violation' },
  { code: 'material.formality_gap', family: 'Material pairing', kind: 'violation' },
  { code: 'jewellery.loud_on_busy', family: 'Jewellery logic', kind: 'violation' },
  { code: 'price.spread', family: 'Price integrity', kind: 'violation' },
  { code: 'price.tier_skip', family: 'Price integrity', kind: 'violation' },
  { code: 'occasion.literal_whites', family: 'Occasion notes', kind: 'penalty' },
  { code: 'occasion.no_layer', family: 'Occasion notes', kind: 'penalty' },
  { code: 'occasion.not_cute', family: 'Occasion notes', kind: 'penalty' },
]

export const CONSTITUTION_FAMILIES = Array.from(new Set(CONSTITUTION_RULES.map((r) => r.family)))

// ── THE CONSTITUTION ──────────────────────────────────────────────────────────

export interface EvaluateOpts {
  occasion?: string | null
  /** Extra approved material pairs learned from Chloé's own decisions. */
  learnedApprovedPairs?: Set<string>
  learnedRejectedPairs?: Set<string>
  /** Soft colour pairs from the Style Brain "combinations you tend to skip". */
  softSkipPairs?: Set<string>
}

export function evaluateHouseStyle(items: HouseItem[], opts: EvaluateOpts = {}): HouseVerdict {
  const violations: RuleHit[] = []
  const penalties: RuleHit[] = []
  const hues = huesOf(items)
  const scheme = classifyScheme(hues)

  const V = (code: string, rule: string, message: string) => violations.push({ code, rule, message })
  const P = (code: string, rule: string, message: string, weight: number) =>
    penalties.push({ code, rule, message, weight })

  // ── CATEGORY BANS ───────────────────────────────────────────────────────────
  for (const i of items) {
    if (isActivewear(i)) {
      V('category.activewear', 'Category bans', `${name(i)} is gymwear — never as outerwear or streetwear`)
    }
    const print = restrictedPrint(i)
    if (print && lower(i.print_flag) !== 'tasteful') {
      V('category.print', 'Category bans', `${name(i)} is ${print} and not flagged tasteful`)
    }
  }

  // ── COLOUR ENGINE ───────────────────────────────────────────────────────────
  for (const i of items) {
    if (isFuchsia(i)) V('colour.fuchsia', 'Colour engine', `${name(i)} is fuchsia — banned in every slot`)
  }
  const realHues = hues.filter((h) => h !== 'multicolour')
  if (realHues.length > 3 || scheme === 'rainbow') {
    V('colour.rainbow', 'Colour engine', `${realHues.length} non-neutral hues — never a rainbow (max 3)`)
  }
  // Exploratory schemes are only permitted inside the ≤3 hue cap.
  if ((scheme === 'triadic' || scheme === 'tetradic') && realHues.length > 3) {
    V('colour.exploratory', 'Colour engine', `${scheme} scheme beyond the 3-hue cap`)
  }
  if (scheme === 'complementary') {
    // Allowed only when one side clearly dominates and the other is a small pop.
    const counts = new Map<string, number>()
    for (const i of items) {
      const c = lower(i.colour_family)
      if (c && !isNeutral(c) && c !== 'multicolour') counts.set(c, (counts.get(c) ?? 0) + 1)
    }
    const sorted = [...counts.values()].sort((a, b) => b - a)
    const dominant = sorted[0] ?? 0
    const secondary = sorted[1] ?? 0
    if (!(dominant > secondary && secondary === 1)) {
      P('colour.complementary_balanced', 'Colour engine',
        'complementary colours with no clear dominant side — needs one hue leading and the other as a small pop', 0.12)
    }
  }
  if (scheme === 'discordant') {
    P('colour.discordant', 'Colour engine', `${realHues.join(' + ')} sit awkwardly on the wheel — neither tonal nor complementary`, 0.1)
  }
  // SPECIAL RULE: white + cream reads off most of the time.
  const whites = items.filter((i) => lower(i.colour_family) === 'white')
  const creams = items.filter((i) => lower(i.colour_family) === 'cream')
  if (whites.length && creams.length) {
    // Only forgiven when texture clearly differentiates the two.
    const texturallyDistinct = whites.some((w) =>
      creams.some((c) => Math.abs((num(w.surface) ?? 1) - (num(c.surface) ?? 1)) >= 2 || materialFamily(w) !== materialFamily(c)),
    )
    if (!texturallyDistinct) {
      P('colour.white_cream', 'Colour engine', 'white with cream and no texture contrast — reads off', 0.2)
    } else {
      P('colour.white_cream', 'Colour engine', 'white with cream — carried only by the texture contrast', 0.06)
    }
  }
  // Learned skip-list stays SOFT (blue+brown, cream+grey can sometimes work).
  if (opts.softSkipPairs?.size) {
    const fams = items.map((i) => lower(i.colour_family)).filter(Boolean)
    for (let a = 0; a < fams.length; a++) {
      for (let b = a + 1; b < fams.length; b++) {
        const k = `colour:${[fams[a], fams[b]].sort().join('|')}`
        if (opts.softSkipPairs.has(k)) {
          P('colour.learned_skip', 'Colour engine', `${fams[a]} + ${fams[b]} is a combination you usually skip`, 0.05)
        }
      }
    }
  }

  // ── STATEMENT BUDGET ────────────────────────────────────────────────────────
  const statements = items
    .map((i) => ({ item: i, kind: statementKind(i, hues) }))
    .filter((s): s is { item: HouseItem; kind: string } => !!s.kind)
  if (statements.length > 1) {
    V('statement.multiple', 'Statement budget',
      `${statements.length} statement elements (${statements.map((s) => `${name(s.item)} — ${s.kind}`).join('; ')}) — only one may speak`)
  }
  if (statements.length === 0) {
    V('statement.none', 'Statement budget', 'no statement element — the look reads bland')
  }

  // Texture budget: max 2 textured/patterned surfaces, never 3.
  const textured = items.filter(isTextured)
  if (textured.length > 2) {
    V('texture.budget', 'Statement budget',
      `${textured.length} textured or patterned surfaces (${textured.map(name).join(', ')}) — maximum is 2`)
  }

  // ── ECHO RULE ───────────────────────────────────────────────────────────────
  const echoes = findEchoes(items)
  if (echoes.length === 0) {
    V('echo.none', 'Echo rule', 'nothing echoes across the look — no shared colour holding it together')
  }

  // ── SILHOUETTE BALANCE ──────────────────────────────────────────────────────
  const volumous = items.filter(isVolumous)
  if (volumous.length > 0 && !items.some(isCounterweight)) {
    V('silhouette.loose_on_loose', 'Silhouette balance',
      `${volumous.map(name).join(', ')} volumous with nothing fitted or cinched — falls off the body`)
  }

  // ── MATERIAL PAIRING ────────────────────────────────────────────────────────
  const statementIds = new Set(statements.map((s) => s.item.item_id))
  for (let a = 0; a < items.length; a++) {
    for (let b = a + 1; b < items.length; b++) {
      const A = items[a], B = items[b]
      const fa = materialFamily(A), fb = materialFamily(B)
      const key = pairKey(fa, fb)
      if (REJECTED_MATERIAL_PAIRS.has(key) || opts.learnedRejectedPairs?.has(key)) {
        V('material.rejected', 'Material pairing', `${fa} with ${fb} is a rejected pairing`)
        continue
      }
      if (APPROVED_MATERIAL_PAIRS.has(key) || opts.learnedApprovedPairs?.has(key)) continue
      if (fa === 'other' || fb === 'other') continue
      // Unlisted pairing → judge on formality distance.
      const da = num(A.material_formality), db = num(B.material_formality)
      if (da != null && db != null && Math.abs(da - db) > 2) {
        const exempt = statementIds.has(A.item_id) || statementIds.has(B.item_id)
        if (!exempt) {
          V('material.formality_gap', 'Material pairing',
            `${fa} and ${fb} are ${Math.abs(da - db)} apart on formality with neither as the statement`)
        }
      }
    }
  }

  // ── JEWELLERY LOGIC ─────────────────────────────────────────────────────────
  const busy = textured.length >= 2 || statements.length >= 1
  const loudJewellery = items.filter((i) => (num(i.jewellery_scale) ?? 0) >= 4)
  for (const j of loudJewellery) {
    const isNecklace = lower(j.item_type) === 'necklace'
    const coveredNeckline = items.some((i) =>
      ['high', 'covered', 'crew', 'turtleneck', 'boat'].includes(lower(i.neckline)),
    )
    const longEveningDress = items.some(
      (i) => i.slot === 'dress' && (num(i.length) ?? 0) >= 4 && (num(i.material_formality) ?? 0) >= 4,
    )
    // Approved signature move: big vintage-style gold earrings.
    const signatureEarrings =
      lower(j.item_type) === 'earrings' &&
      /gold/.test(lower(j.jewellery_finish)) &&
      ['vintage_inspired', 'artisan', 'architectural'].includes(lower(j.jewellery_style))
    const permitted =
      (isNecklace && (coveredNeckline || longEveningDress)) ||
      (signatureEarrings && textured.length <= 1)
    if (busy && !permitted) {
      V('jewellery.loud_on_busy', 'Jewellery logic',
        `${name(j)} is a statement piece on an already-busy outfit — jewellery scale is inverse to busyness`)
    }
  }

  // ── PRICE INTEGRITY ─────────────────────────────────────────────────────────
  const prices = items.map(priceOf).filter((p): p is number => p != null)
  if (prices.length >= 2) {
    const lo = Math.min(...prices), hi = Math.max(...prices)
    if (lo < PRICE_FLOOR && hi > PRICE_CEILING) {
      V('price.spread', 'Price integrity', `£${Math.round(lo)} piece beside a £${Math.round(hi)} piece`)
    }
  }
  const tiers = items.map((i) => num(i.price_tier)).filter((t): t is number => t != null)
  if (tiers.length >= 2) {
    const lo = Math.min(...tiers), hi = Math.max(...tiers)
    if (hi - lo > 1) {
      V('price.tier_skip', 'Price integrity', `brand tiers ${lo} and ${hi} in one outfit — tiers may only mix with adjacent tiers`)
    }
  }

  // ── OCCASION NOTES ──────────────────────────────────────────────────────────
  const guide = occasionGuidance(opts.occasion)
  if (guide.avoidAllWhite) {
    const allWhite = items.every((i) => ['white', 'cream'].includes(lower(i.colour_family)))
    if (allWhite) P('occasion.literal_whites', 'Occasion notes', 'Wimbledon is polished summer daytime, not literal whites', 0.1)
  }
  if (guide.wantsLightJacket) {
    const hasLayer = items.some((i) => i.slot === 'outerwear')
    if (!hasLayer) P('occasion.no_layer', 'Occasion notes', 'outdoor British occasion with no lightweight jacket layer', 0.04)
  }
  if (guide.skewCute) {
    const cute = items.some((i) => i.slot === 'dress' || lower(i.item_type) === 'skirt')
    if (!cute) P('occasion.not_cute', 'Occasion notes', 'date night usually skews dress- or skirt-led', 0.03)
  }

  const penaltyTotal = penalties.reduce((s, p) => s + (p.weight ?? 0), 0)
  return {
    pass: violations.length === 0,
    violations,
    penalties,
    penaltyTotal,
    statement: statements[0] ? { itemId: statements[0].item.item_id, kind: statements[0].kind } : null,
    statementCount: statements.length,
    echoes,
    textureCount: textured.length,
    hues,
    scheme,
  }
}

// ── REFERENCE REGISTER ────────────────────────────────────────────────────────
// The composer's generative direction — injected into AI prompts for aesthetic
// labels, occasion tagging and discovery so the written voice matches the rules.

export const REFERENCE_REGISTER = {
  mood: 'Shopping around Rue de Rivoli and Saint-Honoré — unhurried, dressed for a client lunch.',
  houses: ['Jacquemus', 'Chanel (Blazy collections)', 'Chloé (current)'],
  philosophies: [
    'a quiet base with one object doing all the work',
    'a repeatable signature motif',
    'one outfit re-accessorised across occasions',
    'deliberate tension inside a single look',
    'volume as a styling lever',
    'splurge on statements, save on basics',
    'masculine against feminine so nothing tips too far',
  ],
} as const

export function houseStyleBriefForPrompts(): string {
  return [
    `MYRA house style. Mood: ${REFERENCE_REGISTER.mood}`,
    `Permanent references: ${REFERENCE_REGISTER.houses.join(', ')}.`,
    `Styling philosophy: ${REFERENCE_REGISTER.philosophies.join('; ')}.`,
    'Every outfit is one deliberate surprise over a quiet, coherent base, with at least one visible echo holding it together — never chaotic, never trashy, never bland.',
  ].join(' ')
}

// The constitution rendered for the admin screen.
export const CONSTITUTION_ARTICLES: { title: string; rules: string[] }[] = [
  {
    title: 'Core principle',
    rules: [
      'One deliberate surprise + a quiet, coherent base + at least one visible echo.',
      'Reads as "I wouldn\'t have expected that, but it works perfectly."',
      'Never chaotic, never trashy, never bland.',
    ],
  },
  {
    title: 'Statement budget',
    rules: [
      'Exactly one statement element: hero piece, bold accessory, or colour pop.',
      'Everything else recedes — plainer texture, quieter colour, simpler shape.',
      'Maximum 2 textured or patterned surfaces. Never 3.',
    ],
  },
  {
    title: 'Echo rule',
    rules: [
      'Shoes and bag in the same colour family, or shoes matching the top, or a single colour story with one pop.',
      'Zero echoes fails composition regardless of vector score.',
    ],
  },
  {
    title: 'Silhouette balance',
    rules: [
      'Volume must be counterweighted by something fitted, structured, or cinched.',
      'Loose-on-loose with no definition is an automatic reject.',
      'Fitted top + volume bottom is the trusted default.',
    ],
  },
  {
    title: 'Material pairing',
    rules: [
      'Approved: silk+linen, silk+denim, linen+linen, linen+raffia, leather+silk, knit+tailoring.',
      'Rejected: leather+raffia.',
      'Unlisted pairs: more than 2 apart on formality only if one is the statement.',
    ],
  },
  {
    title: 'Colour engine',
    rules: [
      'Colour wheel, not a pair list — favour tonal and analogous.',
      'Complementary only with one dominant side and one small pop.',
      'Never more than 3 non-neutral hues. Never a rainbow.',
      'White + cream carries a heavy penalty unless texture clearly separates them.',
      'Fuchsia pink is banned in every slot.',
    ],
  },
  {
    title: 'Jewellery logic',
    rules: [
      'Busy outfit → minimal, dainty jewellery only. Never both loud.',
      'High or covered neckline permits a bold necklace; a long evening dress permits a long statement pendant.',
      'Big vintage-style gold earrings are an approved signature move.',
    ],
  },
  {
    title: 'Price integrity',
    rules: [
      'Never pair an item under £150 with one over £1,000.',
      'Brand tiers mix only with adjacent tiers — never skip a tier.',
    ],
  },
  {
    title: 'Category bans',
    rules: [
      'No gymwear or activewear as outerwear or streetwear, ever.',
      'Leopard and polka dot only when the item is flagged tasteful.',
      'Nothing that reads trashy — chaos fails even when every other rule passes.',
    ],
  },
  {
    title: 'Occasion notes',
    rules: [
      'Wimbledon = polished summer daytime, not literal whites.',
      'Outdoor British occasions: a share of outfits carry a lightweight jacket.',
      'Date night skews cuter; dinner can go trouser-led.',
    ],
  },
]
