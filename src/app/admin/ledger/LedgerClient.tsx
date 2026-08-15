'use client'

import { useState } from 'react'
import { adjustCommission } from './actions'

export interface LedgerRow {
  commission_id: string
  merchant_name: string
  order_number: string | null
  order_created_at: string | null
  attribution: string
  status: string
  order_value: number
  currency: string
  order_value_gbp: number
  rate_applied: number
  commission_gbp: number
  return_window_ends_at: string
  events: { to_status: string; actor: string; reason: string | null; created_at: string }[]
}

const STATUS_TONE: Record<string, string> = {
  pending: 'text-[#8B5E00] border-[#E8D9B8] bg-[#FBF6EA]',
  approved: 'text-[#3D7A50] border-[#BBD9C2] bg-[#EAF3EC]',
  payable: 'text-[#3D7A50] border-[#BBD9C2] bg-[#EAF3EC]',
  paid: 'text-[#4A4E57] border-[#E2E0DB] bg-[#FAFAF8]',
  void: 'text-[#A8A8A4] border-[#E2E0DB] bg-white',
  returned: 'text-[#B83A3A] border-[#E8B4B4] bg-[#FDECEC]',
}

const fmt = (n: number) => `£${Number(n).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const d = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) : '—')

export default function LedgerClient({ rows }: { rows: LedgerRow[] }) {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)

  async function act(id: string, to: 'approved' | 'void' | 'returned' | 'paid') {
    const reason = window.prompt(`Reason for marking this ${to.toUpperCase()} (required):`)
    if (!reason) return
    setBusy(id); setError(null)
    const res = await adjustCommission({ commissionId: id, to, reason })
    setBusy(null)
    if (res.error) setError(res.error)
  }

  return (
    <div className="space-y-3">
      {error && <p className="text-[10px] tracking-[0.08em] text-[#B83A3A]">{error.toUpperCase()}</p>}
      {rows.length === 0 && (
        <p className="text-[11px] tracking-[0.09em] text-[#A8A8A4] py-16 text-center">
          NO COMMISSION RECORDS YET — THEY APPEAR AS ATTRIBUTED ORDERS ARRIVE.
        </p>
      )}
      {rows.map((r) => (
        <div key={r.commission_id} className="border border-[#E2E0DB] bg-white rounded-[12px] px-5 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <span className={`text-[8px] tracking-[0.1em] px-2 py-0.5 rounded-full border shrink-0 ${STATUS_TONE[r.status] ?? ''}`}>{r.status.toUpperCase()}</span>
              <p className="text-[11px] tracking-[0.04em] text-[#4A4E57] truncate">
                {r.merchant_name.toUpperCase()} · {r.order_number ?? 'ORDER'} · {d(r.order_created_at)}
              </p>
              <span className="text-[8px] tracking-[0.08em] text-[#A8A8A4]">
                {r.attribution === 'none' ? 'NOT ATTRIBUTED' : `VIA ${r.attribution.replace('_', ' ').toUpperCase()}`}
              </span>
            </div>
            <div className="flex items-center gap-5">
              <p className="text-[10px] text-[#6B6B6B]">{r.currency} {r.order_value} → {fmt(r.order_value_gbp)} × {(r.rate_applied * 100).toFixed(0)}%</p>
              <p className="text-[14px] text-[#0A0A0A]">{fmt(r.commission_gbp)}</p>
              {r.status === 'pending' && <p className="text-[8px] tracking-[0.06em] text-[#8B5E00]">WINDOW ENDS {d(r.return_window_ends_at)}</p>}
              <div className="flex items-center gap-2">
                {r.status === 'pending' && (
                  <>
                    <button disabled={busy === r.commission_id} onClick={() => act(r.commission_id, 'approved')} className="text-[8px] tracking-[0.1em] border border-[#BBD9C2] text-[#3D7A50] px-2.5 py-1 rounded-full hover:bg-[#EAF3EC] disabled:opacity-40">FORCE APPROVE</button>
                    <button disabled={busy === r.commission_id} onClick={() => act(r.commission_id, 'void')} className="text-[8px] tracking-[0.1em] border border-[#E2E0DB] text-[#6B6B6B] px-2.5 py-1 rounded-full hover:border-[#B83A3A] hover:text-[#B83A3A] disabled:opacity-40">VOID</button>
                  </>
                )}
                {(r.status === 'approved' || r.status === 'payable') && (
                  <>
                    <button disabled={busy === r.commission_id} onClick={() => act(r.commission_id, 'paid')} className="text-[8px] tracking-[0.1em] border border-[#0A0A0A] text-[#0A0A0A] px-2.5 py-1 rounded-full hover:bg-[#0A0A0A] hover:text-white disabled:opacity-40">MARK PAID</button>
                    <button disabled={busy === r.commission_id} onClick={() => act(r.commission_id, 'returned')} className="text-[8px] tracking-[0.1em] border border-[#E8B4B4] text-[#B83A3A] px-2.5 py-1 rounded-full hover:bg-[#FDECEC] disabled:opacity-40">RETURNED</button>
                  </>
                )}
                <button onClick={() => setOpen(open === r.commission_id ? null : r.commission_id)} className="text-[8px] tracking-[0.1em] text-[#A8A8A4] underline underline-offset-2 hover:text-[#4A4E57]">
                  {open === r.commission_id ? 'HIDE' : 'HISTORY'}
                </button>
              </div>
            </div>
          </div>
          {open === r.commission_id && (
            <div className="mt-3 pt-3 border-t border-[#F2F2F0] space-y-1">
              {r.events.length === 0 && <p className="text-[9px] text-[#A8A8A4]">No events.</p>}
              {r.events.map((e, i) => (
                <p key={i} className="text-[9px] tracking-[0.04em] text-[#6B6B6B]">
                  {new Date(e.created_at).toLocaleString('en-GB')} · → {e.to_status.toUpperCase()} · {e.actor === 'system' ? 'SYSTEM' : 'ADMIN'}{e.reason ? ` · ${e.reason}` : ''}
                </p>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
