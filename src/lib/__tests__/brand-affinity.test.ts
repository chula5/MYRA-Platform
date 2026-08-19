import { describe, expect, it } from 'vitest'
import {
  applyDiscoverySlots, brandKey, centroidOf, codesComplete, codesSimilarity, combinedTaste,
  computeSimilarBrands, expansionSeeds, ghostCodes, heroBrandOf, isThinBrand,
  outfitBrandAffinity, pcaProject1D, positioningBand, priceProximity, stepDecay, stepPositive,
  CODE_DIMENSIONS, DEFAULT_CONFIG, SEED, type BrandLite, type FeedRow,
} from '@/lib/brand-affinity'

const b = (id: string, name: string, tier: number, vector: number[] | null = null, price = 300): BrandLite => ({
  brand_id: id, name, aliases: [], price_tier: tier, status: 'stocked',
  brand_vector: vector, vector_item_count: 10,
  median_price_overall: price,
  median_price_by_category: { dresses: { median: price, count: 20 } },
  core_category: 'dresses',
  price_position: Math.log(price),
  codes: null,
})

// fully coded brand — base profile with per-dimension overrides
const coded = (id: string, name: string, price: number, overrides: Record<string, number> = {}): BrandLite => ({
  ...b(id, name, 2, null, price),
  codes: Object.fromEntries(CODE_DIMENSIONS.map((d) => [d, overrides[d] ?? 3])),
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
    b('sez', 'Sézane', 2, vec(0.9), 300),
    b('cp', 'Claudie Pierlot', 2, vec(0.85), 320),
    b('maje', 'Maje', 2, vec(0.8), 280),
    b('row', 'The Row', 5, vec(0.88), 3000), // vector-close but 10x the price
    b('near', 'Nearby Label', 3, vec(0.87), 400), // vector-close, 1.3x the price
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

  it('price floor excludes far-priced pairs from algorithmic discovery; curation overrides', () => {
    const out = computeSimilarBrands('sez', { brands, families: [family], memberships, exclusions: [] })
    expect(out.find((s) => s.brand_id === 'row')).toBeUndefined() // 10x price → factor < 0.3
    const near = out.find((s) => s.brand_id === 'near') // 1.3x price → in, decomposed
    expect(near).toBeDefined()
    expect(near!.aesthetic).toBeGreaterThan(0)
    expect(near!.priceFactor).toBeGreaterThan(0.8)
    expect(near!.score).toBeCloseTo(near!.aesthetic! * near!.priceFactor!, 2)
    // curation overrides the price floor
    const withRowFamily = computeSimilarBrands('sez', {
      brands, families: [family],
      memberships: [...memberships, { family_id: 'f1', brand_id: 'row', weight: 'core' as const }],
      exclusions: [],
    })
    expect(withRowFamily.find((s) => s.brand_id === 'row')?.mechanism).toBe('core_family')
  })

  it('thin brands get no algorithmic neighbours and never appear as one', () => {
    const thin = { ...b('thin', 'Emilia Wickstead', 3, vec(0.89), 900), vector_item_count: 1 }
    expect(isThinBrand(thin)).toBe(true)
    // from a thin brand: nothing algorithmic (family still works)
    expect(computeSimilarBrands('thin', { brands: [...brands, thin], families: [], memberships: [], exclusions: [] })).toEqual([])
    // toward a thin brand: never suggested
    const out = computeSimilarBrands('sez', { brands: [...brands, thin], families: [family], memberships, exclusions: [] })
    expect(out.find((s) => s.brand_id === 'thin')).toBeUndefined()
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

describe('price axis', () => {
  it('price_proximity decays with the price ratio (k=1.8)', () => {
    const a = b('a', 'A', 2, null, 300)
    const same = priceProximity(a, b('s', 'S', 2, null, 300), DEFAULT_CONFIG.priceK)
    const double = priceProximity(a, b('d', 'D', 2, null, 600), DEFAULT_CONFIG.priceK)
    const quad = priceProximity(a, b('q', 'Q', 2, null, 1200), DEFAULT_CONFIG.priceK)
    expect(same!.factor).toBe(1)
    expect(double!.factor).toBeCloseTo(0.68, 1)
    expect(quad!.factor).toBeCloseTo(0.46, 1)
  })

  it('compares like-for-like: shared populated category beats core positions', () => {
    const a: BrandLite = { ...b('a', 'A', 2, null, 300), median_price_by_category: { dresses: { median: 300, count: 20 }, bags: { median: 100, count: 5 } } }
    const c: BrandLite = { ...b('c', 'C', 2, null, 900), median_price_by_category: { bags: { median: 110, count: 8 } }, core_category: 'bags' }
    // core positions differ 3x, but the shared bags category is near-identical
    const pp = priceProximity(a, c, DEFAULT_CONFIG.priceK)
    expect(pp!.basis).toBe('bags')
    expect(pp!.factor).toBeGreaterThan(0.9)
  })

  it('positioning bands follow the configured bounds', () => {
    const bounds = DEFAULT_CONFIG.bandBounds
    expect(positioningBand(Math.log(100), bounds)).toBe(0) // high street
    expect(positioningBand(Math.log(200), bounds)).toBe(1) // accessible
    expect(positioningBand(Math.log(500), bounds)).toBe(2) // contemporary
    expect(positioningBand(Math.log(3000), bounds)).toBe(5) // luxury
    expect(positioningBand(null, bounds)).toBeNull()
  })
})

describe('brand codes', () => {
  it('codesComplete requires all 11 dimensions', () => {
    const full = coded('a', 'A', 300)
    expect(codesComplete(full)).toBe(true)
    const partial = { ...full, codes: { price_positioning: 3 } }
    expect(codesComplete(partial)).toBe(false)
  })

  it('codesSimilarity: identical high, opposed low, all-neutral pair identical', () => {
    const minimal = coded('m', 'M', 300, { aesthetic_output: 1, colour_identity: 1, statement_density: 1 })
    const minimal2 = coded('m2', 'M2', 300, { aesthetic_output: 1.5, colour_identity: 1, statement_density: 1.5 })
    const loud = coded('l', 'L', 300, { aesthetic_output: 5, colour_identity: 5, statement_density: 5 })
    expect(codesSimilarity(minimal.codes!, minimal2.codes!)).toBeGreaterThan(0.9)
    expect(codesSimilarity(minimal.codes!, loud.codes!)).toBe(0) // opposed → clamped at 0
    const neutralA = coded('n1', 'N1', 300).codes!
    const neutralB = coded('n2', 'N2', 300).codes!
    expect(codesSimilarity(neutralA, neutralB)).toBe(1) // no direction → distance-based, identical
  })

  it('coded pairs use codes; incomplete pairs fall back to item-centroid (provisional)', () => {
    const a = coded('a', 'A', 300, { aesthetic_output: 1 })
    const c = coded('c', 'C', 320, { aesthetic_output: 1.5 })
    const uncoded = b('u', 'U', 2, vec(0.9), 300)
    const uncoded2 = b('u2', 'U2', 2, vec(0.88), 320)
    const graph = { brands: [a, c, uncoded, uncoded2], families: [], memberships: [], exclusions: [] }
    const fromCoded = computeSimilarBrands('a', graph)
    expect(fromCoded.find((s) => s.brand_id === 'c')?.basis).toBe('codes')
    const fromUncoded = computeSimilarBrands('u', graph)
    expect(fromUncoded.find((s) => s.brand_id === 'u2')?.basis).toBe('vector') // provisional
  })

  it('price fallback: price_positioning codes when item price data is thin', () => {
    const a = { ...coded('a', 'A', 300, { price_positioning: 2 }), price_position: null, median_price_by_category: null }
    const c = { ...coded('c', 'C', 300, { price_positioning: 4 }), price_position: null, median_price_by_category: null }
    const pp = priceProximity(a, c, DEFAULT_CONFIG.priceK)
    expect(pp!.basis).toBe('price positioning code')
    expect(pp!.factor).toBeLessThan(0.5) // £300 vs £1500 pseudo → big gap
  })

  it('ghostCodes maps the item centroid onto mappable dimensions only', () => {
    const v = new Array(34).fill(0.5)
    v[0] = 1 // fully unstructured → fluid silhouette
    v[1] = 0; v[20] = 0; v[21] = 0; v[14] = 1 // no print, all neutral
    v[30] = 0 // casual materials
    const g = ghostCodes({ brand_vector: v, price_position: Math.log(500) }, DEFAULT_CONFIG.bandBounds)
    expect(g.silhouette_language).toBe(5)
    expect(g.colour_identity).toBe(1)
    expect(g.occasion_gravity).toBe(1)
    expect(g.price_positioning).toBeCloseTo(2.6, 1) // £500 → contemporary band
    expect(g.femininity_register).toBeUndefined() // no sensible mapping
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
