import { describe, it, expect } from 'vitest'
import { blockedName, retailerName, summariseCatalogue, verdictFor, type CatalogueAssessment } from '../brand-onboarding-rules'

const base: CatalogueAssessment = {
  host: 'sezane.com', brandName: 'Sézane', route: 'shopify', total: 800, sampled: 800,
  fashion: 700, fashionShare: 0.875, onTaste: 140, onTasteShare: 0.2, medianPriceGbp: 120,
  knownBrand: false, memberFavourite: false, hitCatalogueCap: false,
}

describe('blockedName — the names MYRA never carries', () => {
  it('reads the host', () => {
    expect(blockedName('www.zara.com')).toBe('Zara')
    expect(blockedName('www2.hm.com')).toBe('H&M')
    expect(blockedName('prettylittlething.com')).toBe('PrettyLittleThing')
    expect(blockedName('uk.shein.com')).toBe('Shein')
  })
  it('reads the shop name on a custom domain', () => {
    expect(blockedName('shop.example.com', 'ZARA')).toBe('Zara')
    expect(blockedName('shop.example.com', 'H & M')).toBe('H&M')
  })
  it('leaves labels alone', () => {
    expect(blockedName('sezane.com', 'Sézane')).toBeNull()
    expect(blockedName('bazaar.com', 'Bazaar')).toBeNull() // not "zara"
    expect(blockedName('mangoandsalt.com')).toBeNull()
  })
})

describe('retailerName', () => {
  it('knows multi-brand retailers', () => {
    expect(retailerName('www.net-a-porter.com')).toBe('Net-a-Porter')
    expect(retailerName('www.sezane.com')).toBeNull()
  })
})

describe('verdictFor', () => {
  it('declines fast fashion before anything else', () => {
    expect(verdictFor({ ...base, host: 'zara.com' }).verdict).toBe('declined')
  })
  it('says when it cannot read the shop', () => {
    expect(verdictFor({ ...base, route: 'unreadable' }).verdict).toBe('unreadable')
  })
  it('declines a catalogue too large to be a label', () => {
    expect(verdictFor({ ...base, total: 4200 }).verdict).toBe('declined')
    expect(verdictFor({ ...base, hitCatalogueCap: true }).verdict).toBe('declined')
  })
  it('declines a shop that is not womenswear', () => {
    expect(verdictFor({ ...base, fashion: 30, fashionShare: 0.05 }).verdict).toBe('declined')
    expect(verdictFor({ ...base, fashion: 6, fashionShare: 0.9, sampled: 7 }).verdict).toBe('declined')
  })
  it('accepts a catalogue that resonates', () => {
    const r = verdictFor(base)
    expect(r.verdict).toBe('accepted')
    expect(r.reason).toContain('140 of 700')
  })
  it('accepts a known label or a member favourite even when the numbers are thin', () => {
    expect(verdictFor({ ...base, onTaste: 3, onTasteShare: 0.01, knownBrand: true }).verdict).toBe('accepted')
    expect(verdictFor({ ...base, onTaste: 3, onTasteShare: 0.01, memberFavourite: true }).verdict).toBe('accepted')
  })
  it('leaves the in-between for Chloe', () => {
    expect(verdictFor({ ...base, onTaste: 8, onTasteShare: 0.01 }).verdict).toBe('review')
    expect(verdictFor({ ...base, medianPriceGbp: 28 }).verdict).toBe('review')
    expect(verdictFor({ ...base, host: 'www.net-a-porter.com' }).verdict).toBe('review')
  })
  it('cannot judge a shop whose pages would not open', () => {
    const r = verdictFor({ ...base, route: 'browser', sampled: 0, fashion: 0, fashionShare: 0, onTaste: 0, onTasteShare: 0, total: 6000, hitCatalogueCap: true })
    expect(r.verdict).toBe('unreadable')
  })
  it('treats a known label as a label whatever the sitemap says', () => {
    expect(verdictFor({ ...base, route: 'browser', total: 6000, hitCatalogueCap: true, knownBrand: true, sampled: 40, fashion: 38 }).verdict).toBe('accepted')
  })
  it('asks rather than declines when only the sitemap looks huge', () => {
    const r = verdictFor({ ...base, route: 'browser', total: 6000, hitCatalogueCap: true, sampled: 60, fashion: 55, fashionShare: 0.9, onTaste: 50, onTasteShare: 0.9 })
    expect(r.verdict).toBe('review')
    expect(r.reason).toContain('Sitemap')
  })
  it('asks more of the browser route, where scores are thin', () => {
    const browser = { ...base, route: 'browser' as const, onTaste: 100, onTasteShare: 0.3 }
    expect(verdictFor(browser).verdict).toBe('review')
    expect(verdictFor({ ...browser, onTaste: 500, onTasteShare: 0.7 }).verdict).toBe('accepted')
  })
})

describe('summariseCatalogue', () => {
  it('counts fashion, on-taste and the median price', () => {
    const p = (score: number, priceGbp: number | null, extra: Partial<{ nonFashion: boolean; menswear: boolean; banned: boolean }> = {}) =>
      ({ score, priceGbp, nonFashion: false, menswear: false, banned: false, ...extra })
    const a = summariseCatalogue({
      host: 'x.com', brandName: 'X', route: 'shopify', total: 6, knownBrand: false, memberFavourite: false, hitCatalogueCap: false,
      products: [p(7, 100), p(5, 200), p(2, 50), p(9, 300, { menswear: true }), p(9, 10, { nonFashion: true }), p(8, 150, { banned: true })],
    })
    expect(a.fashion).toBe(3)
    expect(a.onTaste).toBe(2)
    expect(a.medianPriceGbp).toBe(100)
    expect(a.fashionShare).toBeCloseTo(0.5)
  })
})
