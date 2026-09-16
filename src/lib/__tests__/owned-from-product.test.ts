import { describe, it, expect } from 'vitest'
import { buildOwnedItemFromProduct } from '@/lib/wardrobe/approve'

describe('buildOwnedItemFromProduct', () => {
  const base = {
    owner: { kind: 'pilot_member' as const, id: 'member-1' },
    brandId: null,
    brandLabel: 'Skall Studio',
    productName: 'Clementine Waistcoat - Natural',
    imageUrl: 'https://res.cloudinary.com/x/image/upload/v1/w.jpg',
    retailerUrl: 'https://skallstudio.com/products/clementine',
    price: 180,
    currency: 'GBP',
    scores: { item_type: 'blouse', colour_family: 'cream', fit: 3, sleeve: 1, product_name: null, brand_name: null } as any,
    lowConfidence: ['brand_price_tier'],
    retailer: 'Skall Studio',
    orderDate: '2026-03-14',
    colour: 'Natural',
    size: 'S',
    findId: 'find-1',
  }

  it('makes an owned, composable item owned by the member', () => {
    const row = buildOwnedItemFromProduct(base)
    expect(row).toMatchObject({
      ownership: 'owned', owner_kind: 'pilot_member', owner_user_id: 'member-1', status: 'ready',
      item_type: 'blouse', colour_family: 'cream', sleeve: 1, stock_status: 'in_stock',
      retailer_url: 'https://skallstudio.com/products/clementine', price: '180', estimated_value: 180,
    })
    expect((row.owned_metadata as any)).toMatchObject({ owned_since: '2026-03-14', brand_label: 'Skall Studio', fit_notes: 'Bought in S' })
  })

  it('drops out-of-range scores and keeps a known brand off the label', () => {
    const row = buildOwnedItemFromProduct({ ...base, brandId: 'brand-9', scores: { ...base.scores, fit: 9 } })
    expect(row.fit).toBeNull()
    expect((row.owned_metadata as any).brand_label).toBeNull()
  })
})
