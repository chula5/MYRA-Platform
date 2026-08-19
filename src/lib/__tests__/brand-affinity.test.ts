import { describe, expect, it } from 'vitest'
import {
  applyDiscoverySlots, brandKey, centroidOf, combinedTaste, computeSimilarBrands,
  expansionSeeds, heroBrandOf, outfitBrandAffinity, pcaProject1D,
  stepDecay, stepPositive, SEED, type BrandLite, type FeedRow,
} from '@/lib/brand-affinity'

const b = (id: string, name: string, tier: number, vector: number[] | null = null): BrandLite => ({
  brand_id: id, name, aliases: [], price_tier: tier, status: 'stocked',
  brand_vector: vector, vector_item_count: 10,
})

const vec = (bias: number) => new Array(34).fill(0.5).map((x, i) => (i < 5 ? bias : x))

describe('brandKey', () => {
  it('normalises accents, case, punctuation', () => {
    expect(brandKey('Sézane')).toBe(brandKey('sezane'))
    expect(brandKey('J.Crew')).toBe(brandKey('j crew'))
    expect(brandKey('A&B')).toBe(brandKey('a and b'))
  })
})

describe('computeSimilarBrands', () => {
  const family = { family_id: 'f1', name: 'French contemporary', description: null }
  const brands = [
    b('sez', 'Sézane', 2, vec(0.9)),
    b('cp', 'Claudie Pierlot', 2, vec(0.85)),
    b('maje', 'Maje', 2, vec(0.8)),
    b('row', 'The Row', 5, vec(0.88)), // vector-close but 3 tiers away
    b('near', 'Nearby Label', 3, vec(0.87)), // vector-close, 1 tier away
  ]
  const memberships = [
    { family_id: 'f1', brand_id: 'sez', weight: 'core' as const },
    { family_id: 'f1', brand_id: 'cp', weight: 'core' as const },
    { family_id: 'f1', brand_id: 'maje', weight: 'adjacent' as const },
  ]

  it('orders core family before adjacent before vector', () => {
    const out = computeSimilarBrands('sez', { brands, families: [family], memberships, exclusions: [] })
    expect(out[0]).toMatchObject({ brand_id: 'cp', mechanism: 'core_family', family_name: 'French contemporary' })
    expect(out[1]).toMatchObject({ brand_id: 'maje', mechanism: 'adjacent_family' })
    expect(out.slice(2).every((s) => s.mechanism === 'vector')).toBe(true)
  })

  it('tier rule blocks vector matches >1 tier away; families can cross tiers', () => {
    const out = computeSimilarBrands('sez', { brands, families: [family], memberships, exclusions: [] })
    expect(out.find((s) => s.brand_id === 'row')).toBeUndefined() // tier 5 vs 2, no family
    expect(out.find((s) => s.brand_id === 'near')).toBeDefined() // tier 3 vs 2, allowed
    // curation overrides the tier rule
    const withRowFamily = computeSimilarBrands('sez', {
      brands, families: [family],
      memberships: [...memberships, { family_id: 'f1', brand_id: 'row', weight: 'core' as const }],
      exclusions: [],
    })
    expect(withRowFamily.find((s) => s.brand_id === 'row')?.mechanism).toBe('core_family')
  })

  it('exclusions override everything, including family', () => {
    const out = computeSimilarBrands('sez', {
      brands, families: [family], memberships,
      exclusions: [{ brand_a: 'cp', brand_b: 'sez' }],
    })
    expect(out.find((s) => s.brand_id === 'cp')).toBeUndefined()
  })
})

describe('expansionSeeds', () => {
  it('seeds 0.6 core / 0.45 adjacent / 0.35 vector with a one-line trace', () => {
    const named = [b('sez', 'Sézane', 2, vec(0.9))]
    const similar = new Map([[
      'sez', [
        { brand_id: 'cp', name: 'Claudie Pierlot', mechanism: 'core_family' as const, family_name: 'French contemporary' },
        { brand_id: 'maje', name: 'Maje', mechanism: 'adjacent_family' as const, family_name: 'French contemporary' },
        { brand_id: 'near', name: 'Nearby', mechanism: 'vector' as const, score: 0.72 },
      ],
    ]])
    const seeds = expansionSeeds(named, similar)
    expect(seeds.get('cp')).toMatchObject({ value: SEED.coreFamily })
    expect(seeds.get('cp')!.trace).toBe("core family 'French contemporary' via Sézane")
    expect(seeds.get('maje')!.value).toBe(SEED.adjacentFamily)
    expect(seeds.get('near')!.value).toBe(SEED.vectorOnly)
    expect(seeds.get('near')!.trace).toContain('vector 0.72')
  })

  it('when two named brands seed the same brand, the higher value wins', () => {
    const named = [b('a', 'A', 2), b('x', 'X', 2)]
    const similar = new Map([
      ['a', [{ brand_id: 'z', name: 'Z', mechanism: 'vector' as const, score: 0.6 }]],
      ['x', [{ brand_id: 'z', name: 'Z', mechanism: 'core_family' as const, family_name: 'F' }]],
    ])
    expect(expansionSeeds(named, similar).get('z')!.value).toBe(SEED.coreFamily)
  })
})

describe('feed maths', () => {
  const outfit = {
    outfit_item: [
      { slot: 'dress', item: { brand: { brand_id: 'hero', name: 'Hero' } } },
      { slot: 'shoe', item: { brand: { brand_id: 'shoe', name: 'Shoe' } } },
      { slot: 'bag', item: { brand: { brand_id: 'bag', name: 'Bag' } } },
    ],
  }

  it('hero = dress→top→bottom→outerwear→first', () => {
    expect(heroBrandOf(outfit).brand_id).toBe('hero')
    expect(heroBrandOf({ outfit_item: [{ slot: 'shoe', item: { brand: { brand_id: 's', name: 'S' } } }] }).brand_id).toBe('s')
  })

  it('outfit brand affinity weights the hero 2x', () => {
    const aff = new Map([['hero', 1.0], ['shoe', 0.1], ['bag', 0.1]])
    // (1.0*2 + 0.1 + 0.1) / 4 = 0.55
    expect(outfitBrandAffinity(outfit, aff)).toBeCloseTo(0.55)
  })

  it('combined = 0.6 vector + 0.4 brand; brand-only when no vector', () => {
    expect(combinedTaste(0.5, 1.0)).toBeCloseTo(0.7)
    expect(combinedTaste(null, 0.8)).toBe(0.8)
  })
})

describe('applyDiscoverySlots', () => {
  const row = (id: string, hero: string | null): FeedRow => ({
    outfit: {}, outfit_id: id, occasionMatch: false, vecSim: null, brandAff: 0.5,
    combined: 0.5, heroBrandId: hero, heroBrandName: hero,
  })

  it('places a discovery outfit at every 6th position, ranking otherwise intact', () => {
    const ranked = [
      ...Array.from({ length: 10 }, (_, i) => row(`main${i}`, 'known')),
      row('disc1', 'newbrand'),
    ]
    const out = applyDiscoverySlots(ranked, new Set(['newbrand']), 6)
    expect(out[5].outfit_id).toBe('disc1')
    expect(out[5].discovery).toBe(true)
    expect(out.filter((r) => r.discovery).length).toBe(1)
    expect(out.length).toBe(ranked.length)
    expect(out.slice(0, 5).map((r) => r.outfit_id)).toEqual(['main0', 'main1', 'main2', 'main3', 'main4'])
  })

  it('no discoverable brands → order untouched', () => {
    const ranked = Array.from({ length: 8 }, (_, i) => row(`m${i}`, 'known'))
    const out = applyDiscoverySlots(ranked, new Set(), 6)
    expect(out.map((r) => r.outfit_id)).toEqual(ranked.map((r) => r.outfit_id))
  })
})

describe('affinity arithmetic', () => {
  it('positive steps +0.05 capped at 1.0', () => {
    expect(stepPositive(0.6)).toBeCloseTo(0.65)
    expect(stepPositive(0.98)).toBe(1)
  })
  it('decay steps -0.1 floored at 0.05', () => {
    expect(stepDecay(0.45)).toBeCloseTo(0.35)
    expect(stepDecay(0.08)).toBe(0.05)
  })
})

describe('pcaProject1D', () => {
  it('separates two clusters and stays in [0,1]', () => {
    const a = [vec(0.1), vec(0.12), vec(0.11)]
    const z = [vec(0.9), vec(0.88), vec(0.91)]
    const proj = pcaProject1D([...a, ...z])
    expect(Math.min(...proj)).toBeGreaterThanOrEqual(0)
    expect(Math.max(...proj)).toBeLessThanOrEqual(1)
    const aMean = (proj[0] + proj[1] + proj[2]) / 3
    const zMean = (proj[3] + proj[4] + proj[5]) / 3
    expect(Math.abs(aMean - zMean)).toBeGreaterThan(0.5)
  })
})

describe('centroidOf', () => {
  it('averages vectors, null on empty', () => {
    expect(centroidOf([])).toBeNull()
    expect(centroidOf([[0, 1], [1, 0]])).toEqual([0.5, 0.5])
  })
})
