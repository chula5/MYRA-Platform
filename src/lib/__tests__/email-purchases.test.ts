import { describe, it, expect } from 'vitest'
import { looksLikeOrderEmail, parseExtraction, findKey, emailForExtraction } from '@/lib/email/purchase-core'

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
