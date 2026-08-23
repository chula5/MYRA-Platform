import Link from 'next/link'
import { createAdminClient } from '@/lib/supabase-server'
import { loadSecondHandSummary, loadSizeCoverage, coverageGaps } from '@/lib/second-hand-report'
import { rescueReviewQueue } from '@/lib/rescue'
import { STALE_UNIQUE_DAYS } from '@/lib/second-hand'
import { CATEGORY_LABEL } from '@/lib/size-canonical'
import SecondHandClient, { type MerchantSourcingRow, type BrandFitRow } from './SecondHandClient'

export const dynamic = 'force-dynamic'

// The second-hand console. Three questions it exists to answer:
//   1. is this stock moving, and how fast
//   2. what is it costing us when it sells (retired looks, rescued saves)
//   3. does the partner's stock match our clients' bodies
// The third is the one worth taking to a meeting.
export default async function SecondHandPage() {
  const admin = createAdminClient()
  const [summary, coverage, rescues, { data: merchants }, { data: recentSales }, { data: liveByBrand }, { data: brandRows }] = await Promise.all([
    loadSecondHandSummary(),
    loadSizeCoverage(),
    rescueReviewQueue(20),
    admin
      .from('merchant' as any)
      .select('merchant_id, name, source_type, default_stock_class, feed_url, feed_format, feed_checked_at, feed_error, webhook_secret')
      .order('name'),
    admin
      .from('second_hand_sale' as any)
      .select('item_id, sold_at, days_live, clickouts, saves, item(product_name, image_url, brand(name))')
      .order('sold_at', { ascending: false })
      .limit(12),
    admin.from('item' as any).select('brand_id').eq('status', 'live').not('brand_id', 'is', null),
    admin.from('brand' as any).select('brand_id, name, size_offset').order('name'),
  ])

  // Brands ordered by how much live stock they carry — the ones whose fit
  // judgement actually moves anything sit at the top.
  const liveCount = new Map<string, number>()
  for (const r of ((liveByBrand ?? []) as any[])) {
    liveCount.set(r.brand_id, (liveCount.get(r.brand_id) ?? 0) + 1)
  }
  const brands: BrandFitRow[] = ((brandRows ?? []) as any[])
    .map((b) => ({
      brand_id: b.brand_id,
      name: b.name,
      size_offset: (b.size_offset ?? {}) as Record<string, number>,
      live_items: liveCount.get(b.brand_id) ?? 0,
    }))
    .sort((a, b) => b.live_items - a.live_items || a.name.localeCompare(b.name))

  const gaps = coverageGaps(coverage)
  const rows = ((merchants ?? []) as any[]) as MerchantSourcingRow[]

  const num = (n: number | null, unit = '') =>
    n == null ? '—' : `${Math.round(n * 10) / 10}${unit}`

  return (
    <div>
      <div className="mb-8">
        <p className="text-[11px] tracking-[0.113em] text-[#6B6B6B] mb-2">ADMIN STUDIO</p>
        <h1 className="text-[28px] tracking-[0.045em] text-[#4A4E57]">SECOND-HAND</h1>
        <p className="mt-2 text-[10px] tracking-[0.068em] text-[#A8A8A4] max-w-2xl leading-relaxed">
          ONE-OF-ONE STOCK. WHEN A PIECE SELLS IT IS GONE: ITS LIVE LOOKS RETIRE, AND EVERY SAVED
          LOOK CONTAINING IT IS RESTYLED ONCE, FOR EVERYONE WHO SAVED IT.
        </p>
      </div>

      {/* ── Headline numbers ── */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-10">
        {[
          { label: 'LIVE ONE-OF-ONE', value: String(summary.liveUnique) },
          { label: 'LIVE SECOND-HAND', value: String(summary.liveSecondHand) },
          { label: 'SOLD · 30 DAYS', value: String(summary.soldLast30) },
          { label: 'MEDIAN DAYS TO SALE', value: num(summary.medianDaysToSale) },
          { label: 'CLICK-OUTS BEFORE SALE', value: num(summary.medianClickoutsBeforeSale) },
          {
            label: 'RESCUE CONVERSION',
            value:
              summary.rescueConversion.rate == null
                ? '—'
                : `${Math.round(summary.rescueConversion.rate * 100)}%`,
            sub: `${summary.rescueConversion.restyled}/${summary.rescueConversion.total} restyled`,
          },
        ].map((tile) => (
          <div key={tile.label} className="border border-[#E2E0DB] bg-white rounded-[12px] px-4 py-3.5">
            <p className="text-[9px] tracking-[0.12em] text-[#A8A8A4] mb-1.5">{tile.label}</p>
            <p className="text-[24px] tracking-[0.02em] text-[#0A0A0A] leading-none">{tile.value}</p>
            {tile.sub && <p className="text-[9px] tracking-[0.06em] text-[#A8A8A4] mt-1.5">{tile.sub}</p>}
          </div>
        ))}
      </div>

      {/* ── Size coverage: their stock vs our clients' bodies ── */}
      <section className="mb-10">
        <h2 className="text-[13px] tracking-[0.12em] text-[#4A4E57] mb-1">SIZE COVERAGE</h2>
        <p className="text-[10px] tracking-[0.06em] text-[#A8A8A4] mb-4 max-w-2xl leading-relaxed">
          LIVE SECOND-HAND STOCK AGAINST THE SIZES YOUR USERS ACTUALLY WEAR, ON THE SAME CANONICAL
          LADDER. WHERE THE TWO ROWS DIVERGE IS WHERE THE STOCK ISN&rsquo;T MATCHING THE CLIENT BASE.
        </p>

        <div className="space-y-5">
          {coverage.map((row) => {
            const sizes = Object.keys(row.stock).map(Number)
            const stockMax = Math.max(1, ...Object.values(row.stock))
            const userMax = Math.max(1, ...Object.values(row.users))
            return (
              <div key={row.category} className="border border-[#E2E0DB] bg-white rounded-[12px] p-4">
                <p className="text-[10px] tracking-[0.14em] text-[#6B6B6B] mb-3">{CATEGORY_LABEL[row.category]}</p>
                <div className="flex items-end gap-1.5 overflow-x-auto">
                  {sizes.map((size) => (
                    <div key={size} className="flex flex-col items-center gap-1 min-w-[34px]">
                      <div className="flex items-end gap-[3px] h-[64px]">
                        <div
                          title={`${row.stock[size]} pieces in stock`}
                          className="w-[11px] bg-[#0A0A0A] rounded-t-[2px]"
                          style={{ height: `${(row.stock[size] / stockMax) * 64}px` }}
                        />
                        <div
                          title={`${row.users[size]} users wear this size`}
                          className="w-[11px] bg-[#C4A882] rounded-t-[2px]"
                          style={{ height: `${(row.users[size] / userMax) * 64}px` }}
                        />
                      </div>
                      <span className="text-[9px] tracking-[0.04em] text-[#6B6B6B]">{size}</span>
                    </div>
                  ))}
                </div>
                <div className="flex items-center gap-4 mt-3 text-[9px] tracking-[0.1em] text-[#A8A8A4]">
                  <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 bg-[#0A0A0A] rounded-[1px]" /> STOCK</span>
                  <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 bg-[#C4A882] rounded-[1px]" /> YOUR USERS</span>
                </div>
              </div>
            )
          })}
        </div>

        {gaps.length > 0 && (
          <div className="mt-4 border-l-2 border-[#C4A882] pl-4">
            <p className="text-[10px] tracking-[0.14em] text-[#8A7340] mb-2">THE CONVERSATION TO HAVE</p>
            <ul className="space-y-1">
              {gaps.slice(0, 6).map((g) => (
                <li key={`${g.category}-${g.size}`} className="text-[11px] tracking-[0.03em] text-[#4A4E57]">
                  {CATEGORY_LABEL[g.category].toLowerCase()} · size {g.size} —{' '}
                  {Math.round(g.userShare * 100)}% of your users, {Math.round(g.stockShare * 100)}% of the stock
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {/* ── Stale one-of-ones ── */}
      {summary.stale.length > 0 && (
        <section className="mb-10">
          <h2 className="text-[13px] tracking-[0.12em] text-[#4A4E57] mb-1">
            LIVE OVER {STALE_UNIQUE_DAYS} DAYS · NO CLICK-OUTS
          </h2>
          <p className="text-[10px] tracking-[0.06em] text-[#A8A8A4] mb-4 max-w-2xl">
            A PRICING OR STYLING SIGNAL — AND A CONCRETE ONE TO PUT TO THE PARTNER.
          </p>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
            {summary.stale.slice(0, 12).map((i) => (
              <Link
                key={i.item_id}
                href={`/admin/items/${i.item_id}/edit`}
                className="border border-[#E2E0DB] bg-white rounded-[10px] overflow-hidden hover:border-[#0A0A0A] transition-colors"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={i.image_url || '/placeholder-outfit.jpg'} alt="" className="w-full aspect-[3/4] object-cover bg-[#F2F2F2]" />
                <div className="px-2 py-1.5">
                  <p className="text-[9px] tracking-[0.08em] text-[#A8A8A4] uppercase truncate">{i.brand_name ?? 'BRAND'}</p>
                  <p className="text-[10px] leading-[1.2] text-[#4A4E57] line-clamp-2">{i.product_name}</p>
                  <p className="text-[9px] text-[#B83A3A] mt-0.5">{Math.round(i.days_live)} days live</p>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* ── Recent sales ── */}
      {(recentSales ?? []).length > 0 && (
        <section className="mb-10">
          <h2 className="text-[13px] tracking-[0.12em] text-[#4A4E57] mb-4">RECENT SALES</h2>
          <div className="border border-[#E2E0DB] bg-white rounded-[12px] divide-y divide-[#EFEDE9]">
            {((recentSales ?? []) as any[]).map((s) => (
              <div key={s.item_id} className="flex items-center gap-3 px-4 py-2.5">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={s.item?.image_url || '/placeholder-outfit.jpg'} alt="" className="w-[34px] h-[45px] object-cover rounded-[5px] bg-[#F2F2F2]" />
                <div className="min-w-0 flex-1">
                  <p className="text-[9px] tracking-[0.09em] text-[#A8A8A4] uppercase truncate">{s.item?.brand?.name ?? 'BRAND'}</p>
                  <p className="text-[11px] text-[#4A4E57] truncate">{s.item?.product_name ?? 'Item'}</p>
                </div>
                <p className="text-[10px] tracking-[0.06em] text-[#6B6B6B] whitespace-nowrap">
                  {s.days_live != null ? `${Math.round(s.days_live)}d live` : '—'} · {s.clickouts} clicks · {s.saves} saves
                </p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── Merchant sourcing config, feeds, rescue review ── */}
      <SecondHandClient merchants={rows} brands={brands} rescues={rescues} />
    </div>
  )
}
