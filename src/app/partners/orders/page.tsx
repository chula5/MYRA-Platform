import { redirect } from 'next/navigation'
import { createServerClient } from '@/lib/supabase-server'
import { getPartnerContext } from '@/lib/partners/auth'

export const dynamic = 'force-dynamic'

const fmt = (n: number) => `£${Number(n).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—')

// Orders (Part 4): the merchant's MYRA-attributed orders with WHY each is in
// its state ("in return window until …") — pre-empts the support email.
// Read through the user-scoped client: RLS enforces this is their data only.
export default async function PartnerOrders() {
  const ctx = await getPartnerContext()
  if (!ctx) redirect('/partners/login')

  const supabase = await createServerClient()
  const { data } = await supabase
    .from('commission' as any)
    .select('*')
    .eq('merchant_id', ctx.merchantId)
    .neq('attribution', 'none')
    .order('order_created_at', { ascending: false })
    .limit(200)
  const rows = ((data as any[]) ?? [])

  const explain = (r: any): { label: string; tone: string } => {
    switch (r.status) {
      case 'pending': return { label: `IN RETURN WINDOW UNTIL ${day(r.return_window_ends_at)}`, tone: 'text-[#8B5E00]' }
      case 'approved': return { label: 'APPROVED — DUE', tone: 'text-[#3D7A50]' }
      case 'payable': return { label: 'ON YOUR NEXT STATEMENT', tone: 'text-[#3D7A50]' }
      case 'paid': return { label: 'SETTLED', tone: 'text-[#4A4E57]' }
      case 'void': return { label: 'CANCELLED / REFUNDED IN WINDOW', tone: 'text-[#A8A8A4]' }
      case 'returned': return { label: 'RETURNED — REVERSED', tone: 'text-[#B83A3A]' }
      default: return { label: r.status.toUpperCase(), tone: 'text-[#6B6B6B]' }
    }
  }

  return (
    <div>
      <h1 className="text-[20px] tracking-[0.05em] text-[#4A4E57] mb-1">MYRA-ATTRIBUTED ORDERS</h1>
      <p className="text-[10px] tracking-[0.07em] text-[#A8A8A4] mb-8">{rows.length} ORDERS · COMMISSION AT YOUR AGREED RATE</p>

      <div className="border border-[#E2E0DB] bg-white rounded-[12px] overflow-hidden">
        <div className="grid grid-cols-[110px_110px_1fr_110px_110px_1fr] gap-3 px-5 py-3 bg-[#FAFAF8] border-b border-[#E2E0DB]">
          {['ORDER', 'DATE', 'ORDER VALUE', 'RATE', 'COMMISSION', 'STATUS'].map((h, i) => (
            <span key={h} className={`text-[9px] tracking-[0.09em] text-[#6B6B6B] ${i >= 2 && i <= 4 ? 'text-right' : ''}`}>{h}</span>
          ))}
        </div>
        {rows.map((r) => {
          const e = explain(r)
          return (
            <div key={r.commission_id} className="grid grid-cols-[110px_110px_1fr_110px_110px_1fr] gap-3 px-5 py-3 border-b border-[#F2F2F0] last:border-0 items-center">
              <span className="text-[11px] text-[#4A4E57]">{r.order_number ?? '—'}</span>
              <span className="text-[10px] text-[#6B6B6B]">{day(r.order_created_at)}</span>
              <span className="text-[11px] text-[#4A4E57] text-right">{r.currency} {r.order_value} {r.currency !== 'GBP' && <span className="text-[#A8A8A4]">({fmt(r.order_value_gbp)})</span>}</span>
              <span className="text-[10px] text-[#6B6B6B] text-right">{(Number(r.rate_applied) * 100).toFixed(0)}%</span>
              <span className="text-[12px] text-[#0A0A0A] text-right">{fmt(r.commission_gbp)}</span>
              <span className={`text-[9px] tracking-[0.06em] ${e.tone}`}>{e.label}</span>
            </div>
          )
        })}
        {rows.length === 0 && (
          <p className="text-[10px] tracking-[0.08em] text-[#A8A8A4] px-5 py-10 text-center">
            NO MYRA-ATTRIBUTED ORDERS YET — THEY APPEAR HERE AS SOON AS A MYRA CLICK CONVERTS.
          </p>
        )}
      </div>
    </div>
  )
}
