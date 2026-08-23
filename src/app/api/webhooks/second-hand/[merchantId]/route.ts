// Second-hand merchant webhook — the instant sold-signal.
//
// This is the fastest path in the whole availability system, and the one worth
// asking a partner for first: a one-of-one that sells is acted on the moment
// they tell us, with no second confirmation and no waiting for the next feed
// pull. Everything that follows — retiring live looks, rescuing saved ones,
// alerting the people watching it — runs from here.
//
// Auth: the merchant's own `webhook_secret`, sent as `X-MYRA-Secret` (or
// `Authorization: Bearer …`). Compared in constant time.
//
// Body (either shape):
//   { "external_id": "8123…", "sold": true }
//   { "url": "https://…/products/…", "available": false,
//     "sizes": [{ "label": "IT 42", "available": false }] }

import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'
import { createAdminClient } from '@/lib/supabase-server'
import { handleSecondHandWebhook, type WebhookPayload } from '@/lib/studio/second-hand-feed'

export const dynamic = 'force-dynamic'

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ab.length !== bb.length) return false
  return timingSafeEqual(ab, bb)
}

export async function POST(
  req: NextRequest,
  { params }: { params: { merchantId: string } },
) {
  const merchantId = params.merchantId
  const admin = createAdminClient()

  const { data: merchant } = await admin
    .from('merchant' as any)
    .select('merchant_id, webhook_secret, status')
    .eq('merchant_id', merchantId)
    .maybeSingle()

  if (!merchant || (merchant as any).status !== 'active') {
    return NextResponse.json({ error: 'Unknown merchant' }, { status: 404 })
  }

  const expected = (merchant as any).webhook_secret as string | null
  const provided =
    req.headers.get('x-myra-secret') ??
    (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!expected || !provided || !safeEqual(expected, provided)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let payload: WebhookPayload
  try {
    payload = (await req.json()) as WebhookPayload
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const result = await handleSecondHandWebhook(merchantId, payload)
  // 200 even when nothing matched: a merchant retrying forever because we don't
  // stock a product they sold helps nobody. The body says what happened.
  return NextResponse.json(result)
}
