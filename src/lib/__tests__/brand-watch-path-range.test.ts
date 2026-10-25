import { describe, it, expect } from 'vitest'
import { classifyExternalProduct, classifyShopifyProductForTests } from '../brand-watch'

const page = (url: string, title = 'Cotton snap cardigan') => ({
  url, title, description: '', category: '', brand: 'agnès b.', price: 120, currency: 'GBP',
  images: ['https://www.agnesb.com/x.jpg'], available: true,
})

describe('classifyExternalProduct — the path names the range', () => {
  it('keeps women\'s pieces', () => {
    const p = classifyExternalProduct(page('https://www.agnesb.com/en-uk/women/clothing/cardigans/grey-cardigan-1T06LU31_895.html'))
    expect(p.nonFashion).toBe(false)
    expect(p.menswear).toBe(false)
  })
  it('sets children\'s pieces aside, in French too', () => {
    expect(classifyExternalProduct(page('https://www.agnesb.com/fr-eu/enfant/filles/pret-a-porter/parka-claude-noire-1.html')).nonFashion).toBe(true)
    expect(classifyExternalProduct(page('https://shop.example.com/kids/coats/duffle-coat')).nonFashion).toBe(true)
  })
  it('marks men\'s pieces', () => {
    expect(classifyExternalProduct(page('https://www.agnesb.com/en-uk/men/clothing/shirts/blue-shirt-2.html')).menswear).toBe(true)
    expect(classifyExternalProduct(page('https://www.agnesb.com/fr-eu/homme/pret-a-porter/chemise-3.html')).menswear).toBe(true)
  })
})

describe('Shopify feed — the handle names the range', () => {
  const feed = (handle: string, title: string, tags: string[] = []) => classifyShopifyProductForTests({
    id: 1, handle, title, vendor: 'Boden', product_type: '', tags, url: `https://boden.com/products/${handle}`,
    price: 55, published_at: null, images: [], variants: [{ available: true, title: 'Default Title' }],
    bodyText: '', optionColours: [],
  })
  it('sets Boden\'s children\'s pieces aside', () => {
    expect(feed('girls-leather-chelsea-boots-silver-c1980sil', 'Leather Chelsea Boots-Silver').nonFashion).toBe(true)
    expect(feed('boys-chunky-loafer-college-navy-c1234nvy', 'Chunky Loafer-College Navy').nonFashion).toBe(true)
    expect(feed('baby-cable-cardigan-oatmeal-y1234oat', 'Cable Cardigan-Oatmeal Marl').nonFashion).toBe(true)
  })
  it('keeps women\'s pieces, baby colours and boy-fit cuts', () => {
    expect(feed('women-reversible-quilted-coat-navy-and-camel-u0553nvy', 'Reversible Quilted Coat-Navy and Camel').nonFashion).toBe(false)
    expect(feed('baby-blue-cashmere-jumper', 'Baby Blue Cashmere Jumper').nonFashion).toBe(false)
    expect(feed('boy-fit-wool-blazer', 'Boy-Fit Wool Blazer').nonFashion).toBe(false)
    expect(feed('babydoll-silk-dress', 'Babydoll Silk Dress').nonFashion).toBe(false)
  })
})
