import { describe, it, expect } from 'vitest'
import { qualifyFromProductsJson, autoRejectReason, type Qualification } from '@/lib/partners/qualify'

describe('qualifyFromProductsJson', () => {
  it('extracts product count and price range from a Shopify payload', () => {
    const q = qualifyFromProductsJson({
      products: [
        { variants: [{ price: '120.00' }, { price: '140.00' }] },
        { variants: [{ price: '480.00' }] },
      ],
    })
    expect(q).toMatchObject({ isShopify: true, productCount: 2, priceMin: 120, priceMax: 480 })
  })

  it('treats an empty or non-Shopify payload as not Shopify', () => {
    expect(qualifyFromProductsJson({ products: [] }).isShopify).toBe(false)
    expect(qualifyFromProductsJson({}).isShopify).toBe(false)
    expect(qualifyFromProductsJson(null).isShopify).toBe(false)
    expect(qualifyFromProductsJson('<html>not json</html>').isShopify).toBe(false)
  })

  it('ignores zero/garbage prices rather than reporting a £0 range', () => {
    const q = qualifyFromProductsJson({ products: [{ variants: [{ price: '0.00' }, { price: 'abc' }] }] })
    expect(q.priceMin).toBe(null)
    expect(q.priceMax).toBe(null)
    expect(q.productCount).toBe(1)
  })
})

describe('autoRejectReason — only unambiguous non-fits, everything else to review', () => {
  const base: Qualification = { isShopify: true, reachable: true, productCount: 40, priceMin: 100, priceMax: 500, currencies: [], note: '' }

  it('passes a plausible Shopify store to human review', () => {
    expect(autoRejectReason(base)).toBe(null)
  })
  it('rejects unreachable, non-Shopify, and empty stores', () => {
    expect(autoRejectReason({ ...base, reachable: false })).toContain('unreachable')
    expect(autoRejectReason({ ...base, isShopify: false })).toContain('Shopify')
    expect(autoRejectReason({ ...base, productCount: 0 })).toContain('No visible products')
  })
  it('does NOT auto-reject on taste factors — curation is the human gate', () => {
    expect(autoRejectReason({ ...base, priceMin: 5, priceMax: 15 })).toBe(null) // cheap ≠ auto-reject
    expect(autoRejectReason({ ...base, productCount: 3 })).toBe(null)           // tiny ≠ auto-reject
  })
})
