import { redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase-server'
import { getPartnerContext } from '@/lib/partners/auth'

export const dynamic = 'force-dynamic'

// Products (Part 4): the merchant's catalogue as MYRA sees it, with per-piece
// click volume — which pieces work on MYRA. Aggregates only.
export default async function PartnerProducts() {
  const ctx = await getPartnerContext()
  if (!ctx) redirect('/partners/login')
  const admin = createAdminClient()

  const [{ data: items }, { data: clicks }] = await Promise.all([
    admin
      .from('item' as any)
      .select('item_id, product_name, image_url, status, stock_status, stock_sizes, price_gbp, price, currency')
      .eq('merchant_id', ctx.merchantId)
      .order('product_name'),
    admin
      .from('click' as any)
      .select('item_id')
      .eq('merchant_id', ctx.merchantId)
      .eq('is_bot', false)
      .gte('created_at', new Date(Date.now() - 30 * 864e5).toISOString())
      .limit(20000),
  ])

  const clicksBy = new Map<string, number>()
  for (const c of (clicks as any[]) ?? []) clicksBy.set(c.item_id, (clicksBy.get(c.item_id) ?? 0) + 1)

  const rows = (((items as any[]) ?? []).map((it) => ({
    ...it,
    clicks30: clicksBy.get(it.item_id) ?? 0,
  }))).sort((a, b) => b.clicks30 - a.clicks30)

  return (
    <div>
      <h1 className="text-[20px] tracking-[0.05em] text-[#4A4E57] mb-1">PRODUCTS ON MYRA</h1>
      <p className="text-[10px] tracking-[0.07em] text-[#A8A8A4] mb-8">{rows.length} PIECES · CLICKS OVER THE LAST 30 DAYS</p>

      <div className="border border-[#E2E0DB] bg-white rounded-[12px] overflow-hidden">
        <div className="grid grid-cols-[56px_1fr_110px_120px_90px] gap-3 px-5 py-3 bg-[#FAFAF8] border-b border-[#E2E0DB]">
          <span />
          <span className="text-[9px] tracking-[0.09em] text-[#6B6B6B]">PRODUCT</span>
          <span className="text-[9px] tracking-[0.09em] text-[#6B6B6B] text-right">ON MYRA</span>
          <span className="text-[9px] tracking-[0.09em] text-[#6B6B6B] text-right">STOCK</span>
          <span className="text-[9px] tracking-[0.09em] text-[#6B6B6B] text-right">CLICKS 30D</span>
        </div>
        {rows.map((it) => (
          <div key={it.item_id} className="grid grid-cols-[56px_1fr_110px_120px_90px] gap-3 px-5 py-2.5 border-b border-[#F2F2F0] last:border-0 items-center">
            <div className="w-10 h-12 bg-[#F2F2F0] rounded overflow-hidden">
              {it.image_url && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={it.image_url} alt="" className="w-full h-full object-cover" loading="lazy" />
              )}
            </div>
            <div className="min-w-0">
              <p className="text-[11px] tracking-[0.02em] text-[#4A4E57] truncate">{it.product_name}</p>
              <p className="text-[9px] text-[#A8A8A4]">{it.price_gbp ? `£${Number(it.price_gbp).toFixed(0)}` : it.price ? `${it.currency ?? ''} ${it.price}` : ''}</p>
            </div>
            <span className={`text-[9px] tracking-[0.07em] text-right ${it.status === 'live' ? 'text-[#3D7A50]' : 'text-[#A8A8A4]'}`}>
              {it.status === 'live' ? 'LIVE' : it.status === 'ready' ? 'READY' : 'IN REVIEW'}
            </span>
            <span className={`text-[9px] tracking-[0.05em] text-right ${it.stock_status === 'out_of_stock' ? 'text-[#B83A3A]' : it.stock_status === 'low_stock' ? 'text-[#8B5E00]' : 'text-[#6B6B6B]'}`}>
              {(it.stock_sizes ?? []).length ? (it.stock_sizes as string[]).join('·') : (it.stock_status ?? '—').replace(/_/g, ' ').toUpperCase()}
            </span>
            <span className="text-[12px] text-[#0A0A0A] text-right">{it.clicks30}</span>
          </div>
        ))}
        {rows.length === 0 && <p className="text-[10px] tracking-[0.08em] text-[#A8A8A4] px-5 py-10 text-center">NO PRODUCTS SYNCED YET.</p>}
      </div>
    </div>
  )
}
