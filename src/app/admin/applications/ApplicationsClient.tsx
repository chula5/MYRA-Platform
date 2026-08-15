'use client'

import { useState } from 'react'
import { approveApplication, rejectApplication } from './actions'

export interface ApplicationRow {
  application_id: string
  brand_name: string
  store_url: string
  contact_name: string | null
  contact_email: string
  category: string | null
  price_range: string | null
  pitch: string | null
  qualification: any
  status: string
  review_note: string | null
  created_at: string
}

export default function ApplicationsClient({ rows }: { rows: ApplicationRow[] }) {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  async function approve(id: string, brand: string) {
    const rateStr = window.prompt(`Commission rate for ${brand} (e.g. 0.18 for 18%):`, '0.15')
    if (!rateStr) return
    setBusy(id); setError(null); setNotice(null)
    const res = await approveApplication({ applicationId: id, rate: Number(rateStr) })
    setBusy(null)
    if (res.error) setError(res.error)
    else setNotice(res.emailed ? 'Approved — welcome email sent.' : 'Approved — no email service configured, remember to email them.')
  }

  async function reject(id: string) {
    const note = window.prompt('Internal note (optional):') ?? undefined
    setBusy(id); setError(null); setNotice(null)
    const res = await rejectApplication({ applicationId: id, note })
    setBusy(null)
    if (res.error) setError(res.error)
    else setNotice(res.emailed ? 'Rejected — polite email sent.' : 'Rejected — no email service configured, remember to email them.')
  }

  return (
    <div className="space-y-3">
      {error && <p className="text-[10px] tracking-[0.08em] text-[#B83A3A]">{error.toUpperCase()}</p>}
      {notice && <p className="text-[10px] tracking-[0.08em] text-[#3D7A50]">{notice.toUpperCase()}</p>}
      {rows.length === 0 && <p className="text-[11px] tracking-[0.09em] text-[#A8A8A4] py-16 text-center">NO APPLICATIONS.</p>}
      {rows.map((a) => {
        const q = a.qualification ?? {}
        return (
          <div key={a.application_id} className="border border-[#E2E0DB] bg-white rounded-[12px] p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2.5">
                  <p className="text-[13px] tracking-[0.05em] text-[#0A0A0A]">{a.brand_name.toUpperCase()}</p>
                  <span className={`text-[8px] tracking-[0.1em] px-2 py-0.5 rounded-full border ${
                    a.status === 'pending' ? 'border-[#E8D9B8] bg-[#FBF6EA] text-[#8B5E00]'
                    : a.status === 'approved' ? 'border-[#BBD9C2] bg-[#EAF3EC] text-[#3D7A50]'
                    : 'border-[#E2E0DB] text-[#A8A8A4]'
                  }`}>{a.status.replace('_', ' ').toUpperCase()}</span>
                </div>
                <p className="text-[9px] tracking-[0.05em] text-[#6B6B6B] mt-1">
                  <a href={a.store_url.startsWith('http') ? a.store_url : `https://${a.store_url}`} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">{a.store_url}</a>
                  {' '}· {a.contact_name ?? '—'} · {a.contact_email}
                  {a.category && ` · ${a.category}`}{a.price_range && ` · ${a.price_range}`}
                </p>
                <p className="text-[9px] tracking-[0.04em] text-[#A8A8A4] mt-1.5">
                  AUTO-CHECK: {q.isShopify ? '✓ SHOPIFY' : '✗ NOT SHOPIFY'} · {q.productCount ?? '?'} PRODUCTS
                  {q.priceMin != null && ` · ${q.priceMin}–${q.priceMax}`}
                  {q.note && ` · ${q.note}`}
                </p>
                {a.pitch && <p className="text-[10px] tracking-[0.02em] text-[#4A4E57] mt-2 leading-relaxed max-w-2xl">{a.pitch}</p>}
                {a.review_note && <p className="text-[9px] text-[#A8A8A4] mt-1">NOTE: {a.review_note}</p>}
              </div>
              {a.status === 'pending' && (
                <div className="flex items-center gap-2 shrink-0">
                  <button disabled={busy === a.application_id} onClick={() => approve(a.application_id, a.brand_name)}
                    className="bg-[#0A0A0A] text-white px-4 py-2 text-[9px] tracking-[0.12em] rounded-full hover:opacity-85 disabled:opacity-40">APPROVE</button>
                  <button disabled={busy === a.application_id} onClick={() => reject(a.application_id)}
                    className="border border-[#E2E0DB] text-[#6B6B6B] px-4 py-2 text-[9px] tracking-[0.12em] rounded-full hover:border-[#B83A3A] hover:text-[#B83A3A] disabled:opacity-40">REJECT</button>
                </div>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
