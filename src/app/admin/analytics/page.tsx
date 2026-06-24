import { createAdminClient } from '@/lib/supabase-server'
import AnalyticsChart from './AnalyticsChart'
import ReferralLinkCard from './ReferralLinkCard'

export const dynamic = 'force-dynamic'

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || 'https://www.myraassistant.co.uk').replace(/\/+$/, '')

// Known referral codes → friendly label. Add new collabs here.
const REF_LABELS: Record<string, string> = {
  tdfb: '@thedatafashionbrief',
}

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

  // Try fetching with ref — table/column might not exist yet if migration not run.
  let { data, error } = await admin
    .from('landing_event' as any)
    .select('event_type, occurred_at, ref')
    .eq('path', '/')
    .gte('occurred_at', since.toISOString())
    .order('occurred_at', { ascending: true })

  let refColumnReady = !error
  // Fall back to fetching without the ref column.
  if (error) {
    const retry = await admin
      .from('landing_event' as any)
      .select('event_type, occurred_at')
      .eq('path', '/')
      .gte('occurred_at', since.toISOString())
      .order('occurred_at', { ascending: true })
    data = retry.data
    error = retry.error
  }

  const tableReady = !error

  // All-time totals (separate query)
  const { count: totalViews }  = tableReady
    ? await admin.from('landing_event' as any).select('*', { count: 'exact', head: true }).eq('event_type', 'pageview').eq('path', '/')
    : { count: 0 }

  // Build 30-day series
  const dayMap = buildDayMap(DAYS)
  const clickTypes: Record<string, number> = {}
  // Referral attribution (last 30 days): ref → { views, signups }
  const refMap = new Map<string, { views: number; signups: number }>()
  let last30Signups = 0

  if (tableReady && data) {
    for (const row of data as { event_type: string; occurred_at: string; ref?: string | null }[]) {
      const day = row.occurred_at.slice(0, 10)
      const entry = dayMap.get(day)
      const ref = row.ref ?? null
      if (ref) {
        if (!refMap.has(ref)) refMap.set(ref, { views: 0, signups: 0 })
      }

      if (row.event_type === 'pageview') {
        if (entry) entry.views++
        if (ref) refMap.get(ref)!.views++
      } else if (row.event_type === 'waitlist_signup') {
        last30Signups++
        if (ref) refMap.get(ref)!.signups++
      } else {
        if (entry) entry.clicks++
        clickTypes[row.event_type] = (clickTypes[row.event_type] ?? 0) + 1
      }
    }
  }

  const refRows = [...refMap.entries()]
    .map(([ref, v]) => ({
      ref,
      label: REF_LABELS[ref] ?? ref,
      views: v.views,
      signups: v.signups,
      conv: v.views > 0 ? ((v.signups / v.views) * 100).toFixed(1) : '—',
    }))
    .sort((a, b) => b.views - a.views)

  const days = Array.from(dayMap.entries()).map(([isoDate, counts]) => ({
    isoDate,
    date: fmtDate(isoDate),
    ...counts,
  }))

  const last30Views  = days.reduce((s, d) => s + d.views, 0)
  const last30Clicks = days.reduce((s, d) => s + d.clicks, 0)
  const clickRate    = last30Views > 0 ? ((last30Clicks / last30Views) * 100).toFixed(1) : '—'
  const signupRate   = last30Views > 0 ? ((last30Signups / last30Views) * 100).toFixed(1) : '—'

  const CLICK_LABELS: Record<string, string> = {
    cta_click: 'JOIN THE WAITLIST',
    instagram_click: 'INSTAGRAM',
    tiktok_click: 'TIKTOK',
  }

  return (
    <div>
      <div className="mb-8">
        <p className="text-[10px] tracking-[0.25em] text-[#6B6B6B] mb-1">ADMIN</p>
        <h1 className="text-[22px] tracking-[0.10em] text-[#4A4E57]">ANALYTICS</h1>
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
          { label: 'VIEWS (30 DAYS)',    value: last30Views.toLocaleString(), sub: 'LAST 30 DAYS' },
          { label: 'WAITLIST SIGN-UPS',  value: last30Signups.toLocaleString(), sub: 'LAST 30 DAYS' },
          { label: 'SIGN-UP RATE',       value: `${signupRate}%`, sub: 'SIGN-UPS / VIEWS' },
        ].map((s) => (
          <div key={s.label} className="border border-[#E2E0DB] bg-white rounded-[3px] px-5 py-4">
            <p className="text-[9px] tracking-[0.20em] text-[#A8A8A4] mb-2">{s.label}</p>
            <p className="text-[28px] tracking-[0.05em] text-[#4A4E57] leading-none">{s.value}</p>
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

      {/* ── Referral tracking ── */}
      <div className="border border-[#E2E0DB] bg-white rounded-[3px] p-6 mb-8">
        <p className="text-[10px] tracking-[0.22em] text-[#6B6B6B] mb-2">REFERRAL LINKS</p>
        <p className="text-[10px] tracking-[0.12em] text-[#A8A8A4] leading-relaxed mb-5 max-w-[620px]">
          Share these links so visits and waitlist sign-ups are attributed to each source. Add{' '}
          <span className="font-mono text-[#6B6B6B]">?ref=yourcode</span> to any link to create a new one.
        </p>

        <div className="space-y-3 mb-6 max-w-[620px]">
          <ReferralLinkCard label="@THEDATAFASHIONBRIEF" url={`${SITE_URL}/?ref=tdfb`} />
        </div>

        {!refColumnReady ? (
          <div className="border border-[#E8D9B8] bg-[#FBF6EA] rounded-[3px] p-4 max-w-[620px]">
            <p className="text-[10px] tracking-[0.14em] text-[#8A7A4E] leading-relaxed mb-2">
              Run migration <span className="font-mono">0008_landing_event_ref.sql</span> in Supabase to start
              tracking referrals:
            </p>
            <pre className="text-[9px] bg-white border border-[#E8D9B8] p-3 rounded overflow-x-auto text-[#6B6B6B] leading-relaxed">{`ALTER TABLE public.landing_event ADD COLUMN IF NOT EXISTS ref text;
CREATE INDEX IF NOT EXISTS landing_event_ref_idx ON public.landing_event (ref);`}</pre>
          </div>
        ) : refRows.length === 0 ? (
          <p className="text-[10px] tracking-[0.16em] text-[#A8A8A4] py-4">
            NO REFERRAL TRAFFIC YET · LAST 30 DAYS — IT APPEARS HERE ONCE PEOPLE VISIT VIA A ?REF LINK.
          </p>
        ) : (
          <div className="border border-[#E2E0DB] rounded-[3px] overflow-hidden max-w-[620px]">
            <div className="grid grid-cols-[1fr_80px_90px_80px] gap-2 px-4 py-2.5 bg-[#FAFAF8] border-b border-[#E2E0DB]">
              <span className="text-[9px] tracking-[0.18em] text-[#6B6B6B]">SOURCE</span>
              <span className="text-[9px] tracking-[0.18em] text-[#6B6B6B] text-right">VISITS</span>
              <span className="text-[9px] tracking-[0.18em] text-[#6B6B6B] text-right">SIGN-UPS</span>
              <span className="text-[9px] tracking-[0.18em] text-[#6B6B6B] text-right">CONV.</span>
            </div>
            {refRows.map((r, i) => (
              <div
                key={r.ref}
                className={`grid grid-cols-[1fr_80px_90px_80px] gap-2 px-4 py-3 items-center border-b border-[#E2E0DB] last:border-0 ${i % 2 ? 'bg-[#FAFAF8]' : 'bg-white'}`}
              >
                <span className="text-[11px] tracking-[0.06em] text-[#4A4E57] truncate">{r.label}</span>
                <span className="text-[12px] tracking-[0.04em] text-[#4A4E57] text-right">{r.views}</span>
                <span className="text-[12px] tracking-[0.04em] text-[#3A6B3A] text-right">{r.signups}</span>
                <span className="text-[11px] tracking-[0.04em] text-[#6B6B6B] text-right">{r.conv}%</span>
              </div>
            ))}
            <p className="text-[8px] tracking-[0.14em] text-[#A8A8A4] px-4 py-2 bg-[#FAFAF8]">LAST 30 DAYS</p>
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
                      <span className="text-[9px] tracking-[0.16em] text-[#4A4E57]">{CLICK_LABELS[type] ?? type.toUpperCase()}</span>
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
