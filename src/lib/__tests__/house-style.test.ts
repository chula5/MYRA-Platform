import { describe, it, expect } from 'vitest'
import {
  evaluateHouseStyle,
  classifyScheme,
  huesOf,
  isFuchsia,
  materialFamily,
  findEchoes,
  occasionGuidance,
  statementKind,
  type HouseItem,
} from '@/lib/house-style'

// A quiet, coherent, constitution-passing base: black silk top (statement via
// sheen is avoided), fitted; wide linen trouser; black leather shoe; black bag.
const item = (over: Partial<HouseItem> & { item_id: string; slot: string }): HouseItem => ({
  item_type: 'blouse',
  product_name: 'Test piece',
  colour_family: 'black',
  colour_depth: 1,
  pattern: 1,
  surface: 1,
  sheen: 1,
  fit: 3,
  structure: 3,
  waist_definition: 3,
  material_primary: 'silk',
  material_formality: 3,
  price: 400,
  price_tier: 3,
  ...over,
})

// Passes every article: one statement (patterned top), an echo (shoes + bag
// black), a counterweight (fitted top), coherent materials and tiers.
const goodOutfit = (): HouseItem[] => [
  item({ item_id: 'top', slot: 'top', pattern: 4, fit: 2, material_primary: 'silk' }),
  item({ item_id: 'bot', slot: 'bottom', item_type: 'trousers', material_primary: 'linen', fit: 4, leg_opening: 4 }),
  item({ item_id: 'sho', slot: 'shoe', item_type: 'heel', material_primary: 'leather' }),
  item({ item_id: 'bag', slot: 'bag', item_type: 'tote', material_primary: 'leather' }),
]

describe('the constitution passes a correct outfit', () => {
  it('accepts one statement over a quiet base with an echo', () => {
    const v = evaluateHouseStyle(goodOutfit())
    expect(v.violations.map((x) => x.code)).toEqual([])
    expect(v.pass).toBe(true)
    expect(v.statementCount).toBe(1)
    expect(v.echoes.length).toBeGreaterThan(0)
  })
})

describe('statement budget', () => {
  it('rejects two statement elements', () => {
    const items = goodOutfit()
    items[1] = { ...items[1], pattern: 5 } // second hero piece
    const v = evaluateHouseStyle(items)
    expect(v.pass).toBe(false)
    expect(v.violations.some((x) => x.code === 'statement.multiple')).toBe(true)
  })
  it('rejects a bland outfit with no statement at all', () => {
    const items = goodOutfit().map((i) => ({ ...i, pattern: 1, surface: 1 }))
    const v = evaluateHouseStyle(items)
    expect(v.violations.some((x) => x.code === 'statement.none')).toBe(true)
  })
  it('counts bold accessories and colour pops as statements', () => {
    expect(statementKind(item({ item_id: 'j', slot: 'jewellery', jewellery_scale: 5 }))).toBe('bold accessory')
    expect(statementKind(item({ item_id: 'c', slot: 'bag', colour_family: 'red', colour_depth: 5 }))).toBe('colour pop')
    expect(statementKind(item({ item_id: 'q', slot: 'top' }))).toBeNull()
  })
  it('rejects three textured surfaces', () => {
    const items = goodOutfit().map((i) => ({ ...i, surface: 3 }))
    const v = evaluateHouseStyle(items)
    expect(v.violations.some((x) => x.code === 'texture.budget')).toBe(true)
  })
})

describe('echo rule', () => {
  it('finds shoes+bag, shoes+top and single-colour-story echoes', () => {
    expect(findEchoes([
      item({ item_id: 's', slot: 'shoe', colour_family: 'brown' }),
      item({ item_id: 'b', slot: 'bag', colour_family: 'brown' }),
    ]).join()).toMatch(/shoes and bag both brown/)
    expect(findEchoes([
      item({ item_id: 't', slot: 'top', colour_family: 'green' }),
      item({ item_id: 's', slot: 'shoe', colour_family: 'green' }),
    ]).join()).toMatch(/shoes pick up the green/)
  })
  it('fails an outfit with no echo at all', () => {
    const items = [
      item({ item_id: 'top', slot: 'top', colour_family: 'green', pattern: 4, fit: 2 }),
      item({ item_id: 'bot', slot: 'bottom', colour_family: 'blue', material_primary: 'denim' }),
      item({ item_id: 'sho', slot: 'shoe', colour_family: 'red', material_primary: 'leather' }),
      item({ item_id: 'bag', slot: 'bag', colour_family: 'yellow', material_primary: 'leather' }),
    ]
    const v = evaluateHouseStyle(items)
    expect(v.violations.some((x) => x.code === 'echo.none')).toBe(true)
  })
})

describe('silhouette balance', () => {
  it('rejects loose-on-loose with no definition', () => {
    const items = goodOutfit().map((i) => ({ ...i, fit: 5, waist_definition: 5, structure: 4 }))
    const v = evaluateHouseStyle(items)
    expect(v.violations.some((x) => x.code === 'silhouette.loose_on_loose')).toBe(true)
  })
  it('accepts volume when something is fitted', () => {
    const v = evaluateHouseStyle(goodOutfit()) // wide linen trouser + fitted top
    expect(v.violations.some((x) => x.code === 'silhouette.loose_on_loose')).toBe(false)
  })
})

describe('material pairing', () => {
  it('identifies material families from free text', () => {
    expect(materialFamily(item({ item_id: 'x', slot: 'bag', material_primary: 'Woven raffia' }))).toBe('raffia')
    expect(materialFamily(item({ item_id: 'x', slot: 'top', material_primary: 'silk crêpe de chine' }))).toBe('silk')
    expect(materialFamily(item({ item_id: 'x', slot: 'bottom', material_primary: 'wool gabardine' }))).toBe('tailoring')
  })
  it('rejects leather + raffia', () => {
    const items = goodOutfit()
    items[3] = { ...items[3], material_primary: 'raffia' }
    const v = evaluateHouseStyle(items)
    expect(v.violations.some((x) => x.code === 'material.rejected')).toBe(true)
  })
  it('rejects an unlisted pairing more than 2 apart on formality', () => {
    // the statement is the jewellery, so neither the poplin nor the velvet is exempt
    const items = [
      item({ item_id: 'top', slot: 'top', fit: 2, material_primary: 'cotton poplin', material_formality: 1 }),
      item({ item_id: 'bot', slot: 'bottom', material_primary: 'velvet', material_formality: 5 }),
      item({ item_id: 'sho', slot: 'shoe', material_primary: 'leather', material_formality: 3 }),
      item({ item_id: 'jwl', slot: 'jewellery', item_type: 'earrings', jewellery_scale: 5 }),
    ]
    const v = evaluateHouseStyle(items)
    expect(v.violations.some((x) => x.code === 'material.formality_gap')).toBe(true)
  })
  it('exempts the formality gap when one side is the statement', () => {
    const items = [
      item({ item_id: 'top', slot: 'top', fit: 2, material_primary: 'cotton poplin', material_formality: 1 }),
      // the velvet piece IS the statement (pattern 4)
      item({ item_id: 'bot', slot: 'bottom', material_primary: 'velvet', material_formality: 5, pattern: 4 }),
      item({ item_id: 'sho', slot: 'shoe', material_primary: 'leather', material_formality: 3 }),
      item({ item_id: 'bag', slot: 'bag', material_primary: 'leather', material_formality: 3 }),
    ]
    const v = evaluateHouseStyle(items)
    expect(v.violations.some((x) => x.code === 'material.formality_gap')).toBe(false)
  })
  it('honours learned approved pairs', () => {
    const items = goodOutfit()
    items[3] = { ...items[3], material_primary: 'raffia' }
    const v = evaluateHouseStyle(items, { learnedApprovedPairs: new Set(['leather+raffia']) })
    // still rejected — an explicit REJECTED pair outranks a learned approval
    expect(v.violations.some((x) => x.code === 'material.rejected')).toBe(true)
  })
})

describe('colour engine', () => {
  it('classifies schemes on the wheel', () => {
    expect(classifyScheme([])).toBe('neutral')
    expect(classifyScheme(['red'])).toBe('tonal')
    expect(classifyScheme(['red', 'orange'])).toBe('analogous')
    expect(classifyScheme(['blue', 'orange'])).toBe('complementary')
    expect(classifyScheme(['red', 'green', 'blue'])).toBe('triadic')
    expect(classifyScheme(['red', 'green', 'blue', 'yellow'])).toBe('tetradic')
  })
  it('counts only non-neutral hues', () => {
    expect(huesOf([
      item({ item_id: '1', slot: 'top', colour_family: 'black' }),
      item({ item_id: '2', slot: 'bag', colour_family: 'camel' }),
      item({ item_id: '3', slot: 'shoe', colour_family: 'green' }),
    ])).toEqual(['green'])
  })
  it('hard-caps at 3 non-neutral hues — never a rainbow', () => {
    const items = [
      item({ item_id: 'a', slot: 'top', colour_family: 'red', pattern: 4, fit: 2 }),
      item({ item_id: 'b', slot: 'bottom', colour_family: 'green' }),
      item({ item_id: 'c', slot: 'shoe', colour_family: 'blue' }),
      item({ item_id: 'd', slot: 'bag', colour_family: 'yellow' }),
    ]
    const v = evaluateHouseStyle(items)
    expect(v.violations.some((x) => x.code === 'colour.rainbow')).toBe(true)
  })
  it('bans fuchsia everywhere, by name or by hex', () => {
    expect(isFuchsia(item({ item_id: 'f', slot: 'bag', product_name: 'Fuchsia clutch' }))).toBe(true)
    expect(isFuchsia(item({ item_id: 'f', slot: 'bag', colour_family: 'pink', colour_hex: '#FF00A0' }))).toBe(true)
    expect(isFuchsia(item({ item_id: 'f', slot: 'bag', colour_family: 'pink', colour_hex: '#F2D9DE' }))).toBe(false)
    const items = goodOutfit()
    items[3] = { ...items[3], product_name: 'Fuchsia leather tote' }
    expect(evaluateHouseStyle(items).violations.some((x) => x.code === 'colour.fuchsia')).toBe(true)
  })
  it('penalises white + cream heavily without texture contrast', () => {
    const items = [
      item({ item_id: 'top', slot: 'top', colour_family: 'white', pattern: 4, fit: 2, material_primary: 'silk', surface: 1 }),
      item({ item_id: 'bot', slot: 'bottom', colour_family: 'cream', material_primary: 'silk', surface: 1 }),
      item({ item_id: 'sho', slot: 'shoe', colour_family: 'white', material_primary: 'silk' }),
      item({ item_id: 'bag', slot: 'bag', colour_family: 'white', material_primary: 'silk' }),
    ]
    const v = evaluateHouseStyle(items)
    const hit = v.penalties.find((p) => p.code === 'colour.white_cream')
    expect(hit?.weight).toBe(0.2)
  })
  it('forgives white + cream when materials differ', () => {
    const items = [
      item({ item_id: 'top', slot: 'top', colour_family: 'white', pattern: 4, fit: 2, material_primary: 'silk' }),
      item({ item_id: 'bot', slot: 'bottom', colour_family: 'cream', material_primary: 'linen' }),
      item({ item_id: 'sho', slot: 'shoe', colour_family: 'white', material_primary: 'leather' }),
      item({ item_id: 'bag', slot: 'bag', colour_family: 'white', material_primary: 'leather' }),
    ]
    const hit = evaluateHouseStyle(items).penalties.find((p) => p.code === 'colour.white_cream')
    expect(hit?.weight).toBe(0.06)
  })
  it('keeps the learned skip-list soft, not banned', () => {
    const items = goodOutfit()
    items[0] = { ...items[0], colour_family: 'blue' }
    items[1] = { ...items[1], colour_family: 'brown' }
    const v = evaluateHouseStyle(items, { softSkipPairs: new Set(['colour:blue|brown']) })
    expect(v.penalties.some((p) => p.code === 'colour.learned_skip')).toBe(true)
    expect(v.violations.some((x) => x.code.startsWith('colour.learned'))).toBe(false)
  })
})

describe('jewellery logic', () => {
  const busyBase = () => [
    item({ item_id: 'top', slot: 'top', pattern: 4, fit: 2 }),
    item({ item_id: 'bot', slot: 'bottom', material_primary: 'linen' }),
    item({ item_id: 'sho', slot: 'shoe', material_primary: 'leather' }),
    item({ item_id: 'bag', slot: 'bag', material_primary: 'leather' }),
  ]
  it('rejects loud jewellery on a busy outfit', () => {
    const items = [...busyBase(), item({ item_id: 'n', slot: 'jewellery', item_type: 'necklace', jewellery_scale: 5 })]
    const v = evaluateHouseStyle(items)
    expect(v.violations.some((x) => x.code === 'jewellery.loud_on_busy')).toBe(true)
  })
  it('permits a bold necklace with a covered neckline', () => {
    const base = busyBase()
    base[0] = { ...base[0], neckline: 'turtleneck' }
    const items = [...base, item({ item_id: 'n', slot: 'jewellery', item_type: 'necklace', jewellery_scale: 5 })]
    expect(evaluateHouseStyle(items).violations.some((x) => x.code === 'jewellery.loud_on_busy')).toBe(false)
  })
  it('permits the signature vintage gold earrings when the look is quiet', () => {
    const items = [
      item({ item_id: 'top', slot: 'top', fit: 2, colour_family: 'black' }),
      item({ item_id: 'bot', slot: 'bottom', material_primary: 'linen', colour_family: 'black' }),
      item({ item_id: 'sho', slot: 'shoe', material_primary: 'leather', colour_family: 'black' }),
      item({ item_id: 'e', slot: 'jewellery', item_type: 'earrings', jewellery_scale: 4, jewellery_finish: 'yellow_gold', jewellery_style: 'vintage_inspired' }),
    ]
    const v = evaluateHouseStyle(items)
    expect(v.violations.some((x) => x.code === 'jewellery.loud_on_busy')).toBe(false)
    expect(v.statement?.kind).toBe('bold accessory')
  })
})

describe('price integrity', () => {
  it('rejects a sub-£150 piece beside a £1000+ piece', () => {
    const items = goodOutfit()
    items[0] = { ...items[0], price: 90, price_tier: 3 }
    items[1] = { ...items[1], price: 1800, price_tier: 3 }
    const v = evaluateHouseStyle(items)
    expect(v.violations.some((x) => x.code === 'price.spread')).toBe(true)
  })
  it('rejects skipping a brand tier', () => {
    const items = goodOutfit()
    items[0] = { ...items[0], price_tier: 1 }
    items[1] = { ...items[1], price_tier: 3 }
    const v = evaluateHouseStyle(items)
    expect(v.violations.some((x) => x.code === 'price.tier_skip')).toBe(true)
  })
  it('allows adjacent tiers', () => {
    const items = goodOutfit().map((i, n) => ({ ...i, price_tier: n < 2 ? 2 : 3 }))
    expect(evaluateHouseStyle(items).violations.some((x) => x.code === 'price.tier_skip')).toBe(false)
  })
})

describe('category bans', () => {
  it('bans activewear', () => {
    const items = goodOutfit()
    items[1] = { ...items[1], product_name: 'Performance running legging' }
    expect(evaluateHouseStyle(items).violations.some((x) => x.code === 'category.activewear')).toBe(true)
  })
  it('bans leopard unless flagged tasteful', () => {
    const items = goodOutfit()
    items[0] = { ...items[0], product_name: 'Leopard print blouse' }
    expect(evaluateHouseStyle(items).violations.some((x) => x.code === 'category.print')).toBe(true)
    items[0] = { ...items[0], print_flag: 'tasteful' }
    expect(evaluateHouseStyle(items).violations.some((x) => x.code === 'category.print')).toBe(false)
  })
})

describe('occasion notes', () => {
  it('reads Wimbledon as polished summer daytime, not literal whites', () => {
    const g = occasionGuidance('Wimbledon')
    expect(g.avoidAllWhite).toBe(true)
    expect(g.note).toMatch(/not literal tennis whites/)
    const items = goodOutfit().map((i) => ({ ...i, colour_family: 'white' }))
    const v = evaluateHouseStyle(items, { occasion: 'Wimbledon' })
    expect(v.penalties.some((p) => p.code === 'occasion.literal_whites')).toBe(true)
  })
  it('wants a light jacket for outdoor British occasions', () => {
    expect(occasionGuidance('garden party').wantsLightJacket).toBe(true)
    const v = evaluateHouseStyle(goodOutfit(), { occasion: 'garden party' })
    expect(v.penalties.some((p) => p.code === 'occasion.no_layer')).toBe(true)
  })
  it('skews date night cuter', () => {
    expect(occasionGuidance('date night').skewCute).toBe(true)
  })
})
