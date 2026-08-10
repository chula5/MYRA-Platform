import { notFound } from 'next/navigation'
import { getDashboardMetrics, getMetric, METRIC_KEYS } from '@/lib/dashboard-metrics'
import { getBreakdowns } from '@/lib/metric-detail'
import TrendChart from '@/components/admin/charts/TrendChart'
import BarChart from '@/components/admin/charts/BarChart'
import RankBars from '@/components/admin/charts/RankBars'
import DeltaChip from '@/components/admin/charts/DeltaChip'
import { INK, STATUS } from '@/components/admin/charts/palette'

export const dynamic = 'force-dynamic'

function formatValue(kind: string, v: number): string {
  if (kind === 'gbp0') return `£${Math.round(v).toLocaleString('en-GB')}`
  if (kind === 'gbp') return `£${v.toFixed(2)}`
  if (kind === 'pct') return `${(v * 100).toFixed(1)}%`
  return Math.round(v).toLocaleString('en-GB')
}

export default async function MetricDetailPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params
  const all = await getDashboardMetrics()
  const m = getMetric(all, key)
  if (!m) notFound()

  const breakdowns = await getBreakdowns(m.key)

  // The week in progress is shown but never used for the headline — it is
  // always mid-flight and would read as a collapse.
  const inProgress = m.series[m.series.length - 1]
  const inProgressLabel = m.labels[m.labels.length - 1]

  const peers = METRIC_KEYS.filter((k) => k !== m.key)

  return (
    <div>
      {/* Header */}
      <div className="mb-8">
        <a href="/admin" className="text-[10px] tracking-[0.14em] text-[#A8A8A4] hover:text-[#0A0A0A] transition-colors duration-300">
          ← DASHBOARD
        </a>
        <div className="flex flex-wrap items-end justify-between gap-6 mt-4">
          <div>
            <p className="text-[10px] tracking-[0.14em] text-[#6B6B6B] mb-2">{m.label}</p>
            <div className="flex items-end gap-4">
              <p
                className="text-[52px] leading-none tracking-[0.02em]"
                style={{ color: m.alert ? STATUS.critical : INK.body }}
              >
                {formatValue(m.format, m.current)}
              </p>
              <div className="pb-2">
                <DeltaChip delta={m.delta} inverted={m.inverted} />
                <p className="text-[9px] tracking-[0.09em] text-[#A8A8A4] mt-1">
                  WEEK OF {m.labels[m.labels.length - 2] ?? '—'}
                </p>
              </div>
            </div>
            {m.alert && (
              <p className="text-[10px] tracking-[0.09em] mt-3" style={{ color: STATUS.critical }}>
                ⚠ {m.alert}
              </p>
            )}
          </div>

          <a
            href={m.area.href}
            className="bg-[#0A0A0A] text-white px-6 py-3 rounded-[12px] text-[10px] tracking-[0.14em] hover:opacity-85 transition-opacity"
          >
            GO TO {m.area.label} →
          </a>
        </div>
      </div>

      {!m.available && (
        <div className="mb-6 border border-[#E2D6B8] bg-[#FBF6E9] rounded-[12px] p-4">
          <p className="text-[10px] tracking-[0.09em] text-[#8A6D3B]">
            THE TABLE BEHIND THIS METRIC DOES NOT EXIST YET · RUN THE OUTSTANDING SUPABASE MIGRATION
          </p>
        </div>
      )}

      {/* Definition — no metric on this dashboard is unexplained. */}
      <div className="mb-8 bg-white border border-[#E2E0DB] rounded-[14px] p-6">
        <p className="text-[9px] tracking-[0.14em] text-[#A8A8A4] mb-2">HOW THIS IS MEASURED</p>
        <p className="text-[11px] tracking-[0.045em] text-[#4A4E57] leading-relaxed max-w-3xl">{m.definition}</p>
        {m.inverted && (
          <p className="text-[9px] tracking-[0.09em] text-[#A8A8A4] mt-3">A FALL IS THE GOOD OUTCOME FOR THIS METRIC.</p>
        )}
      </div>

      {/* Series */}
      <div className="grid grid-cols-12 gap-5 mb-8">
        <div className="col-span-12 xl:col-span-7 bg-white border border-[#E2E0DB] rounded-[14px] p-6">
          <p className="text-[10px] tracking-[0.14em] text-[#4A4E57] mb-4">
            {m.label} · LAST {m.labels.length} WEEKS
          </p>
          <TrendChart
            labels={m.labels}
            series={[{ name: m.label, values: m.series, colour: m.colour }]}
            height={230}
            format={m.format}
          />
        </div>

        <div className="col-span-12 xl:col-span-5 bg-white border border-[#E2E0DB] rounded-[14px] p-6">
          <p className="text-[10px] tracking-[0.14em] text-[#4A4E57] mb-4">PER WEEK</p>
          <BarChart labels={m.labels} values={m.series} colour={m.colour} format={m.format} height={200} />
          <div className="mt-4 pt-4 border-t border-[#F2F2F0] grid grid-cols-3 gap-3">
            <Figure label="LAST COMPLETE" value={formatValue(m.format, m.current)} />
            <Figure label="WEEK BEFORE" value={m.previous === null ? '—' : formatValue(m.format, m.previous)} />
            <Figure label={`${inProgressLabel} (SO FAR)`} value={formatValue(m.format, inProgress)} muted />
          </div>
        </div>
      </div>

      {/* Breakdowns */}
      {breakdowns.length > 0 && (
        <>
          <p className="text-[10px] tracking-[0.113em] text-[#6B6B6B] mb-4">WHAT IS BEHIND IT</p>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5 mb-10">
            {breakdowns.map((b) => (
              <div key={b.title} className="bg-white border border-[#E2E0DB] rounded-[14px] p-6">
                <p className="text-[10px] tracking-[0.14em] text-[#4A4E57] mb-4">{b.title}</p>
                <RankBars
                  rows={b.rows}
                  colour={m.colour}
                  empty={b.empty}
                  format={
                    b.format === 'gbp'
                      ? (n) => `£${Math.round(n).toLocaleString('en-GB')}`
                      : (n) => Math.round(n).toLocaleString('en-GB')
                  }
                />
              </div>
            ))}
          </div>
        </>
      )}

      {/* Jump to another metric without going back to the dashboard first. */}
      <p className="text-[10px] tracking-[0.113em] text-[#6B6B6B] mb-4">OTHER METRICS</p>
      <div className="flex flex-wrap gap-2">
        {peers.map((k) => (
          <a
            key={k}
            href={`/admin/metrics/${k}`}
            className="border border-[#E2E0DB] bg-white px-4 py-2 rounded-[10px] text-[9px] tracking-[0.14em] text-[#6B6B6B] hover:border-[#0A0A0A] hover:text-[#0A0A0A] transition-colors duration-300"
          >
            {all.metrics[k].label}
          </a>
        ))}
      </div>
    </div>
  )
}

function Figure({ label, value, muted = false }: { label: string; value: string; muted?: boolean }) {
  return (
    <div>
      <p className="text-[8px] tracking-[0.14em] text-[#A8A8A4] mb-1.5">{label}</p>
      <p className={`text-[16px] tracking-[0.02em] ${muted ? 'text-[#C9C7C2]' : 'text-[#4A4E57]'}`}>{value}</p>
    </div>
  )
}
