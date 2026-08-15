import { redirect } from 'next/navigation'
import { createServerClient, createAdminClient } from '@/lib/supabase-server'
import { getPartnerContext } from '@/lib/partners/auth'
import { getBalanceGbp } from '@/lib/billing/store'

export const dynamic = 'force-dynamic'

const fmt = (n: number) => `£${n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

// Partner overview (Part 4). Financial rows come through the USER-scoped
// client, so RLS enforces tenancy; click counts are aggregates only — never
// user-level behaviour, which stays MYRA's.
export default async function PartnerOverview() {
  const ctx = await getPartnerContext()
  if (!ctx) redirect('/partners/login')

  const supabase = await createServerClient() // RLS-scoped
  const admin = createAdminClient()           // aggregates only

  const monthStart = new Date()
  monthStart.setUTCDate(1); monthStart.setUTCHours(0, 0, 0, 0)

  const [{ data: commissions }, balance] = await Promise.all([
    supabase.from('commission' as any).select('status, commission_gbp, order_value_gbp, order_created_at, attribution').eq('merchant_id', ctx.merchantId),
    getBalanceGbp(ctx.merchantId),
  ])
  const { count: clicksMonth } = await admin
    .from('click' as any)
    .select('*', { count: 'exact', head: true })
    .eq('merchant_id', ctx.merchantId)
    .eq('is_bot', false)
    .gte('created_at', monthStart.toISOString())

  const rows = ((commissions as any[]) ?? [])
  const inMonth = rows.filter((r) => r.order_created_at && new Date(r.order_created_at) >= monthStart)
  const attributed = inMonth.filter((r) => r.attribution !== 'none' && r.status !== 'void')
  const sum = (list: any[], f: (r: any) => boolean) =>
    Math.round(list.filter(f).reduce((s, r) => s + (Number(r.commission_gbp) || 0), 0) * 100) / 100

  const pending = sum(rows, (r) => r.status === 'pending' && r.attribution !== 'none')
  const approved = sum(rows, (r) => r.status === 'approved' || r.status === 'payable')
  const paid = sum(rows, (r) => r.status === 'paid')
  const orderValueMonth = Math.round(attributed.reduce((s, r) => s + (Number(r.order_value_gbp) || 0), 0) * 100) / 100
  const aov = attributed.length ? Math.round((orderValueMonth / attributed.length) * 100) / 100 : 0
  const conv = clicksMonth ? ((attributed.length / clicksMonth) * 100).toFixed(1) : '—'

  return (
    <div>
      <h1 className="text-[20px] tracking-[0.05em] text-[#4A4E57] mb-1">OVERVIEW</h1>
      <p className="text-[10px] tracking-[0.07em] text-[#A8A8A4] mb-8">
        {new Date().toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }).toUpperCase()} · MYRA-ATTRIBUTED ACTIVITY
      </p>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'CLICKS THIS MONTH', value: String(clicksMonth ?? 0), sub: 'MYRA → YOUR STORE' },
          { label: 'ATTRIBUTED ORDERS', value: String(attributed.length), sub: `AOV ${fmt(aov)}` },
          { label: 'ORDER VALUE', value: fmt(orderValueMonth), sub: `CONVERSION ${conv}%` },
          { label: 'ACCOUNT BALANCE', value: fmt(balance), sub: 'PRE-FUNDED' },
        ].map((s) => (
          <div key={s.label} className="border border-[#E2E0DB] bg-white rounded-[12px] px-5 py-4">
            <p className="text-[9px] tracking-[0.09em] text-[#A8A8A4] mb-2">{s.label}</p>
            <p className="text-[24px] tracking-[0.02em] text-[#4A4E57] leading-none">{s.value}</p>
            <p className="text-[8px] tracking-[0.07em] text-[#C4A882] mt-1.5">{s.sub}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'PENDING', value: fmt(pending), sub: 'IN RETURN WINDOW', tone: 'text-[#8B5E00]' },
          { label: 'APPROVED', value: fmt(approved), sub: 'WINDOW CLOSED — DUE', tone: 'text-[#3D7A50]' },
          { label: 'SETTLED', value: fmt(paid), sub: 'ALL TIME', tone: 'text-[#4A4E57]' },
        ].map((s) => (
          <div key={s.label} className="border border-[#E2E0DB] bg-white rounded-[12px] px-5 py-4">
            <p className="text-[9px] tracking-[0.09em] text-[#A8A8A4] mb-2">{s.label} COMMISSION</p>
            <p className={`text-[22px] tracking-[0.02em] leading-none ${s.tone}`}>{s.value}</p>
            <p className="text-[8px] tracking-[0.07em] text-[#A8A8A4] mt-1.5">{s.sub}</p>
          </div>
        ))}
      </div>

      <p className="text-[9px] tracking-[0.05em] text-[#A8A8A4] mt-8 max-w-2xl leading-relaxed">
        Commission stays PENDING inside your return window and becomes due once the window closes. These figures come from
        the same ledger as your statements — they always reconcile. You can verify MYRA traffic independently in your own
        Shopify analytics (source: myra).
      </p>
    </div>
  )
}
