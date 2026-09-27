import { describe, it, expect } from 'vitest'
import { classifyExternalProduct } from '../brand-watch'

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
