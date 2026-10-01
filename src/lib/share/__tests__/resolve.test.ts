import { describe, it, expect } from 'vitest'
import {
  classifyUrl, extractInstagram, extractProduct, firstOutboundLink,
  instagramAuthorFromHtml, isAggregatorHost, isSocialHost,
} from '@/lib/share/resolve'

describe('classifyUrl — what the share sheet handed over', () => {
  it('reads an Instagram profile, however dressed up the link is', () => {
    expect(classifyUrl('https://www.instagram.com/ullajohnson/')).toEqual({ kind: 'instagram-profile', handle: 'ullajohnson' })
    expect(classifyUrl('https://instagram.com/UllaJohnson')).toEqual({ kind: 'instagram-profile', handle: 'ullajohnson' })
    expect(classifyUrl('https://www.instagram.com/sezane?igsh=abc123')).toEqual({ kind: 'instagram-profile', handle: 'sezane' })
  })

  it('reads posts, reels and tv as posts, canonicalised', () => {
    expect(classifyUrl('https://www.instagram.com/p/Cabc123XY_/')).toEqual({ kind: 'instagram-post', url: 'https://www.instagram.com/p/Cabc123XY_/' })
    expect(classifyUrl('https://www.instagram.com/reel/Dxyz789/?utm_source=share')).toEqual({ kind: 'instagram-post', url: 'https://www.instagram.com/reel/Dxyz789/' })
    expect(classifyUrl('https://www.instagram.com/tv/Cq111/')).toEqual({ kind: 'instagram-post', url: 'https://www.instagram.com/tv/Cq111/' })
  })

  it('never mistakes Instagram’s own pages for a handle', () => {
    expect(classifyUrl('https://www.instagram.com/explore/').kind).toBe('invalid')
    expect(classifyUrl('https://www.instagram.com/reels/').kind).toBe('invalid')
    expect(classifyUrl('https://www.instagram.com/p/').kind).toBe('invalid')
    expect(classifyUrl('https://www.instagram.com/').kind).toBe('invalid')
  })

  it('treats an ordinary shop page as a product page', () => {
    const c = classifyUrl('https://www.net-a-porter.com/en-gb/shop/product/silk-slip-skirt/12345')
    expect(c.kind).toBe('web')
  })

  it('turns away anything that is not a web link', () => {
    expect(classifyUrl('not a url').kind).toBe('invalid')
    expect(classifyUrl('ftp://example.com/file').kind).toBe('invalid')
    expect(classifyUrl('').kind).toBe('invalid')
  })
})

describe('hub and social hosts — never the shop itself', () => {
  it('knows the link-hubs', () => {
    expect(isAggregatorHost('linktr.ee')).toBe(true)
    expect(isAggregatorHost('www.beacons.ai')).toBe(true)
    expect(isAggregatorHost('shop.stan.store')).toBe(true)
    expect(isAggregatorHost('ullajohnson.com')).toBe(false)
  })

  it('knows the social networks', () => {
    expect(isSocialHost('instagram.com')).toBe(true)
    expect(isSocialHost('www.tiktok.com')).toBe(true)
    expect(isSocialHost('sezane.com')).toBe(false)
  })
})

describe('extractInstagram — the brand behind the profile', () => {
  it('takes external_url first, unescaping Instagram’s JSON', () => {
    const html = '{"biography":"Parisian maison","external_url":"https:\\/\\/ullajohnson.com\\/?utm=ig","bio_links":[{"url":"https://linktr.ee/ullajohnson"}]}'
    const read = extractInstagram(html)
    expect(read.website).toBe('https://ullajohnson.com/?utm=ig')
  })

  it('falls back to bio_links when external_url is empty', () => {
    const html = '{"external_url":"","bio_links":[{"title":"Shop","url":"https:\\/\\/linktr.ee\\/' + 'sezane"}]}'
    const read = extractInstagram(html)
    expect(read.website).toBe('https://linktr.ee/sezane')
  })

  it('says nothing when the bio carries no link (the login wall reads the same)', () => {
    expect(extractInstagram('<html><body>Log in to Instagram</body></html>').website).toBeNull()
  })

  it('reads the display name from og:title, dropping the suffix', () => {
    const html = '<meta property="og:title" content="Ulla Johnson (@ullajohnson) • Instagram photos and videos">'
    expect(extractInstagram(html).name).toBe('Ulla Johnson')
  })

  it('reads full_name when og:title is absent', () => {
    const html = '{"full_name":"Sézane","external_url":"https:\\/\\/www.sezane.com"}'
    expect(extractInstagram(html).name).toBe('Sézane')
  })
})

describe('instagramAuthorFromHtml — whose reel this is', () => {
  it('prefers the owner block', () => {
    const html = '{"username":"someoneelse","owner":{"id":"42","username":"ullajohnson"}}'
    expect(instagramAuthorFromHtml(html)).toBe('ullajohnson')
  })

  it('falls back to the first username', () => {
    expect(instagramAuthorFromHtml('{"username":"Sezane"}')).toBe('sezane')
    expect(instagramAuthorFromHtml('<html>no json here</html>')).toBeNull()
  })
})

describe('firstOutboundLink — stepping through a link-hub', () => {
  const hub = [
    '<a href="https://www.instagram.com/ullajohnson">Instagram</a>',
    '<a href="https://linktr.ee/help">About Linktree</a>',
    '<a href="https://ullajohnson.com/collections/new">New arrivals</a>',
  ].join('\n')

  it('takes the first link that is neither the hub nor a social network', () => {
    expect(firstOutboundLink(hub, 'https://linktr.ee/ullajohnson')).toBe('https://ullajohnson.com/collections/new')
  })

  it('says nothing when every door leads back to social', () => {
    expect(firstOutboundLink('<a href="https://www.tiktok.com/@x">tt</a>', 'https://linktr.ee/x')).toBeNull()
  })
})

describe('extractProduct — a piece from a shop page', () => {
  it('prefers JSON-LD over the og tags', () => {
    const html = `<html><head>
      <meta property="og:title" content="Fallback title">
      <meta property="og:image" content="https://cdn.shop.com/og.jpg">
      <script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","name":"Silk slip skirt","image":["https://cdn.shop.com/ld.jpg"],"brand":{"@type":"Brand","name":"Net-a-Porter"},"offers":{"@type":"Offer","price":"450.00"}}</script>
    </head></html>`
    const p = extractProduct(html, 'https://www.net-a-porter.com/en-gb/shop/product/12345')
    expect(p).toEqual({
      url: 'https://www.net-a-porter.com/en-gb/shop/product/12345',
      title: 'Silk slip skirt',
      brand: 'Net-a-Porter',
      image: 'https://cdn.shop.com/ld.jpg',
      price: 450,
      host: 'net-a-porter.com',
    })
  })

  it('falls back to og tags and resolves a relative image', () => {
    const html = `<html><head>
      <meta content="Stripe cotton shirt" property="og:title">
      <meta property="og:image" content="/img/shirt.jpg">
      <meta property="og:site_name" content="Sézane">
      <meta property="product:price:amount" content="£145.00">
      <title>ignored when og:title is present</title>
    </head></html>`
    const p = extractProduct(html, 'https://www.sezane.com/gb/product/stripe-shirt')
    expect(p?.title).toBe('Stripe cotton shirt')
    expect(p?.image).toBe('https://www.sezane.com/img/shirt.jpg')
    expect(p?.brand).toBe('Sézane')
    expect(p?.price).toBe(145)
  })

  it('uses og:url as the canonical url when the page offers one', () => {
    const html = `<html><head>
      <meta property="og:title" content="Wool coat">
      <meta property="og:image" content="https://cdn.shop.com/coat.jpg">
      <meta property="og:url" content="https://www.shop.com/coat">
    </head></html>`
    expect(extractProduct(html, 'https://www.shop.com/coat?utm=x')?.url).toBe('https://www.shop.com/coat')
  })

  it('returns null without a usable title or image', () => {
    expect(extractProduct('<html><head></head><body>nothing</body></html>', 'https://www.shop.com/')).toBeNull()
    expect(extractProduct('<html><head><meta property="og:title" content="Only a title"></head></html>', 'https://www.shop.com/')).toBeNull()
  })
})
