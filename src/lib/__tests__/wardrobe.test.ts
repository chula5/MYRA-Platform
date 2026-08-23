import { describe, it, expect } from 'vitest'
import { normaliseDetected, normaliseDetectedList, productNameFromDetected } from '../wardrobe/detect'
import { buildCutoutPrompt } from '../wardrobe/cutout'
import { imageCallCost, textCallCost } from '../wardrobe/cost'
import { lowConfidenceDims, buildOwnedItemRow } from '../wardrobe/approve'
import { lookSpend, formatLookSpend, styledInCounts, costPerWear, retailOnly, ownerRefsForMember } from '../wardrobe/owned-items'
import { rankUnlockPurchases } from '../wardrobe/unlock'
import { composeMemberLooks, toLookItem, type MemberTaste } from '../pilot-composer'
import { EMPTY_STYLE_PREFS } from '../pilot-stylist'
import type { ItemWithBrand } from '../admin-queries'

// ── fixtures ────────────────────────────────────────────────────────────────

let seq = 0
function item(over: Partial<Record<string, any>> & { item_type: string }): ItemWithBrand {
  seq++
  const base: any = {
    item_id: over.item_id ?? `it-${seq}`,
    brand_id: over.brand_id ?? `b-${seq}`,
    brand: over.brand === null ? null : over.brand ?? { brand_id: over.brand_id ?? `b-${seq}`, name: over.brand_name ?? `Brand ${seq}`, price_tier: 3, era_orientation: 3, aesthetic_output: 3, cultural_legibility: 3, creative_behaviour: 3, notes: null },
    product_name: over.product_name ?? `${over.item_type} ${seq}`,
    retailer_url: over.retailer_url ?? 'https://shop.example/x',
    image_url: over.image_url ?? `https://res.cloudinary.com/x/image/upload/v1/i${seq}.jpg`,
    price: over.price ?? '180',
    currency: 'GBP',
    status: 'ready',
    stock_status: 'in_stock',
    colour_family: 'navy',
    colour_hex: '#1d2a44',
    colour_depth: 2,
    pattern: 1,
    surface: 1,
    sheen: 1,
    fit: 3,
    structure: 3,
    material_formality: 3,
    material_weight: 3,
    material_primary: 'wool',
    material_category: 'natural_woven',
    ownership: 'retail',
  }
  return { ...base, ...over } as ItemWithBrand
}

function owned(over: Partial<Record<string, any>> & { item_type: string }): ItemWithBrand {
  return item({ ownership: 'owned', owner_user_id: 'member-1', owner_kind: 'pilot_member', brand: null, brand_id: null, price: null, retailer_url: null, estimated_value: over.estimated_value ?? 120, ...over })
}

const emptyTaste = (): MemberTaste => ({
  affinity: new Map(), families: new Map(), excludedPairs: new Set(), inputOnlyBrands: new Set(['zara']),
  itemSwapOut: new Map(), brandSwapOut: new Map(), pairNet: new Map(),
})

// ── detect ──────────────────────────────────────────────────────────────────

describe('detect normalisation', () => {
  it('maps a raw record onto the taxonomy and clamps the box', () => {
    const g = normaliseDetected({
      name: 'navy linen shirt', item_type: 'shirt', colour_family: 'navy', colour_hex: '#1D2A44', material_guess: 'linen',
      pattern: 'none', silhouette: 'relaxed', description: 'Button-through shirt.', brand_hint: null,
      bounding_box: { x: 900, y: 10, width: 500, height: 2000 }, confidence: 1.4,
    })!
    expect(g.category).toBe('top')
    expect(g.colour_hex).toBe('#1d2a44')
    expect(g.bounding_box).toEqual({ x: 900, y: 10, width: 100, height: 990 })
    expect(g.confidence).toBe(1)
    expect(productNameFromDetected(g)).toBe('Navy Linen Shirt')
  })
  it('drops records with an unknown item_type and caps the list', () => {
    const list = normaliseDetectedList([
      { item_type: 'hoodie', name: 'x', pattern: 'none', bounding_box: {}, description: '' },
      ...Array.from({ length: 10 }, (_, i) => ({ item_type: 'boot', name: `boot ${i}`, pattern: 'none', bounding_box: {}, description: '', confidence: 0.9 })),
    ])
    expect(list.length).toBe(8)
    expect(list.every((g) => g.item_type === 'boot')).toBe(true)
  })
})

// ── cutout prompt ───────────────────────────────────────────────────────────

describe('cutout prompt', () => {
  const g = normaliseDetected({ name: 'camel wool coat', item_type: 'coat', colour_family: 'camel', colour_hex: '#c19a6b', material_guess: 'wool', pattern: 'none', silhouette: 'oversized, maxi', description: 'Double-breasted coat with notch lapels.', brand_hint: null, bounding_box: { x: 0, y: 0, width: 1000, height: 1000 }, confidence: 0.9 })!
  it('asks for white, removes the wearer, and forbids invention', () => {
    const p = buildCutoutPrompt(g)
    expect(p).toMatch(/pure white/i)
    expect(p).toMatch(/remove them entirely/i)
    expect(p).toMatch(/Do not invent/i)
    expect(p).toContain('camel')
    expect(p).toContain('Double-breasted')
  })
  it('appends the reviewer direction on regeneration', () => {
    expect(buildCutoutPrompt(g, 'the lapels are wrong')).toMatch(/Reviewer's correction.*lapels/)
  })
})

// ── cost ────────────────────────────────────────────────────────────────────

describe('cost', () => {
  it('prices text calls from usage and flags estimates', () => {
    expect(textCallCost('gpt-5.6-terra', { input_tokens: 1_000_000, output_tokens: 0 }).usd).toBeCloseTo(2)
    expect(textCallCost('gpt-5.6-terra', null).estimated).toBe(true)
  })
  it('estimates an image when no usage is returned', () => {
    const c = imageCallCost('gpt-image-2', null, 'high')
    expect(c.estimated).toBe(true)
    expect(c.usd).toBeGreaterThan(0.1)
    expect(c.usd).toBeLessThan(0.5)
  })
})

// ── approve ─────────────────────────────────────────────────────────────────

describe('approve', () => {
  const g = normaliseDetected({ name: 'black leather boot', item_type: 'boot', colour_family: 'black', colour_hex: '#111111', material_guess: 'leather', pattern: 'none', silhouette: null, description: 'Ankle boot.', brand_hint: null, bounding_box: { x: 0, y: 0, width: 1000, height: 1000 }, confidence: 0.9 })!
  it('flags brand-derived dims when brand is unknown and nothing when known + material read', () => {
    const scores: any = { material_category: 'leather_suede', material_primary: 'Leather' }
    expect(lowConfidenceDims(scores, { brandKnown: false, detected: g })).toEqual(expect.arrayContaining(['brand_price_tier', 'material_formality']))
    expect(lowConfidenceDims(scores, { brandKnown: true, detected: g })).toEqual([])
  })
  it('builds an owned item row: never live, no retailer, edits win over scores', () => {
    const row = buildOwnedItemRow({
      detected: g,
      scores: { fit: 2, colour_family: 'black', item_type: 'boot' } as any,
      edits: { brand_name: 'Sézane', estimated_value: 250, scores: { fit: 4 }, favourite: true },
      owner: { kind: 'pilot_member', id: 'm1' },
      photoId: 'p1', extractionId: 'x1', cutoutUrl: 'https://res.cloudinary.com/c.jpg', brandId: 'brand-sezane', lowConfidence: [],
    })
    expect(row.status).toBe('ready')
    expect(row.ownership).toBe('owned')
    expect(row.retailer_url).toBeNull()
    expect(row.price).toBeNull()
    expect(row.fit).toBe(4)
    expect(row.estimated_value).toBe(250)
    expect(row.brand_id).toBe('brand-sezane')
    expect((row.owned_metadata as any).favourite).toBe(true)
    expect((row.owned_metadata as any).brand_label).toBeNull()
    expect(row.product_name).toBe('Black Leather Boot')
  })
})

// ── owned-items helpers ─────────────────────────────────────────────────────

describe('owned-item helpers', () => {
  it('spend excludes owned pieces but counts them', () => {
    const s = lookSpend([{ owned: false, price_gbp: 200 }, { owned: true, estimated_value_gbp: 300 }, { owned: false, price_gbp: 75 }, { owned: true }])
    expect(s.retailTotal).toBe(275)
    expect(s.ownedCount).toBe(2)
    expect(s.ownedValue).toBe(300)
    expect(s.pieceCount).toBe(4)
    expect(formatLookSpend(s)).toBe('£275 to buy · 2 pieces already hers')
  })
  it('retailOnly treats pre-migration rows as retail', () => {
    expect(retailOnly([{ ownership: 'owned' }, {}, { ownership: 'retail' }]).length).toBe(2)
  })
  it('styled-in counts and cost per wear', () => {
    const m = styledInCounts([{ items: [{ item_id: 'a' }, { item_id: 'b' }, { item_id: 'a' }] }, { items: [{ item_id: 'a' }] }])
    expect(m.get('a')).toBe(2)
    expect(m.get('b')).toBe(1)
    expect(costPerWear(300, 3)).toBe(100)
    expect(costPerWear(null, 3)).toBeNull()
  })
  it('owner refs include the linked login', () => {
    expect(ownerRefsForMember({ member_id: 'm', auth_user_id: 'u' })).toEqual([{ kind: 'pilot_member', id: 'm' }, { kind: 'auth_user', id: 'u' }])
  })
})

// ── composer integration ────────────────────────────────────────────────────

describe('pilot composer with owned items', () => {
  function library() {
    return [
      item({ item_type: 'blouse', brand_name: 'Toteme' }), item({ item_type: 'knitwear', brand_name: 'Khaite' }),
      item({ item_type: 'trousers', brand_name: 'The Row' }), item({ item_type: 'skirt', brand_name: 'Toteme' }),
      // the constitution wants exactly one statement element per look
      item({ item_type: 'flat', brand_name: 'The Row' }), item({ item_type: 'boot', brand_name: 'Khaite', sheen: 4 }),
      item({ item_type: 'tote', brand_name: 'The Row' }), item({ item_type: 'shoulder_bag', brand_name: 'Khaite', colour_family: 'burgundy', colour_hex: '#6d1f2c', colour_depth: 4 }),
      owned({ item_type: 'shirt', product_name: 'Her linen shirt', colour_family: 'green', colour_hex: '#3d6b45', colour_depth: 4, material_primary: 'linen' }),
      owned({ item_type: 'jeans', product_name: 'Her jeans', owned_metadata: { brand_label: 'Zara' }, material_primary: 'denim' }),
    ]
  }
  it('toLookItem marks owned pieces, prices them at nothing, carries her estimate', () => {
    const li = toLookItem(owned({ item_type: 'shirt', estimated_value: 90, owned_metadata: { brand_label: 'Sézane' } }))
    expect(li.owned).toBe(true)
    expect(li.price_gbp).toBeNull()
    expect(li.estimated_value_gbp).toBe(90)
    expect(li.brand).toBe('Sézane')
    expect(li.in_stock).toBe(true)
  })
  it('style_owned puts an owned piece in at least the target share of looks', () => {
    const looks = composeMemberLooks(emptyTaste(), library(), 3, undefined, undefined, undefined, { ownedMode: 'style_owned', ownedTargetShare: 0.6 })
    expect(looks.length).toBeGreaterThan(0)
    const withOwned = looks.filter((l) => l.ownedCount > 0).length
    expect(withOwned).toBeGreaterThanOrEqual(Math.min(looks.length, 2))
    expect(looks.some((l) => l.items.some((i) => i.owned))).toBe(true)
  })
  it('retail_only ignores the wardrobe; blend may use it', () => {
    const none = composeMemberLooks(emptyTaste(), library(), 3, undefined, undefined, undefined, { ownedMode: 'retail_only' })
    expect(none.every((l) => l.ownedCount === 0)).toBe(true)
    const blend = composeMemberLooks(emptyTaste(), library(), 3)
    expect(blend.length).toBeGreaterThan(0)
  })
  it('her authored avoids gate her own pieces too — what she says she won’t wear is never composed', () => {
    const taste = emptyTaste()
    taste.prefs = { ...EMPTY_STYLE_PREFS, colours_avoided: ['red'] }
    const lib = [...library(), owned({ item_type: 'blouse', product_name: 'Her red blouse', colour_family: 'red', colour_hex: '#b3202a', colour_depth: 4 })]
    const looks = composeMemberLooks(taste, lib, 3, undefined, undefined, undefined, { ownedMode: 'style_owned', ownedTargetShare: 1 })
    expect(looks.length).toBeGreaterThan(0)
    expect(looks.every((l) => !l.items.some((i) => i.product_name === 'Her red blouse'))).toBe(true)
  })
  it('the input-only (Zara) rule does not apply to what she already owns', () => {
    const taste = emptyTaste()
    const zaraRetail = item({ item_type: 'skirt', brand_name: 'Zara', product_name: 'Zara skirt' })
    const lib = [...library(), zaraRetail]
    const looks = composeMemberLooks(taste, lib, 3)
    // recommended Zara never appears; her own Zara jeans may
    expect(looks.every((l) => !l.items.some((i) => i.product_name === 'Zara skirt'))).toBe(true)
    const ownedZara = looks.flatMap((l) => l.items).filter((i) => i.product_name === 'Her jeans')
    expect(ownedZara.every((i) => i.owned)).toBe(true)
  })
})

// ── unlock ranking ──────────────────────────────────────────────────────────

describe('what to buy', () => {
  it('ranks retail pieces by the outfits they complete with owned pieces', () => {
    const ownedPool = [
      owned({ item_type: 'shirt' }), owned({ item_type: 'knitwear' }), owned({ item_type: 'trousers' }), owned({ item_type: 'flat' }),
    ]
    const retail = [
      item({ item_type: 'skirt', product_name: 'Navy skirt' }),   // completes shirt+skirt+flat AND knit+skirt+flat
      item({ item_type: 'earrings', product_name: 'Hoops', jewellery_scale: 3, jewellery_formality: 2 }),
      item({ item_type: 'coat', product_name: 'Camel coat' }),    // layers over both owned bodies
    ]
    const ranked = rankUnlockPurchases(ownedPool, retail, { minCoherence: 0.5 })
    expect(ranked.length).toBeGreaterThan(0)
    expect(ranked[0].unlocked).toBeGreaterThanOrEqual(ranked[ranked.length - 1].unlocked)
    for (const r of ranked) {
      expect(r.looks.length).toBeGreaterThan(0)
      // the piece to buy always leads the look
      expect(r.looks[0].itemIds[0]).toBe(r.item.item_id)
      expect(r.looks[0].slots.length).toBe(r.looks[0].itemIds.length)
      // no piece appears twice in a look
      expect(new Set(r.looks[0].itemIds).size).toBe(r.looks[0].itemIds.length)
    }
  })
  it('completes each look with the layer and bag she already owns', () => {
    const ownedPool = [
      owned({ item_type: 'shirt' }), owned({ item_type: 'trousers' }), owned({ item_type: 'flat' }),
      owned({ item_type: 'jacket', product_name: 'Her navy blazer' }),
      owned({ item_type: 'tote', product_name: 'Her tote' }),
    ]
    const [top] = rankUnlockPurchases(ownedPool, [item({ item_type: 'skirt', product_name: 'New skirt' })], { minCoherence: 0.5 })
    expect(top).toBeTruthy()
    const slots = top.looks[0].slots
    // a body piece, her shoes, and the optional slots her wardrobe can fill
    expect(slots).toContain('bottom')
    expect(slots).toContain('shoe')
    expect(slots).toContain('outerwear')
    expect(slots).toContain('bag')
    expect(top.missingSlots).toEqual([])
  })
  it('says which slots her wardrobe cannot finish', () => {
    // no shoes, no bag — the look is shown honestly incomplete
    const ownedPool = [owned({ item_type: 'shirt' }), owned({ item_type: 'trousers' })]
    const [top] = rankUnlockPurchases(ownedPool, [item({ item_type: 'jacket' })], { minCoherence: 0.5 })
    expect(top).toBeTruthy()
    expect(top.missingSlots).toEqual(expect.arrayContaining(['shoe', 'bag']))
    expect(top.looks[0].slots).not.toContain('shoe')
  })
  it('returns nothing when she owns no body pieces and the candidate is an accessory', () => {
    const ranked = rankUnlockPurchases([owned({ item_type: 'flat' })], [item({ item_type: 'tote' })])
    expect(ranked).toEqual([])
  })
  it('honours her hard gate — an excluded pairing never counts as an unlocked outfit', () => {
    const ownedTop = owned({ item_type: 'shirt' })
    const ownedBottom = owned({ item_type: 'trousers' })
    const candidate = item({ item_type: 'coat', product_name: 'Coat' })
    const open = rankUnlockPurchases([ownedTop, ownedBottom], [candidate], { minCoherence: 0.5 })
    expect(open[0]?.unlocked).toBeGreaterThan(0)
    const gated = rankUnlockPurchases([ownedTop, ownedBottom], [candidate], { minCoherence: 0.5, gate: () => false })
    expect(gated).toEqual([])
  })
})
