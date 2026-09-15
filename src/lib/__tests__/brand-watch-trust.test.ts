import { describe, it, expect } from 'vitest'
import { measureBrandTrust, summariseTrust, TRUST_MIN_PREDICTIONS, type TrustDecision } from '../brand-watch-trust'

const at = (n: number) => new Date(Date.UTC(2026, 8, 1) + n * 60_000).toISOString()
const decision = (n: number, brand: string, kept: boolean, name: string, extra: Partial<TrustDecision> = {}): TrustDecision => ({
  at: at(n), kept, brandName: brand, productName: name, itemType: 'shirt', colourFamily: 'cream',
  materialCategory: 'natural_woven', price: '120', priceGbp: 120, score: 6, minScore: 5, ...extra,
})

describe('measureBrandTrust', () => {
  it('trusts a brand whose auto-keeps she actually kept', () => {
    const ds = Array.from({ length: 30 }, (_, i) => decision(i, 'Skall', true, 'Linen Shirt'))
    const t = measureBrandTrust(ds, 5).get('Skall')!
    expect(t.predictions).toBeGreaterThanOrEqual(TRUST_MIN_PREDICTIONS)
    expect(t.trusted).toBe(true)
  })

  it('does not trust a brand where the same kind of piece is kept and skipped', () => {
    const ds = Array.from({ length: 60 }, (_, i) => decision(i, 'Mixed', i % 3 !== 0, 'Linen Shirt'))
    const t = measureBrandTrust(ds, 5).get('Mixed')!
    expect(t.trusted).toBe(false)
  })

  it('never counts bulk keeps as proof', () => {
    const bulkAt = at(0)
    const ds = Array.from({ length: 40 }, (_, i) => decision(i, 'Bulk', true, 'Linen Shirt', { at: bulkAt }))
    const t = measureBrandTrust(ds, 5).get('Bulk')!
    expect(t.careful).toBe(0)
    expect(t.trusted).toBe(false)
  })

  it('never counts its own auto-keeps as proof', () => {
    const ds = Array.from({ length: 40 }, (_, i) => decision(i, 'Auto', true, 'Linen Shirt', { autoKept: true }))
    expect(measureBrandTrust(ds, 5).get('Auto')!.trusted).toBe(false)
  })

  it('will not auto-keep a piece below the brand min score', () => {
    const ds = Array.from({ length: 30 }, (_, i) => decision(i, 'Low', true, 'Linen Shirt', { score: 3 }))
    expect(measureBrandTrust(ds, 5).get('Low')!.predictions).toBe(0)
  })
})

describe('summariseTrust', () => {
  it('says what is missing', () => {
    expect(summariseTrust(0, 0, 0).summary).toBe('NO ONE-BY-ONE DECISIONS YET')
    expect(summariseTrust(12, 4, 4).summary).toMatch(/^LEARNING — 4 OF 10/)
    expect(summariseTrust(20, 11, 6).summary).toMatch(/^NOT YET — RIGHT 6 OF 11/)
    expect(summariseTrust(25, 20, 20).summary).toBe('TRUSTED — RIGHT 20 OF 20')
  })
})
