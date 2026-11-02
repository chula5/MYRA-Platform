import { describe, expect, it } from 'vitest'
import { outfitToText, picturesOf, pictureLine, lookPicture } from '@/lib/mcp/outfit-text'

const piece = (over: Partial<Parameters<typeof pictureLine>[0] & { price_gbp: number | null; owned: boolean; url: string | null }> = {}) => ({
  name: 'Dan Trousers', brand: 'Sézane', price_gbp: 135, owned: false, url: 'https://sezane.com/dan',
  image_url: 'https://cdn.sezane.com/dan.jpg', ...over,
})

describe('outfit text for an assistant', () => {
  it('puts the look picture under the heading, then every piece without its own picture', () => {
    const shoe = piece({ name: 'Carly Heel', brand: 'WYSE', image_url: 'https://cdn/shoe.jpg', url: null })
    const t = outfitToText({ pieces: [piece(), shoe], why: 'Brown and black.' }, 0)
    expect(t.split('\n')).toEqual([
      'Look 1',
      '  ![Look 1 — Sézane Dan Trousers](https://cdn.sezane.com/dan.jpg)',
      '  Sézane — Dan Trousers · £135 · https://sezane.com/dan',
      '  WYSE — Carly Heel · £135',
      '  Why: Brown and black.',
    ])
  })

  it('leaves the picture line out when MYRA has none, and marks what is hers', () => {
    const t = outfitToText({ pieces: [piece({ owned: true, price_gbp: null, url: null, image_url: null, name: 'Charlotte Jacket' })], why: '' }, 2)
    expect(t).toBe('Look 3\n  ◈ Sézane — Charlotte Jacket (hers already)')
  })

  it('falls back to the first piece with a picture when the anchor has none', () => {
    const bag = piece({ name: 'Pouch', image_url: 'https://cdn/bag.jpg' })
    expect(lookPicture({ pieces: [piece({ image_url: null }), bag], why: '' })).toBe(bag)
  })

  it('keeps brackets and line breaks out of the alt text', () => {
    expect(pictureLine({ brand: 'ME+EM', name: 'Soft [Stripe]\nBlouse', image_url: 'https://x/y.jpg' })).toBe('![ME+EM — Soft Stripe Blouse](https://x/y.jpg)')
  })

  it('collects one picture per look, in look order, up to a cap', () => {
    const jacket = piece({ name: 'Charlotte Jacket', image_url: 'https://cdn/jacket.jpg' })
    const looks = [
      { pieces: [piece(), jacket], why: '' },
      { pieces: [piece({ image_url: null }), piece({ image_url: 'https://cdn/shoe.jpg', name: 'Shoe' })], why: '' },
      { pieces: [jacket], why: '' },
    ]
    expect(picturesOf(looks)).toEqual([
      { url: 'https://cdn.sezane.com/dan.jpg', caption: 'Look 1 — Sézane Dan Trousers · Sézane Charlotte Jacket' },
      { url: 'https://cdn/shoe.jpg', caption: 'Look 2 — Sézane Dan Trousers · Sézane Shoe' },
      { url: 'https://cdn/jacket.jpg', caption: 'Look 3 — Sézane Charlotte Jacket' },
    ])
    expect(picturesOf(looks, 2).map((p) => p.url)).toEqual(['https://cdn.sezane.com/dan.jpg', 'https://cdn/shoe.jpg'])
  })
})
