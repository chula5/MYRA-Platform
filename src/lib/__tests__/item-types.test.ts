import { describe, it, expect } from 'vitest'
import { classifyExternalProduct } from '@/lib/brand-watch'

const parsed = (title: string, url = 'https://uk.varley.com/products/x') => ({
  url, title, brand: 'Varley', description: '', category: '',
  price: 100, currency: 'GBP', images: ['https://x/i.jpg'], available: true,
})
const typeOf = (title: string) => classifyExternalProduct(parsed(title)).itemType

describe('item types the scanner was missing', () => {
  it('reads a runner as a sneaker', () => {
    // Activewear brands do not use the word "sneaker". Varley sells six
    // runners; two came through with no type at all.
    expect(typeOf('Aleone Runner')).toBe('sneaker')
    expect(typeOf('Amera Runner Suede/Satin')).toBe('sneaker')
    expect(typeOf('Asmei Sneaker Suede')).toBe('sneaker')
  })

  it('reads the other names that were falling through', () => {
    expect(typeOf('Jute Espadrille')).toBe('flat')
    expect(typeOf('Bermuda Short')).toBe('shorts')
    expect(typeOf('Linen Overshirt')).toBe('shirt')
    expect(typeOf('Pique Polo Shirt')).toBe('t-shirt')
  })

  it('does not read a polo NECK as a polo shirt', () => {
    // "Cashmere Boxy Polo Neck" is a roll-neck jumper, not a tee.
    expect(typeOf('Cashmere Boxy Polo Neck')).toBe('knitwear')
  })

  it('still keeps homeware and trinkets out', () => {
    for (const t of ['Leather Keychain', 'Card Holder', 'Passport Holder']) {
      expect(classifyExternalProduct(parsed(t)).nonFashion).toBe(true)
    }
  })
})

describe('names that must not be mistyped', () => {
  const parsed2 = (title: string) => ({
    url: 'https://x.com/p', title, brand: 'X', description: '', category: '',
    price: 100, currency: 'GBP', images: ['https://x/i.jpg'], available: true,
  })
  it('keeps a cashmere stole a scarf, not a jumper', () => {
    expect(classifyExternalProduct(parsed2('Cashmere Stole')).itemType).toBe('scarf')
  })
})
