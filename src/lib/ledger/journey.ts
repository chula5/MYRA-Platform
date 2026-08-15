// 30-day attribution via Shopify's own customer journey. Shopify retains every
// session that led to an order (30-day lookback), so a shopper who clicked
// MYRA on Monday and bought direct two weeks later is still attributable —
// without ANY code on the merchant's storefront.
//
// Attribution is computed asynchronously on Shopify's side (`ready` flag), so
// callers must treat "not ready" as retry-later, not "no attribution".

import { shopifyGraphql } from '@/lib/shopify/client'
import type { ShopifyMerchant } from '@/lib/shopify/merchant'
import type { JourneyMoment } from './logic'

const JOURNEY_QUERY = `
query MyraJourney($id: ID!) {
  order(id: $id) {
    customerJourneySummary {
      ready
      daysToConversion
      moments(first: 30) {
        nodes {
          ... on CustomerVisit {
            landingPage
            referrerUrl
            occurredAt
            utmParameters { source medium }
          }
        }
      }
    }
  }
}`

export interface JourneyResult {
  ready: boolean
  moments: JourneyMoment[]
  daysToConversion: number | null
}

export async function fetchOrderJourney(
  merchant: ShopifyMerchant,
  shopifyOrderNumericId: string | number,
): Promise<JourneyResult | null> {
  try {
    const gid = String(shopifyOrderNumericId).startsWith('gid://')
      ? String(shopifyOrderNumericId)
      : `gid://shopify/Order/${shopifyOrderNumericId}`
    const data: any = await shopifyGraphql(merchant.shop_domain, merchant.accessToken, JOURNEY_QUERY, { id: gid })
    const summary = data?.order?.customerJourneySummary
    if (!summary) return null
    return {
      ready: Boolean(summary.ready),
      daysToConversion: summary.daysToConversion ?? null,
      moments: (summary.moments?.nodes ?? []).filter(Boolean) as JourneyMoment[],
    }
  } catch {
    // Plan-restricted, order too old, or transient failure — caller falls back
    // to landing-site attribution rather than losing the order entirely.
    return null
  }
}
