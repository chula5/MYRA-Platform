// Affiliate deep-linking. Wraps an approved merchant's product URL so outbound
// clicks are tracked/attributed by the affiliate network. Merchants we are NOT
// approved for return the raw URL unchanged.
//
// Currently: Rakuten Advertising — Isabel Marant (MID 49987).

const RAKUTEN_PUBLISHER_ID = 'UvSzxGwCHE0'

// One entry per approved Rakuten merchant. Matched by brand name and/or URL host.
const RAKUTEN_MERCHANTS: { mid: number; brandMatch: RegExp; hostMatch: RegExp }[] = [
  { mid: 49987, brandMatch: /isabel\s*marant/i, hostMatch: /(^|\.)isabelmarant\.com$/i },
]

// u1 is a CONTENT / placement identifier only (e.g. an item or outfit id). It
// must NEVER be a user id or anything personal. Sanitised to url-safe chars.
function sanitiseU1(id?: string | null): string {
  const clean = (id ?? '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40)
  return clean || 'edit'
}

// Returns an affiliate-tracked outbound URL for approved merchants, else the raw
// URL. The raw product URL is never surfaced as the outbound link for approved
// merchants (it's fully percent-encoded into `murl`).
export function affiliateUrl(
  rawUrl: string | null | undefined,
  opts: { brandName?: string | null; contentId?: string | null } = {},
): string {
  const url = (rawUrl ?? '').trim()
  if (!/^https?:\/\//i.test(url)) return url

  let host = ''
  try { host = new URL(url).hostname } catch { /* ignore */ }
  const brand = (opts.brandName ?? '').trim()

  const merchant = RAKUTEN_MERCHANTS.find(
    (m) => (brand && m.brandMatch.test(brand)) || (host && m.hostMatch.test(host)),
  )
  if (!merchant) return url

  const murl = encodeURIComponent(url) // & → %26, ? → %3F, : → %3A, / → %2F …
  const u1 = sanitiseU1(opts.contentId)
  return `https://click.linksynergy.com/deeplink?id=${RAKUTEN_PUBLISHER_ID}&mid=${merchant.mid}&murl=${murl}&u1=${u1}`
}
