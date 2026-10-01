// Behavioural tests for the REAL Quality Lab generation/checking adapters
// (generation-adapters.ts), with only the outermost boundaries faked:
// the item pool, the composer, and the size-row loader. The size matching
// (resolveAvailability), price contract (priceOfItem), brand membership, and
// profile-context logic under test are the real production code.

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
    image_url: 'https://cdn.example.com/a.jpg',
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

const generateCandidatesSpy = vi.fn((opts: any) => {
  return [{ items: [{ item: SHOE, slot: 'shoe' }], score: 1 }] as any
})

vi.mock('@/lib/admin-queries', () => ({
  getReadyAndLiveItems: vi.fn(async () => POOL),
}))

vi.mock('@/lib/composer', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/composer')>()
  return { ...actual, generateCandidates: (opts: any) => generateCandidatesSpy(opts) }
})

vi.mock('@/lib/size-availability', () => ({
  loadSizeRowsFor: vi.fn(async () => SIZE_ROWS),
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
  generateCandidatesSpy.mockClear()
})

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

    const anchorIds = generateCandidatesSpy.mock.calls.map((c) => c[0].anchor.item_id)
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
    expect(generateCandidatesSpy.mock.calls.map((c) => c[0].anchor.item_id)).toEqual(['a-available'])
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
    const call = generateCandidatesSpy.mock.calls[0]?.[0]
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

    const anchorIds = generateCandidatesSpy.mock.calls.map((c) => c[0].anchor.item_id)
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
    expect(generateCandidatesSpy.mock.calls.map((c) => c[0].anchor.item_id)).toEqual(['a-first', 'a-second'])
    expect(generateCandidatesSpy.mock.calls[0][0].shortlistAdjust).toBeUndefined()
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

    const anchorIds = generateCandidatesSpy.mock.calls.map((c) => c[0].anchor.item_id)
    expect(anchorIds).toEqual(['a-good'])
    // The library passed to the composer contains neither unusable item.
    const library = generateCandidatesSpy.mock.calls[0][0].library as any[]
    expect(library.map((i) => i.item_id)).not.toContain('a-brandless')
    expect(library.map((i) => i.item_id)).not.toContain('a-typeless')
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
