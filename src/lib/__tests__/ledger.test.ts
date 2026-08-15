import { describe, it, expect } from 'vitest'
import {
  canTransition,
  resolveRate,
  computeCommissionGbp,
  returnWindowEnd,
  commissionBase,
  orderOutcome,
  extractMyraClick,
  attributeFromJourney,
} from '@/lib/ledger/logic'

describe('state machine — the paths money is allowed to take', () => {
  it('allows the happy path', () => {
    expect(canTransition('pending', 'approved')).toBe(true)
    expect(canTransition('approved', 'payable')).toBe(true)
    expect(canTransition('payable', 'paid')).toBe(true)
  })

  it('allows the failure paths (fashion returns run 20–40%)', () => {
    expect(canTransition('pending', 'void')).toBe(true)
    expect(canTransition('approved', 'returned')).toBe(true)
    expect(canTransition('payable', 'returned')).toBe(true)
    expect(canTransition('paid', 'returned')).toBe(true)
  })

  it('forbids everything else — money can never skip or resurrect', () => {
    expect(canTransition('pending', 'payable')).toBe(false)  // never payable inside the window
    expect(canTransition('pending', 'paid')).toBe(false)
    expect(canTransition('pending', 'returned')).toBe(false) // in-window is void, not returned
    expect(canTransition('void', 'approved')).toBe(false)    // terminal
    expect(canTransition('returned', 'approved')).toBe(false)
    expect(canTransition('approved', 'pending')).toBe(false) // no going backwards
  })
})

describe('resolveRate — intro auto-expiry and volume tiers', () => {
  const terms = {
    base_rate: 0.15,
    intro_rate: 0.2,
    intro_expires_at: '2027-02-09T00:00:00Z',
    tier_threshold_gbp: 10_000,
    tier_rate: 0.18,
  }

  it('intro rate applies before expiry', () => {
    expect(resolveRate(terms, new Date('2026-12-01'))).toBe(0.2)
  })

  it('reverts automatically after expiry — no cron, no memory required', () => {
    expect(resolveRate(terms, new Date('2027-03-01'))).toBe(0.15)
  })

  it('volume tier beats base after intro expiry', () => {
    expect(resolveRate(terms, new Date('2027-03-01'), 12_000)).toBe(0.18)
  })

  it('no terms → merchant fallback rate', () => {
    expect(resolveRate(null, new Date(), 0, 0.12)).toBe(0.12)
  })
})

describe('computeCommissionGbp — penny-exact and defensive', () => {
  it('computes to 2dp', () => {
    expect(computeCommissionGbp(328, 0.2)).toBe(65.6)
    expect(computeCommissionGbp(99.99, 0.15)).toBe(15.0)
  })
  it('never produces commission from garbage', () => {
    expect(computeCommissionGbp(0, 0.2)).toBe(0)
    expect(computeCommissionGbp(-50, 0.2)).toBe(0)
    expect(computeCommissionGbp(NaN, 0.2)).toBe(0)
    expect(computeCommissionGbp(100, 0)).toBe(0)
  })
})

describe('return window', () => {
  it('adds the merchant window in days', () => {
    expect(returnWindowEnd(new Date('2026-08-09T12:00:00Z'), 30).toISOString()).toBe('2026-09-08T12:00:00.000Z')
  })
})

describe('commissionBase — merchandise subtotal, not shipping/tax', () => {
  it('prefers the current subtotal (survives partial refunds)', () => {
    expect(commissionBase({ current_subtotal_price: '250.00', subtotal_price: '328.00', total_price: '340.00', currency: 'GBP' }))
      .toEqual({ amount: 250, currency: 'GBP' })
  })
  it('falls back sensibly', () => {
    expect(commissionBase({ subtotal_price: '328.00', currency: 'EUR' })).toEqual({ amount: 328, currency: 'EUR' })
    expect(commissionBase({ total_price: '340.00' })).toEqual({ amount: 340, currency: 'GBP' })
    expect(commissionBase({})).toEqual({ amount: 0, currency: 'GBP' })
  })
})

describe('orderOutcome — cancellations and refunds', () => {
  it('classifies each financial state', () => {
    expect(orderOutcome({ cancelled_at: '2026-08-09' })).toBe('cancelled')
    expect(orderOutcome({ financial_status: 'refunded' })).toBe('refunded')
    expect(orderOutcome({ financial_status: 'partially_refunded' })).toBe('partially_refunded')
    expect(orderOutcome({ financial_status: 'paid' })).toBe('active')
    expect(orderOutcome({})).toBe('active')
  })
  it('cancellation wins even if financial status still says paid', () => {
    expect(orderOutcome({ cancelled_at: 'x', financial_status: 'paid' })).toBe('cancelled')
  })
})

describe('attribution', () => {
  it('extracts the click id from a landing URL', () => {
    expect(extractMyraClick('https://jamemme.com/products/d?utm_source=myra&myra_click=a1b2c3d4-e5')).toBe('a1b2c3d4-e5')
    expect(extractMyraClick('/products/d?myra_click=abcd1234')).toBe('abcd1234')
  })
  it('refuses malformed or missing ids', () => {
    expect(extractMyraClick('https://jamemme.com/products/d')).toBe(null)
    expect(extractMyraClick('?myra_click=short')).toBe(null)          // < 8 chars
    expect(extractMyraClick('?myra_click=has spaces')).toBe(null)
    expect(extractMyraClick(null)).toBe(null)
  })

  it('finds a MYRA touch anywhere in the 30-day journey', () => {
    const r = attributeFromJourney([
      { landingPage: 'https://jamemme.com/', utmParameters: { source: 'google' } },
      { landingPage: 'https://jamemme.com/products/d?myra_click=deadbeef01', utmParameters: { source: 'myra' }, occurredAt: '2026-08-01' },
      { landingPage: 'https://jamemme.com/checkout' },
    ])
    expect(r).toEqual({ clickId: 'deadbeef01', myraTouched: true, momentAt: '2026-08-01' })
  })

  it('last MYRA click wins when there are several', () => {
    const r = attributeFromJourney([
      { landingPage: '?myra_click=firstclick1' },
      { landingPage: '?myra_click=secondclick2' },
    ])
    expect(r.clickId).toBe('secondclick2')
  })

  it('utm without a recoverable id still counts as a MYRA touch', () => {
    const r = attributeFromJourney([{ utmParameters: { source: 'MYRA' } }])
    expect(r).toMatchObject({ clickId: null, myraTouched: true })
  })

  it('a journey with no MYRA touch attributes nothing', () => {
    expect(attributeFromJourney([{ utmParameters: { source: 'instagram' } }, {}]).myraTouched).toBe(false)
    expect(attributeFromJourney(null).myraTouched).toBe(false)
    expect(attributeFromJourney([]).myraTouched).toBe(false)
  })
})
