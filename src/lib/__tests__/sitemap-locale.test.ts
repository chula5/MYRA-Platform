import { describe, it, expect } from 'vitest'
import { preferredSitemaps } from '@/lib/brand-watch-browser'

// The real robots.txt shape that broke: one catalogue published 31 times.
const BIMBA = [
  'be_en', 'co_en', 'co_es', 'de_en', 'de_de', 'ec_en', 'es_es', 'es_en',
  'fr_en', 'fr_fr', 'gb_en', 'it_en', 'kr_en', 'nl_nl', 'us_en',
].map((l) => `https://www.bimbaylola.com/${l}/sitemap_index.xml`)

describe('preferredSitemaps', () => {
  it('takes the locale the storefront URL names', () => {
    const got = preferredSitemaps('https://www.bimbaylola.com/gb_en/', BIMBA)
    expect(got).toEqual(['https://www.bimbaylola.com/gb_en/sitemap_index.xml'])
  })

  it('falls back to the English locales when the URL names none', () => {
    const got = preferredSitemaps('https://www.bimbaylola.com', BIMBA)
    expect(got.length).toBeGreaterThan(0)
    expect(got.length).toBeLessThan(BIMBA.length)
    expect(got).toContain('https://www.bimbaylola.com/gb_en/sitemap_index.xml')
  })

  it('never filters a small list down to nothing', () => {
    const one = ['https://www.sessun.co.uk/sitemap.xml']
    expect(preferredSitemaps('https://www.sessun.co.uk', one)).toEqual(one)
    const two = ['https://x.com/sitemap.xml', 'https://x.com/sitemap_index.xml']
    expect(preferredSitemaps('https://x.com', two)).toEqual(two)
  })

  it('ignores a path segment that is not a locale', () => {
    const all = ['https://shop.com/sitemap.xml']
    expect(preferredSitemaps('https://shop.com/collections/new', all)).toEqual(all)
  })
})

describe('preferredSitemaps — no hint in the address', () => {
  const AGNES = [
    'https://www.agnesb.com/fr-eu/sitemap_index.xml',
    'https://www.agnesb.com/en-eu/sitemap_index.xml',
    'https://www.agnesb.com/en-uk/sitemap_index.xml',
    'https://www.agnesb.com/en-us/sitemap_index.xml',
    'https://www.agnesb.com/en-ca/sitemap_index.xml',
  ]
  it('takes the UK sitemap alone when the site publishes one per locale', () => {
    expect(preferredSitemaps('https://www.agnesb.com', AGNES)).toEqual(['https://www.agnesb.com/en-uk/sitemap_index.xml'])
  })
  it('still falls back to English on a long list, and to everything on a short one', () => {
    const noUk = [...AGNES.filter((u) => !u.includes('en-uk')), 'https://www.agnesb.com/fr-ca/sitemap_index.xml']
    expect(preferredSitemaps('https://www.agnesb.com', noUk)).toEqual(noUk.filter((u) => u.includes('/en-')))
    expect(preferredSitemaps('https://x.com', ['https://x.com/sitemap.xml'])).toEqual(['https://x.com/sitemap.xml'])
  })
})
