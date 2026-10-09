// Behavioural tests for the REAL Quality Lab generation/checking adapters
// (generation-adapters.ts), with only the outermost boundaries faked:
// the item pool, the review recipe (composeReviewLooks), the size-row loader,
// the member context and the house knowledge loaders. The size matching
// (resolveAvailability), price contract (priceOfItem), brand membership,
// member gates and profile-context logic under test are the real production
// code.

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Fixture pool ─────────────────────────────────────────────────────────────

const SHOE = {
  item_id: 'item-shoe',
  item_type: 'heel',
  brand: { brand_id: 'b-shoe', name: 'Jimmy Choo', price_tier: 4 },
  image_url: 'https://cdn.example.com/shoe.jpg',
  retailer_url: 'https://shop.example.com/shoe',
  status: 'live',
  stock_status: 'in_stock',
  price: null,
  price_gbp: 450,
  currency: 'GBP',
  colour_family: 'black',
  material_formality: 4,
  pattern: 1,
}

function garment(over: Record<string, unknown> = {}) {
  return {
    item_id: 'item-anchor',
    item_type: 'midi_dress',
    brand: { brand_id: 'b-1', name: 'Rixo', price_tier: 3 },
    image_url: `https://cdn.example.com/${String(over.item_id ?? 'item-anchor')}.jpg`,
    retailer_url: 'https://shop.example.com/a',
    status: 'live',
    stock_status: 'in_stock',
    price: null,
    price_gbp: 300,
    currency: 'GBP',
    colour_family: 'red',
    material_formality: 3,
    pattern: 4,
    ...over,
  } as any
}

let POOL: any[] = []
let SIZE_ROWS = new Map<string, any[]>()
let MEMBER_CTX: { taste: any; sizeProfile: Record<string, unknown> } = { taste: null, sizeProfile: {} }

const onePick = () => ({ picks: [{ items: [{ item: SHOE, slot: 'shoe' }], score: 1, verdict: {} }], rejectionHits: [] })
const composeSpy = vi.fn((_opts: any) => onePick() as any)

vi.mock('@/lib/admin-queries', () => ({
  getReadyAndLiveItems: vi.fn(async () => POOL),
}))

vi.mock('@/lib/review-compose', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/review-compose')>()
  return { ...actual, composeReviewLooks: (opts: any) => composeSpy(opts) }
})

vi.mock('@/lib/size-availability', () => ({
  loadSizeRowsFor: vi.fn(async () => SIZE_ROWS),
}))

vi.mock('@/lib/outfit-quality/member-context', () => ({
  loadRealMemberContext: vi.fn(async () => MEMBER_CTX),
}))
vi.mock('@/lib/house-style-store', () => ({
  loadLearnedMaterialPairs: vi.fn(async () => ({ approved: new Set(), rejected: new Set() })),
}))
vi.mock('@/lib/pipeline-store', () => ({
  loadEjectionConstraints: vi.fn(async () => ({ quarantined: new Set(), excludedContexts: new Map() })),
}))

// Never touched by these tests, but mocked so no Anthropic client or member
// size path can be reached by accident.
vi.mock('@/lib/look-check', () => ({ checkLook: vi.fn(async () => null) }))
vi.mock('@/lib/look-size-check', () => ({ checkSizesForMember: vi.fn(async () => new Map()) }))

import {
  createComposerGenerator,
  createObjectiveEvidenceProvider,
} from '@/lib/outfit-quality/generation-adapters'

const PROFILE_CONTEXT = (facts: Record<string, unknown>) => ({
  dataPartition: 'test',
  realMemberId: null,
  evaluationProfileId: 'profile-1',
  selectedStylistId: 'stylist-1',
  contextSnapshot: { type: 'evaluation_profile', profile_id: 'profile-1', slug: 'p', ...facts },
})

const SNAPSHOT = {
  snapshotId: 'snap-1',
  payloadHash: 'hash-1',
  rulesOnly: false,
  payload: { item_mask: { decisions: [] } },
  systemVersions: {},
}

beforeEach(() => {
  POOL = []
  SIZE_ROWS = new Map()
  MEMBER_CTX = { taste: null, sizeProfile: {} }
  composeSpy.mockClear()
  composeSpy.mockImplementation(() => onePick() as any)
})

const anchorsComposed = () => composeSpy.mock.calls.map((c) => c[0].anchor.item_id)
const libraryIds = (call = 0) => (composeSpy.mock.calls[call][0].library as any[]).map((i) => i.item_id)

const sizeRow = (over: Record<string, unknown> = {}) => ({
  size_label: 'UK 10',
  size_system: 'UK',
  canonical_category: 'tops',
  canonical_value: 10,
  in_stock: true,
  stock_level: 'in_stock',
  ...over,
})

const PROFILE_SIZES = { tops: { value: 10, adjacent: null }, bottoms: { value: 10, adjacent: null }, shoes: { value: 6, adjacent: null } }

describe('createComposerGenerator — sold-out sizes fail closed at pool gating', () => {
  const facts = {
    style_families: [], brand_groups: [], occasions: [],
    budget_profile: {},
    size_profile: PROFILE_SIZES,
  }

  it('excludes a sized garment whose matching size row is sold out (wearable=false)', async () => {
    const soldOut = garment({ item_id: 'a-soldout' })
    const available = garment({ item_id: 'a-available' })
    POOL = [soldOut, available, SHOE]
    SIZE_ROWS = new Map([
      // The profile's exact size (UK 10 tops) exists but is SOLD OUT.
      ['a-soldout', [sizeRow({ in_stock: false, stock_level: 'sold_out' })]],
      ['a-available', [sizeRow()]],
    ])

    const gen = createComposerGenerator({} as any)
    const out = await gen.generate({ count: 5, snapshot: SNAPSHOT as any, context: PROFILE_CONTEXT(facts) as any })

    const anchorIds = anchorsComposed()
    expect(anchorIds).toContain('a-available')
    expect(anchorIds).not.toContain('a-soldout')
    // And no produced candidate carries the sold-out garment at all.
    expect(JSON.stringify(out)).not.toContain('a-soldout')
  })

  it('keeps a sized garment with an in-stock matching size row', async () => {
    const available = garment({ item_id: 'a-available' })
    POOL = [available, SHOE]
    SIZE_ROWS = new Map([['a-available', [sizeRow()]]])

    const gen = createComposerGenerator({} as any)
    await gen.generate({ count: 1, snapshot: SNAPSHOT as any, context: PROFILE_CONTEXT(facts) as any })
    expect(anchorsComposed()).toEqual(['a-available'])
  })
})

describe('createComposerGenerator — budget follows the canonical priceOfItem contract', () => {
  // max £250. Budget is the ONLY differing signal in these cases.
  const facts = {
    style_families: [], brand_groups: [], occasions: [],
    budget_profile: { price_tiers: [], max_gbp: 250 },
    size_profile: PROFILE_SIZES,
  }

  async function capturedAdjust() {
    const gen = createComposerGenerator({} as any)
    await gen.generate({ count: 1, snapshot: SNAPSHOT as any, context: PROFILE_CONTEXT(facts) as any })
    const call = composeSpy.mock.calls[0]?.[0]
    expect(call?.shortlistAdjust).toBeTypeOf('function')
    return call.shortlistAdjust as (item: any) => number
  }

  beforeEach(() => {
    const anchor = garment()
    POOL = [anchor, SHOE]
    SIZE_ROWS = new Map([[anchor.item_id, [sizeRow()]]])
  })

  it('price_gbp wins over the native price', async () => {
    const adjust = await capturedAdjust()
    // price_gbp £600 (over budget) with a native price of "100": the canonical
    // contract prefers price_gbp, so this must be penalised. Parsing the
    // native price as GBP would wrongly treat it as under budget.
    const gbpFirst = garment({ item_id: 'x', price_gbp: 600, price: '100', currency: 'GBP' })
    const cheap = garment({ item_id: 'y', price_gbp: 100, price: null, currency: 'GBP' })
    expect(adjust(gbpFirst)).toBeLessThan(adjust(cheap))
  })

  it('converts a native non-GBP price instead of reading it as GBP', async () => {
    const adjust = await capturedAdjust()
    // $300 ≈ £224 → UNDER the £250 cap. The old code read "300" as £300 (over).
    const usd = garment({ item_id: 'x', price_gbp: null, price: '300', currency: 'USD' })
    const noPrice = garment({ item_id: 'y', price_gbp: null, price: null, currency: null })
    expect(adjust(usd)).toBe(adjust(noPrice))
    // €400 ≈ £343 → OVER the cap, penalised via conversion.
    const eur = garment({ item_id: 'z', price_gbp: null, price: '400', currency: 'EUR' })
    expect(adjust(eur)).toBeLessThan(adjust(usd))
  })
})

describe('createComposerGenerator — the frozen profile governs anchor order', () => {
  const facts = {
    style_families: [], brand_groups: ['contemporary'], occasions: [],
    budget_profile: { price_tiers: [], max_gbp: 250 },
    size_profile: PROFILE_SIZES,
  }

  it('iterates anchors best-profile-fit first, not pool order', async () => {
    // Pool order puts the off-profile anchor FIRST: over budget AND its brand
    // belongs to a different controlled group (designer, not contemporary).
    const offProfile = garment({ item_id: 'a-off', brand: { brand_id: 'b-k', name: 'Khaite', price_tier: 5 }, price_gbp: 900 })
    const onProfile = garment({ item_id: 'a-on', brand: { brand_id: 'b-r', name: 'Rixo', price_tier: 3 }, price_gbp: 150 })
    POOL = [offProfile, onProfile, SHOE]
    SIZE_ROWS = new Map([
      ['a-off', [sizeRow()]],
      ['a-on', [sizeRow()]],
    ])

    const gen = createComposerGenerator({} as any)
    await gen.generate({ count: 2, snapshot: SNAPSHOT as any, context: PROFILE_CONTEXT(facts) as any })

    const anchorIds = anchorsComposed()
    expect(anchorIds[0]).toBe('a-on')
    expect(anchorIds[1]).toBe('a-off')
  })

  it('leaves anchor order untouched for a real-member context', async () => {
    const first = garment({ item_id: 'a-first', price_gbp: 900 })
    const second = garment({ item_id: 'a-second', price_gbp: 100 })
    POOL = [first, second, SHOE]
    const gen = createComposerGenerator({} as any)
    await gen.generate({
      count: 2,
      snapshot: SNAPSHOT as any,
      context: {
        dataPartition: 'test',
        realMemberId: 'member-1',
        evaluationProfileId: null,
        selectedStylistId: 'stylist-1',
        contextSnapshot: { type: 'real_member', member_id: 'member-1' },
      } as any,
    })
    // No profile context: pool order is preserved and no adjust is attached.
    expect(anchorsComposed()).toEqual(['a-first', 'a-second'])
    expect(composeSpy.mock.calls[0][0].shortlistAdjust).toBeUndefined()
  })
})

describe('createComposerGenerator — pool excludes items that can never pass objective checks', () => {
  it('excludes brand-less and type-less items from the pool entirely', async () => {
    const brandless = garment({ item_id: 'a-brandless', brand: null })
    const typeless = garment({ item_id: 'a-typeless', item_type: null })
    const good = garment({ item_id: 'a-good' })
    POOL = [brandless, typeless, good, SHOE]
    SIZE_ROWS = new Map([['a-good', [sizeRow()]]])

    const facts = {
      style_families: [], brand_groups: [], occasions: [],
      budget_profile: {},
      size_profile: PROFILE_SIZES,
    }
    const gen = createComposerGenerator({} as any)
    await gen.generate({ count: 5, snapshot: SNAPSHOT as any, context: PROFILE_CONTEXT(facts) as any })

    const anchorIds = anchorsComposed()
    expect(anchorIds).toEqual(['a-good'])
    // The library passed to the composer contains neither unusable item.
    expect(libraryIds(0)).not.toContain('a-brandless')
    expect(libraryIds(0)).not.toContain('a-typeless')
  })
})

describe('createObjectiveEvidenceProvider — sold-out matching size is not in-size', () => {
  const context = PROFILE_CONTEXT({
    style_families: [], brand_groups: [], occasions: [],
    budget_profile: {}, size_profile: PROFILE_SIZES,
  }) as any

  const sizedItem = (id: string) => ({
    item_id: id,
    slot: 'dress',
    sort_order: 0,
    item_snapshot: { item_type: 'midi_dress' },
    source_image_url: 'https://cdn.example.com/x.jpg',
  })

  it('reports a sold-out matching size row as not_in_size (fail closed)', async () => {
    SIZE_ROWS = new Map([['i-1', [sizeRow({ in_stock: false, stock_level: 'sold_out' })]]])
    const evidence = createObjectiveEvidenceProvider({} as any)
    const out = await evidence.gather({ items: [sizedItem('i-1')] as any, context })
    expect((out.size as any)['i-1']).toBe('not_in_size')
  })

  it('reports an in-stock matching size row as in_size', async () => {
    SIZE_ROWS = new Map([['i-1', [sizeRow()]]])
    const evidence = createObjectiveEvidenceProvider({} as any)
    const out = await evidence.gather({ items: [sizedItem('i-1')] as any, context })
    expect((out.size as any)['i-1']).toBe('in_size')
  })

  it('reports a sized garment with no usable size evidence as unconfirmed', async () => {
    SIZE_ROWS = new Map()
    const evidence = createObjectiveEvidenceProvider({} as any)
    const out = await evidence.gather({ items: [sizedItem('i-1')] as any, context })
    expect((out.size as any)['i-1']).toBe('unconfirmed')
  })
})

describe('createComposerGenerator — scope exclusions stop repeats', () => {
  const memberCtx = {
    dataPartition: 'training',
    realMemberId: 'member-1',
    evaluationProfileId: null,
    selectedStylistId: 'stylist-1',
    contextSnapshot: { type: 'real_member', member_id: 'member-1' },
  } as any

  it('skips anchors that already led a look in this scope', async () => {
    POOL = [garment({ item_id: 'a-led' }), garment({ item_id: 'a-fresh' }), SHOE]
    const gen = createComposerGenerator({} as any)
    const out = await gen.generate({
      count: 1,
      snapshot: SNAPSHOT as any,
      context: memberCtx,
      exclusions: { signatures: new Set(), anchorItemIds: new Set(['a-led']) },
    })
    expect(out.map((c) => c.anchorItemId)).toEqual(['a-fresh'])
    expect(anchorsComposed()).toEqual(['a-fresh'])
  })

  it('never re-produces a composition whose signature is already cased, and revisits led anchors for an UNSEEN look', async () => {
    const SHOE2 = { ...SHOE, item_id: 'item-shoe-2' }
    POOL = [garment({ item_id: 'a-led' }), SHOE, SHOE2]
    // The recipe offers two looks for the anchor; the first is already cased.
    composeSpy.mockImplementation((opts: any) => ({
      picks: [{ items: [{ item: SHOE, slot: 'shoe' }], score: 1, verdict: {} }, { items: [{ item: SHOE2, slot: 'shoe' }], score: 0.9, verdict: {} }].slice(0, opts.count),
      rejectionHits: [],
    }) as any)
    const gen = createComposerGenerator({} as any)
    const out = await gen.generate({
      count: 1,
      snapshot: SNAPSHOT as any,
      context: memberCtx,
      exclusions: { signatures: new Set(['a-led|item-shoe']), anchorItemIds: new Set(['a-led']) },
    })
    expect(out).toHaveLength(1)
    expect(out[0].itemsSignature).toBe('a-led|item-shoe-2')
    expect(out[0].anchorItemId).toBe('a-led')
  })

  it('stamps every candidate with its anchor and sorted signature', async () => {
    POOL = [garment({ item_id: 'a-1' }), SHOE]
    const gen = createComposerGenerator({} as any)
    const [c] = await gen.generate({ count: 1, snapshot: SNAPSHOT as any, context: memberCtx })
    expect(c.anchorItemId).toBe('a-1')
    expect(c.itemsSignature).toBe('a-1|item-shoe')
  })
})

describe('createComposerGenerator — the frozen stylist lens reaches the composer', () => {
  const memberCtx = {
    dataPartition: 'training',
    realMemberId: 'member-1',
    evaluationProfileId: null,
    selectedStylistId: 'stylist-1',
    contextSnapshot: { type: 'real_member', member_id: 'member-1' },
  } as any

  it('passes the FROZEN learned model to the recipe when the snapshot froze one', async () => {
    POOL = [garment({ item_id: 'a-1' }), SHOE]
    const snapshot = {
      ...SNAPSHOT,
      payload: {
        item_mask: { decisions: [] },
        rules_only: true,
        learned_model: { status: 'loaded', payload: { version: 1, decisions: 40, approves: 30, skips: 10, singles: {}, pairs: {} }, version: 1, decision_count: 40 },
      },
    }
    const gen = createComposerGenerator({} as any)
    await gen.generate({ count: 1, snapshot: snapshot as any, context: memberCtx })
    const opts = composeSpy.mock.calls[0][0]
    expect(opts.styleModel?.decisions).toBe(40)
  })

  it('attaches no model and no shortlist pull when the stylist has no model, no envelope and an empty brief', async () => {
    POOL = [garment({ item_id: 'a-1' }), SHOE]
    const snapshot = {
      ...SNAPSHOT,
      payload: {
        item_mask: { decisions: [] },
        rules_only: true,
        learned_model: { status: 'absent', payload: null, version: null, decision_count: 0 },
        brief: { nevers: [], brands: [], signature_pieces: [], fabrics: [] },
      },
    }
    const gen = createComposerGenerator({} as any)
    await gen.generate({ count: 1, snapshot: snapshot as any, context: memberCtx })
    const opts = composeSpy.mock.calls[0][0]
    expect(opts.styleModel ?? null).toBeNull()
    expect(opts.shortlistAdjust).toBeUndefined()
  })

  it('drops a piece the brief BANS from the pool entirely', async () => {
    const denim = garment({ item_id: 'a-denim', item_type: 'jeans', material_category: 'denim', material_primary: 'denim', product_name: 'Wide jeans' })
    const tailored = garment({ item_id: 'a-tailored', item_type: 'trousers', material_category: 'wool', product_name: 'Tailored trouser' })
    POOL = [denim, tailored, SHOE]
    const snapshot = {
      ...SNAPSHOT,
      payload: {
        item_mask: { decisions: [] },
        rules_only: true,
        brief: { nevers: [{ kind: 'ban', phrase: 'denim', match: ['denim'] }], brands: [], signature_pieces: [], fabrics: [] },
      },
    }
    const gen = createComposerGenerator({} as any)
    await gen.generate({ count: 5, snapshot: snapshot as any, context: memberCtx })
    const anchors = anchorsComposed()
    expect(anchors).not.toContain('a-denim')
    expect(anchors).toContain('a-tailored')
  })
})

describe('createComposerGenerator — variety cap on supporting pieces', () => {
  const memberCtx = {
    dataPartition: 'training',
    realMemberId: 'member-1',
    evaluationProfileId: null,
    selectedStylistId: 'stylist-1',
    contextSnapshot: { type: 'real_member', member_id: 'member-1' },
  } as any

  it('excludes a piece that already supports its share of looks in the scope, and penalises prior use at the shortlist', async () => {
    const SHOE2 = { ...SHOE, item_id: 'item-shoe-2' }
    POOL = [garment({ item_id: 'a-1' }), SHOE, SHOE2]
    const gen = createComposerGenerator({} as any)
    await gen.generate({
      count: 1,
      snapshot: SNAPSHOT as any,
      context: memberCtx,
      exclusions: { signatures: new Set(['x|item-shoe', 'y|item-shoe']), anchorItemIds: new Set(['x', 'y']), itemUses: new Map([['item-shoe', 2]]) },
    })
    const opts = composeSpy.mock.calls[0][0]
    expect(libraryIds(0)).not.toContain('item-shoe')
    expect(libraryIds(0)).toContain('item-shoe-2')
    expect(opts.shortlistAdjust(SHOE)).toBeLessThan(opts.shortlistAdjust(SHOE2))
  })

  it('relaxes the cap when nothing else composes, rather than producing no look', async () => {
    POOL = [garment({ item_id: 'a-1' }), SHOE]
    composeSpy.mockImplementation((opts: any) =>
      (opts.library as any[]).some((i) => i.item_id === 'item-shoe') ? (onePick() as any) : { picks: [], rejectionHits: [] },
    )
    const gen = createComposerGenerator({} as any)
    const out = await gen.generate({
      count: 1,
      snapshot: SNAPSHOT as any,
      context: memberCtx,
      exclusions: { signatures: new Set(), anchorItemIds: new Set(), itemUses: new Map([['item-shoe', 5]]) },
    })
    expect(out).toHaveLength(1)
    expect(composeSpy).toHaveBeenCalledTimes(2)
  })

  it('counts pieces used earlier in the SAME chunk, so one heel cannot carry every look', async () => {
    const SHOE2 = { ...SHOE, item_id: 'item-shoe-2' }
    POOL = [garment({ item_id: 'a-1' }), garment({ item_id: 'a-2' }), garment({ item_id: 'a-3' }), SHOE, SHOE2]
    const gen = createComposerGenerator({} as any)
    await gen.generate({ count: 3, snapshot: SNAPSHOT as any, context: memberCtx })
    // Every look took item-shoe (the spy always returns it); by the third
    // anchor it has supported two looks and is excluded from that library.
    expect(libraryIds(0)).toContain('item-shoe')
    expect(libraryIds(1)).toContain('item-shoe')
    expect(libraryIds(2)).not.toContain('item-shoe')
  })
})

// ── Real members: her sizes, her gates, her shoes ───────────────────────────

const SNEAKER = (id: string) => ({ ...SHOE, item_id: id, item_type: 'sneaker', image_url: `https://cdn.example.com/${id}.jpg` })

const taste = (prefs: Partial<{ types_loved: string[]; types_avoided: string[] }> = {}) => ({
  affinity: new Map(), families: new Map(), excludedPairs: new Set(), inputOnlyBrands: new Set(),
  itemSwapOut: new Map(), brandSwapOut: new Map(), pairNet: new Map(),
  prefs: { colours_loved: [], colours_avoided: [], shapes_loved: [], shapes_avoided: [], types_loved: [], types_avoided: [], ...prefs },
})

describe('createComposerGenerator — a real member composes through her own gates', () => {
  const memberCtx = {
    dataPartition: 'training',
    realMemberId: 'member-1',
    evaluationProfileId: null,
    selectedStylistId: 'stylist-1',
    contextSnapshot: { type: 'real_member', member_id: 'member-1' },
  } as any

  it('gates the pool to her declared sizes on stored rows, fail closed', async () => {
    const confirmed = garment({ item_id: 'a-confirmed' })
    const noRows = garment({ item_id: 'a-norows' })
    const soldOut = garment({ item_id: 'a-soldout' })
    POOL = [noRows, soldOut, confirmed, SHOE]
    SIZE_ROWS = new Map([
      ['a-confirmed', [sizeRow()]],
      ['a-soldout', [sizeRow({ in_stock: false, stock_level: 'sold_out' })]],
    ])
    MEMBER_CTX = { taste: null, sizeProfile: PROFILE_SIZES }
    const gen = createComposerGenerator({} as any)
    await gen.generate({ count: 5, snapshot: SNAPSHOT as any, context: memberCtx })
    expect(anchorsComposed()).toEqual(['a-confirmed'])
  })

  it('removes the types she avoids and lets her loved trainers own the shoe slot', async () => {
    const sneakers = ['s-1', 's-2', 's-3', 's-4'].map(SNEAKER)
    POOL = [garment({ item_id: 'a-1' }), SHOE, ...sneakers]
    MEMBER_CTX = { taste: taste({ types_loved: ['sneaker'], types_avoided: ['heel'] }), sizeProfile: {} }
    const gen = createComposerGenerator({} as any)
    await gen.generate({ count: 1, snapshot: SNAPSHOT as any, context: memberCtx })
    const lib = libraryIds(0)
    expect(lib).not.toContain('item-shoe')
    for (const s of sneakers) expect(lib).toContain(s.item_id)
    // Her taste pulls the shortlist: a loved type ranks above a plain one.
    const adjust = composeSpy.mock.calls[0][0].shortlistAdjust
    expect(adjust).toBeTypeOf('function')
    expect(adjust(sneakers[0])).toBeGreaterThan(adjust(garment({ item_id: 'plain', item_type: 'trousers' })))
  })

  it('keeps every shoe when she loves trainers but too few exist to vary', async () => {
    const sneakers = ['s-1', 's-2'].map(SNEAKER)
    POOL = [garment({ item_id: 'a-1' }), SHOE, ...sneakers]
    MEMBER_CTX = { taste: taste({ types_loved: ['sneaker'] }), sizeProfile: {} }
    const gen = createComposerGenerator({} as any)
    await gen.generate({ count: 1, snapshot: SNAPSHOT as any, context: memberCtx })
    expect(libraryIds(0)).toContain('item-shoe')
  })
})

describe('createComposerGenerator — a look is the review shape', () => {
  const memberCtx = {
    dataPartition: 'training',
    realMemberId: 'member-1',
    evaluationProfileId: null,
    selectedStylistId: 'stylist-1',
    contextSnapshot: { type: 'real_member', member_id: 'member-1' },
  } as any

  it('requires the anchor and shoes for a dress; the other garment too for separates', async () => {
    POOL = [garment({ item_id: 'a-dress' }), garment({ item_id: 'a-top', item_type: 'blouse' }), SHOE]
    const gen = createComposerGenerator({} as any)
    const out = await gen.generate({ count: 2, snapshot: SNAPSHOT as any, context: memberCtx })
    const byAnchor = new Map(out.map((c) => [c.anchorItemId, c.requiredSlots]))
    expect(byAnchor.get('a-dress')).toEqual(['dress', 'shoe'])
    expect(byAnchor.get('a-top')).toEqual(['top', 'bottom', 'shoe'])
  })

  it('never hands the recipe outerwear to compose with', async () => {
    POOL = [garment({ item_id: 'a-1' }), garment({ item_id: 'coat', item_type: 'coat' }), SHOE]
    const gen = createComposerGenerator({} as any)
    await gen.generate({ count: 1, snapshot: SNAPSHOT as any, context: memberCtx })
    expect(libraryIds(0)).not.toContain('coat')
  })
})
