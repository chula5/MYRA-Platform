// The site's one public address. Every canonical link, the sitemap, robots and
// structured data use it, so search engines see one domain (www), never two.
export const SITE_URL = 'https://www.myraassistant.co.uk'
export const SITE_NAME = 'MYRA'
export const SITE_TITLE = 'MYRA | Private personal stylist, outfits built around you'
export const SITE_DESCRIPTION =
  'MYRA is a private styling service: complete outfits built around your taste, your size and what you already own, for the occasions coming up. Membership is by application.'

// Areas that are for members, partners or Chloe — never for search results.
// Crawlers are kept out of these entirely. The sign-in doors (/signin, /login,
// /welcome, /join, /earlyaccess, /reset-password) stay crawlable but carry
// noindex, because a blocked page can still be listed from a link to it.
// Shared look links (/outfit, /picks) stay crawlable so link previews work.
export const PRIVATE_PATHS = [
  '/admin', '/me', '/studio', '/edit', '/partners', '/onboarding', '/settings', '/mirror', '/api',
]

/** Spread into a layout's metadata: keeps the page out of search results. */
export const NOINDEX = { robots: { index: false, follow: false } } as const
// Link redirectors: blocked by exact prefix so "/e" never catches "/everything".
export const PRIVATE_EXACT = ['/e?', '/e/', '/go/']
