// WHICH COUNTRY'S PAGE ENDS UP IN THE QUEUE.
//
// A brand publishes one coat under a dozen locales. Brand Watch collapses them
// to one product and then has to choose which URL to actually scrape, because
// that choice decides the title, the description and — the part that shows —
// the currency of the price. Picking the American page puts dollars in the
// queue for a British client.
//
// The rule is UK first, always. These assert that, and the order underneath it.

import { describe, it, expect } from 'vitest'
import { localeRank, canonicalProductKey } from '@/lib/brand-watch-browser'

const M = 'https://www.meandem.com'

describe('UK wins', () => {
  it('beats an unprefixed URL on the same site', () => {
    expect(localeRank(`${M}/uk/products/the-coat-123456`))
      .toBeLessThan(localeRank(`${M}/products/the-coat-123456`))
  })

  it('beats every foreign market', () => {
    const uk = localeRank(`${M}/uk/products/the-coat-123456`)
    for (const loc of ['us', 'de', 'fr', 'int', 'eu', 'ie', 'au', 'row']) {
      expect(uk, `/${loc}/ should not beat /uk/`)
        .toBeLessThan(localeRank(`${M}/${loc}/products/the-coat-123456`))
    }
  })

  it('beats a generic English path, which names no market', () => {
    expect(localeRank(`${M}/uk/products/the-coat-123456`))
      .toBeLessThan(localeRank(`${M}/en/products/the-coat-123456`))
  })

  it('is recognised however the site spells it', () => {
    // All four are the same market and must all rank top.
    for (const p of ['/uk/x/the-coat-123456', '/gb/x/the-coat-123456', '/en-gb/x/the-coat-123456', '/en-uk/x/the-coat-123456']) {
      expect(localeRank(M + p), `${p} should rank as UK`).toBe(0)
    }
  })
})

describe('when a brand publishes no UK path at all', () => {
  // ME+EM serves Britain from the unprefixed root. There is no /uk/ to prefer,
  // so the bare URL has to beat /us/ or the dollar page wins by default.
  it('prefers the unprefixed URL over a foreign one', () => {
    expect(localeRank(`${M}/products/the-coat-123456`))
      .toBeLessThan(localeRank(`${M}/us/products/the-coat-123456`))
  })

  it('still puts a real UK path above the unprefixed one when both exist', () => {
    const ranks = [
      localeRank(`${M}/uk/products/the-coat-123456`),
      localeRank(`${M}/products/the-coat-123456`),
      localeRank(`${M}/en/products/the-coat-123456`),
      localeRank(`${M}/us/products/the-coat-123456`),
    ]
    // Strictly ascending: UK, then unprefixed, then generic English, then foreign.
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b))
    expect(new Set(ranks).size).toBe(4)
  })
})

describe('the locales all collapse to one product first', () => {
  // The ranking only gets to choose if every locale of the coat is recognised
  // as the SAME coat. If this fails, each country is queued as its own item and
  // the scan does many times the work it should.
  it('reads every locale of one product as one key', () => {
    const keys = ['/uk', '/us', '/de', '/fr', '/int', '']
      .map((loc) => canonicalProductKey(`${M}${loc}/products/the-coat-123456`))
    expect(new Set(keys).size, `expected one key, got ${JSON.stringify(keys)}`).toBe(1)
  })

  it('does not merge two different products', () => {
    expect(canonicalProductKey(`${M}/uk/products/the-coat-123456`))
      .not.toBe(canonicalProductKey(`${M}/uk/products/the-dress-654321`))
  })
})
