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

describe('a shoe word inside a garment name is not a shoe', () => {
  // Shoes are read before tops, so these all came through as flats.
  const at = (title: string, url: string) => classifyExternalProduct(parsed(title, url)).itemType
  it('keeps a Ballerina top a top', () => {
    expect(typeOf('Organic Cotton Ballerina Top - Clay')).toBe('blouse')
    expect(typeOf('Ballerina Wrap Knit Top - Off White')).toBe('knitwear')
    expect(typeOf('BALLERINA LONG SLEEVE TOP IN MESH JERSEY')).toBe('blouse')
  })
  it('reads the category in the path over a colourway called Ballerina', () => {
    expect(at('CHEBBI Ballerina', 'https://www.sessun.co.uk/catalogue/sweatshirts/chebbi-ballerina.html')).toBe('knitwear')
    expect(at('TAMAYO Ballerina', 'https://www.sessun.co.uk/catalogue/trousers/tamayo-ballerina.html')).toBe('trousers')
  })
  it('does not make shoes of flat-front trousers, a loafer jean or a flat belt', () => {
    expect(at('viscose and silk velvet trousers night', 'https://forte-forte.com/products/pantalone-flared-flat-front-velluto-liscio-vi-se-night')).toBe('trousers')
    expect(at('Cath x WYSE Signature Jean - Black', 'https://www.wyselondon.com/products/cath-x-wyse-loafer-jean-black')).toBe('jeans')
    expect(at('JANE BELT', 'https://nililotan.com/products/janes-belt-flat-calfskin')).toBe('belt')
    expect(at('KIKI SWEATPANT', 'https://nililotan.com/products/kiki-sweatpant-washed-black')).toBe('trousers')
  })
  it('still reads real flats', () => {
    expect(typeOf('Ballerina Flat - Off White')).toBe('flat')
    expect(typeOf('black leather Alice ballerinas')).toBe('flat')
    expect(typeOf('PEDILLE FLAT BALLERINA IN GOATSKIN LEATHER')).toBe('flat')
    expect(typeOf('Raffia Texture Flat Bag')).not.toBe('flat')
  })
})

describe('knit is a construction, not a garment (Chloe, 2026-11-09)', () => {
  // Outfit Review set Yves Salomon's fur jackets in the TOP slot under a camel
  // coat: the bare word "knit" was filed as knitwear before any garment word
  // below it could be read. 355 pieces were typed knitwear by that word alone.
  it('reads the garment word over the knit', () => {
    expect(typeOf('Merino knit jacket with fox fur')).toBe('jacket')
    expect(typeOf('Mink fur and Merino knit jacket')).toBe('jacket')
    expect(typeOf('Tech Knit Jacket')).toBe('jacket')
    expect(typeOf('Knit bomber jacket in wool blend')).toBe('jacket')
    expect(typeOf('Knit straight trousers')).toBe('trousers')
    expect(typeOf('Merino knit wide leg trousers')).toBe('trousers')
    expect(typeOf('ASPEN SANDSTONE STRIPE KNIT PANT')).toBe('trousers')
    expect(typeOf('Jacquard Midi Knit Skirt')).toBe('skirt')
    expect(typeOf('Flecked knit shorts co-ord')).toBe('shorts')
    expect(typeOf('Culottes in fine lamb leather')).toBe('trousers')
    expect(typeOf('Triangle Knit Scarf')).toBe('scarf')
    expect(typeOf('Knitted wool beanie')).toBe('hat')
    expect(typeOf('100% cashmere knit balaclava')).toBe('hat')
    expect(typeOf('HOOD IN YAK ALPACA')).toBe('hat')
    expect(typeOf('Cashmere wool knit and rex rabbit fur fingerless gloves')).toBe('gloves')
    expect(typeOf('Cashmere and wool knit mittens with cashmere lambskin')).toBe('gloves')
    expect(typeOf('100% cashmere knit bandana')).toBe('scarf')
    // The garment word can come BEFORE the knit.
    expect(typeOf('Long jacket in knitted fox fur')).toBe('jacket')
    expect(typeOf('Knitted short fox fur jacket')).toBe('jacket')
    // A handle that says "fox vest" is a fur gilet, not a knit vest.
    expect(classifyExternalProduct(parsed('Merino knit and fox fur jacket', 'https://www.yves-salomon.co.uk/products/merino-knit-and-fox-vest-brown-27wyg90871marea2197')).itemType).toBe('gilet')
    expect(typeOf('Cashmere High Neck Knit Vest')).toBe('knitwear')
  })
  it('still reads a knit top as knitwear', () => {
    expect(typeOf('Merino knit sweater')).toBe('knitwear')
    expect(typeOf('Ribbed Knit Top')).toBe('knitwear')
    expect(typeOf('Cable Cardigan')).toBe('knitwear')
    expect(typeOf('Cashmere Boxy Polo Neck')).toBe('knitwear')
    // A scarf that comes WITH the jumper does not make the jumper a scarf.
    expect(typeOf('Straight Sweater + Scarf')).toBe('knitwear')
    expect(typeOf('Cashmere V-neck sweater with removable scarf')).toBe('knitwear')
    expect(typeOf('ANDIE IVORY SCARF KNIT JUMPER')).toBe('knitwear')
  })
  it('reads the last word of a knit compound as the garment', () => {
    expect(typeOf('Bomber sweater-jacket in colorblock vintage wool')).toBe('jacket')
    expect(typeOf('Cardigan jacket in vintage wool blend')).toBe('jacket')
    expect(typeOf('Nadine Column Sweater Skirt')).toBe('skirt')
    expect(typeOf('Mini knit sweater-skirt in argyle wool')).toBe('skirt')
  })
  it('reads a cardigan made of fur as a jacket, and a fur-trimmed one as a cardigan', () => {
    expect(typeOf('Belted cardigan in merino knit and fox fur')).toBe('jacket')
    expect(typeOf('Knitted Cardigan With Faux Fur Cuffs Navy Green Red Argyle Brown')).toBe('knitwear')
    expect(typeOf('Bill Blass 1980s Cream Fur Plaid Lined Sweater')).toBe('knitwear')
  })
})

describe('knit accessories that fell to the Spanish rules', () => {
  it('reads a knitted collar as a scarf, not a Spanish necklace', () => {
    expect(typeOf('Kate Collar - Tobacco')).toBe('scarf')
    expect(typeOf('COLLAR GAD BEIGE MELANGE')).toBe('scarf')
    expect(typeOf('COLLAR WOOL  BEIGE')).toBe('scarf')
    expect(typeOf('COLLAR GAD NAVY')).toBe('scarf')
    expect(typeOf('Dusyk zip collar (262 / W / CAPTAIN)')).toBe('scarf')
    // A Spanish necklace is still a necklace.
    expect(typeOf('COLLAR PERLAS')).toBe('necklace')
  })
  it('reads the shoes that name no heel or sole of their own', () => {
    // MKDT Studio's fringed flat was set in the TOP slot of an outfit.
    expect(typeOf('Ardea Shoes - IVORY')).toBe('flat')
    expect(typeOf('Alaia Shoes - BLACK')).toBe('flat')
    expect(typeOf('Chylak Monk Shoes “glossy black”')).toBe('flat')
    expect(typeOf('Leather boat shoes')).toBe('flat')
    expect(typeOf('Romine suede slippers')).toBe('flat')
    expect(typeOf('Ponyhair Clogs (262 / W / BROWN)')).toBe('mule')
    expect(typeOf('Topstitched smooth leather clogs')).toBe('mule')
    // Not the things sold for shoes, a shoestring strap, or a garment in a shoe's name.
    expect(typeOf('Chylak Pearl Shoe Clips')).not.toBe('flat')
    expect(typeOf('Shoe-string Strap Cami Top')).not.toBe('flat')
    expect(typeOf('Organic Cotton Ballerina Top - Jet Black')).toBe('blouse')
    expect(typeOf('Cath X WYSE Loafer Jean - Mid Wash')).toBe('jeans')
  })
  it('reads a cardi as knitwear, not a Spanish salón heel', () => {
    expect(typeOf('The Brushed Cashmere Salon Cardi -- Taupe Multi')).toBe('knitwear')
  })
})
