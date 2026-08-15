import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { getPartnerContext } from '@/lib/partners/auth'

export const dynamic = 'force-dynamic'

// Monthly statement CSV (Part 4). User-scoped client → RLS guarantees a brand
// can only ever export its own rows, whatever the query params say.
export async function GET(req: NextRequest) {
  const ctx = await getPartnerContext()
  if (!ctx) return NextResponse.json({ error: 'Not authorised' }, { status: 401 })

  const month = req.nextUrl.searchParams.get('month') ?? ''
  if (!/^\d{4}-\d{2}$/.test(month)) return NextResponse.json({ error: 'month=YYYY-MM required' }, { status: 400 })
  const start = `${month}-01T00:00:00Z`
  const endDate = new Date(start); endDate.setUTCMonth(endDate.getUTCMonth() + 1)

  const supabase = await createServerClient()
  const { data } = await supabase
    .from('commission' as any)
    .select('order_number, order_created_at, currency, order_value, order_value_gbp, rate_applied, commission_gbp, status')
    .eq('merchant_id', ctx.merchantId)
    .neq('attribution', 'none')
    .gte('order_created_at', start)
    .lt('order_created_at', endDate.toISOString())
    .order('order_created_at')

  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
  const lines = [
    ['order', 'date', 'currency', 'order_value', 'order_value_gbp', 'rate', 'commission_gbp', 'status'].join(','),
    ...(((data as any[]) ?? []).map((r) =>
      [esc(r.order_number), esc(r.order_created_at?.slice(0, 10)), esc(r.currency), r.order_value, r.order_value_gbp, r.rate_applied, r.commission_gbp, esc(r.status)].join(','),
    )),
  ]

  return new NextResponse(lines.join('\n'), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="myra-statement-${month}.csv"`,
    },
  })
}
