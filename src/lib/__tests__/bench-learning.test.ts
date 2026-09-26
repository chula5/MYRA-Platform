import { describe, it, expect } from 'vitest'
import { composeMemberVariants, toFeature, type ComposeHistory, type MemberTaste } from '../pilot-composer'
import { emptyModel, applyDecision, blendStrength } from '../style-brain'
import { rulesForMember } from '../style-rules'
import type { ItemWithBrand } from '../admin-queries'

// The bench with no client: global rules, no preferences, and the stylist's
// own Style Brain. Fit ties between the two bottoms, so only what the brain
// has learned can decide between them.
let seq = 0
function item(item_type: string, item_id: string): ItemWithBrand {
  seq++
  return {
    item_id, item_type, brand_id: `b-${seq}`,
    brand: { brand_id: `b-${seq}`, name: `Brand ${seq}`, price_tier: 3, era_orientation: 3, aesthetic_output: 3, cultural_legibility: 3, creative_behaviour: 3, notes: null },
    product_name: `${item_type} ${item_id}`, retailer_url: 'https://shop.example/x',
    image_url: `https://res.cloudinary.com/x/image/upload/v1/${item_id}.jpg`, price: '180', currency: 'GBP',
    status: 'ready', stock_status: 'in_stock', colour_family: 'navy', colour_hex: '#1d2a44', colour_depth: 2,
    pattern: 1, surface: 1, sheen: 1, fit: 3, structure: 3, material_formality: 3, material_weight: 3,
    material_primary: 'wool', material_category: 'natural_woven', ownership: 'retail',
  } as any
}

const library = () => [
  item('shirt', 'top1'), item('shirt', 'top2'),
  item('trousers', 'bot1'), item('skirt', 'bot2'),
  item('flat', 'shoe1'), item('flat', 'shoe2'),
  item('necklace', 'neckA'), item('necklace', 'neckB'),
  item('tote', 'bagA'), item('tote', 'bagB'),
]
const history = (): ComposeHistory => ({ seenCounts: new Map(), rejected: new Set() })
const stylistAlone = (styleModel: MemberTaste['styleModel']): MemberTaste => ({
  affinity: new Map(), families: new Map(), excludedPairs: new Set(), inputOnlyBrands: new Set(),
  itemSwapOut: new Map(), brandSwapOut: new Map(), pairNet: new Map(),
  rules: rulesForMember(null, false), styleModel,
})
const ids = (items: { item_id?: string | null }[]) => items.map((i) => i.item_id)

describe('a bench verdict teaches the stylist', () => {
  it('forty YESes on a pairing make the stylist reach for it', () => {
    const lib = library()
    const hero = lib[0], bot2 = lib.find((i) => i.item_id === 'bot2')!
    const model = emptyModel()
    for (let i = 0; i < 40; i++) applyDecision(model, [toFeature(hero), toFeature(bot2)], 'approve')
    expect(blendStrength(model)).toBeCloseTo(0.3)
    const [look] = composeMemberVariants(stylistAlone(model), lib, 'top1', 1, undefined, undefined, history())
    expect(ids(look.items)).toContain('bot2')
  })

  it('forty NOs on a pairing make the stylist leave it', () => {
    const lib = library()
    const hero = lib[0], bot1 = lib.find((i) => i.item_id === 'bot1')!
    const model = emptyModel()
    for (let i = 0; i < 40; i++) applyDecision(model, [toFeature(hero), toFeature(bot1)], 'skip')
    const [look] = composeMemberVariants(stylistAlone(model), lib, 'top1', 1, undefined, undefined, history())
    expect(ids(look.items)).not.toContain('bot1')
    expect(ids(look.items)).toContain('bot2')
  })

  it('an unlearned stylist still composes', () => {
    const looks = composeMemberVariants(stylistAlone(emptyModel()), library(), 'top1', 1, undefined, undefined, history())
    expect(looks.length).toBe(1)
  })
})
