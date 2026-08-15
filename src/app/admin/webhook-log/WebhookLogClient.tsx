'use client'

import { useState } from 'react'
import { replayDelivery } from './actions'

export interface DeliveryRow {
  delivery_id: string
  topic: string
  shop_domain: string
  status: string
  error: string | null
  received_at: string
  processed_at: string | null
  has_payload: boolean
}

export default function WebhookLogClient({ rows }: { rows: DeliveryRow[] }) {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function replay(id: string) {
    setBusy(id); setError(null)
    const res = await replayDelivery(id)
    setBusy(null)
    if (res.error) setError(res.error)
  }

  return (
    <div className="space-y-2">
      {error && <p className="text-[10px] tracking-[0.08em] text-[#B83A3A]">{error.toUpperCase()}</p>}
      {rows.length === 0 && (
        <p className="text-[11px] tracking-[0.09em] text-[#A8A8A4] py-16 text-center">NO WEBHOOK DELIVERIES YET.</p>
      )}
      {rows.map((r) => (
        <div key={r.delivery_id} className="border border-[#E2E0DB] bg-white rounded-[10px] px-4 py-3 flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] tracking-[0.05em] text-[#4A4E57]">
              <span className={`inline-block w-2 h-2 rounded-full mr-2 ${
                r.status === 'processed' ? 'bg-[#3D7A50]' : r.status === 'failed' ? 'bg-[#B83A3A]' : 'bg-[#D9A441]'
              }`} />
              {r.topic} · {r.shop_domain}
            </p>
            <p className="text-[8px] tracking-[0.05em] text-[#A8A8A4] mt-0.5">
              received {new Date(r.received_at).toLocaleString('en-GB')}
              {r.processed_at && ` · processed ${new Date(r.processed_at).toLocaleString('en-GB')}`}
            </p>
            {r.error && <p className="text-[9px] tracking-[0.04em] text-[#B83A3A] mt-1 truncate max-w-xl">{r.error}</p>}
          </div>
          {(r.status === 'failed' || r.status === 'received') && r.has_payload && (
            <button
              disabled={busy === r.delivery_id}
              onClick={() => replay(r.delivery_id)}
              className="text-[8px] tracking-[0.12em] border border-[#0A0A0A] text-[#0A0A0A] px-3 py-1.5 rounded-full hover:bg-[#0A0A0A] hover:text-white transition-colors disabled:opacity-40"
            >
              {busy === r.delivery_id ? 'REPLAYING…' : '↻ REPLAY'}
            </button>
          )}
        </div>
      ))}
    </div>
  )
}
