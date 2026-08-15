import { redirect } from 'next/navigation'
import { createServerClient } from '@/lib/supabase-server'
import { getPartnerContext } from '@/lib/partners/auth'

export const dynamic = 'force-dynamic'

const fmt = (n: number) => `£${Number(n).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

// Statements (Part 4/5): monthly commission summaries + issued invoices.
// CSV download per month; the print stylesheet makes the page a clean PDF
// via the browser's Save-as-PDF.
export default async function PartnerStatements() {
  const ctx = await getPartnerContext()
  if (!ctx) redirect('/partners/login')

  const supabase = await createServerClient()
  const [{ data: commissions }, { data: invoices }] = await Promise.all([
    supabase
      .from('commission' as any)
      .select('order_created_at, status, commission_gbp, attribution')
      .eq('merchant_id', ctx.merchantId)
      .neq('attribution', 'none'),
    supabase
      .from('invoice' as any)
      .select('*')
      .eq('merchant_id', ctx.merchantId)
      .order('issued_at', { ascending: false }),
  ])

  const byMonth = new Map<string, { orders: number; earned: number; settled: number }>()
  for (const r of ((commissions as any[]) ?? [])) {
    if (!r.order_created_at || ['void'].includes(r.status)) continue
    const key = String(r.order_created_at).slice(0, 7)
    const e = byMonth.get(key) ?? { orders: 0, earned: 0, settled: 0 }
    e.orders++
    const v = Number(r.commission_gbp) || 0
    if (r.status !== 'returned') e.earned += v
    if (r.status === 'paid') e.settled += v
    byMonth.set(key, e)
  }
  const months = [...byMonth.entries()].sort((a, b) => b[0].localeCompare(a[0]))

  return (
    <div>
      <h1 className="text-[20px] tracking-[0.05em] text-[#4A4E57] mb-8 print:mb-4">STATEMENTS</h1>

      <div className="border border-[#E2E0DB] bg-white rounded-[12px] overflow-hidden mb-10">
        <div className="grid grid-cols-[1fr_100px_130px_130px_110px] gap-3 px-5 py-3 bg-[#FAFAF8] border-b border-[#E2E0DB]">
          {['MONTH', 'ORDERS', 'COMMISSION EARNED', 'SETTLED', ''].map((h, i) => (
            <span key={i} className={`text-[9px] tracking-[0.09em] text-[#6B6B6B] ${i > 0 ? 'text-right' : ''}`}>{h}</span>
          ))}
        </div>
        {months.map(([month, e]) => (
          <div key={month} className="grid grid-cols-[1fr_100px_130px_130px_110px] gap-3 px-5 py-3 border-b border-[#F2F2F0] last:border-0 items-center">
            <span className="text-[11px] tracking-[0.03em] text-[#4A4E57]">
              {new Date(month + '-01T12:00:00Z').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }).toUpperCase()}
            </span>
            <span className="text-[11px] text-[#6B6B6B] text-right">{e.orders}</span>
            <span className="text-[12px] text-[#0A0A0A] text-right">{fmt(e.earned)}</span>
            <span className="text-[11px] text-[#3D7A50] text-right">{fmt(e.settled)}</span>
            <a href={`/partners/statements/csv?month=${month}`} className="text-[9px] tracking-[0.1em] text-[#6B6B6B] underline underline-offset-2 hover:text-[#0A0A0A] text-right">
              CSV ↓
            </a>
          </div>
        ))}
        {months.length === 0 && <p className="text-[10px] tracking-[0.08em] text-[#A8A8A4] px-5 py-10 text-center">NO ACTIVITY YET.</p>}
      </div>

      <p className="text-[10px] tracking-[0.099em] text-[#6B6B6B] mb-3">INVOICES</p>
      <div className="space-y-2">
        {(((invoices as any[]) ?? [])).map((inv) => (
          <div key={inv.invoice_id} className="border border-[#E2E0DB] bg-white rounded-[10px] px-4 py-3 flex items-center justify-between">
            <p className="text-[11px] tracking-[0.04em] text-[#4A4E57]">
              {inv.invoice_number} · {inv.period_start} → {inv.period_end} · {fmt(Number(inv.total_gbp))}
            </p>
            <span className={`text-[9px] tracking-[0.08em] ${inv.status === 'paid' ? 'text-[#3D7A50]' : inv.status === 'overdue' ? 'text-[#B83A3A]' : 'text-[#8B5E00]'}`}>
              {inv.status.toUpperCase()}{inv.due_at && inv.status === 'issued' ? ` · DUE ${new Date(inv.due_at).toLocaleDateString('en-GB')}` : ''}
            </span>
          </div>
        ))}
        {(((invoices as any[]) ?? [])).length === 0 && (
          <p className="text-[9px] tracking-[0.06em] text-[#A8A8A4]">No invoices — your account settles against its pre-funded balance.</p>
        )}
      </div>

      <p className="text-[9px] tracking-[0.05em] text-[#A8A8A4] mt-8 leading-relaxed">
        Statements are drawn from the same ledger as your dashboard — the numbers always match. Use your browser&rsquo;s
        Print → Save as PDF for a filed copy.
      </p>
    </div>
  )
}
