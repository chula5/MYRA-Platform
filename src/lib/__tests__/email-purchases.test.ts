import { describe, it, expect } from 'vitest'
import {
  looksLikeOrderEmail, emailKind, worthReading, subjectTopic, nameAppearsIn, parseExtraction, findKey, emailForExtraction, sameFind, mergeFind, matchImagesByAlt, isGenericName,
} from '@/lib/email/purchase-core'

describe('looksLikeOrderEmail', () => {
  it('reads order confirmations and dispatch emails', () => {
    for (const subject of [
      'Your ME+EM order #10492 is confirmed',
      'Thank you for your order',
      'Your order has been dispatched',
      'Your Sézane order is on its way',
      'Receipt for your purchase',
    ]) expect(looksLikeOrderEmail({ subject })).toBe(true)
  })

  it('skips returns, refunds and marketing', () => {
    for (const subject of [
      'Your return has been received',
      'Your refund is on its way',
      'Order cancelled',
      'New in: the autumn edit',
      'Last chance — 30% off everything',
      'Verify your email to complete your order',
    ]) expect(looksLikeOrderEmail({ subject })).toBe(false)
  })
})

describe('parseExtraction', () => {
  it('tolerates missing and malformed fields', () => {
    const e = parseExtraction({
      is_purchase: true,
      retailer: 'ME+EM',
      order_date: '14 March 2026',
      items: [
        { product_name: 'Wide Leg Trouser', price: '£275.00', currency: 'gbp', image_url: 'not a url', category: 'clothing' },
        { product_name: '', category: 'clothing' },
      ],
    })
    expect(e.is_purchase).toBe(true)
    expect(e.order_date).toBe('2026-03-14')
    expect(e.items).toHaveLength(1)
    expect(e.items[0]).toMatchObject({ price: 275, currency: 'GBP', image_url: null, brand_name: null })
  })

  it('drops pieces that do not belong in a wardrobe', () => {
    const e = parseExtraction({
      is_purchase: true,
      items: [
        { product_name: 'Organic Coffee Beans', category: 'groceries' },
        { product_name: 'Leather Loafers', category: 'shoes' },
      ],
    })
    expect(e.items.map((i) => i.product_name)).toEqual(['Leather Loafers'])
  })

  it('is not a purchase when nothing wearable is left', () => {
    expect(parseExtraction({ is_purchase: true, items: [{ product_name: 'Kettle', category: 'homeware' }] }).is_purchase).toBe(false)
    expect(parseExtraction(null).is_purchase).toBe(false)
  })
})

describe('findKey', () => {
  it('matches the same piece in an order confirmation and its dispatch email', () => {
    const item = { product_name: 'Clementine Waistcoat - Natural', colour: 'Natural', size: 'S' }
    const confirmation = findKey({ retailer: 'Skall Studio', order_id: '#4491', order_date: '2026-03-01' }, item)
    const dispatch = findKey({ retailer: 'Skall Studio', order_id: '#4491', order_date: '2026-03-03' }, { ...item, product_name: 'CLEMENTINE WAISTCOAT – NATURAL' })
    expect(dispatch).toBe(confirmation)
  })

  it('keeps two sizes of the same piece apart', () => {
    const e = { retailer: 'Sessùn', order_id: '77', order_date: null }
    expect(findKey(e, { product_name: 'Tee', colour: 'Black', size: 'S' })).not.toBe(findKey(e, { product_name: 'Tee', colour: 'Black', size: 'M' }))
  })
})

describe('emailForExtraction', () => {
  it('keeps product images and links, drops tracking pixels and social icons', () => {
    const out = emailForExtraction({
      id: '1', subject: 'Your order', from: 'orders@shop.com', date: null, text: null,
      html: '<p>Wide Leg Trouser £275</p><img src="https://cdn.shop.com/p/trouser.jpg"><img src="https://t.shop.com/pixel.gif"><a href="https://shop.com/products/trouser">View</a><a href="https://instagram.com/shop">IG</a>',
    })
    expect(out.images).toEqual(['https://cdn.shop.com/p/trouser.jpg'])
    expect(out.links).toEqual(['https://shop.com/products/trouser'])
    expect(out.text).toContain('Wide Leg Trouser £275')
  })
})

describe('emailKind', () => {
  it('reads returns, refunds and cancellations as returns', () => {
    for (const subject of ['Your return has been received', 'Your refund is on its way', 'Order cancelled', 'Refund for "Isabel Marant skirt"'])
      expect(emailKind({ subject })).toBe('return')
  })
  it('still ignores marketing that mentions returns', () => {
    expect(emailKind({ subject: 'New in: free returns on the autumn edit' })).toBe(null)
    expect(emailKind({ subject: 'Receipt for your payment to Benda Bili Ltd' })).toBe('order')
  })
})

describe('parseExtraction kinds', () => {
  it('keeps a whole-order refund with no items when it names the order', () => {
    const e = parseExtraction({ kind: 'return', whole_order: true, order_id: '374353476', items: [] })
    expect(e.kind).toBe('return')
    expect(e.whole_order).toBe(true)
    expect(e.is_purchase).toBe(false)
  })
  it('a return only requested is not confirmed; a refund is', () => {
    const item = { product_name: 'Emporio Armani black jacket', category: 'clothing' }
    expect(parseExtraction({ kind: 'return', return_confirmed: false, items: [item] }).return_confirmed).toBe(false)
    expect(parseExtraction({ kind: 'return', return_confirmed: true, items: [item] }).return_confirmed).toBe(true)
    expect(parseExtraction({ kind: 'purchase', return_confirmed: true, items: [item] }).return_confirmed).toBe(false)
  })
  it('a return with nothing to match is nothing', () => {
    expect(parseExtraction({ kind: 'return', whole_order: false, items: [] }).kind).toBe('other')
  })
})

describe('sameFind — one piece across its emails', () => {
  const vinted = (name: string, date: string, extra = {}) => ({
    retailer: 'Vinted', order_id: null, order_date: date, product_name: name, brand_name: 'Emporio Armani', colour: 'black', size: '8', ...extra,
  })
  it('merges Vinted receipt, delivery and feedback emails for one jacket', () => {
    const receipt = vinted('Emporio Armani black jacket (Size 8)', '2026-09-07', { order_id: '22119012044' })
    expect(sameFind(receipt, vinted('Emporio Armani black jacket', '2026-09-12'))).toBe(true)
    expect(sameFind(receipt, vinted('Emporio Armani black jacket', '2026-09-16'))).toBe(true)
  })
  it('matches a PayPal receipt under the company name to the shop order', () => {
    const paypal = { retailer: 'Benda Bili Ltd', order_date: '2026-09-13', product_name: 'Charlotte Jacket', brand_name: null, colour: null, size: null }
    const sezane = { retailer: 'Sézane', order_date: '2026-09-13', product_name: 'Charlotte Jacket', brand_name: 'Sézane', colour: 'Brown', size: '8' }
    expect(sameFind(paypal, sezane)).toBe(true)
    expect(mergeFind(paypal, sezane)).toMatchObject({ retailer: 'Sézane', brand_name: 'Sézane', colour: 'Brown', size: '8' })
  })
  it('keeps different sizes, brands and far-apart purchases apart', () => {
    const a = vinted('Emporio Armani black jacket', '2026-09-07')
    expect(sameFind(a, vinted('Emporio Armani black jacket', '2026-09-08', { size: '12' }))).toBe(false)
    expect(sameFind(a, vinted('Black jacket', '2026-09-08', { brand_name: 'Zara' }))).toBe(false)
    expect(sameFind(a, vinted('Emporio Armani black jacket', '2026-03-01'))).toBe(false)
  })
  it('one generic word needs the same shop and colour', () => {
    const skirt = { retailer: 'Vinted', order_date: '2026-09-08', product_name: 'Isabel marant skirt', brand_name: 'Isabel Marant', colour: null, size: null }
    expect(sameFind(skirt, { ...skirt, order_date: '2026-09-10' })).toBe(true)
    expect(sameFind(skirt, { ...skirt, retailer: 'Vestiaire' })).toBe(false)
  })
  it('never merges on a generic name, but does on the same photo', () => {
    const z = { retailer: 'Zara', order_date: '2026-09-14', product_name: 'Item', brand_name: 'Zara', colour: null, size: 'S', image_url: 'https://static.zara.net/photos/a/01528804712-f1.jpg?ts=1' }
    expect(isGenericName('Item')).toBe(true)
    expect(sameFind(z, { ...z, image_url: null })).toBe(false)
    expect(sameFind(z, { ...z, product_name: 'Cream lace midi dress', image_url: 'https://static.zara.net/photos/a/01528804712-f1.jpg?ts=2' })).toBe(true)
  })
})

describe('matchImagesByAlt', () => {
  it('gives Sézane pieces the photo whose alt text names them', () => {
    const item = { product_name: 'Charlotte Jacket', brand_name: 'Sézane', colour: 'Brown', size: '8', price: 360, currency: 'GBP', image_url: null, product_url: null, category: 'clothing' }
    const out = matchImagesByAlt([item, { ...item, product_name: 'Totebag' }], [
      { url: 'https://image.news.sezane.com/lib/m/1/images1.png', alt: null },
      { url: 'https://media.sezane.com/image/upload/c_fill,h_200/gh2v7ia77gkijzynwh0o.jpg', alt: 'Charlotte Jacket' },
      { url: 'https://media.sezane.com/image/upload/c_fill,h_200/ulimvmmzpbmuzyij8xlb.jpg', alt: 'Totebag' },
    ])
    expect(out.map((i) => i.image_url)).toEqual([
      'https://media.sezane.com/image/upload/c_fill,h_200/gh2v7ia77gkijzynwh0o.jpg',
      'https://media.sezane.com/image/upload/c_fill,h_200/ulimvmmzpbmuzyij8xlb.jpg',
    ])
  })
})

describe('saving reads', () => {
  it('skips carriers, payment processors, food and her own emails', () => {
    expect(worthReading({ subject: 'Your parcel has been delivered', from: 'Royal Mail <no-reply@royalmail.com>' })).toBe(false)
    expect(worthReading({ subject: 'Your order is confirmed', from: 'Deliveroo <noreply@deliveroo.co.uk>' })).toBe(false)
    expect(worthReading({ subject: 'Receipt for your payment to Benda Bili Ltd', from: 'PayPal <service@paypal.co.uk>' })).toBe(false)
    expect(worthReading({ subject: 'Order notes', from: 'CC <ccotter31@gmail.com>' }, 'ccotter31@gmail.com')).toBe(false)
    expect(worthReading({ subject: '[Sézane] Confirmation of your Order #374353476', from: '"Sézane" <hello@sezane.com>' })).toBe(true)
    expect(worthReading({ subject: 'Your order was delivered', from: 'Zara <noreply@zara.com>' })).toBe(true)
  })
  it('gives Vinted emails about one listing the same topic', () => {
    const from = 'Team Vinted <no-reply@vinted.co.uk>'
    const receipt = subjectTopic({ subject: 'Your receipt for "Emporio Armani black jacket (Size 8)“', from })
    const needed = subjectTopic({ subject: 'Emporio Armani black jacket (Size 8) - Confirmation needed', from })
    expect(receipt).toBeTruthy()
    expect(subjectTopic({ subject: 'Your receipt for "Emporio Armani black jacket (Size 8)"', from })).toBe(receipt)
    // A return about the same listing is a different topic — it is always read.
    expect(subjectTopic({ subject: 'Return your order by 23 Sep: Emporio Armani black jacket (Size 8)', from })).not.toBe(receipt)
    expect(needed === null || needed !== receipt).toBe(true)
  })
})

describe('nameAppearsIn', () => {
  it('catches a name the email never says', () => {
    const zara = 'Your order has been shipped ORDER NO. 54426546801 1 item S 29.99 GBP'
    expect(nameAppearsIn('Striped T-shirt', zara)).toBe(false)
    expect(nameAppearsIn('Emporio Armani black jacket', 'Your receipt for "Emporio Armani black jacket (Size 8)"')).toBe(true)
    expect(nameAppearsIn('Charlotte Jacket', 'Order #374353476', [{ url: 'https://x/y.jpg', alt: 'Charlotte Jacket' }])).toBe(true)
  })
})
