import { createAdminClient } from '@/lib/supabase-server'
import { BLACK_FRIDAY, isBrandOnSale } from '@/lib/sales/detect'
import PauseButton from './PauseButton'

export const dynamic = 'force-dynamic'

// BLACK FRIDAY — which watched brands MYRA reads as on sale, how deep, and how
// many members were told. The hourly sweep (api/cron/sales) keeps it; PAUSE
// stops a sale being shown or told, whatever the sweep reads.

const when = (s: string | null) => (s ? new Date(s).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—')

export default async function SalesPage() {
  const admin = createAdminClient() as any
  const [{ data: rows }, { data: notes }] = await Promise.all([
    admin.from('brand_sale').select('brand_id, active, paused, started_at, ended_at, last_swept_at, on_sale_count, total_count, max_off_pct, median_off_pct, brand:brand_id(name)')
      .order('active', { ascending: false }).order('on_sale_count', { ascending: false }).limit(400),
    admin.from('sale_note').select('brand_id, kind'),
  ])
  const told = new Map<string, number>()
  for (const n of (notes ?? []) as any[]) if (n.brand_id) told.set(n.brand_id, (told.get(n.brand_id) ?? 0) + 1)
  const headsUp = ((notes ?? []) as any[]).filter((n) => n.kind === 'heads_up').length
  const list = (rows ?? []) as any[]
  const active = list.filter((r) => r.active)
  const swept = list.filter((r) => r.last_swept_at).length

  return (
    <div>
      <div className="mb-8">
        <p className="text-[11px] tracking-[0.113em] text-[#6B6B6B] mb-2">ADMIN STUDIO</p>
        <h1 className="text-[28px] tracking-[0.045em] text-[#4A4E57]">BLACK FRIDAY</h1>
        <p className="mt-2 text-[10px] tracking-[0.068em] text-[#A8A8A4] max-w-2xl leading-relaxed">
          THE WATCHED SHOPIFY BRANDS, READ EVERY FEW HOURS FOR TODAY&rsquo;S PRICE AND THE SHOP&rsquo;S OWN WAS-PRICE. A BRAND IS ON SALE
          WITH 3+ PIECES MARKED DOWN AND 5% OF ITS CATALOGUE (OR 15 PIECES). MEMBERS HEAR ABOUT THEIR NAMED BRANDS ONCE PER SALE, 3 A DAY AT MOST.
          SEASON {BLACK_FRIDAY.from} → {BLACK_FRIDAY.to}.
        </p>
        <div className="mt-3 flex items-center gap-4 text-[10px] tracking-[0.09em] text-[#6B6B6B]">
          <span className="text-[#0A0A0A]">{active.length} ON SALE</span>
          <span>{swept} BRANDS SWEPT</span>
          <span>{headsUp} HEADS-UPS SENT</span>
        </div>
      </div>

      <table className="w-full text-[11px] tracking-[0.04em] text-[#4A4E57]">
        <thead>
          <tr className="text-left text-[10px] tracking-[0.09em] text-[#A8A8A4] border-b border-[#E5E5E2]">
            <th className="py-2 pr-4">BRAND</th><th className="pr-4">STATE</th><th className="pr-4">MARKED DOWN</th><th className="pr-4">UP TO</th>
            <th className="pr-4">TYPICAL</th><th className="pr-4">SINCE</th><th className="pr-4">SWEPT</th><th className="pr-4">TOLD</th><th />
          </tr>
        </thead>
        <tbody>
          {list.filter((r) => r.on_sale_count > 0 || r.active).map((r) => (
            <tr key={r.brand_id} className="border-b border-[#F0F0EE]">
              <td className="py-2.5 pr-4 text-[#0A0A0A]">{r.brand?.name ?? r.brand_id}</td>
              <td className="pr-4">{r.paused ? 'PAUSED' : r.active ? 'ON SALE' : isBrandOnSale({ onSale: r.on_sale_count, total: r.total_count }) ? 'STARTING' : 'A FEW PIECES'}</td>
              <td className="pr-4">{r.on_sale_count} / {r.total_count}</td>
              <td className="pr-4">{r.max_off_pct != null ? `${r.max_off_pct}%` : '—'}</td>
              <td className="pr-4">{r.median_off_pct != null ? `${r.median_off_pct}%` : '—'}</td>
              <td className="pr-4">{r.active ? when(r.started_at) : '—'}</td>
              <td className="pr-4">{when(r.last_swept_at)}</td>
              <td className="pr-4">{told.get(r.brand_id) ?? 0}</td>
              <td className="text-right">{(r.active || r.paused) && <PauseButton brandId={r.brand_id} paused={!!r.paused} />}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!list.some((r) => r.on_sale_count > 0) && <p className="mt-6 text-[11px] text-[#A8A8A4]">NO BRAND HAS PIECES MARKED DOWN YET.</p>}
    </div>
  )
}
