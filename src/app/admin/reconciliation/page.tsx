import { createAdminClient } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'

const fmt = (n: number) => `£${n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const d = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—')

// Reconciliation (Part 7): clicks vs conversions per merchant, plus the orders
// that arrived WITHOUT attribution — the manual-phase matching worklist.
export default async function ReconciliationPage() {
  const admin = createAdminClient()
  const since = new Date(Date.now() - 30 * 864e5).toISOString()

  const [{ data: clicks }, { data: commissions }, { data: merchants }] = await Promise.all([
    admin.from('click' as any).select('merchant_id, created_at, is_bot').gte('created_at', since).limit(20000),
    admin.from('commission' as any).select('*, merchant:merchant_id(name)').gte('created_at', since).order('created_at', { ascending: false }),
    admin.from('merchant' as any).select('merchant_id, name').order('name'),
  ])

  const byMerchant = new Map<string, { name: string; clicks: number; orders: number; attributed: number; commissionGbp: number }>()
  for (const m of (merchants as any[]) ?? []) byMerchant.set(m.merchant_id, { name: m.name, clicks: 0, orders: 0, attributed: 0, commissionGbp: 0 })
  for (const c of (clicks as any[]) ?? []) {
    if (!c.merchant_id || c.is_bot) continue
    const e = byMerchant.get(c.merchant_id); if (e) e.clicks++
  }
  const unattributed: any[] = []
  for (const c of (commissions as any[]) ?? []) {
    const e = byMerchant.get(c.merchant_id)
    if (e) {
      e.orders++
      if (c.attribution !== 'none') { e.attributed++; e.commissionGbp += Number(c.commission_gbp) || 0 }
    }
    if (c.attribution === 'none' && ['pending'].includes(c.status)) unattributed.push(c)
  }
  const rows = [...byMerchant.values()].filter((r) => r.clicks + r.orders > 0)

  return (
    <div>
      <div className="mb-8">
        <p className="text-[10px] tracking-[0.113em] text-[#6B6B6B] mb-1">ADMIN</p>
        <h1 className="text-[22px] tracking-[0.045em] text-[#4A4E57]">RECONCILIATION</h1>
        <p className="text-[11px] tracking-[0.068em] text-[#A8A8A4] mt-1">Last 30 days: our clicks vs their orders — attribution gaps surface here.</p>
      </div>

      <div className="border border-[#E2E0DB] bg-white rounded-[12px] overflow-hidden mb-10">
        <div className="grid grid-cols-[1fr_90px_90px_110px_120px] gap-2 px-5 py-3 bg-[#FAFAF8] border-b border-[#E2E0DB]">
          {['MERCHANT', 'CLICKS', 'ORDERS', 'ATTRIBUTED', 'COMMISSION'].map((h) => (
            <span key={h} className="text-[9px] tracking-[0.09em] text-[#6B6B6B] last:text-right [&:nth-child(n+2)]:text-right">{h}</span>
          ))}
        </div>
        {rows.length === 0 && <p className="text-[10px] tracking-[0.08em] text-[#A8A8A4] px-5 py-8 text-center">NO ACTIVITY IN THE LAST 30 DAYS.</p>}
        {rows.map((r) => (
          <div key={r.name} className="grid grid-cols-[1fr_90px_90px_110px_120px] gap-2 px-5 py-3 border-b border-[#F2F2F0] last:border-0 items-center">
            <span className="text-[11px] tracking-[0.03em] text-[#4A4E57]">{r.name.toUpperCase()}</span>
            <span className="text-[11px] text-[#6B6B6B] text-right">{r.clicks}</span>
            <span className="text-[11px] text-[#6B6B6B] text-right">{r.orders}</span>
            <span className={`text-[11px] text-right ${r.orders > 0 && r.attributed < r.orders ? 'text-[#8B5E00]' : 'text-[#3D7A50]'}`}>
              {r.attributed}/{r.orders}
            </span>
            <span className="text-[11px] text-[#0A0A0A] text-right">{fmt(r.commissionGbp)}</span>
          </div>
        ))}
      </div>

      <p className="text-[10px] tracking-[0.099em] text-[#6B6B6B] mb-3">
        UNATTRIBUTED ORDERS STILL IN WINDOW · {unattributed.length}
      </p>
      <p className="text-[9px] tracking-[0.05em] text-[#A8A8A4] mb-4 max-w-2xl leading-relaxed">
        These arrived without a MYRA click on the landing session. The daily journey pass keeps re-checking them against
        Shopify&rsquo;s 30-day customer journey; anything still unattributed when its window closes is voided. If you KNOW one is
        ours (e.g. the brand confirms), force-approve it from the ledger with a reason.
      </p>
      <div className="space-y-2">
        {unattributed.slice(0, 40).map((c) => (
          <div key={c.commission_id} className="border border-[#E2E0DB] bg-white rounded-[10px] px-4 py-2.5 flex items-center justify-between">
            <p className="text-[10px] tracking-[0.04em] text-[#4A4E57]">
              {(c.merchant?.name ?? '—').toUpperCase()} · {c.order_number ?? c.shopify_order_id} · {d(c.order_created_at)} · {c.currency} {c.order_value}
            </p>
            <a href="/admin/ledger?status=pending" className="text-[8px] tracking-[0.1em] text-[#6B6B6B] underline underline-offset-2 hover:text-[#0A0A0A]">OPEN IN LEDGER →</a>
          </div>
        ))}
        {unattributed.length === 0 && <p className="text-[10px] tracking-[0.08em] text-[#A8A8A4]">NONE — EVERYTHING IN WINDOW IS ATTRIBUTED.</p>}
      </div>
    </div>
  )
}
