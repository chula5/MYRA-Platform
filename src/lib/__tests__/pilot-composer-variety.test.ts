import { describe, it, expect } from 'vitest'
import { composeMemberLooks, composeMemberVariants, type ComposeHistory, type MemberTaste } from '../pilot-composer'
import { generateCandidates } from '../composer'
import type { ItemWithBrand } from '../admin-queries'
import { parseBrief } from '../stylist-brief'

// Identical pieces except their ids — so fit ties, and only history and
// rotation can decide between them.
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

const taste = (): MemberTaste => ({
  affinity: new Map(), families: new Map(), excludedPairs: new Set(), inputOnlyBrands: new Set(),
  itemSwapOut: new Map(), brandSwapOut: new Map(), pairNet: new Map(),
})

const library = () => [
  item('shirt', 'top1'), item('shirt', 'top2'),
  item('trousers', 'bot1'), item('trousers', 'bot2'),
  item('flat', 'shoe1'), item('flat', 'shoe2'),
  item('necklace', 'neckA'), item('necklace', 'neckB'),
  item('tote', 'bagA'), item('tote', 'bagB'),
]

const history = (over: Partial<ComposeHistory> = {}): ComposeHistory => ({ seenCounts: new Map(), rejected: new Set(), ...over })
const ids = (items: { item_id?: string | null }[]) => items.map((i) => i.item_id)

describe('composer variety — shown pieces step back, kept pieces stay', () => {
  it('does not keep reusing a necklace and bag she has already been shown', () => {
    const shown = history({ seenCounts: new Map([['neckA', 3], ['bagA', 3]]) })
    const [look] = composeMemberLooks(taste(), library(), 1, undefined, undefined, shown)
    expect(ids(look.items)).not.toContain('neckA')
    expect(ids(look.items)).not.toContain('bagA')
  })

  it('still reaches for a bag she kept', () => {
    const kept = history({ seenCounts: new Map([['bagA', 1], ['bagB', 1]]), keptCounts: new Map([['bagA', 2]]) })
    const [look] = composeMemberLooks(taste(), library(), 1, undefined, undefined, kept)
    expect(ids(look.items)).toContain('bagA')
  })

  it('never puts the same necklace or bag on two ways of wearing one piece when there is another', () => {
    const variants = composeMemberVariants(taste(), library(), 'top1', 2, undefined, undefined, history())
    expect(variants.length).toBe(2)
    const finishes = variants.map((v) => ids(v.items).filter((id) => /^(neck|bag)/.test(String(id))))
    for (const id of finishes[0]) expect(finishes[1]).not.toContain(id)
  })
})

describe('generateCandidates without a shortlist nudge', () => {
  it('builds the same shortlist it always did', () => {
    const lib = library()
    const anchor = lib[0]
    const a = generateCandidates({ anchor, library: lib, perSlotPool: 2 })
    const b = generateCandidates({ anchor, library: lib, perSlotPool: 2, shortlistAdjust: () => 0 })
    expect(a.map((c) => c.items.map((x) => x.item.item_id))).toEqual(b.map((c) => c.items.map((x) => x.item.item_id)))
  })
})

describe('a stylist brief shapes the shortlist, not only the score', () => {
  const withBrief = (brief: unknown): MemberTaste => ({ ...taste(), brief: parseBrief(brief, 'T') })

  it('reaches for the brand in the brief when the pieces are otherwise identical', () => {
    const lib = library()
    const bot2 = lib.find((i) => i.item_id === 'bot2')!
    const [look] = composeMemberVariants(withBrief({ brands: [bot2.brand!.name] }), lib, 'top1', 1, undefined, undefined, history())
    expect(ids(look.items)).toContain('bot2')
  })

  it('never shortlists a piece the brief bans while there is another', () => {
    const [look] = composeMemberVariants(withBrief({ nevers: [{ kind: 'ban', text: 'not that one', match: ['bot1'] }] }), library(), 'top1', 1, undefined, undefined, history())
    expect(ids(look.items)).toContain('bot2')
    expect(ids(look.items)).not.toContain('bot1')
  })
})

describe("a client's loved shoe type is a hard rule", () => {
  // Four sneakers: enough for the type to own the slot (SHOE_PREFERENCE_MIN).
  const shoes = () => [
    item('sneaker', 'sn1'), item('sneaker', 'sn2'), item('sneaker', 'sn3'), item('sneaker', 'sn4'),
    item('flat', 'fl1'), item('flat', 'fl2'),
  ]
  const lib = () => [item('shirt', 'top1'), item('shirt', 'top2'), item('trousers', 'bot1'), item('trousers', 'bot2'), ...shoes()]
  const lovesSneakers = (): MemberTaste => ({
    ...taste(),
    prefs: { colours_loved: [], colours_avoided: [], shapes_loved: [], shapes_avoided: [], types_loved: ['sneaker'], types_avoided: [] },
  })

  it('puts her in the sneaker she loves, never the flat', () => {
    const [look] = composeMemberVariants(lovesSneakers(), lib(), 'top1', 1, undefined, undefined, history())
    expect(ids(look.items).some((id) => String(id).startsWith('sn'))).toBe(true)
    expect(ids(look.items).some((id) => String(id).startsWith('fl'))).toBe(false)
  })

  it('outranks a stylist who bans sneakers — the stylist declines rather than breaking her rule', () => {
    const t: MemberTaste = { ...lovesSneakers(), brief: parseBrief({ nevers: [{ kind: 'ban', text: 'No trainers', match: ['sneaker'] }] }, 'Corporate') }
    expect(composeMemberVariants(t, lib(), 'top1', 1, undefined, undefined, history())).toEqual([])
  })
})
