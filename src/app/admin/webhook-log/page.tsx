import { createAdminClient } from '@/lib/supabase-server'
import WebhookLogClient, { type DeliveryRow } from './WebhookLogClient'

export const dynamic = 'force-dynamic'

// Webhook log (Part 7): inspect deliveries and failures, replay from the
// stored raw payload.
export default async function WebhookLogPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>
}) {
  const { status } = await searchParams
  const admin = createAdminClient()

  let q = admin
    .from('webhook_delivery' as any)
    .select('delivery_id, topic, shop_domain, status, error, received_at, processed_at, payload_id')
    .order('received_at', { ascending: false })
    .limit(150)
  if (status && status !== 'all') q = q.eq('status', status)
  const { data } = await q

  const rows: DeliveryRow[] = ((data as any[]) ?? []).map((r) => ({
    delivery_id: r.delivery_id,
    topic: r.topic,
    shop_domain: r.shop_domain,
    status: r.status,
    error: r.error,
    received_at: r.received_at,
    processed_at: r.processed_at,
    has_payload: Boolean(r.payload_id),
  }))

  const counts = { failed: 0, processed: 0 }
  const { count: failed } = await admin.from('webhook_delivery' as any).select('*', { count: 'exact', head: true }).eq('status', 'failed')
  const { count: processed } = await admin.from('webhook_delivery' as any).select('*', { count: 'exact', head: true }).eq('status', 'processed')
  counts.failed = failed ?? 0
  counts.processed = processed ?? 0

  return (
    <div>
      <div className="mb-8">
        <p className="text-[10px] tracking-[0.113em] text-[#6B6B6B] mb-1">ADMIN</p>
        <h1 className="text-[22px] tracking-[0.045em] text-[#4A4E57]">WEBHOOK LOG</h1>
        <p className="text-[11px] tracking-[0.068em] text-[#A8A8A4] mt-1">
          {counts.processed} processed · <span className={counts.failed ? 'text-[#B83A3A]' : ''}>{counts.failed} failed</span> — failures can be replayed from the stored payload.
        </p>
      </div>

      <div className="flex flex-wrap gap-2 mb-5">
        {['all', 'processed', 'failed', 'received'].map((f) => (
          <a
            key={f}
            href={f === 'all' ? '/admin/webhook-log' : `/admin/webhook-log?status=${f}`}
            className={`px-3 py-1.5 text-[9px] tracking-[0.1em] rounded-full border transition-colors ${
              (status ?? 'all') === f ? 'bg-[#0A0A0A] text-white border-[#0A0A0A]' : 'text-[#6B6B6B] border-[#E2E0DB] hover:border-[#0A0A0A]'
            }`}
          >
            {f.toUpperCase()}
          </a>
        ))}
      </div>

      <WebhookLogClient rows={rows} />
    </div>
  )
}
