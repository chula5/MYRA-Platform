import { describe, it, expect } from 'vitest'
import {
  isUnique, isSecondHand, sourceTypeOf, defaultStockClass, isSold,
  pollTier, riskScore, alertPriority, classifySignal, actImmediately,
  isStaleUnique, savedByLabel, nextCheckAt, POLL_INTERVAL_MS,
  type RiskInputs,
} from '@/lib/second-hand'
import { resolveAvailability, passesSizeGate, anyOutOfSize } from '@/lib/size-match'
import type { SizeRow } from '@/lib/size-match'
import type { SizeProfile } from '@/lib/size-canonical'

const risk = (patch: Partial<RiskInputs> = {}): RiskInputs => ({
  saversInSize: 0, saversOtherSize: 0, clickOuts48h: 0, clickOuts24h: 0,
  daysLive: 30, inLiveOutfit: false, stockClass: 'replenishable', ...patch,
})

describe('source and class', () => {
  it('lets the merchant decide, with a brand override', () => {
    expect(sourceTypeOf({ merchant: { source_type: 'second_hand' }, brand: { source_type: 'retail' } })).toBe('second_hand')
    expect(sourceTypeOf({ merchant: { source_type: 'retail' }, brand: { source_type: 'vintage' } })).toBe('vintage')
    expect(sourceTypeOf({})).toBe('retail')
  })

  it('treats second-hand and vintage as pre-loved, retail as not', () => {
    expect(isSecondHand({ merchant: { source_type: 'vintage' } })).toBe(true)
    expect(isSecondHand({ merchant: { source_type: 'retail' } })).toBe(false)
  })

  it('makes a second-hand seller default to one-of-one', () => {
    expect(defaultStockClass({ source_type: 'second_hand' })).toBe('unique')
    expect(defaultStockClass({ source_type: 'retail' })).toBe('replenishable')
    expect(defaultStockClass({ source_type: 'retail', default_stock_class: 'unique' })).toBe('unique')
  })

  it('separates sold from merely out of stock', () => {
    expect(isSold({ status: 'sold' })).toBe(true)
    expect(isSold({ status: 'out_of_stock' })).toBe(false)
    expect(isUnique({ stock_class: 'unique' })).toBe(true)
  })
})

describe('polling tiers', () => {
  it('puts a piece someone is waiting on in her size in the fastest lane', () => {
    expect(pollTier(risk({ saversInSize: 1 }))).toBe('A')
    expect(POLL_INTERVAL_MS.A).toBe(30 * 60_000)
  })

  it('puts a recent click-out in the fastest lane too', () => {
    expect(pollTier(risk({ clickOuts24h: 1 }))).toBe('A')
  })

  it('drops an unengaged live piece to three-hourly, and a shelved one to daily', () => {
    expect(pollTier(risk({ inLiveOutfit: true }))).toBe('B')
    expect(pollTier(risk())).toBe('C')
  })

  it('cannot let arithmetic outvote a saver in her size', () => {
    // Zero on every other signal, and still Tier A.
    expect(pollTier(risk({ saversInSize: 1, daysLive: 900 }))).toBe('A')
  })

  it('schedules the next check by tier', () => {
    const from = 1_700_000_000_000
    expect(nextCheckAt('B', from).getTime() - from).toBe(3 * 60 * 60_000)
  })
})

describe('risk score', () => {
  it('gives a one-of-one a floor, because every check is its last chance', () => {
    expect(riskScore(risk({ stockClass: 'unique' }))).toBeGreaterThanOrEqual(0.35)
    expect(riskScore(risk())).toBeLessThan(0.35)
  })

  it('weights a saver in her size above one who isn’t', () => {
    expect(riskScore(risk({ saversInSize: 2 }))).toBeGreaterThan(riskScore(risk({ saversOtherSize: 2 })))
  })

  it('stays within 0-1', () => {
    const hot = risk({ saversInSize: 40, clickOuts48h: 90, inLiveOutfit: true, daysLive: 0 })
    expect(riskScore(hot)).toBeLessThanOrEqual(1)
  })
})

describe('alert priority', () => {
  it('sends a sold one-of-one immediately', () => {
    expect(alertPriority('unique_sold', { stockClass: 'unique' })).toBe('urgent')
  })

  it('sends low stock on a unique or fast-moving piece within the hour', () => {
    expect(alertPriority('low_in_size', { stockClass: 'unique' })).toBe('urgent')
    expect(alertPriority('low_in_size', { stockClass: 'replenishable', fastMoving: true })).toBe('urgent')
  })

  it('batches everything else', () => {
    expect(alertPriority('low_in_size', { stockClass: 'replenishable' })).toBe('batch')
    expect(alertPriority('back_in_size', { stockClass: 'unique' })).toBe('batch')
    expect(alertPriority('sold_out_in_size', { stockClass: 'replenishable' })).toBe('batch')
  })
})

describe('acting on a signal', () => {
  it('treats a merchant statement or structured data as explicit', () => {
    expect(classifySignal('webhook')).toBe('explicit_sold')
    expect(classifySignal('feed')).toBe('explicit_sold')
    expect(classifySignal('shopify')).toBe('explicit_sold')
    expect(classifySignal('jsonld')).toBe('explicit_sold')
  })

  it('treats page text as an inference and a failed fetch as nothing', () => {
    expect(classifySignal('regex')).toBe('inferred_oos')
    expect(classifySignal('error')).toBe('ambiguous')
  })

  it('acts at once on an explicit sold signal for a one-of-one only', () => {
    expect(actImmediately('unique', 'explicit_sold')).toBe(true)
    expect(actImmediately('unique', 'ambiguous')).toBe(false)
    expect(actImmediately('unique', 'inferred_oos')).toBe(false)
    expect(actImmediately('replenishable', 'explicit_sold')).toBe(false)
  })
})

describe('merchandising', () => {
  it('flags a one-of-one live over a fortnight with no interest', () => {
    expect(isStaleUnique({ stockClass: 'unique', daysLive: 20, clickOutsTotal: 0 })).toBe(true)
    expect(isStaleUnique({ stockClass: 'unique', daysLive: 20, clickOutsTotal: 3 })).toBe(false)
    expect(isStaleUnique({ stockClass: 'unique', daysLive: 3, clickOutsTotal: 0 })).toBe(false)
    expect(isStaleUnique({ stockClass: 'replenishable', daysLive: 90, clickOutsTotal: 0 })).toBe(false)
  })

  it('only claims social proof where it is honest', () => {
    expect(savedByLabel(1)).toBeNull()
    expect(savedByLabel(2)).toBeNull()
    expect(savedByLabel(7)).toBe('SAVED BY 7 PEOPLE')
  })
})

// ── The gate that hides pieces ───────────────────────────────────────────────

const row = (label: string, values: number[], inStock = true, level: SizeRow['stock_level'] = 'in_stock'): SizeRow => ({
  size_label: label,
  canonical_category: 'tops',
  canonical_value: values[0] ?? null,
  canonical_values: values,
  in_stock: inStock,
  stock_level: level,
})

const her: SizeProfile = { tops: { value: 10, adjacent: 12 } }

describe('availability for a shopper', () => {
  it('picks the label she would actually order', () => {
    const a = resolveAvailability({ item_type: 'midi_dress' }, [row('IT 42', [10]), row('IT 44', [12])], her)
    expect(a.quality).toBe('full')
    expect(a.herSizeLabel).toBe('IT 42')
    expect(a.wearable).toBe(true)
  })

  it('prefers an exact match over an adjacent one', () => {
    const a = resolveAvailability({ item_type: 'midi_dress' }, [row('UK 12', [12]), row('UK 10', [10])], her)
    expect(a.herSizeLabel).toBe('UK 10')
  })

  it('falls back to the adjacent size she listed when hers is gone', () => {
    const a = resolveAvailability(
      { item_type: 'midi_dress' },
      [row('UK 10', [10], false, 'sold_out'), row('UK 12', [12])],
      her,
    )
    expect(a.quality).toBe('acceptable')
    expect(a.herSizeLabel).toBe('UK 12')
    expect(a.outOfHerSize).toBe(false)
  })

  it('reports low stock in HER size specifically', () => {
    const a = resolveAvailability({ item_type: 'midi_dress' }, [row('UK 10', [10], true, 'low')], her)
    expect(a.lowInHerSize).toBe(true)
  })

  it('says out-of-her-size when nothing matches', () => {
    const a = resolveAvailability({ item_type: 'midi_dress' }, [row('UK 16', [16]), row('UK 18', [18])], her)
    expect(a.quality).toBe('none')
    expect(a.outOfHerSize).toBe(true)
  })

  it('never treats missing information as a mismatch', () => {
    const noRows = resolveAvailability({ item_type: 'midi_dress' }, [], her)
    expect(noRows.quality).toBe('unknown')
    expect(noRows.outOfHerSize).toBe(false)

    const noProfile = resolveAvailability({ item_type: 'midi_dress' }, [row('UK 16', [16])], {})
    expect(noProfile.quality).toBe('unknown')
    expect(noProfile.outOfHerSize).toBe(false)
  })
})

describe('the size gate', () => {
  const wrongSize = [row('UK 16', [16])]

  it('hides a one-of-one that is not in her size', () => {
    expect(passesSizeGate({ item_type: 'midi_dress', stock_class: 'unique' }, wrongSize, her)).toBe(false)
  })

  it('keeps a replenishable piece that is not in her size — it is ranked, not hidden', () => {
    expect(passesSizeGate({ item_type: 'midi_dress', stock_class: 'replenishable' }, wrongSize, her)).toBe(true)
  })

  it('holds a private lookbook to the stricter bar', () => {
    expect(
      passesSizeGate({ item_type: 'midi_dress', stock_class: 'replenishable' }, wrongSize, her, { strict: true }),
    ).toBe(false)
  })

  it('lets unknown sizing through even under strict', () => {
    expect(passesSizeGate({ item_type: 'tote', stock_class: 'unique' }, [], her, { strict: true })).toBe(true)
  })

  it('flags a look containing anything out of her size', () => {
    const out = resolveAvailability({ item_type: 'midi_dress' }, wrongSize, her)
    const fine = resolveAvailability({ item_type: 'midi_dress' }, [row('UK 10', [10])], her)
    expect(anyOutOfSize([fine, out])).toBe(true)
    expect(anyOutOfSize([fine])).toBe(false)
  })
})
