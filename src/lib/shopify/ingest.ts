// Catalogue ingestion: pull a merchant's products and land them as DRAFT items
// for manual review + scoring. Nothing here ever reaches the live feed — that
// is Chloe's explicit action in admin (non-negotiable per the build spec).
//
// GBP: prices come from Shopify Markets via contextualPricing(country: GB), so
// we store the merchant's real UK price rather than converting client-side. The
// shop's own currency amount is kept alongside it.

import { createAdminClient } from '@/lib/supabase-server'
import { shopifyGraphql } from './client'
import type { ShopifyMerchant } from './merchant'

const PAGE_SIZE = 50

// One page of products with variants, images, inventory and GB contextual price.
const PRODUCTS_QUERY = `
query MyraProducts($first: Int!, $after: String) {
  products(first: $first, after: $after, query: "status:active") {
    pageInfo { hasNextPage endCursor }
    nodes {
      id
      title
      handle
      productType
      vendor
      status
      totalInventory
      featuredImage { url }
      images(first: 5) { nodes { url } }
      priceRangeV2 { minVariantPrice { amount currencyCode } }
      contextualPricing(context: { country: GB }) {
        minVariantPricing: minVariantPrice { amount currencyCode }
      }
      variants(first: 50) {
        nodes {
          id
          title
          sku
          availableForSale
          inventoryQuantity
          inventoryItem { id }
          contextualPricing(context: { country: GB }) {
            price { amount currencyCode }
          }
          price
        }
      }
    }
  }
}`

export interface IngestResult {
  productsSeen: number
  itemsInserted: number
  itemsUpdated: number
  error?: string
}

function num(v: unknown): number | null {
  const n = parseFloat(String(v ?? '').replace(/[^0-9.]/g, ''))
  return Number.isFinite(n) ? n : null
}

// In-stock variant size labels — the same shape the stock sentinel and review
// chips already expect (item.stock_sizes).
function inStockSizes(variants: any[]): string[] {
  return variants
    .filter((v) => v?.availableForSale)
    .map((v) => String(v?.title ?? '').trim())
    .filter((t) => t && t.toLowerCase() !== 'default title')
}

function stockStatus(variants: any[]): 'in_stock' | 'low_stock' | 'out_of_stock' {
  const available = variants.filter((v) => v?.availableForSale)
  if (available.length === 0) return 'out_of_stock'
  const totalQty = available.reduce((s, v) => s + (Number(v?.inventoryQuantity) || 0), 0)
  if (available.length <= 2 || (totalQty > 0 && totalQty <= 3)) return 'low_stock'
  return 'in_stock'
}

export async function ingestCatalogue(merchant: ShopifyMerchant): Promise<IngestResult> {
  const admin = createAdminClient()
  const result: IngestResult = { productsSeen: 0, itemsInserted: 0, itemsUpdated: 0 }

  // Resolve the brand for this merchant's own-label goods. A merchant may sell
  // other labels (constraint 1) — those get re-assigned during admin review.
  const { data: brandRow } = await admin
    .from('brand' as any)
    .select('brand_id')
    .ilike('name', merchant.name)
    .maybeSingle()
  const brandId = (brandRow as any)?.brand_id ?? null

  let after: string | null = null
  let guard = 0

  do {
    if (++guard > 40) break // ~2000 products, plenty; prevents a runaway loop

    const data: any = await shopifyGraphql(merchant.shop_domain, merchant.accessToken, PRODUCTS_QUERY, {
      first: PAGE_SIZE,
      after,
    })
    const conn = data?.products
    const nodes: any[] = conn?.nodes ?? []

    // Raw payload first — so we can re-parse without re-fetching.
    await admin.from('shopify_raw_payload' as any).insert({
      merchant_id: merchant.merchant_id,
      kind: 'product',
      shopify_id: null,
      payload: conn as any,
    } as any)

    for (const p of nodes) {
      result.productsSeen++
      const variants: any[] = p?.variants?.nodes ?? []
      const first = variants[0]

      // Native GB price where Markets provides it; else the shop price.
      const gbp =
        num(first?.contextualPricing?.price?.amount) ??
        num(p?.contextualPricing?.minVariantPricing?.amount)
      const shopAmount = num(first?.price) ?? num(p?.priceRangeV2?.minVariantPrice?.amount)
      const shopCurrency = p?.priceRangeV2?.minVariantPrice?.currencyCode ?? null

      const productId = String(p?.id ?? '')
      if (!productId) continue

      const row: Record<string, unknown> = {
        merchant_id: merchant.merchant_id,
        shopify_product_id: productId,
        shopify_variant_id: first?.id ? String(first.id) : null,
        shopify_inventory_item_id: first?.inventoryItem?.id ? String(first.inventoryItem.id) : null,
        shopify_handle: p?.handle ?? null,
        product_name: p?.title ?? 'Untitled',
        image_url: p?.featuredImage?.url ?? p?.images?.nodes?.[0]?.url ?? null,
        retailer_url: p?.handle ? `https://${merchant.shop_domain.replace('.myshopify.com', '.com')}/products/${p.handle}` : null,
        price: shopAmount != null ? String(shopAmount) : null,
        currency: shopCurrency,
        price_gbp: gbp,
        stock_status: stockStatus(variants),
        stock_sizes: inStockSizes(variants),
        stock_checked_at: new Date().toISOString(),
        available: variants.some((v) => v?.availableForSale),
        shopify_synced_at: new Date().toISOString(),
      }
      if (brandId) row.brand_id = brandId

      // Match an existing item so the FIRST sync adopts a manually-added
      // catalogue instead of duplicating it:
      //   1. shopify_product_id — synced before
      //   2. shopify_handle     — synced under a different product id
      //   3. retailer_url /products/<handle> — how items were added by hand
      //      before the app existed. This is the case that matters: J'amemme
      //      has 35 such items, 6 of them already used in live outfits.
      let existing: { item_id: string } | null = null
      const q1 = await admin.from('item' as any).select('item_id').eq('shopify_product_id', productId).maybeSingle()
      existing = (q1.data as any) ?? null

      const handle = p?.handle ? String(p.handle) : ''
      if (!existing && handle) {
        const q2 = await admin
          .from('item' as any)
          .select('item_id')
          .eq('merchant_id', merchant.merchant_id)
          .eq('shopify_handle', handle)
          .maybeSingle()
        existing = (q2.data as any) ?? null

        if (!existing) {
          const q3 = await admin
            .from('item' as any)
            .select('item_id')
            .eq('merchant_id', merchant.merchant_id)
            .is('shopify_product_id', null)
            .ilike('retailer_url', `%/products/${handle}%`)
            .limit(1)
          existing = ((q3.data as any[]) ?? [])[0] ?? null
        }
      }

      if (existing) {
        // Adopt it: attach Shopify ids + refresh the facts. `status` is never
        // in `row`, so a curated/live item is never knocked back to draft and
        // its outfit memberships stay intact.
        await admin.from('item' as any).update(row as any).eq('item_id', (existing as any).item_id)
        result.itemsUpdated++
      } else {
        await admin.from('item' as any).insert({ ...row, status: 'draft' } as any)
        result.itemsInserted++
      }
    }

    after = conn?.pageInfo?.hasNextPage ? conn.pageInfo.endCursor : null
  } while (after)

  await admin
    .from('merchant' as any)
    .update({ catalogue_synced_at: new Date().toISOString() } as any)
    .eq('merchant_id', merchant.merchant_id)

  return result
}
