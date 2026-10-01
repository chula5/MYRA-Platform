import { describe, it, expect } from 'vitest'
import {
  profileFactsFromContext,
  buildSizeProfile,
  hasAnySize,
  keepForProfileSize,
  budgetTiers,
  budgetMaxGbp,
  parsePriceGbp,
  profileItemAffinity,
  BRAND_GROUP_TIERS,
  type EvaluationProfileFacts,
  type AffinityItemFacts,
} from '@/lib/outfit-quality/profile-context'

const FACTS: EvaluationProfileFacts = {
  style_families: ['minimal', 'classic'],
  brand_groups: ['contemporary'],
  budget_profile: { price_tiers: [3], max_gbp: 500 },
  size_profile: {
    tops: { value: 10, adjacent: 12 },
    bottoms: { value: 10, adjacent: null },
    shoes: { value: 6, adjacent: 5 },
  },
  occasions: ['work_standard'],
}

function item(over: Partial<AffinityItemFacts> = {}): AffinityItemFacts {
  return {
    item_type: 'shirt',
    price_gbp: 300,
    brand_price_tier: 3,
    colour_family: 'navy',
    material_formality: 3,
    pattern: 1,
    ...over,
  }
}

describe('profileFactsFromContext', () => {
  it('reads evaluation-profile coverage from the frozen context snapshot', () => {
    const facts = profileFactsFromContext({
      type: 'evaluation_profile',
      style_families: ['relaxed'],
      brand_groups: ['high_street'],
      budget_profile: { price_tiers: [1] },
      size_profile: { tops: { value: 14 } },
      occasions: ['casual_day'],
    })
    expect(facts).not.toBeNull()
    expect(facts!.style_families).toEqual(['relaxed'])
    expect(facts!.occasions).toEqual(['casual_day'])
  })
  it('returns null for a real-member context', () => {
    expect(profileFactsFromContext({ type: 'real_member', member_id: 'm1' })).toBeNull()
    expect(profileFactsFromContext(null)).toBeNull()
  })
})

describe('buildSizeProfile / hasAnySize', () => {
  it('builds a canonical SizeProfile and detects declared sizes', () => {
    const p = buildSizeProfile(FACTS.size_profile)
    expect(p.tops).toEqual({ value: 10, adjacent: 12 })
    expect(p.bottoms).toEqual({ value: 10, adjacent: null })
    expect(p.shoes).toEqual({ value: 6, adjacent: 5 })
    expect(p.outerwear).toBeUndefined()
    expect(hasAnySize(p)).toBe(true)
  })
  it('an empty size profile declares no sizes', () => {
    expect(hasAnySize(buildSizeProfile({}))).toBe(false)
    expect(hasAnySize(buildSizeProfile(null))).toBe(false)
  })
})

describe('keepForProfileSize — size gate for generation', () => {
  it('always keeps genuinely unsized pieces regardless of match quality', () => {
    expect(keepForProfileSize(false, 'none')).toBe(true)
    expect(keepForProfileSize(false, 'unknown')).toBe(true)
  })
  it('keeps a sized piece only when confirmed in (or adjacent to) the profile size', () => {
    expect(keepForProfileSize(true, 'full')).toBe(true)
    expect(keepForProfileSize(true, 'acceptable')).toBe(true)
    expect(keepForProfileSize(true, 'none')).toBe(false)
    // Unknown sizing is NOT kept — it would fail the objective check closed.
    expect(keepForProfileSize(true, 'unknown')).toBe(false)
  })
})

describe('budget', () => {
  it('derives accepted price tiers from budget tiers and brand groups', () => {
    expect(budgetTiers(FACTS)).toEqual([3])
    expect(budgetTiers({ ...FACTS, brand_groups: ['premium', 'luxury'], budget_profile: {} })).toEqual([4, 5])
    expect(BRAND_GROUP_TIERS.high_street).toEqual([1])
  })
  it('reads a numeric max budget or null', () => {
    expect(budgetMaxGbp(FACTS)).toBe(500)
    expect(budgetMaxGbp({ ...FACTS, budget_profile: { max_gbp: null } })).toBeNull()
  })
  it('parses retailer price strings into GBP', () => {
    expect(parsePriceGbp('£295')).toBe(295)
    expect(parsePriceGbp('1,250.00')).toBe(1250)
    expect(parsePriceGbp(420)).toBe(420)
    expect(parsePriceGbp(null)).toBeNull()
  })
})

describe('profileItemAffinity — budget, brand, occasion, style all applied', () => {
  it('rewards an on-budget, on-occasion, on-style item', () => {
    const s = profileItemAffinity(FACTS, item({ item_type: 'blazer', brand_price_tier: 3, colour_family: 'navy', material_formality: 4 }))
    expect(s).toBeGreaterThan(0)
  })
  it('penalises an out-of-tier item', () => {
    const onTier = profileItemAffinity(FACTS, item({ brand_price_tier: 3 }))
    const offTier = profileItemAffinity(FACTS, item({ brand_price_tier: 5 }))
    expect(offTier).toBeLessThan(onTier)
  })
  it('penalises an over-budget price', () => {
    const under = profileItemAffinity(FACTS, item({ price_gbp: 200 }))
    const over = profileItemAffinity(FACTS, item({ price_gbp: 900 }))
    expect(over).toBeLessThan(under)
  })
  it('penalises an occasion-avoided item type', () => {
    const favoured = profileItemAffinity(FACTS, item({ item_type: 'trousers' }))
    const avoided = profileItemAffinity(FACTS, item({ item_type: 'mini_dress' }))
    expect(avoided).toBeLessThan(favoured)
  })
  it('a statement profile rewards non-neutral colour and bold pattern', () => {
    const statement: EvaluationProfileFacts = { ...FACTS, style_families: ['statement'], occasions: [], brand_groups: [], budget_profile: {} }
    const bold = profileItemAffinity(statement, item({ colour_family: 'red', pattern: 5 }))
    const plain = profileItemAffinity(statement, item({ colour_family: 'black', pattern: 1 }))
    expect(bold).toBeGreaterThan(plain)
  })
})
