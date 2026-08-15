'use server'

// Replay a stored webhook delivery (Part 7). Re-runs processing from the raw
// payload we kept — no need for Shopify to resend. Audited.

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase-server'
import { requireAdminUser, writeAudit } from '@/lib/admin-audit'
import { processWebhook } from '@/lib/shopify/webhooks'

export async function replayDelivery(deliveryId: string): Promise<{ ok?: true; error?: string }> {
  const gate = await requireAdminUser()
  if (!gate.ok) return { error: 'Not authorised' }

  const admin = createAdminClient()
  const { data: delivery } = await admin
    .from('webhook_delivery' as any)
    .select('delivery_id, topic, shop_domain, merchant_id, payload_id')
    .eq('delivery_id', deliveryId)
    .maybeSingle()
  const row = delivery as any
  if (!row) return { error: 'Delivery not found' }

  let payload: any = null
  if (row.payload_id) {
    const { data: raw } = await admin
      .from('shopify_raw_payload' as any)
      .select('payload')
      .eq('payload_id', row.payload_id)
      .maybeSingle()
    payload = (raw as any)?.payload ?? null
  }
  if (!payload) {
    // Failed deliveries may not have stored a payload row; try the most recent
    // raw payload for the same topic + shop as a best effort.
    return { error: 'No stored payload for this delivery — cannot replay' }
  }

  await admin.from('webhook_delivery' as any).update({ status: 'received', error: null } as any).eq('delivery_id', deliveryId)
  await processWebhook({
    deliveryId: row.delivery_id,
    topic: row.topic,
    shopDomain: row.shop_domain,
    merchantId: row.merchant_id,
    payload,
  })
  await writeAudit({ actor: gate.userId!, action: 'webhook.replay', entityType: 'webhook_delivery', entityId: deliveryId })
  revalidatePath('/admin/webhook-log')
  return { ok: true }
}
