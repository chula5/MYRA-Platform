import { createAdminClient } from '@/lib/supabase-server'
import LedgerClient, { type LedgerRow } from './LedgerClient'

export const dynamic = 'force-dynamic'

const fmt = (n: number) => `£${n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

// Commission ledger console (Part 7). Totals here are THE numbers — the brand
// dashboard and statements read the same rows, so they can never disagree.
export default async function LedgerPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; merchant?: string }>
}) {
  const { status, merchant } = await searchParams
  const admin = createAdminClient()

  let q = admin
    .from('commission' as any)
    .select('*, merchant:merchant_id(name)')
    .order('created_at', { ascending: false })
    .limit(200)
  if (status && status !== 'all') q = q.eq('status', status)
  if (merchant) q = q.eq('merchant_id', merchant)
  const { data: rows } = await q

  const ids = ((rows as any[]) ?? []).map((r) => r.commission_id)
  const { data: events } = ids.length
    ? await admin
        .from('commission_event' as any)
        .select('commission_id, to_status, actor, reason, created_at')
        .in('commission_id', ids)
        .order('created_at', { ascending: true })
    : { data: [] }
  const eventsBy = new Map<string, any[]>()
  for (const e of (events as any[]) ?? []) {
    const list = eventsBy.get(e.commission_id) ?? []
    list.push(e)
    eventsBy.set(e.commission_id, list)
  }

  // Headline totals across the WHOLE ledger (not just this page of rows).
  const { data: all } = await admin.from('commission' as any).select('status, commission_gbp')
  const totals = { pending: 0, approved: 0, paid: 0, returned: 0 }
  for (const c of (all as any[]) ?? []) {
    const v = Number(c.commission_gbp) || 0
    if (c.status === 'pending') totals.pending += v
    else if (c.status === 'approved' || c.status === 'payable') totals.approved += v
    else if (c.status === 'paid') totals.paid += v
    else if (c.status === 'returned') totals.returned += v
  }

  const ledgerRows: LedgerRow[] = ((rows as any[]) ?? []).map((r) => ({
    commission_id: r.commission_id,
    merchant_name: r.merchant?.name ?? '—',
    order_number: r.order_number,
    order_created_at: r.order_created_at,
    attribution: r.attribution,
    status: r.status,
    order_value: Number(r.order_value),
    currency: r.currency,
    order_value_gbp: Number(r.order_value_gbp),
    rate_applied: Number(r.rate_applied),
    commission_gbp: Number(r.commission_gbp),
    return_window_ends_at: r.return_window_ends_at,
    events: eventsBy.get(r.commission_id) ?? [],
  }))

  const FILTERS = ['all', 'pending', 'approved', 'payable', 'paid', 'void', 'returned']

  return (
    <div>
      <div className="mb-8">
        <p className="text-[10px] tracking-[0.113em] text-[#6B6B6B] mb-1">ADMIN</p>
        <h1 className="text-[22px] tracking-[0.045em] text-[#4A4E57]">COMMISSION LEDGER</h1>
        <p className="text-[11px] tracking-[0.068em] text-[#A8A8A4] mt-1">The source of truth. Manual adjustments require a reason and are audited.</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        {[
          { label: 'PENDING (IN WINDOW)', value: totals.pending, tone: 'text-[#8B5E00]' },
          { label: 'APPROVED — OWED', value: totals.approved, tone: 'text-[#3D7A50]' },
          { label: 'PAID', value: totals.paid, tone: 'text-[#4A4E57]' },
          { label: 'RETURNED', value: totals.returned, tone: 'text-[#B83A3A]' },
        ].map((s) => (
          <div key={s.label} className="border border-[#E2E0DB] bg-white rounded-[12px] px-5 py-4">
            <p className="text-[9px] tracking-[0.09em] text-[#A8A8A4] mb-2">{s.label}</p>
            <p className={`text-[24px] tracking-[0.02em] leading-none ${s.tone}`}>{fmt(s.value)}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-2 mb-5">
        {FILTERS.map((f) => (
          <a
            key={f}
            href={f === 'all' ? '/admin/ledger' : `/admin/ledger?status=${f}`}
            className={`px-3 py-1.5 text-[9px] tracking-[0.1em] rounded-full border transition-colors ${
              (status ?? 'all') === f ? 'bg-[#0A0A0A] text-white border-[#0A0A0A]' : 'text-[#6B6B6B] border-[#E2E0DB] hover:border-[#0A0A0A]'
            }`}
          >
            {f.toUpperCase()}
          </a>
        ))}
      </div>

      <LedgerClient rows={ledgerRows} />
    </div>
  )
}
