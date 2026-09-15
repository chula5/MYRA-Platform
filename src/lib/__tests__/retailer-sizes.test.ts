import { describe, it, expect } from 'vitest'
import {
  normaliseSizeLabel, sizesFromSfccHtml, sizesFromRscVariants, sizesFromKleepConfig,
  sizesFromPage, myshopifyDomainIn, sizeLabelFromVariant,
} from '@/lib/retailer-sizes'
import { canonicalise } from '@/lib/size-canonical'

// Fixtures are trimmed from the real product pages (fetched 2026-09-15).

const BMB = 'https://www.bymalenebirger.com/gb/en/ready-to-wear/tops-blouses/alicia-organic-cotton-t-shirt/103929653.html'
const bmbHtml = `
<div class="product-detail__size-selection-wrapper">
  <div class="size  null" aria-label="XXS" value="https://www.bymalenebirger.com/on/demandware.store/Sites-BMB-GLOBAL-Site/en_GB/Product-Variation?dwvar_103929653_color=653&amp;dwvar_103929653_size=siz02minusxxxs&amp;pid=103929653" data-attr-value="siz02minusxxxs"> <span>XXS</span> </div>
  <div class="size size--unavailable null" aria-label="XS" value="https://www.bymalenebirger.com/on/demandware.store/Sites-BMB-GLOBAL-Site/en_GB/Product-Variation?dwvar_103929653_color=653&amp;dwvar_103929653_size=siz02minusx0xs&amp;pid=103929653" data-attr-value="siz02minusx0xs"> <span>XS</span> </div>
  <div class="size size--unavailable null" aria-label="S" value="https://www.bymalenebirger.com/on/demandware.store/Sites-BMB-GLOBAL-Site/en_GB/Product-Variation?dwvar_103929653_color=653&amp;dwvar_103929653_size=siz02minusx00s&amp;pid=103929653" data-attr-value="siz02minusx00s"> <span>S</span> </div>
  <div class="size  null" aria-label="M" value="https://www.bymalenebirger.com/on/demandware.store/Sites-BMB-GLOBAL-Site/en_GB/Product-Variation?dwvar_103929653_color=653&amp;dwvar_103929653_size=siz02minusx00m&amp;pid=103929653" data-attr-value="siz02minusx00m"> <span>M</span> </div>
</div>`

const AD = 'https://www.adolfodominguez.com/en-gb/braided-fabric-japanese-sleeve-top-220121278262.html'
const adHtml = `
<button rel="https://www.adolfodominguez.com/on/demandware.store/Sites-ad-gb-Site/en_GB/Product-Variation?dwvar_220121278262_color=2103&amp;dwvar_220121278262_size=S&amp;pid=220121278262" data-attr-value="S" class="u-btn-clean product-sizes__option customized-select__option " > <span class="product-sizes__value"> S </span> </button>
<button rel="https://www.adolfodominguez.com/on/demandware.store/Sites-ad-gb-Site/en_GB/Product-Variation?dwvar_220121278262_color=2103&amp;dwvar_220121278262_size=XL&amp;pid=220121278262" data-attr-value="XL" class="u-btn-clean product-sizes__option customized-select__option stock-last-units " > <span class="product-sizes__value"> XL </span> </button>
<button rel="https://www.adolfodominguez.com/on/demandware.store/Sites-ad-gb-Site/en_GB/Product-Variation?dwvar_29610170220762_size=34&amp;pid=29610170220762" data-attr-value="34" class="u-btn-clean product-sizes__option customized-select__option disabled--unavailable js-quickshop-option" disabled> <span class="product-sizes__value"> 34 </span> </button>
<button rel="https://www.adolfodominguez.com/on/demandware.store/Sites-ad-gb-Site/en_GB/Product-Variation?dwvar_29610170220762_size=S&amp;pid=29610170220762" data-attr-value="S" class="u-btn-clean product-sizes__option customized-select__option disabled--unavailable" disabled> <span class="product-sizes__value"> S </span> </button>`

const AGNES = 'https://www.agnesb.com/en-uk/women/clothing/cardigans/snap-cardigan-in-cotton-fleece/0267M434_010.html'
const agnesHtml = `
<button class="size-attribute " aria-label="Select Size 1" aria-describedby="1" data-attr-value="1" data-url="https://www.agnesb.com/on/demandware.store/Sites-Agnesb-uk-Site/en_GB/Product-Variation?dwvar_0267M434__010_color=010&amp;dwvar_0267M434__010_size=1&amp;pid=0267M434_010&amp;quantity=1" > 1 </button>
<button class="size-attribute
                        notify-me
                        " aria-label="Select Size 5" aria-describedby="5" data-attr-value="5" data-url="https://www.agnesb.com/on/demandware.store/Sites-Agnesb-uk-Site/en_GB/Product-Variation?dwvar_0267M434__010_color=010&amp;dwvar_0267M434__010_size=5&amp;pid=0267M434_010&amp;quantity=1" > 5 </button>`

describe('normaliseSizeLabel', () => {
  it('spells out Wyse London sizes in UK and keeps the length', () => {
    const url = 'https://www.wyselondon.com/products/otti-midi-dress-white'
    expect(normaliseSizeLabel('1R', url)).toBe('1R (UK 8)')
    expect(normaliseSizeLabel('0L', url)).toBe('0L (UK 6)')
    expect(normaliseSizeLabel('4', 'https://www.wyselondon.com/products/wool-coat')).toBe('4 (UK 14)')
    expect(canonicalise('1R (UK 8)', 'tops').value).toBe(8)
  })

  it('reads ME+EM numbers as US on /us/ pages and UK elsewhere', () => {
    expect(normaliseSizeLabel('8', 'https://www.meandem.com/us/cotton-voile-blouse')).toBe('US 8')
    expect(normaliseSizeLabel('8R', 'https://www.meandem.com/us/wide-trouser')).toBe('US 8R')
    expect(normaliseSizeLabel('8', 'https://www.meandem.com/rib-polo-top')).toBe('UK 8')
    expect(normaliseSizeLabel('27', 'https://www.meandem.com/us/straight-jean')).toBe('27')
    expect(normaliseSizeLabel('6 (39)', 'https://www.meandem.com/retro-runner-black-brown')).toBe('UK 6 (EU 39)')
    expect(canonicalise('UK 6 (EU 39)', 'shoes').value).toBe(6)
    expect(canonicalise('US 4', 'tops').value).toBe(8)
    expect(canonicalise('UK 8', 'tops').value).toBe(8)
    expect(normaliseSizeLabel('XS', 'https://www.meandem.com/us/knit')).toBe('XS')
  })

  it("maps agnès b.'s 0–6 run through their chart, leaves 34–44 bare", () => {
    expect(normaliseSizeLabel('1', AGNES)).toBe('1 (UK 8)')
    expect(normaliseSizeLabel('2', AGNES)).toBe('2 (UK 10-12)')
    expect(canonicalise('1 (UK 8)', 'tops').value).toBe(8)
    expect(normaliseSizeLabel('36', AGNES)).toBe('36')
  })

  it('accepts slash alphas and waist sizes, rejects colours', () => {
    const url = 'https://uk.skallstudio.com/products/laurine-cardigan'
    expect(normaliseSizeLabel('XS/S', url)).toBe('XS/S')
    expect(canonicalise('XS/S', 'tops').values).toEqual([6, 8])
    expect(normaliseSizeLabel('27W/32L', 'https://baumundpferdgarten.com/products/niema-jeans')).toBe('27W/32L')
    expect(normaliseSizeLabel('UK 8-10', url)).toBe('UK 8-10')
    expect(canonicalise('UK 8-10', 'tops').value).toBe(8)
    expect(normaliseSizeLabel('Luwak', url)).toBeNull()
    expect(normaliseSizeLabel('Default Title', url)).toBeNull()
  })

  it('takes the size from a legacy "colour / size" variant title', () => {
    expect(normaliseSizeLabel('black / 34', 'https://intl.isabelmarant.com/products/jiska-top')).toBe('34')
    expect(normaliseSizeLabel('Black/Scarlet Red / 41', 'https://intl.isabelmarant.com/products/luza-pumps')).toBe('41')
  })
})

describe('sizesFromSfccHtml', () => {
  it('reads By Malene Birger selectors by aria-label, sold out from size--unavailable', () => {
    expect(sizesFromSfccHtml(bmbHtml, BMB)).toEqual([
      { label: 'XXS', inStock: true, level: 'in_stock' },
      { label: 'XS', inStock: false, level: 'sold_out' },
      { label: 'S', inStock: false, level: 'sold_out' },
      { label: 'M', inStock: true, level: 'in_stock' },
    ])
  })

  it("reads Adolfo Dominguez's last units as low and ignores quick-shop / other products", () => {
    expect(sizesFromSfccHtml(adHtml, AD)).toEqual([
      { label: 'S', inStock: true, level: 'in_stock' },
      { label: 'XL', inStock: true, level: 'low' },
    ])
  })

  it('reads agnès b. notify-me as sold out and annotates the size', () => {
    expect(sizesFromSfccHtml(agnesHtml, AGNES)).toEqual([
      { label: '1 (UK 8)', inStock: true, level: 'in_stock' },
      { label: '5 (UK 20-22)', inStock: false, level: 'sold_out' },
    ])
  })
})

describe('sizesFromRscVariants', () => {
  it('reads the first ME+EM variants block from the RSC stream', () => {
    const payload = JSON.stringify(
      '1b:{"variants":[{"name":"16","status":"Default"},{"name":"18","status":"OutOfStock"}]}\n' +
      '2c:{"variants":[{"name":"4","status":"OutOfStock"}]}',
    )
    const html = `<script>self.__next_f.push([1,${payload}])</script>`
    expect(sizesFromRscVariants(html, 'https://www.meandem.com/drawcord-trouser-black')).toEqual([
      { label: 'UK 16', inStock: true, level: 'in_stock' },
      { label: 'UK 18', inStock: false, level: 'sold_out' },
    ])
  })

  it('returns nothing on a page without an RSC stream', () => {
    expect(sizesFromRscVariants('<html></html>', 'https://www.meandem.com/x')).toEqual([])
  })
})

describe('sizesFromKleepConfig', () => {
  it("reads Sessùn's size widget config", () => {
    const html = `<script>var kleepConfig = {"product_id":"ynoten-ebene","sizes":[{"variantId":"XS","quantity":true},{"variantId":"S","quantity":false}]};</script>`
    expect(sizesFromKleepConfig(html, 'https://www.sessun.co.uk/catalogue/sweaters/ynoten-ebene.html')).toEqual([
      { label: 'XS', inStock: true, level: 'in_stock' },
      { label: 'S', inStock: false, level: 'sold_out' },
    ])
  })
})

describe('sizesFromPage + helpers', () => {
  it('names the extractor that answered', () => {
    expect(sizesFromPage(bmbHtml, BMB)?.via).toBe('sfcc')
    expect(sizesFromPage('<p>nothing here</p>', BMB)).toBeNull()
  })

  it("finds a headless store's myshopify domain", () => {
    expect(myshopifyDomainIn('{"storeDomain":"https://varleyuk.myshopify.com"}')).toBe('varleyuk.myshopify.com')
    expect(myshopifyDomainIn('<p>no shop</p>')).toBeNull()
  })

  it('picks the size option off a colour + size Shopify variant', () => {
    expect(sizeLabelFromVariant({ option1: 'Decadent Chocolate', option2: '3' }, 'https://uk.varley.com/products/asmei-sneaker')).toBe('3')
    expect(sizeLabelFromVariant({ option1: '2R' }, 'https://www.wyselondon.com/products/x')).toBe('2R (UK 10)')
  })
})
