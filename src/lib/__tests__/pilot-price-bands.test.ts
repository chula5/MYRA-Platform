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

const priced = (byCat: Record<string, number>, overall?: number) => ({
  median_price_by_category: Object.fromEntries(
    Object.entries(byCat).map(([cat, median]) => [cat, { median, count: 10 }]),
  ),
  median_price_overall: overall ?? Object.values(byCat)[0] ?? null,
})

describe('price gate on brand suggestions', () => {
  it('lets a brand near her ceiling through and blocks one far above it, per category', () => {
    // £300 dress ceiling, 1.5x headroom → dresses up to £450 are reachable
    const bands = { dress: { min: null, max: 300 } }
    expect(withinMemberPriceReach(bands, priced({ dresses: 280 }))).toBe(true)
    expect(withinMemberPriceReach(bands, priced({ dresses: 440 }))).toBe(true)
    expect(withinMemberPriceReach(bands, priced({ dresses: 508 }))).toBe(false) // the Cult Gaia case
    expect(EXPANSION_PRICE_HEADROOM).toBe(1.5)
  })

  it('judges like-for-like: a dear dress house with reachable tops is reachable', () => {
    // The Zimmermann case: dresses far above her dress ceiling, tops within
    // her tops band — she shops the brand through its cheaper categories.
    const bands = { dress: { min: null, max: 400 }, top: { min: null, max: 300 } }
    expect(withinMemberPriceReach(bands, priced({ dresses: 900, tops: 380 }))).toBe(true)
    expect(withinMemberPriceReach(bands, priced({ dresses: 900, tops: 700 }))).toBe(false)
  })

  it('uses her outerwear budget for coats, not for dresses — no cross-category leak', () => {
    // Regression: a single max ceiling let a £700 dress brand through on the
    // strength of a £570 outerwear band.
    const bands = { dress: { min: null, max: 400 }, outerwear: { min: null, max: 570 } }
    expect(withinMemberPriceReach(bands, priced({ dresses: 700 }))).toBe(false)
    expect(withinMemberPriceReach(bands, priced({ outerwear: 700 }))).toBe(true)
  })

  it('falls back to overall median vs her highest ceiling when no category overlaps', () => {
    const bands = { dress: { min: null, max: 300 } }
    expect(withinMemberPriceReach(bands, { median_price_by_category: null, median_price_overall: 280 })).toBe(true)
    expect(withinMemberPriceReach(bands, { median_price_by_category: null, median_price_overall: 900 })).toBe(false)
  })

  it('holds no opinion when either side is unknown', () => {
    expect(withinMemberPriceReach(null, priced({ dresses: 900 }))).toBe(true) // she stated no ceiling
    expect(withinMemberPriceReach({ dress: { min: null, max: 300 } }, null)).toBe(true) // unknown brand
    expect(withinMemberPriceReach({ dress: { min: null, max: 300 } }, { median_price_by_category: null, median_price_overall: null })).toBe(true)
    expect(withinMemberPriceReach({}, priced({ dresses: 900 }))).toBe(true)
  })

  it('drops an over-priced brand from the expansion set entirely', () => {
    const named = [{ brand_id: 'sessun', name: 'Sessùn', vector_item_count: 20 } as any]
    const similar = new Map([['sessun', [
      { brand_id: 'cheap', name: 'Sézane', mechanism: 'vector', score: 0.9, aesthetic: 0.9 } as any,
      { brand_id: 'dear', name: 'Cult Gaia', mechanism: 'vector', score: 0.94, aesthetic: 0.94 } as any,
    ]]])
    const brandById = new Map<string, any>([
      ['cheap', priced({ dresses: 132 })],
      ['dear', priced({ dresses: 508 })],
    ])

    const ungated = expansionSeeds(named, similar)
    expect(Array.from(ungated.keys()).sort()).toEqual(['cheap', 'dear'])

    const gated = expansionSeeds(named, similar, { priceBands: { dress: { min: null, max: 300 } }, brandById })
    expect(Array.from(gated.keys())).toEqual(['cheap'])
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
