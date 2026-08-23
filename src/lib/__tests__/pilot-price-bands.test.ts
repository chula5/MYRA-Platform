import { describe, it, expect } from 'vitest'
import { priceVerdict, bandForItem, priceBucketFor, readPriceBands, hasPriceBands, PRICE_BUCKETS } from '@/lib/pilot-stylist'

const bands = { default: { min: 60, max: 300 }, dress: { min: 80, max: 350 }, bag: { min: 150, max: 900 } }

describe('price buckets', () => {
  it('routes every item type to exactly one bucket', () => {
    const seen = new Map<string, string>()
    for (const b of PRICE_BUCKETS) for (const t of b.types) {
      expect(seen.has(t)).toBe(false) // no type in two buckets
      seen.set(t, b.id)
    }
    expect(priceBucketFor('midi_dress')).toBe('dress')
    expect(priceBucketFor('blazer')).toBe('outerwear')
    expect(priceBucketFor('crossbody')).toBe('bag')
    expect(priceBucketFor(null)).toBe(null)
  })
})

describe('bandForItem', () => {
  it('prefers the bucket, falls back to the default for clothing', () => {
    expect(bandForItem(bands, 'midi_dress')).toEqual({ min: 80, max: 350 })
    expect(bandForItem(bands, 'blazer')).toEqual({ min: 60, max: 300 }) // no outerwear band → default
  })

  it('never lets accessories inherit the clothing default', () => {
    // shoes have no band here: no opinion, NOT the £60-300 clothing range
    expect(bandForItem(bands, 'heel')).toBe(null)
    expect(bandForItem(bands, 'earrings')).toBe(null)
    // a bag has its own, higher band
    expect(bandForItem(bands, 'tote')).toEqual({ min: 150, max: 900 })
  })
})

describe('priceVerdict', () => {
  it('is the Isabel Marant case: loves the brand, not the £600 jacket', () => {
    expect(priceVerdict(bands, { item_type: 'jacket', price_gbp: 600 })).toBe('over')
    expect(priceVerdict(bands, { item_type: 'midi_dress', price_gbp: 300 })).toBe('in')
  })

  it('lets a bag sit well above the clothing ceiling', () => {
    expect(priceVerdict(bands, { item_type: 'tote', price_gbp: 700 })).toBe('in')
    // the same £700 on a coat is over
    expect(priceVerdict(bands, { item_type: 'coat', price_gbp: 700 })).toBe('over')
  })

  it('flags below her floor without vetoing it', () => {
    expect(priceVerdict(bands, { item_type: 'shirt', price_gbp: 20 })).toBe('under')
  })

  it('never judges a piece it cannot price', () => {
    expect(priceVerdict(bands, { item_type: 'coat', price_gbp: null })).toBe('unknown')
    expect(priceVerdict(bands, { item_type: 'coat', price_gbp: 0 })).toBe('unknown')
    expect(priceVerdict(undefined, { item_type: 'coat', price_gbp: 900 })).toBe('unknown')
    expect(priceVerdict({}, { item_type: 'coat', price_gbp: 900 })).toBe('unknown')
  })

  it('honours a one-sided band', () => {
    expect(priceVerdict({ default: { max: 200 } }, { item_type: 'shirt', price_gbp: 10 })).toBe('in')
    expect(priceVerdict({ default: { min: 50 } }, { item_type: 'shirt', price_gbp: 9000 })).toBe('in')
  })
})

describe('readPriceBands', () => {
  it('drops junk and survives a pre-0049 row', () => {
    expect(readPriceBands(null)).toEqual({})
    expect(readPriceBands({})).toEqual({})
    expect(readPriceBands({ price_bands: { dress: { min: 'x', max: 350 } } })).toEqual({ dress: { min: null, max: 350 } })
    expect(readPriceBands({ price_bands: { dress: { min: -5, max: 0 } } })).toEqual({ dress: { min: null, max: null } })
  })

  it('knows when nothing has been set', () => {
    expect(hasPriceBands({})).toBe(false)
    expect(hasPriceBands({ dress: { min: null, max: null } })).toBe(false)
    expect(hasPriceBands({ dress: { max: 350 } })).toBe(true)
  })
})

import { withinMemberPriceReach, expansionSeeds, EXPANSION_PRICE_HEADROOM } from '@/lib/brand-affinity'

describe('price gate on brand suggestions', () => {
  it('lets a brand near her ceiling through and blocks one far above it', () => {
    // £300 clothing ceiling, 1.5x headroom → up to £450 is reachable
    expect(withinMemberPriceReach(300, 280)).toBe(true)
    expect(withinMemberPriceReach(300, 440)).toBe(true)
    expect(withinMemberPriceReach(300, 508)).toBe(false) // the Cult Gaia case
    expect(EXPANSION_PRICE_HEADROOM).toBe(1.5)
  })

  it('holds no opinion when either side is unknown', () => {
    expect(withinMemberPriceReach(null, 900)).toBe(true) // she stated no ceiling
    expect(withinMemberPriceReach(300, null)).toBe(true) // brand has no median
    expect(withinMemberPriceReach(0, 900)).toBe(true)
  })

  it('drops an over-priced brand from the expansion set entirely', () => {
    const named = [{ brand_id: 'sessun', name: 'Sessùn' } as any]
    const similar = new Map([['sessun', [
      { brand_id: 'cheap', name: 'Sézane', mechanism: 'vector', score: 0.9 } as any,
      { brand_id: 'dear', name: 'Cult Gaia', mechanism: 'vector', score: 0.94 } as any,
    ]]])
    const medians = new Map<string, number | null>([['cheap', 132], ['dear', 508]])

    const ungated = expansionSeeds(named, similar)
    expect([...ungated.keys()].sort()).toEqual(['cheap', 'dear'])

    const gated = expansionSeeds(named, similar, { priceCeiling: 300, medianById: medians })
    expect([...gated.keys()]).toEqual(['cheap'])
  })
})

describe('brand provenance', () => {
  it('a positive signal must not un-name a brand she named herself', async () => {
    // Regression: applyBrandSignals wrote source:'learned' unconditionally, so
    // liking a look containing Sessùn erased the fact she named Sessùn at
    // intake. The map then reported "SHE NAMED · 0" for a member with five.
    const src = await import('node:fs').then((fs) =>
      fs.readFileSync(new URL('../brand-affinity.ts', import.meta.url), 'utf8'))
    const positiveBranch = src.slice(src.indexOf('if (positive) {'), src.indexOf('if (positive) {') + 700)
    expect(positiveBranch).toContain("old?.source === 'onboarded' ? 'onboarded' : 'learned'")
    expect(positiveBranch).not.toMatch(/source: 'learned',/)
  })
})
