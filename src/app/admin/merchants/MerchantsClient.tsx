'use client'

import { useState } from 'react'
import { updateMerchantCommercials, createManualMerchant, setTerms, createPartnerInvite } from './actions'

export interface MerchantRow {
  merchant_id: string
  name: string
  type: string
  status: string
  shop_domain: string | null
  installed_at: string | null
  webhooks_registered_at: string | null
  catalogue_synced_at: string | null
  default_commission_rate: number
  return_window_days: number
  billing_model: string
  itemCount: number
  liveItemCount: number
  clicks30: number
  commission: { pendingGbp: number; approvedGbp: number; paidGbp: number }
  terms: { version: number; base_rate: number; intro_rate: number | null; intro_expires_at: string | null; accepted_at: string | null } | null
}

const fmt = (n: number) => `£${n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const pct = (r: number | null | undefined) => (r == null ? '—' : `${(Number(r) * 100).toFixed(0)}%`)
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) : null)

export default function MerchantsClient({ merchants }: { merchants: MerchantRow[] }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [newOpen, setNewOpen] = useState(false)

  async function run(fn: () => Promise<{ ok?: true; error?: string }>) {
    setBusy(true); setError(null)
    const res = await fn()
    setBusy(false)
    if (res.error) setError(res.error)
    else setEditing(null)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-[10px] tracking-[0.14em] text-[#A8A8A4]">{merchants.length} MERCHANT{merchants.length === 1 ? '' : 'S'}</p>
        <button onClick={() => setNewOpen((v) => !v)} className="border border-[#0A0A0A] text-[#4A4E57] px-5 py-2 text-[10px] tracking-[0.14em] rounded-full hover:bg-[#0A0A0A] hover:text-white transition-colors">
          + MANUAL MERCHANT
        </button>
      </div>
      {error && <p className="text-[10px] tracking-[0.08em] text-[#B83A3A]">{error.toUpperCase()}</p>}

      {newOpen && (
        <form
          className="border border-[#E2E0DB] rounded-[12px] p-5 bg-white flex flex-wrap items-end gap-3"
          action={(fd) => run(() => createManualMerchant({ name: String(fd.get('name') ?? ''), trackingTemplate: String(fd.get('tpl') ?? '') }))}
        >
          <label className="block">
            <span className="block text-[9px] tracking-[0.1em] text-[#6B6B6B] mb-1">BRAND / MERCHANT NAME</span>
            <input name="name" className="border border-[#E2E0DB] rounded-[8px] px-3 py-2 text-[11px] w-[220px]" placeholder="e.g. Nuovo Paris" />
          </label>
          <label className="block flex-1 min-w-[260px]">
            <span className="block text-[9px] tracking-[0.1em] text-[#6B6B6B] mb-1">TRACKING PARAMS (OPTIONAL)</span>
            <input name="tpl" className="border border-[#E2E0DB] rounded-[8px] px-3 py-2 text-[11px] w-full" placeholder="utm_source=myra&myra_click={click_id}" />
          </label>
          <button disabled={busy} className="bg-[#0A0A0A] text-white px-5 py-2.5 text-[10px] tracking-[0.14em] rounded-full disabled:opacity-50">CREATE</button>
        </form>
      )}

      <div className="space-y-4">
        {merchants.map((m) => {
          const connected = Boolean(m.installed_at)
          return (
            <div key={m.merchant_id} className="border border-[#E2E0DB] bg-white rounded-[12px] p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2.5">
                    <p className="text-[14px] tracking-[0.05em] text-[#0A0A0A]">{m.name.toUpperCase()}</p>
                    <span className={`text-[8px] tracking-[0.1em] px-2 py-0.5 rounded-full border ${
                      m.status === 'uninstalled' ? 'border-[#B83A3A] text-[#B83A3A]'
                      : connected ? 'border-[#BBD9C2] bg-[#EAF3EC] text-[#3D7A50]'
                      : 'border-[#E2E0DB] text-[#6B6B6B]'
                    }`}>
                      {m.status === 'uninstalled' ? 'UNINSTALLED' : connected ? 'CONNECTED' : m.type === 'network' ? 'NETWORK' : 'NOT CONNECTED'}
                    </span>
                  </div>
                  <p className="text-[9px] tracking-[0.06em] text-[#A8A8A4] mt-1">
                    {m.shop_domain ?? 'no store linked'}
                    {connected && ` · installed ${day(m.installed_at)}`}
                    {m.webhooks_registered_at && ` · webhooks ✓`}
                    {m.catalogue_synced_at && ` · synced ${day(m.catalogue_synced_at)}`}
                  </p>
                </div>
                <div className="flex items-center gap-6 text-center">
                  <div><p className="text-[16px] text-[#4A4E57] leading-none">{m.itemCount}</p><p className="text-[8px] tracking-[0.1em] text-[#A8A8A4] mt-1">ITEMS ({m.liveItemCount} LIVE)</p></div>
                  <div><p className="text-[16px] text-[#4A4E57] leading-none">{m.clicks30}</p><p className="text-[8px] tracking-[0.1em] text-[#A8A8A4] mt-1">CLICKS · 30D</p></div>
                  <div><p className="text-[16px] text-[#8B5E00] leading-none">{fmt(m.commission.pendingGbp)}</p><p className="text-[8px] tracking-[0.1em] text-[#A8A8A4] mt-1">PENDING</p></div>
                  <div><p className="text-[16px] text-[#3D7A50] leading-none">{fmt(m.commission.approvedGbp)}</p><p className="text-[8px] tracking-[0.1em] text-[#A8A8A4] mt-1">APPROVED</p></div>
                  <div><p className="text-[16px] text-[#4A4E57] leading-none">{fmt(m.commission.paidGbp)}</p><p className="text-[8px] tracking-[0.1em] text-[#A8A8A4] mt-1">PAID</p></div>
                </div>
              </div>

              <div className="mt-4 pt-4 border-t border-[#F2F2F0] flex flex-wrap items-center justify-between gap-3">
                <p className="text-[9px] tracking-[0.06em] text-[#6B6B6B]">
                  {m.terms
                    ? <>TERMS v{m.terms.version}: {pct(m.terms.base_rate)} base{m.terms.intro_rate != null && <> · {pct(m.terms.intro_rate)} intro until {day(m.terms.intro_expires_at)}</>} · {m.terms.accepted_at ? `accepted ${day(m.terms.accepted_at)}` : 'NOT YET ACCEPTED'}</>
                    : <>NO TERMS — fallback rate {pct(m.default_commission_rate)}</>}
                  {' '}· {m.return_window_days}-day return window · {m.billing_model.toUpperCase()}
                </p>
                <div className="flex items-center gap-4">
                  <button
                    onClick={async () => {
                      const email = window.prompt('Invite email for ' + m.name + ':')
                      if (!email) return
                      const role = window.confirm('Make this person the OWNER? (Cancel = staff, view-only)') ? 'owner' as const : 'staff' as const
                      const res = await createPartnerInvite({ merchantId: m.merchant_id, email, role })
                      if (res.error) { setError(res.error); return }
                      try { await navigator.clipboard.writeText(res.inviteUrl!) } catch { /* ignore */ }
                      window.alert('Invite link (valid 7 days, copied to clipboard):\n\n' + res.inviteUrl)
                    }}
                    className="text-[9px] tracking-[0.1em] text-[#6B6B6B] underline underline-offset-2 hover:text-[#0A0A0A]"
                  >
                    INVITE PARTNER
                  </button>
                  <button onClick={() => setEditing(editing === m.merchant_id ? null : m.merchant_id)} className="text-[9px] tracking-[0.1em] text-[#6B6B6B] underline underline-offset-2 hover:text-[#0A0A0A]">
                    {editing === m.merchant_id ? 'CLOSE' : 'EDIT COMMERCIALS'}
                  </button>
                </div>
              </div>

              {editing === m.merchant_id && (
                <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                  <form
                    className="border border-[#F2F2F0] rounded-[10px] p-4 flex flex-wrap items-end gap-3"
                    action={(fd) => run(() => updateMerchantCommercials({
                      merchantId: m.merchant_id,
                      defaultRate: fd.get('rate') ? Number(fd.get('rate')) : undefined,
                      returnWindowDays: fd.get('window') ? Number(fd.get('window')) : undefined,
                      billingModel: (fd.get('billing') as 'prefunded' | 'invoiced') || undefined,
                    }))}
                  >
                    <label className="block"><span className="block text-[8px] tracking-[0.1em] text-[#6B6B6B] mb-1">FALLBACK RATE</span>
                      <input name="rate" defaultValue={m.default_commission_rate} className="border border-[#E2E0DB] rounded-[8px] px-2 py-1.5 text-[11px] w-[80px]" /></label>
                    <label className="block"><span className="block text-[8px] tracking-[0.1em] text-[#6B6B6B] mb-1">WINDOW (DAYS)</span>
                      <input name="window" defaultValue={m.return_window_days} className="border border-[#E2E0DB] rounded-[8px] px-2 py-1.5 text-[11px] w-[80px]" /></label>
                    <label className="block"><span className="block text-[8px] tracking-[0.1em] text-[#6B6B6B] mb-1">BILLING</span>
                      <select name="billing" defaultValue={m.billing_model} className="border border-[#E2E0DB] rounded-[8px] px-2 py-1.5 text-[11px] bg-white">
                        <option value="prefunded">PREFUNDED</option>
                        <option value="invoiced">INVOICED</option>
                      </select></label>
                    <button disabled={busy} className="bg-[#0A0A0A] text-white px-4 py-2 text-[9px] tracking-[0.12em] rounded-full disabled:opacity-50">SAVE</button>
                  </form>

                  <form
                    className="border border-[#F2F2F0] rounded-[10px] p-4 flex flex-wrap items-end gap-3"
                    action={(fd) => run(() => setTerms({
                      merchantId: m.merchant_id,
                      baseRate: Number(fd.get('base')),
                      introRate: fd.get('intro') ? Number(fd.get('intro')) : null,
                      introExpiresAt: fd.get('expiry') ? new Date(String(fd.get('expiry'))).toISOString() : null,
                    }))}
                  >
                    <label className="block"><span className="block text-[8px] tracking-[0.1em] text-[#6B6B6B] mb-1">NEW TERMS · BASE</span>
                      <input name="base" defaultValue={m.terms?.base_rate ?? 0.15} className="border border-[#E2E0DB] rounded-[8px] px-2 py-1.5 text-[11px] w-[80px]" /></label>
                    <label className="block"><span className="block text-[8px] tracking-[0.1em] text-[#6B6B6B] mb-1">INTRO RATE</span>
                      <input name="intro" defaultValue={m.terms?.intro_rate ?? ''} className="border border-[#E2E0DB] rounded-[8px] px-2 py-1.5 text-[11px] w-[80px]" /></label>
                    <label className="block"><span className="block text-[8px] tracking-[0.1em] text-[#6B6B6B] mb-1">INTRO EXPIRES</span>
                      <input name="expiry" type="date" defaultValue={m.terms?.intro_expires_at?.slice(0, 10) ?? ''} className="border border-[#E2E0DB] rounded-[8px] px-2 py-1.5 text-[11px]" /></label>
                    <button disabled={busy} className="border border-[#0A0A0A] text-[#0A0A0A] px-4 py-2 text-[9px] tracking-[0.12em] rounded-full disabled:opacity-50">VERSION TERMS</button>
                  </form>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
