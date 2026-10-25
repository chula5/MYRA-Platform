import { describe, it, expect } from 'vitest'
import { notAProductPage } from '../mirror/style'

describe('notAProductPage — the Mirror never makes a piece out of writing', () => {
  it('refuses a newsletter article, priced or not', () => {
    expect(notAProductPage({ url: 'https://thedatafashionbrief.substack.com/p/i-make-my-living-studying-trends', price: null })).toBe(true)
    expect(notAProductPage({ url: 'https://medium.com/@someone/what-to-wear', price: 20 })).toBe(true)
  })

  it('refuses a shop journal page with no price', () => {
    expect(notAProductPage({ url: 'https://www.toa.st/journal/autumn-edit/', price: null })).toBe(true)
  })

  it('keeps real product pages', () => {
    expect(notAProductPage({ url: 'https://www.phoebephilo.com/products/aviator-jacket-dark-emerald-leather', price: 4700 })).toBe(false)
    expect(notAProductPage({ url: 'https://www.libertylondon.com/uk/poet-cotton-cashmere-cardigan-R729081006.html', price: 88 })).toBe(false)
    expect(notAProductPage({ url: 'https://www.zara.com/uk/en/p/wool-coat-p01234.html', price: null })).toBe(false)
  })
})
