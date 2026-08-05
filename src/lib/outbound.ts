// Outbound click routing — pure helpers shared by the /go/[clickId] redirect
// route, the beacon logger, and the client-side ShopLink component.
//
// Design constraints (Part 1 of the affiliate build):
//  - Network merchants' links must be byte-identical to today's behaviour:
//    Rakuten deep links are composed server-side via affiliateUrl() (safe to
//    route through /go/); Awin Convert-a-Link merchants (Da Luna) are rewritten
//    client-side by the MasterTag, so those links must NOT go through a server
//    redirect — they keep the raw href and log via beacon instead.
//  - Direct/manual merchants (J'amemme) get our tracking params appended.

import { affiliateUrl } from '@/lib/affiliate'

// Hosts whose affiliate tracking happens client-side (Awin MasterTag).
// Outbound links to these hosts keep their original href; clicks are logged
// with a fire-and-forget beacon. Keep in sync with merchant.link_mode='beacon'.
const BEACON_HOSTS = [/(^|\.)dalunalondon\.com$/i]
const BEACON_BRANDS = [/da\s*luna/i]

export function isBeaconMerchant(brandName?: string | null, url?: string | null): boolean {
  const brand = (brandName ?? '').trim()
  if (brand && BEACON_BRANDS.some((r) => r.test(brand))) return true
  try {
    if (url) {
      const host = new URL(url).hostname
      return BEACON_HOSTS.some((r) => r.test(host))
    }
  } catch { /* unparseable → not beacon */ }
  return false
}

// ── Bot / prefetch detection ────────────────────────────────────────────────
// Generic terms are word-bounded so real device UAs (e.g. "Cubot") don't match.
const BOT_UA =
  /\b(bot|crawler|spider|scraper)\b|googlebot|bingbot|yandex|baidu|duckduckbot|slurp|facebookexternalhit|meta-externalagent|twitterbot|linkedinbot|pinterest|slackbot|discord|telegram|whatsapp|headlesschrome|phantomjs|puppeteer|playwright|lighthouse|pagespeed|gtmetrix|uptimerobot|pingdom|statuscake|curl\/|wget\/|python-requests|python-httpx|go-http-client|okhttp|java\/|libwww/i

export function isBotRequest(userAgent: string | null, headers: Headers): boolean {
  const ua = (userAgent ?? '').trim()
  if (!ua) return true // no UA at all → treat as automation
  if (BOT_UA.test(ua)) return true
  // Browser prefetch/prerender — a real user did NOT click (yet).
  const purpose = (headers.get('purpose') ?? headers.get('x-purpose') ?? '').toLowerCase()
  const secPurpose = (headers.get('sec-purpose') ?? '').toLowerCase()
  if (purpose.includes('prefetch') || purpose.includes('preview')) return true
  if (secPurpose.includes('prefetch') || secPurpose.includes('prerender')) return true
  if ((headers.get('x-moz') ?? '').toLowerCase() === 'prefetch') return true
  return false
}

export function deviceFromUa(userAgent: string | null): string {
  const ua = (userAgent ?? '').toLowerCase()
  if (!ua) return 'unknown'
  if (/ipad|tablet|kindle|silk/.test(ua)) return 'tablet'
  if (/mobi|iphone|android/.test(ua)) return 'mobile'
  return 'desktop'
}

// ── Tracking params (direct/manual merchants) ───────────────────────────────
// template e.g. 'utm_source=myra&utm_medium=affiliate&myra_click={click_id}'.
// Appended safely whether or not the URL already has a query string; existing
// params are preserved. A null/empty template returns the URL untouched.
export function appendTrackingParams(url: string, template: string | null | undefined, clickId: string): string {
  const tpl = (template ?? '').trim()
  if (!tpl || !/^https?:\/\//i.test(url)) return url
  const filled = tpl.replace(/\{click_id\}/g, encodeURIComponent(clickId))
  try {
    const u = new URL(url)
    const params = new URLSearchParams(filled)
    params.forEach((v, k) => u.searchParams.set(k, v))
    return u.toString()
  } catch {
    return url
  }
}

// ── Destination resolution ──────────────────────────────────────────────────
// Given an item's raw retailer URL, its brand and its merchant config, produce
// the final outbound URL. Network merchants keep today's affiliateUrl()
// behaviour exactly; direct/manual merchants get tracking params appended.
export interface MerchantLite {
  merchant_id: string
  type: 'shopify' | 'manual' | 'network'
  link_mode: 'redirect' | 'beacon'
  tracking_param_template: string | null
  status: string
}

export function resolveDestination(opts: {
  retailerUrl: string
  brandName?: string | null
  itemId: string
  merchant: MerchantLite | null
  clickId: string
}): string {
  const { retailerUrl, brandName, itemId, merchant, clickId } = opts
  if (merchant && merchant.type !== 'network') {
    return appendTrackingParams(retailerUrl, merchant.tracking_param_template, clickId)
  }
  // Network (or unknown) merchants: identical to the pre-/go/ behaviour.
  return affiliateUrl(retailerUrl, { brandName, contentId: itemId })
}

// ── Client href builder ─────────────────────────────────────────────────────
// The /go/ link carries everything the server can't derive from the request:
// item, outfit context, the client-side session id and referral code.
export function goHref(opts: {
  clickId: string
  itemId: string
  outfitId?: string | null
  sessionId?: string | null
  ref?: string | null
}): string {
  const sp = new URLSearchParams({ item: opts.itemId })
  if (opts.outfitId) sp.set('outfit', opts.outfitId)
  if (opts.sessionId) sp.set('sid', opts.sessionId)
  if (opts.ref) sp.set('ref', opts.ref)
  return `/go/${opts.clickId}?${sp.toString()}`
}
