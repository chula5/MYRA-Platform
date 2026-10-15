import { describe, expect, it } from 'vitest'
import { outfitToText, picturesOf, pictureLine } from '@/lib/mcp/outfit-text'

const piece = (over: Partial<Parameters<typeof pictureLine>[0] & { price_gbp: number | null; owned: boolean; url: string | null }> = {}) => ({
  name: 'Dan Trousers', brand: 'Sézane', price_gbp: 135, owned: false, url: 'https://sezane.com/dan',
  image_url: 'https://cdn.sezane.com/dan.jpg', ...over,
})

describe('outfit text for an assistant', () => {
  it('puts a markdown image under every piece that has a picture', () => {
    const t = outfitToText({ pieces: [piece()], why: 'Brown and black.' }, 0)
    expect(t.split('\n')).toEqual([
      'Look 1',
      '  Sézane — Dan Trousers · £135 · https://sezane.com/dan',
      '  ![Sézane — Dan Trousers](https://cdn.sezane.com/dan.jpg)',
      '  Why: Brown and black.',
    ])
  })

  it('leaves the picture line out when MYRA has none, and marks what is hers', () => {
    const t = outfitToText({ pieces: [piece({ owned: true, price_gbp: null, url: null, image_url: null, name: 'Charlotte Jacket' })], why: '' }, 2)
    expect(t).toBe('Look 3\n  ◈ Sézane — Charlotte Jacket (hers already)')
  })

  it('keeps brackets and line breaks out of the alt text', () => {
    expect(pictureLine({ brand: 'ME+EM', name: 'Soft [Stripe]\nBlouse', image_url: 'https://x/y.jpg' })).toBe('![ME+EM — Soft Stripe Blouse](https://x/y.jpg)')
  })

  it('collects each picture once, in look order, up to a cap', () => {
    const jacket = piece({ name: 'Charlotte Jacket', image_url: 'https://cdn/jacket.jpg' })
    const looks = [
      { pieces: [piece(), jacket], why: '' },
      { pieces: [jacket, piece({ image_url: null }), piece({ image_url: 'https://cdn/shoe.jpg' })], why: '' },
    ]
    expect(picturesOf(looks)).toEqual([
      { url: 'https://cdn.sezane.com/dan.jpg', caption: 'Sézane — Dan Trousers' },
      { url: 'https://cdn/jacket.jpg', caption: 'Sézane — Charlotte Jacket' },
      { url: 'https://cdn/shoe.jpg', caption: 'Sézane — Dan Trousers' },
    ])
    expect(picturesOf(looks, 2).map((p) => p.url)).toEqual(['https://cdn.sezane.com/dan.jpg', 'https://cdn/jacket.jpg'])
  })
})
