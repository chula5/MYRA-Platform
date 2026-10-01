import { describe, it, expect } from 'vitest'
import {
  profileFactsFromContext,
  buildSizeProfile,
  hasAnySize,
  keepForProfileSize,
  budgetTiers,
  budgetMaxGbp,
  profileItemAffinity,
  brandGroupsForBrand,
  CONTROLLED_BRAND_GROUP_KEYS,
  type EvaluationProfileFacts,
  type AffinityItemFacts,
} from '@/lib/outfit-quality/profile-context'
import { BRAND_GROUPS } from '@/app/onboarding/brand-groups'

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
    brand_name: null,
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
      brand_groups: ['parisian'],
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

describe('keepForProfileSize — size gate for generation (fail closed)', () => {
  it('always keeps genuinely unsized pieces regardless of match quality', () => {
    expect(keepForProfileSize(false, 'none', false)).toBe(true)
    expect(keepForProfileSize(false, 'unknown', false)).toBe(true)
  })
  it('keeps a sized piece only when a WEARABLE matching size exists', () => {
    expect(keepForProfileSize(true, 'full', true)).toBe(true)
    expect(keepForProfileSize(true, 'acceptable', true)).toBe(true)
    // A matching size that is SOLD OUT (wearable=false) is not kept, even
    // though the match quality is full/acceptable.
    expect(keepForProfileSize(true, 'full', false)).toBe(false)
    expect(keepForProfileSize(true, 'acceptable', false)).toBe(false)
    expect(keepForProfileSize(true, 'none', false)).toBe(false)
    // Unknown sizing is NOT kept — it would fail the objective check closed.
    expect(keepForProfileSize(true, 'unknown', true)).toBe(false)
  })
})

describe('controlled brand groups', () => {
  it('exposes exactly the onboarding BRAND_GROUPS keys', () => {
    expect(CONTROLLED_BRAND_GROUP_KEYS).toEqual(BRAND_GROUPS.map((g) => g.key))
    expect(CONTROLLED_BRAND_GROUP_KEYS).toEqual([
      'parisian', 'quiet_luxury', 'tailoring', 'romantic', 'contemporary', 'designer', 'directional',
    ])
  })
  it('resolves brand membership by actual brand list, normalised', () => {
    expect(brandGroupsForBrand('Rixo')).toEqual(['contemporary'])
    expect(brandGroupsForBrand('Khaite')).toEqual(['designer'])
    // Normalisation: case, accents, and "&" spellings all resolve.
    expect(brandGroupsForBrand('RIXO')).toEqual(['contemporary'])
    expect(brandGroupsForBrand('Bec + Bridge')).toEqual(['contemporary'])
    expect(brandGroupsForBrand('Sezane')).toEqual(['parisian'])
    // A brand in no controlled list has no membership.
    expect(brandGroupsForBrand('Some Unknown Label')).toEqual([])
    expect(brandGroupsForBrand(null)).toEqual([])
  })
})

describe('budget', () => {
  it('derives accepted price tiers from the budget profile only', () => {
    expect(budgetTiers(FACTS)).toEqual([3])
    // Brand groups are an aesthetic membership signal, NOT a price-tier map:
    // they never contribute tiers.
    expect(budgetTiers({ ...FACTS, brand_groups: ['designer'], budget_profile: {} })).toEqual([])
    // Legacy price-tier labels in brand_groups contribute nothing either.
    expect(budgetTiers({ ...FACTS, brand_groups: ['luxury'], budget_profile: {} })).toEqual([])
  })
  it('reads a numeric max budget or null', () => {
    expect(budgetMaxGbp(FACTS)).toBe(500)
    expect(budgetMaxGbp({ ...FACTS, budget_profile: { max_gbp: null } })).toBeNull()
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
  it('scores brand-group membership by the actual brand list', () => {
    const inGroup = profileItemAffinity(FACTS, item({ brand_name: 'Rixo' }))
    const wrongGroup = profileItemAffinity(FACTS, item({ brand_name: 'Khaite' }))
    const unknown = profileItemAffinity(FACTS, item({ brand_name: 'Some Unknown Label' }))
    expect(inGroup).toBeGreaterThan(unknown)
    expect(unknown).toBeGreaterThan(wrongGroup)
  })
  it('ignores brand_groups values that are not controlled keys', () => {
    const legacy: EvaluationProfileFacts = { ...FACTS, brand_groups: ['high_street', 'luxury'] }
    // No controlled key → membership scoring is neutral for every brand.
    const a = profileItemAffinity(legacy, item({ brand_name: 'Rixo' }))
    const b = profileItemAffinity(legacy, item({ brand_name: 'Khaite' }))
    expect(a).toBe(b)
  })
})
