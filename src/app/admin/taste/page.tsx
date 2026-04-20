import Link from 'next/link'
import { getTasteInsights } from '@/lib/admin-queries'

const PRICE_TIER_LABELS: Record<number, string> = {
  1: 'HIGH STREET',
  2: 'CONTEMPORARY',
  3: 'PREMIUM',
  4: 'LUXURY',
  5: 'ULTRA-LUXURY',
}

export default async function TastePage() {
  const insights = await getTasteInsights()

  if (insights.totalLogs === 0) {
    return (
      <div>
        <Header />
        <div className="py-20 text-center border border-[#E2E0DB] bg-white rounded-[3px]">
          <p className="text-[11px] tracking-[0.20em] text-[#A8A8A4]">
            NO TASTE DATA YET. START LOGGING ITEMS IN THE ITEM LIBRARY.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div>
      <Header />

      {/* Summary row */}
      <div className="grid grid-cols-3 gap-4 mb-10">
        <SummaryCard label="LOG EVENTS" value={insights.totalLogs} />
        <SummaryCard label="UNIQUE BRANDS" value={insights.uniqueBrands} />
        <SummaryCard
          label="DOMINANT TIER"
          value={dominantTier(insights.priceTierDistribution)}
          isText
        />
      </div>

      {/* Two-column grid */}
      <div className="grid grid-cols-2 gap-6 mb-10">
        <Panel title="TOP BRANDS">
          {insights.topBrands.length === 0 ? (
            <Empty />
          ) : (
            <ul className="space-y-2">
              {insights.topBrands.map((b) => (
                <li key={b.name} className="flex items-center justify-between">
                  <span className="text-[11px] tracking-[0.12em] text-[#0A0A0A]">
                    {b.name.toUpperCase()}
                  </span>
                  <div className="flex items-center gap-3">
                    {b.priceTier != null && (
                      <span className="text-[9px] tracking-[0.15em] text-[#A8A8A4]">
                        {PRICE_TIER_LABELS[b.priceTier] ?? `TIER ${b.priceTier}`}
                      </span>
                    )}
                    <span className="text-[10px] tracking-[0.12em] text-[#6B6B6B] w-8 text-right">
                      {b.count}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="TOP ITEM TYPES">
          {insights.topItemTypes.length === 0 ? (
            <Empty />
          ) : (
            <ul className="space-y-2">
              {insights.topItemTypes.map((t) => (
                <li key={t.type} className="flex items-center justify-between">
                  <span className="text-[11px] tracking-[0.12em] text-[#0A0A0A]">
                    {t.type.replace(/_/g, ' ').toUpperCase()}
                  </span>
                  <CountBar count={t.count} max={insights.topItemTypes[0].count} />
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="COLOUR FAMILIES">
          {insights.topColourFamilies.length === 0 ? (
            <Empty />
          ) : (
            <ul className="space-y-2">
              {insights.topColourFamilies.map((c) => (
                <li key={c.family} className="flex items-center justify-between">
                  <span className="text-[11px] tracking-[0.12em] text-[#0A0A0A]">
                    {c.family.replace(/_/g, ' ').toUpperCase()}
                  </span>
                  <CountBar count={c.count} max={insights.topColourFamilies[0].count} />
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="MATERIAL CATEGORIES">
          {insights.topMaterialCategories.length === 0 ? (
            <Empty />
          ) : (
            <ul className="space-y-2">
              {insights.topMaterialCategories.map((m) => (
                <li key={m.category} className="flex items-center justify-between">
                  <span className="text-[11px] tracking-[0.12em] text-[#0A0A0A]">
                    {m.category.replace(/_/g, ' ').toUpperCase()}
                  </span>
                  <CountBar count={m.count} max={insights.topMaterialCategories[0].count} />
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="PRICE TIER DISTRIBUTION">
          {insights.priceTierDistribution.length === 0 ? (
            <Empty />
          ) : (
            <ul className="space-y-2">
              {insights.priceTierDistribution.map((p) => (
                <li key={p.tier} className="flex items-center justify-between">
                  <span className="text-[11px] tracking-[0.12em] text-[#0A0A0A]">
                    {p.tier} — {PRICE_TIER_LABELS[p.tier] ?? ''}
                  </span>
                  <CountBar
                    count={p.count}
                    max={Math.max(...insights.priceTierDistribution.map((x) => x.count))}
                  />
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="AVERAGE SCORES">
          <ul className="space-y-2">
            {Object.entries(insights.avgScores).map(([key, value]) => (
              <li key={key} className="flex items-center justify-between">
                <span className="text-[11px] tracking-[0.12em] text-[#0A0A0A]">
                  {key.replace(/_/g, ' ').toUpperCase()}
                </span>
                <span className="text-[10px] tracking-[0.12em] text-[#6B6B6B]">
                  {value != null ? value.toFixed(2) : '—'}
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      {/* Recent activity */}
      <Panel title="RECENT LOG EVENTS">
        {insights.recent.length === 0 ? (
          <Empty />
        ) : (
          <ul className="divide-y divide-[#E2E0DB]">
            {insights.recent.map((r) => (
              <li key={r.log_id} className="flex items-center justify-between py-2">
                <div>
                  <span className="text-[11px] tracking-[0.12em] text-[#0A0A0A]">
                    {r.brand_name?.toUpperCase() ?? '—'}
                  </span>
                  <span className="mx-2 text-[#A8A8A4]">·</span>
                  <span className="text-[10px] tracking-[0.12em] text-[#6B6B6B]">
                    {r.item_type?.replace(/_/g, ' ').toUpperCase() ?? '—'}
                  </span>
                  {r.colour_family && (
                    <>
                      <span className="mx-2 text-[#A8A8A4]">·</span>
                      <span className="text-[10px] tracking-[0.12em] text-[#6B6B6B]">
                        {r.colour_family.toUpperCase()}
                      </span>
                    </>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-[9px] tracking-[0.15em] text-[#A8A8A4]">
                    {r.event_type.toUpperCase()}
                  </span>
                  <span className="text-[9px] tracking-[0.12em] text-[#A8A8A4]">
                    {new Date(r.logged_at).toLocaleDateString()}
                  </span>
                  <Link
                    href={`/admin/items/${r.item_id}/edit`}
                    className="text-[9px] tracking-[0.15em] text-[#6B6B6B] hover:text-[#0A0A0A]"
                  >
                    OPEN →
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  )
}

function Header() {
  return (
    <div className="mb-10">
      <p className="text-[11px] tracking-[0.25em] text-[#6B6B6B] mb-2">ADMIN STUDIO</p>
      <h1 className="text-[28px] tracking-[0.10em] text-[#0A0A0A]">TASTE BRAIN</h1>
      <p className="mt-2 text-[10px] tracking-[0.15em] text-[#A8A8A4]">
        AGGREGATED SIGNAL FROM EVERY ITEM YOU'VE LOGGED.
      </p>
    </div>
  )
}

function SummaryCard({ label, value, isText = false }: { label: string; value: number | string; isText?: boolean }) {
  return (
    <div className="bg-white border border-[#E2E0DB] p-6 rounded-[3px]">
      <p
        className="text-[#0A0A0A] mb-1 tracking-[0.08em]"
        style={{ fontSize: isText ? '16px' : '32px', lineHeight: 1 }}
      >
        {value}
      </p>
      <p className="text-[10px] tracking-[0.20em] text-[#0A0A0A]">{label}</p>
    </div>
  )
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white border border-[#E2E0DB] p-5 rounded-[3px]">
      <p className="text-[10px] tracking-[0.20em] text-[#6B6B6B] mb-4 pb-3 border-b border-[#E2E0DB]">
        {title}
      </p>
      {children}
    </div>
  )
}

function CountBar({ count, max }: { count: number; max: number }) {
  const pct = max > 0 ? Math.round((count / max) * 100) : 0
  return (
    <div className="flex items-center gap-3">
      <div className="w-24 h-1 bg-[#F2F2F0] rounded-full overflow-hidden">
        <div className="h-full bg-[#0A0A0A]" style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[10px] tracking-[0.12em] text-[#6B6B6B] w-8 text-right">{count}</span>
    </div>
  )
}

function Empty() {
  return <p className="text-[10px] tracking-[0.15em] text-[#A8A8A4]">NO DATA YET.</p>
}

function dominantTier(dist: { tier: number; count: number }[]): string {
  if (dist.length === 0) return '—'
  const top = [...dist].sort((a, b) => b.count - a.count)[0]
  return PRICE_TIER_LABELS[top.tier] ?? `TIER ${top.tier}`
}
