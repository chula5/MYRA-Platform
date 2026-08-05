import { describe, it, expect } from 'vitest'
import {
  appendTrackingParams,
  isBotRequest,
  deviceFromUa,
  resolveDestination,
  isBeaconMerchant,
  goHref,
  type MerchantLite,
} from '../outbound'
import { affiliateUrl } from '../affiliate'

const SAFARI_IOS =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
const CHROME_MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

const h = (obj: Record<string, string> = {}) => new Headers(obj)

const manualMerchant: MerchantLite = {
  merchant_id: 'm1',
  type: 'manual',
  link_mode: 'redirect',
  tracking_param_template: 'utm_source=myra&utm_medium=affiliate&myra_click={click_id}',
  status: 'active',
}
const networkMerchant: MerchantLite = {
  merchant_id: 'm2',
  type: 'network',
  link_mode: 'redirect',
  tracking_param_template: null,
  status: 'active',
}

describe('appendTrackingParams', () => {
  it('appends params to a bare product URL', () => {
    const out = appendTrackingParams('https://jamemme.com/products/dress', manualMerchant.tracking_param_template, 'abc-123')
    const u = new URL(out)
    expect(u.searchParams.get('utm_source')).toBe('myra')
    expect(u.searchParams.get('myra_click')).toBe('abc-123')
  })

  it('preserves existing query params', () => {
    const out = appendTrackingParams('https://jamemme.com/products/dress?variant=42', manualMerchant.tracking_param_template, 'abc')
    const u = new URL(out)
    expect(u.searchParams.get('variant')).toBe('42')
    expect(u.searchParams.get('myra_click')).toBe('abc')
  })

  it('null/empty template returns the URL untouched', () => {
    expect(appendTrackingParams('https://x.com/p', null, 'id')).toBe('https://x.com/p')
    expect(appendTrackingParams('https://x.com/p', '  ', 'id')).toBe('https://x.com/p')
  })

  it('does not touch non-http values', () => {
    expect(appendTrackingParams('not a url', 'a=b', 'id')).toBe('not a url')
  })

  it('encodes unsafe click ids', () => {
    const out = appendTrackingParams('https://x.com/p', 'c={click_id}', 'a b&c')
    expect(out).not.toContain(' ')
    expect(new URL(out).searchParams.get('c')).toBe('a b&c')
  })
})

describe('isBotRequest', () => {
  it('flags known crawlers and tools', () => {
    expect(isBotRequest('Mozilla/5.0 (compatible; Googlebot/2.1)', h())).toBe(true)
    expect(isBotRequest('curl/8.4.0', h())).toBe(true)
    expect(isBotRequest('python-requests/2.31', h())).toBe(true)
    expect(isBotRequest('facebookexternalhit/1.1', h())).toBe(true)
  })

  it('flags a missing user agent', () => {
    expect(isBotRequest(null, h())).toBe(true)
    expect(isBotRequest('', h())).toBe(true)
  })

  it('flags browser prefetch via headers even with a real UA', () => {
    expect(isBotRequest(CHROME_MAC, h({ purpose: 'prefetch' }))).toBe(true)
    expect(isBotRequest(CHROME_MAC, h({ 'sec-purpose': 'prefetch;prerender' }))).toBe(true)
    expect(isBotRequest(CHROME_MAC, h({ 'x-moz': 'prefetch' }))).toBe(true)
  })

  it('passes real browsers', () => {
    expect(isBotRequest(SAFARI_IOS, h())).toBe(false)
    expect(isBotRequest(CHROME_MAC, h())).toBe(false)
  })

  it('does not false-positive on device names containing bot-like substrings', () => {
    // "Cubot" is a phone manufacturer — the generic 'bot' term is word-bounded.
    const cubot = 'Mozilla/5.0 (Linux; Android 13; Cubot X70) AppleWebKit/537.36 Chrome/119 Mobile Safari/537.36'
    expect(isBotRequest(cubot, h())).toBe(false)
  })
})

describe('deviceFromUa', () => {
  it('classifies phone / tablet / desktop', () => {
    expect(deviceFromUa(SAFARI_IOS)).toBe('mobile')
    expect(deviceFromUa('Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X)')).toBe('tablet')
    expect(deviceFromUa(CHROME_MAC)).toBe('desktop')
    expect(deviceFromUa(null)).toBe('unknown')
  })
})

describe('resolveDestination', () => {
  it('network merchants produce EXACTLY the legacy affiliateUrl output', () => {
    const raw = 'https://www.isabelmarant.com/gb/products/some-dress'
    const out = resolveDestination({
      retailerUrl: raw, brandName: 'Isabel Marant', itemId: 'item-1', merchant: networkMerchant, clickId: 'c1',
    })
    expect(out).toBe(affiliateUrl(raw, { brandName: 'Isabel Marant', contentId: 'item-1' }))
    expect(out).toContain('click.linksynergy.com') // really is the Rakuten deep link
    expect(out).not.toContain('myra_click')        // never our params on a network link
  })

  it('manual merchants get tracking params on the product URL', () => {
    const out = resolveDestination({
      retailerUrl: 'https://jamemme.com/products/corset-dress', brandName: "J'amemme", itemId: 'item-2',
      merchant: manualMerchant, clickId: 'click-9',
    })
    const u = new URL(out)
    expect(u.hostname).toBe('jamemme.com')
    expect(u.searchParams.get('myra_click')).toBe('click-9')
  })

  it('no merchant falls back to legacy behaviour (raw or network-wrapped)', () => {
    const raw = 'https://www.tibi.com/products/top'
    const out = resolveDestination({ retailerUrl: raw, brandName: 'Tibi', itemId: 'i', merchant: null, clickId: 'c' })
    expect(out).toBe(raw) // Tibi isn't an approved network merchant → untouched
  })
})

describe('isBeaconMerchant', () => {
  it('detects Awin Convert-a-Link merchants by brand or host', () => {
    expect(isBeaconMerchant('Da Luna', null)).toBe(true)
    expect(isBeaconMerchant(null, 'https://www.dalunalondon.com/products/bag')).toBe(true)
  })
  it('everything else is redirect mode', () => {
    expect(isBeaconMerchant('Isabel Marant', 'https://www.isabelmarant.com/x')).toBe(false)
    expect(isBeaconMerchant("J'amemme", 'https://jamemme.com/products/d')).toBe(false)
    expect(isBeaconMerchant(null, 'not a url')).toBe(false)
  })
})

describe('goHref', () => {
  it('builds the /go/ URL with only the params it has', () => {
    expect(goHref({ clickId: 'c1', itemId: 'i1' })).toBe('/go/c1?item=i1')
    const full = goHref({ clickId: 'c1', itemId: 'i1', outfitId: 'o1', sessionId: 's1', ref: 'tdfb' })
    const sp = new URLSearchParams(full.split('?')[1])
    expect(sp.get('outfit')).toBe('o1')
    expect(sp.get('sid')).toBe('s1')
    expect(sp.get('ref')).toBe('tdfb')
  })
})
