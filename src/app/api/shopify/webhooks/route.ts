import { NextRequest, NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { createAdminClient } from '@/lib/supabase-server'
import { verifyWebhookHmac } from '@/lib/shopify/crypto'
import { processWebhook } from '@/lib/shopify/webhooks'

export const dynamic = 'force-dynamic'

// Single endpoint for every subscribed topic.
//
//   1. HMAC on the RAW body before anything is parsed or stored
//   2. idempotent: webhook_delivery.delivery_id is a primary key, so a retried
//      delivery is recorded once and processed once
//   3. 200 returned immediately; processing runs via waitUntil (Shopify times
//      out aggressively and retries on slow responses)

export async function POST(req: NextRequest) {
  // Raw body EXACTLY as sent — any re-serialisation would break the HMAC.
  const rawBody = await req.text()

  const hmac = req.headers.get('x-shopify-hmac-sha256')
  const topic = req.headers.get('x-shopify-topic') ?? ''
  const shopDomain = req.headers.get('x-shopify-shop-domain') ?? ''
  const deliveryId = req.headers.get('x-shopify-webhook-id') ?? ''

  if (!verifyWebhookHmac(rawBody, hmac)) {
    // Do not record unverified traffic beyond a log line — an attacker could
    // otherwise fill the delivery table.
    console.warn('[shopify webhook] HMAC failed', { topic, shopDomain })
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!deliveryId || !topic || !shopDomain) {
    return NextResponse.json({ error: 'Missing Shopify headers' }, { status: 400 })
  }

  let payload: any
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const admin = createAdminClient()

  // Resolve the merchant (may be null if we somehow don't know this shop).
  const { data: merchantRow } = await admin
    .from('merchant' as any)
    .select('merchant_id')
    .eq('shop_domain', shopDomain)
    .maybeSingle()
  const merchantId = (merchantRow as any)?.merchant_id ?? null

  // Idempotency gate: insert-if-absent. A duplicate delivery hits the primary
  // key, we skip processing and still return 200 so Shopify stops retrying.
  const { error: insertError } = await admin.from('webhook_delivery' as any).insert({
    delivery_id: deliveryId,
    topic,
    shop_domain: shopDomain,
    merchant_id: merchantId,
    hmac_valid: true,
    status: 'received',
  } as any)

  if (insertError) {
    // 23505 = unique_violation → already seen this exact delivery.
    if ((insertError as any).code === '23505') {
      return NextResponse.json({ ok: true, duplicate: true })
    }
    console.error('[shopify webhook] delivery insert', (insertError as any).message)
    return NextResponse.json({ error: 'Storage error' }, { status: 500 })
  }

  waitUntil(processWebhook({ deliveryId, topic, shopDomain, merchantId, payload }))

  return NextResponse.json({ ok: true })
}
