import { describe, it, expect } from 'vitest'
import { classifyExternalProduct, typeFromStoredRow } from '@/lib/brand-watch'
import { asItemType } from '@/app/admin/ai/classify-item-type'

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

  it('reads the singular words American shops use for the same garment', () => {
    // AFLALO sends no product_type and names every piece "Bradum Pant in
    // Wool". `\bpants` matched none of them, so 14 pieces of its queue were
    // untyped — and an untyped piece cannot be kept, which left ACCEPT looking
    // broken while the queue count never moved.
    expect(typeOf('Bradum Pant in Wool')).toBe('trousers')
    expect(typeOf('Marroc Pant in Silk')).toBe('trousers')
    expect(typeOf('Tavi Pant in Wool')).toBe('trousers')
    expect(typeOf('Bromer Short in Viscose')).toBe('shorts')
  })

  it('does not read a length as the garment', () => {
    // The singular "short" must never beat the piece it describes.
    expect(typeOf('Short Sleeve Shirt')).toBe('shirt')
    // A puffer is filed as a coat by the rule above this one; the point here
    // is only that the length did not turn it into a pair of shorts.
    expect(typeOf('Short Puffer Jacket')).toBe('coat')
    expect(typeOf('Short Bomber Jacket')).toBe('jacket')
    expect(typeOf('Short Pleated Skirt')).toBe('skirt')
    expect(typeOf('Short Cashmere Dress')).toBe('midi_dress')
  })

  it('does not let the singular words beat a different garment named after them', () => {
    // Every rule for these sits below the trousers and shorts rules, so an
    // unguarded singular word wins by being read first.
    expect(typeOf('PANT IX Glasses Black')).toBe('sunglasses')
    expect(typeOf('Pant Skirt Grey Melange')).toBe('skirt')
    expect(typeOf('Short Sleeve Shirt')).toBe('shirt')
    expect(typeOf('Short black double breasted wool bomber')).toBe('jacket')
    expect(typeOf('Short Glove')).toBe('gloves')
    // A piece its own name calls a skirt does not become a pair of shorts for
    // having a "detachable mini short" inside it.
    expect(typeOf('COLETTE - Sheer chiffon midi skirt with detachable mini short')).toBe('skirt')
  })

  it('does not let a cuff or a belt beat the trousers they belong to', () => {
    expect(typeOf('The Slim Cuff Pant 27.5')).toBe('trousers')
    expect(typeOf('Belted Cotton Pant')).toBe('trousers')
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

describe('reading a type back off a stored queue row', () => {
  it('names the pieces whose shop states no product_type at all', () => {
    // AFLALO sends product_type as the literal string "undefined", so its rows
    // sit in the queue with no type — and an untyped piece cannot be kept, so
    // ACCEPT did nothing and the count never moved.
    expect(typeFromStoredRow({ product_name: 'Bradum Pant in Wool', retailer_url: 'https://aflalo.com/products/bradum-pant-in-wool' })).toBe('trousers')
    expect(typeFromStoredRow({ product_name: 'Tavi Pant in Wool', retailer_url: 'https://aflalo.com/products/tavi-pant-in-wool' })).toBe('trousers')
    expect(typeFromStoredRow({ product_name: 'Bromer Short in Viscose', retailer_url: 'https://aflalo.com/products/bromer-short-in-viscose' })).toBe('shorts')
  })

  it('still refuses to guess', () => {
    // Tennis string is not a garment, and a nameless row is still nameless.
    expect(typeFromStoredRow({ product_name: 'Racquet String in Khaki', retailer_url: 'https://aflalo.com/products/racquet-string-in-khaki' })).toBeNull()
    expect(typeFromStoredRow({ product_name: '' })).toBeNull()
    expect(typeFromStoredRow({ product_name: 'Solstice' })).toBeNull()
  })
})

describe('reading an item type out of the picture', () => {
  it('files a taxonomy label straight through', () => {
    expect(asItemType('bracelet')).toBe('bracelet')
    expect(asItemType(' Trousers\n')).toBe('trousers')
    expect(asItemType('structured_bag')).toBe('structured_bag')
    expect(asItemType('t-shirt')).toBe('t-shirt')
  })

  it('takes the plain word for a label the taxonomy spells differently', () => {
    expect(asItemType('tee')).toBe('t-shirt')
    expect(asItemType('jumper')).toBe('knitwear')
    expect(asItemType('bag')).toBe('structured_bag')
    expect(asItemType('earring')).toBe('earrings')
  })

  it('refuses anything that is not one of the labels', () => {
    // A bracelet woven from tennis string must not be filed as "string", and
    // "jewellery" is too broad to be one row in the library.
    expect(asItemType('string')).toBeNull()
    expect(asItemType('jewellery')).toBeNull()
    expect(asItemType('unclear')).toBeNull()
    expect(asItemType('')).toBeNull()
  })
})

describe('combined retailer categories', () => {
  const parsed3 = (title: string, url: string) => ({
    url, title, brand: 'Sessùn', description: '', category: '',
    price: 100, currency: 'GBP', images: ['https://x/i.jpg'], available: true,
  })
  it('does not let "skirts-and-shorts" decide the type', () => {
    // Sessùn files a knit midi SKIRT under /catalogue/skirts-and-shorts/ and
    // it came out shorts, because the shorts rule is tested first.
    const c = classifyExternalProduct(parsed3('ALYORA Espresso', 'https://www.sessun.co.uk/catalogue/skirts-and-shorts/alyora-espresso.html'))
    expect(c.itemType).not.toBe('shorts')
  })
  it('still reads the type when the piece names it itself', () => {
    expect(classifyExternalProduct(parsed3('Violetta Cotton Skirt', 'https://www.sessun.co.uk/catalogue/skirts-and-shorts/violetta.html')).itemType).toBe('skirt')
    expect(classifyExternalProduct(parsed3('Tallulah Shorts', 'https://x.com/catalogue/skirts-and-shorts/tallulah.html')).itemType).toBe('shorts')
  })
})

describe('what MYRA does not style', () => {
  const p = (title: string) => ({
    url: 'https://x.com/p', title, brand: 'X', description: '', category: '',
    price: 100, currency: 'GBP', images: ['https://x/i.jpg'], available: true,
  })
  it('keeps swimwear and underwear out of the queue entirely', () => {
    // A bikini top has no swimwear type to go to, so it fell through to the
    // untyped default and was composed as a BLOUSE in a client's outfit.
    for (const t of [
      'EXCLUSIVE: Astella swimsuit', 'Astra Triangle bikini top',
      'Knotted-strap one-piece swimsuit', 'Thin Strap Lingerie Top',
    ]) {
      expect(classifyExternalProduct(p(t)).nonFashion).toBe(true)
    }
  })
  it('still lets ordinary clothes through', () => {
    for (const t of ['Silk Cami Top', 'Wide Leg Trouser', 'Wool Coat']) {
      expect(classifyExternalProduct(p(t)).nonFashion).toBe(false)
    }
  })
})

describe('vest is a top unless something says otherwise', () => {
  const p = (title: string, url = 'https://x.com/products/x') => ({
    url, title, brand: 'X', description: '', category: '',
    price: 100, currency: 'GBP', images: ['https://x/i.jpg'], available: true,
  })
  const t = (title: string, url?: string) => classifyExternalProduct(p(title, url)).itemType

  it('reads a knit vest as knitwear, not outerwear', () => {
    expect(t('MMAyana Wool Knit Vest')).toBe('knitwear')
    expect(t('Relaxed Cashmere High Neck Vest')).toBe('knitwear')
  })

  it('puts an unqualified vest on the top half, whatever else it decides', () => {
    // "Amara v-neck vest" could be knit or woven and the name does not say.
    // Blouse is a fair read; what matters is that it is not her coat.
    const vneck = t('Amara v-neck vest', 'https://uk.skallstudio.com/products/amara-v-neck-vest-light-green')
    expect(vneck).not.toBe('gilet')
    expect(['blouse', 'knitwear']).toContain(vneck)
  })

  it('reads a plain vest as a sleeveless top', () => {
    // The URL says vest, the name says top — either way it is not a coat.
    expect(t('Tura Top - NAVY', 'https://mkdtstudio.com/products/tura-soft-denim-vest-navy')).toBe('blouse')
    expect(t('Elle Ribbed Vest - White')).toBe('knitwear')
  })

  it('still reads real outerwear as a gilet', () => {
    expect(t('Sheepskin Gilet')).toBe('gilet')
    expect(t('Merino Wool Gilet')).toBe('gilet')
    expect(t('Carina Duffle Gilet - Cocoa')).toBe('gilet')
    expect(t('Quilted Vest')).toBe('gilet')
  })

  it('reads a waistcoat as a top, not a layer', () => {
    // Chloe, 2026-09-15: "this gilet is more of a top than a jacket" — a
    // Clementine waistcoat was layered over a sleeveless maxi dress.
    expect(t('Merlin waistcoat')).toBe('blouse')
    expect(t('Clementine waistcoat - Natural')).toBe('blouse')
  })
})

describe('names the classifier was mistyping (found composing for Alison)', () => {
  it('reads earrings as earrings even when they mention a chain', () => {
    expect(typeOf('Fine chain earrings with stones')).toBe('earrings')
    expect(typeOf('Damita gold-tone faux pearl earrings')).toBe('earrings')
    expect(typeOf('Layered T-Bar Necklace')).toBe('necklace')
  })

  it('does not read a shirt as a tee because a word ends in t', () => {
    expect(typeOf('Draped funnel neck cross-front shirt')).toBe('shirt')
    expect(typeOf('Asymmetric spread collar short shirt')).toBe('shirt')
    expect(typeOf('Sunday Best Shirt - WHITE')).toBe('shirt')
    expect(typeOf('Organic Cotton T-Shirt')).toBe('t-shirt')
    expect(typeOf('Boxy Tee')).toBe('t-shirt')
  })

  it('reads a sweatshirt as knitwear, not a tee', () => {
    expect(typeOf('Carala organic cotton sweatshirt')).toBe('knitwear')
  })

  it('does not put a flat bag in the shoe slot', () => {
    expect(typeOf('Raffia texture flat bag')).not.toBe('flat')
    expect(typeOf('Leather Ballet Flat')).toBe('flat')
  })
})
