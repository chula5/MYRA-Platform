// Webhook subscription + processing.
//
// Every handler obeys the same three rules (per the build spec):
//   1. HMAC verified before ANYTHING is processed
//   2. idempotent — Shopify retries, and duplicate commission records would be
//      a serious problem. webhook_delivery.delivery_id is the unique key.
//   3. return 200 fast, process asynchronously
//
// Orders are STORED here. Commission rows are deliberately NOT created yet —
// that is Part 3 (the ledger), which owns the pending→approved→payable state
// machine and the return window.

import { createAdminClient } from '@/lib/supabase-server'
import { shopifyGraphql } from './client'
import { markUninstalled, type ShopifyMerchant } from './merchant'
import { accrueCommission, reconcileOrderUpdate } from '@/lib/ledger/store'

export const WEBHOOK_TOPICS = [
  'ORDERS_CREATE',
  'ORDERS_UPDATED',
  'PRODUCTS_UPDATE',
  'PRODUCTS_DELETE',
  'INVENTORY_LEVELS_UPDATE',
  'APP_UNINSTALLED',
] as const

const SUBSCRIBE = `
mutation Subscribe($topic: WebhookSubscriptionTopic!, $callbackUrl: URL!) {
  webhookSubscriptionCreate(
    topic: $topic
    webhookSubscription: { callbackUrl: $callbackUrl, format: JSON }
  ) {
    webhookSubscription { id }
    userErrors { field message }
  }
}`

export async function registerWebhooks(merchant: ShopifyMerchant): Promise<{ registered: number; errors: string[] }> {
  const base = (process.env.SHOPIFY_APP_URL || 'https://www.myraassistant.co.uk').replace(/\/+$/, '')
  const callbackUrl = `${base}/api/shopify/webhooks`
  const errors: string[] = []
  let registered = 0

  for (const topic of WEBHOOK_TOPICS) {
    try {
      const res: any = await shopifyGraphql(merchant.shop_domain, merchant.accessToken, SUBSCRIBE, {
        topic,
        callbackUrl,
      })
      const errs = res?.webhookSubscriptionCreate?.userErrors ?? []
      // "already exists" is success for our purposes — registration is idempotent.
      const real = errs.filter((e: any) => !/already exists|taken/i.test(e?.message ?? ''))
      if (real.length) errors.push(`${topic}: ${real.map((e: any) => e.message).join(', ')}`)
      else registered++
    } catch (err) {
      errors.push(`${topic}: ${err instanceof Error ? err.message : 'failed'}`)
    }
  }

  if (registered > 0) {
    const admin = createAdminClient()
    await admin
      .from('merchant' as any)
      .update({ webhooks_registered_at: new Date().toISOString() } as any)
      .eq('merchant_id', merchant.merchant_id)
  }
  return { registered, errors }
}

// ── Processing ──────────────────────────────────────────────────────────────
// Called AFTER the 200 has been returned. Never throws to the caller.
export async function processWebhook(opts: {
  deliveryId: string
  topic: string
  shopDomain: string
  merchantId: string | null
  payload: any
}): Promise<void> {
  const admin = createAdminClient()
  const { deliveryId, topic, shopDomain, merchantId, payload } = opts

  try {
    // Keep the raw body for replay / re-parse.
    const { data: raw } = await admin
      .from('shopify_raw_payload' as any)
      .insert({
        merchant_id: merchantId,
        kind: `webhook:${topic}`,
        shopify_id: payload?.admin_graphql_api_id ?? (payload?.id != null ? String(payload.id) : null),
        payload,
      } as any)
      .select('payload_id')
      .single()

    switch (topic) {
      case 'orders/create':
        await handleOrder(merchantId, payload)
        if (merchantId) await accrueCommission({ merchantId, order: payload })
        break
      case 'orders/updated':
        await handleOrder(merchantId, payload)
        if (merchantId) await reconcileOrderUpdate(merchantId, payload)
        break
      case 'products/update':
        await handleProductUpdate(merchantId, payload)
        break
      case 'products/delete':
        await handleProductDelete(payload)
        break
      case 'inventory_levels/update':
        await handleInventoryUpdate(payload)
        break
      case 'app/uninstalled':
        await markUninstalled(shopDomain)
        break
      default:
        break // unknown topic: stored, not actioned
    }

    await admin
      .from('webhook_delivery' as any)
      .update({
        status: 'processed',
        processed_at: new Date().toISOString(),
        payload_id: (raw as any)?.payload_id ?? null,
      } as any)
      .eq('delivery_id', deliveryId)
  } catch (err) {
    await admin
      .from('webhook_delivery' as any)
      .update({
        status: 'failed',
        error: err instanceof Error ? err.message.slice(0, 500) : 'processing failed',
        processed_at: new Date().toISOString(),
      } as any)
      .eq('delivery_id', deliveryId)
  }
}

// Store the order + its MYRA click attribution. Commission accrual is Part 3.
async function handleOrder(merchantId: string | null, payload: any): Promise<void> {
  if (!merchantId) return
  const admin = createAdminClient()

  // Attribution: our own click id, echoed back through the landing URL params.
  const landing: string = payload?.landing_site ?? payload?.referring_site ?? ''
  let clickId: string | null = null
  const m = /[?&]myra_click=([0-9a-zA-Z_-]{8,64})/.exec(landing)
  if (m) clickId = m[1]

  // Verify the click exists before claiming attribution (a spoofed param
  // shouldn't create a phantom link).
  if (clickId) {
    const { data: click } = await admin
      .from('click' as any)
      .select('click_id')
      .eq('click_id', clickId)
      .maybeSingle()
    if (!click) clickId = null
  }

  await admin.from('shopify_raw_payload' as any).insert({
    merchant_id: merchantId,
    kind: 'order',
    shopify_id: payload?.admin_graphql_api_id ?? String(payload?.id ?? ''),
    payload: { ...payload, _myra_click_id: clickId },
  } as any)
}

async function handleProductUpdate(merchantId: string | null, payload: any): Promise<void> {
  const admin = createAdminClient()
  const productId: string = payload?.admin_graphql_api_id ?? ''
  if (!productId) return

  const variants: any[] = payload?.variants ?? []
  const available = variants.some((v) => (Number(v?.inventory_quantity) || 0) > 0 || v?.inventory_policy === 'continue')
  const sizes = variants
    .filter((v) => (Number(v?.inventory_quantity) || 0) > 0)
    .map((v) => String(v?.title ?? '').trim())
    .filter((t) => t && t.toLowerCase() !== 'default title')

  await admin
    .from('item' as any)
    .update({
      product_name: payload?.title ?? undefined,
      available,
      stock_status: !available ? 'out_of_stock' : sizes.length <= 2 ? 'low_stock' : 'in_stock',
      stock_sizes: sizes,
      stock_checked_at: new Date().toISOString(),
      shopify_synced_at: new Date().toISOString(),
    } as any)
    .eq('shopify_product_id', productId)
}

async function handleProductDelete(payload: any): Promise<void> {
  const admin = createAdminClient()
  const productId = payload?.admin_graphql_api_id ?? (payload?.id != null ? `gid://shopify/Product/${payload.id}` : '')
  if (!productId) return
  // Don't hard-delete curated work — mark unavailable so the outfit repair /
  // stock-sentinel flow can react.
  await admin
    .from('item' as any)
    .update({ available: false, stock_status: 'out_of_stock', stock_checked_at: new Date().toISOString() } as any)
    .eq('shopify_product_id', productId)
}

// Unique / one-off stock must react in near real time — a dead link in Source
// Items breaks the highest-intent signal we have (constraint 2).
async function handleInventoryUpdate(payload: any): Promise<void> {
  const admin = createAdminClient()
  const inventoryItemId = payload?.inventory_item_id
  if (inventoryItemId == null) return
  const gid = `gid://shopify/InventoryItem/${inventoryItemId}`
  const qty = Number(payload?.available)

  if (!Number.isFinite(qty)) return
  await admin
    .from('item' as any)
    .update({
      available: qty > 0,
      stock_status: qty <= 0 ? 'out_of_stock' : qty <= 3 ? 'low_stock' : 'in_stock',
      stock_checked_at: new Date().toISOString(),
    } as any)
    .eq('shopify_inventory_item_id', gid)
}
