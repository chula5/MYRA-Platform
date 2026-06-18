import { createAdminClient } from '@/lib/supabase-server'
import AnalyticsChart from './AnalyticsChart'

export const dynamic = 'force-dynamic'

// Build a map of the last N days (ISO date strings → {views, clicks}).
function buildDayMap(n: number): Map<string, { views: number; clicks: number }> {
  const map = new Map<string, { views: number; clicks: number }>()
  const now = new Date()
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now)
    d.setDate(d.getDate() - i)
    map.set(d.toISOString().slice(0, 10), { views: 0, clicks: 0 })
  }
  return map
}

function fmtDate(iso: string): string {
  const d = new Date(iso + 'T12:00:00Z')
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

export default async function AnalyticsPage() {
  const DAYS = 30
  const admin = createAdminClient()

  const since = new Date()
  since.setDate(since.getDate() - DAYS)

  // Try fetching — table might not exist yet if migration hasn't been run.
  const { data, error } = await admin
    .from('landing_event' as any)
    .select('event_type, occurred_at')
    .eq('path', '/')
    .gte('occurred_at', since.toISOString())
    .order('occurred_at', { ascending: true })

  const tableReady = !error

  // All-time totals (separate query)
  const { count: totalViews }  = tableReady
    ? await admin.from('landing_event' as any).select('*', { count: 'exact', head: true }).eq('event_type', 'pageview').eq('path', '/')
    : { count: 0 }
  const { count: totalClicks } = tableReady
    ? await admin.from('landing_event' as any).select('*', { count: 'exact', head: true }).neq('event_type', 'pageview').eq('path', '/')
    : { count: 0 }

  // Build 30-day series
  const dayMap = buildDayMap(DAYS)
  const clickTypes: Record<string, number> = {}

  if (tableReady && data) {
    for (const row of data as { event_type: string; occurred_at: string }[]) {
      const day = row.occurred_at.slice(0, 10)
      const entry = dayMap.get(day)
      if (!entry) continue
      if (row.event_type === 'pageview') {
        entry.views++
      } else {
        entry.clicks++
        clickTypes[row.event_type] = (clickTypes[row.event_type] ?? 0) + 1
      }
    }
  }

  const days = Array.from(dayMap.entries()).map(([isoDate, counts]) => ({
    isoDate,
    date: fmtDate(isoDate),
    ...counts,
  }))

  const last30Views  = days.reduce((s, d) => s + d.views, 0)
  const last30Clicks = days.reduce((s, d) => s + d.clicks, 0)
  const clickRate    = last30Views > 0 ? ((last30Clicks / last30Views) * 100).toFixed(1) : '—'

  const CLICK_LABELS: Record<string, string> = {
    cta_click: 'JOIN THE WAITLIST',
    instagram_click: 'INSTAGRAM',
    tiktok_click: 'TIKTOK',
  }

  return (
    <div>
      <div className="mb-8">
        <p className="text-[10px] tracking-[0.25em] text-[#6B6B6B] mb-1">ADMIN</p>
        <h1 className="text-[22px] tracking-[0.10em] text-[#0A0A0A]">ANALYTICS</h1>
        <p className="text-[11px] tracking-[0.15em] text-[#A8A8A4] mt-1">Landing page · myraassistant.co.uk</p>
      </div>

      {!tableReady && (
        <div className="border border-[#E8D9B8] bg-[#FBF6EA] rounded-[3px] p-5 mb-8 max-w-[600px]">
          <p className="text-[11px] tracking-[0.18em] text-[#8A7A4E] mb-3">DATABASE TABLE NOT YET CREATED</p>
          <p className="text-[10px] tracking-[0.12em] text-[#8A7A4E] leading-relaxed mb-3">
            Run the following SQL once in your Supabase SQL Editor to start collecting data:
          </p>
          <pre className="text-[9px] bg-white border border-[#E8D9B8] p-3 rounded overflow-x-auto text-[#6B6B6B] leading-relaxed">{`CREATE TABLE IF NOT EXISTS public.landing_event (
  event_id    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type  text        NOT NULL,
  path        text        NOT NULL DEFAULT '/',
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS landing_event_occurred_at_idx
  ON public.landing_event (occurred_at DESC);
ALTER TABLE public.landing_event ENABLE ROW LEVEL SECURITY;`}</pre>
        </div>
      )}

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-10">
        {[
          { label: 'TOTAL VIEWS',        value: totalViews?.toLocaleString() ?? '—', sub: 'ALL TIME' },
          { label: 'TOTAL CLICKS',       value: totalClicks?.toLocaleString() ?? '—', sub: 'ALL TIME' },
          { label: 'VIEWS (30 DAYS)',    value: last30Views.toLocaleString(), sub: 'LAST 30 DAYS' },
          { label: 'CLICK RATE',         value: `${clickRate}%`, sub: 'CLICKS / VIEWS' },
        ].map((s) => (
          <div key={s.label} className="border border-[#E2E0DB] bg-white rounded-[3px] px-5 py-4">
            <p className="text-[9px] tracking-[0.20em] text-[#A8A8A4] mb-2">{s.label}</p>
            <p className="text-[28px] tracking-[0.05em] text-[#0A0A0A] leading-none">{s.value}</p>
            <p className="text-[8px] tracking-[0.16em] text-[#C4A882] mt-1">{s.sub}</p>
          </div>
        ))}
      </div>

      {/* Chart */}
      <div className="border border-[#E2E0DB] bg-white rounded-[3px] p-6 mb-8">
        <p className="text-[10px] tracking-[0.22em] text-[#6B6B6B] mb-6">LAST 30 DAYS</p>
        {tableReady ? (
          <AnalyticsChart days={days} />
        ) : (
          <div className="h-[160px] flex items-center justify-center">
            <p className="text-[10px] tracking-[0.20em] text-[#A8A8A4]">DATA WILL APPEAR HERE ONCE THE TABLE IS CREATED</p>
          </div>
        )}
      </div>

      {/* Click breakdown */}
      {tableReady && Object.keys(clickTypes).length > 0 && (
        <div className="border border-[#E2E0DB] bg-white rounded-[3px] p-6 max-w-[480px]">
          <p className="text-[10px] tracking-[0.22em] text-[#6B6B6B] mb-5">CLICK BREAKDOWN · LAST 30 DAYS</p>
          <div className="space-y-3">
            {Object.entries(clickTypes)
              .sort(([, a], [, b]) => b - a)
              .map(([type, count]) => {
                const pct = last30Clicks > 0 ? (count / last30Clicks) * 100 : 0
                return (
                  <div key={type}>
                    <div className="flex justify-between mb-1">
                      <span className="text-[9px] tracking-[0.16em] text-[#0A0A0A]">{CLICK_LABELS[type] ?? type.toUpperCase()}</span>
                      <span className="text-[9px] tracking-[0.12em] text-[#6B6B6B]">{count}</span>
                    </div>
                    <div className="h-[3px] bg-[#F2F2F2] rounded-full overflow-hidden">
                      <div className="h-full bg-[#0A0A0A] rounded-full" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                )
              })}
          </div>
        </div>
      )}
    </div>
  )
}
