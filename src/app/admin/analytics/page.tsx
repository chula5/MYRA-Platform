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
    .select('event_type, occurred_at, ref, country')
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

  // ── Retention: time on site + repeat session rate (last 30 days) ──
  let retentionReady = true
  let totalSessions = 0
  let repeatRate = '—'
  let medianTime = '—'
  let returningVisitorRate = '—'
  const sessionsByCountry = new Map<string, number>()
  {
    const { data: sessions, error: sErr } = await admin
      .from('site_session' as any)
      .select('visitor_id, is_returning, started_at, last_seen_at, country')
      .gte('started_at', since.toISOString())
      .limit(50000)
    if (sErr) {
      retentionReady = false
    } else {
      const rows = (sessions ?? []) as { visitor_id: string; is_returning: boolean; started_at: string; last_seen_at: string; country?: string | null }[]
      totalSessions = rows.length
      if (totalSessions > 0) {
        const returningSessions = rows.filter((r) => r.is_returning).length
        repeatRate = `${((returningSessions / totalSessions) * 100).toFixed(0)}%`

        // MEDIAN session duration (robust to idle tabs), capped at 30 min.
        const durations = rows
          .map((r) => (new Date(r.last_seen_at).getTime() - new Date(r.started_at).getTime()) / 1000)
          .map((d) => Math.max(0, Math.min(d, 1800)))
          .sort((a, b) => a - b)
        const mid = Math.floor(durations.length / 2)
        const medSec = durations.length % 2 ? durations[mid] : (durations[mid - 1] + durations[mid]) / 2
        medianTime = `${Math.floor(medSec / 60)}:${String(Math.round(medSec % 60)).padStart(2, '0')}`

        // Returning visitor rate: visitors seen in >1 session this window.
        const sessionsByVisitor = new Map<string, number>()
        for (const r of rows) {
          sessionsByVisitor.set(r.visitor_id, (sessionsByVisitor.get(r.visitor_id) ?? 0) + 1)
          const c = r.country || '—'
          sessionsByCountry.set(c, (sessionsByCountry.get(c) ?? 0) + 1)
        }
        const visitors = sessionsByVisitor.size
        const returningVisitors = [...sessionsByVisitor.values()].filter((n) => n > 1).length
        returningVisitorRate = visitors > 0 ? `${((returningVisitors / visitors) * 100).toFixed(0)}%` : '—'
      }
    }
  }

  // Build 30-day series
  const dayMap = buildDayMap(DAYS)
  const clickTypes: Record<string, number> = {}
  // Referral attribution (last 30 days): ref → { views, signups }
  const refMap = new Map<string, { views: number; signups: number }>()
  let last30Signups = 0   // account sign-ups
  const viewsByCountry = new Map<string, number>()
  const signupsByCountry = new Map<string, number>()

  if (tableReady && data) {
    for (const row of data as { event_type: string; occurred_at: string; ref?: string | null; country?: string | null }[]) {
      const day = row.occurred_at.slice(0, 10)
      const entry = dayMap.get(day)
      const ref = row.ref ?? null
      const country = row.country || '—'
      if (ref) {
        if (!refMap.has(ref)) refMap.set(ref, { views: 0, signups: 0 })
      }

      if (row.event_type === 'pageview') {
        if (entry) entry.views++
        if (ref) refMap.get(ref)!.views++
        viewsByCountry.set(country, (viewsByCountry.get(country) ?? 0) + 1)
      } else if (row.event_type === 'account_signup' || row.event_type === 'waitlist_signup') {
        last30Signups++
        if (ref) refMap.get(ref)!.signups++
        signupsByCountry.set(country, (signupsByCountry.get(country) ?? 0) + 1)
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

  // ── Location: views + sign-ups + sessions by country (top 12) ──
  const COUNTRY_NAMES: Record<string, string> = {
    GB: 'United Kingdom', US: 'United States', IE: 'Ireland', FR: 'France', DE: 'Germany',
    ES: 'Spain', IT: 'Italy', NL: 'Netherlands', AU: 'Australia', CA: 'Canada', AE: 'UAE',
    CH: 'Switzerland', SE: 'Sweden', DK: 'Denmark', PT: 'Portugal', BE: 'Belgium', '—': 'Unknown',
  }
  const countryCodes = new Set<string>([...viewsByCountry.keys(), ...signupsByCountry.keys(), ...sessionsByCountry.keys()])
  const countryRows = [...countryCodes]
    .map((code) => ({
      code,
      label: COUNTRY_NAMES[code] ?? code,
      views: viewsByCountry.get(code) ?? 0,
      signups: signupsByCountry.get(code) ?? 0,
      sessions: sessionsByCountry.get(code) ?? 0,
    }))
    .sort((a, b) => b.views + b.sessions - (a.views + a.sessions))
    .slice(0, 12)
  const maxCountry = Math.max(1, ...countryRows.map((c) => c.views + c.sessions))
  const hasGeo = countryRows.some((c) => c.code !== '—')

  const CLICK_LABELS: Record<string, string> = {
    cta_click: 'JOIN THE WAITLIST',
    instagram_click: 'INSTAGRAM',
    tiktok_click: 'TIKTOK',
  }

  return (
    <div>
      <div className="mb-8">
        <p className="text-[10px] tracking-[0.113em] text-[#6B6B6B] mb-1">ADMIN</p>
        <h1 className="text-[22px] tracking-[0.045em] text-[#4A4E57]">ANALYTICS</h1>
        <p className="text-[11px] tracking-[0.068em] text-[#A8A8A4] mt-1">Landing page · myraassistant.co.uk</p>
      </div>

      {!tableReady && (
        <div className="border border-[#E8D9B8] bg-[#FBF6EA] rounded-[12px] p-5 mb-8 max-w-[600px]">
          <p className="text-[11px] tracking-[0.081em] text-[#8A7A4E] mb-3">DATABASE TABLE NOT YET CREATED</p>
          <p className="text-[10px] tracking-[0.054em] text-[#8A7A4E] leading-relaxed mb-3">
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
          { label: 'ACCOUNT SIGN-UPS',   value: last30Signups.toLocaleString(), sub: 'LAST 30 DAYS' },
          { label: 'SIGN-UP RATE',       value: `${signupRate}%`, sub: 'SIGN-UPS / VIEWS' },
        ].map((s) => (
          <div key={s.label} className="border border-[#E2E0DB] bg-white rounded-[12px] px-5 py-4">
            <p className="text-[9px] tracking-[0.09em] text-[#A8A8A4] mb-2">{s.label}</p>
            <p className="text-[28px] tracking-[0.023em] text-[#4A4E57] leading-none">{s.value}</p>
            <p className="text-[8px] tracking-[0.072em] text-[#C4A882] mt-1">{s.sub}</p>
          </div>
        ))}
      </div>

      {/* Retention */}
      <div className="mb-10">
        <p className="text-[10px] tracking-[0.135em] text-[#6B6B6B] mb-4">RETENTION · LAST 30 DAYS</p>
        {!retentionReady ? (
          <div className="border border-[#E8D9B8] bg-[#FBF6EA] rounded-[12px] p-5 max-w-[600px]">
            <p className="text-[11px] tracking-[0.081em] text-[#8A7A4E] mb-3">SESSION TABLE NOT YET CREATED</p>
            <p className="text-[10px] tracking-[0.054em] text-[#8A7A4E] leading-relaxed mb-3">
              Run migration <span className="font-mono">0013_site_session.sql</span> in Supabase to start
              measuring time on site and repeat sessions.
            </p>
            <pre className="text-[9px] bg-white border border-[#E8D9B8] p-3 rounded overflow-x-auto text-[#6B6B6B] leading-relaxed">{`create table if not exists site_session (
  session_id   text primary key,
  visitor_id   text not null,
  is_returning boolean not null default false,
  path         text,
  started_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create index if not exists site_session_visitor_idx on site_session (visitor_id);
create index if not exists site_session_started_idx on site_session (started_at);
alter table site_session enable row level security;`}</pre>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: 'TYPICAL TIME ON SITE', value: medianTime, sub: 'MEDIAN MIN:SEC PER SESSION' },
              { label: 'REPEAT SESSION RATE', value: repeatRate, sub: 'SESSIONS FROM RETURN VISITS' },
              { label: 'RETURNING VISITORS', value: returningVisitorRate, sub: 'VISITORS WITH 2+ SESSIONS' },
              { label: 'SESSIONS (30 DAYS)', value: totalSessions.toLocaleString(), sub: 'TOTAL VISITS' },
            ].map((s) => (
              <div key={s.label} className="border border-[#E2E0DB] bg-white rounded-[12px] px-5 py-4">
                <p className="text-[9px] tracking-[0.09em] text-[#A8A8A4] mb-2">{s.label}</p>
                <p className="text-[28px] tracking-[0.023em] text-[#4A4E57] leading-none">{s.value}</p>
                <p className="text-[8px] tracking-[0.072em] text-[#C4A882] mt-1">{s.sub}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Location ── */}
      <div className="border border-[#E2E0DB] bg-white rounded-[12px] p-6 mb-10">
        <div className="flex items-baseline justify-between mb-5">
          <p className="text-[10px] tracking-[0.099em] text-[#6B6B6B]">BY LOCATION · LAST 30 DAYS</p>
          <p className="text-[8px] tracking-[0.072em] text-[#A8A8A4]">VIEWS · SIGN-UPS</p>
        </div>
        {countryRows.length === 0 ? (
          <p className="text-[10px] tracking-[0.072em] text-[#A8A8A4] py-4 text-center">NO LOCATION DATA YET.</p>
        ) : (
          <>
            <div className="space-y-2.5">
              {countryRows.map((c) => (
                <div key={c.code} className="flex items-center gap-3">
                  <span className="text-[10px] tracking-[0.045em] text-[#4A4E57] w-[130px] flex-shrink-0 truncate">{c.label.toUpperCase()}</span>
                  <div className="flex-1 h-[6px] bg-[#F2F2F2] rounded-full overflow-hidden">
                    <div className="h-full bg-[#C4A882] rounded-full" style={{ width: `${((c.views + c.sessions) / maxCountry) * 100}%` }} />
                  </div>
                  <span className="text-[9px] tracking-[0.045em] text-[#6B6B6B] w-[70px] text-right flex-shrink-0">
                    {c.views} · {c.signups}
                  </span>
                </div>
              ))}
            </div>
            {!hasGeo && (
              <p className="text-[9px] tracking-[0.054em] text-[#A8A8A4] mt-4 leading-relaxed">
                Country shows as &ldquo;Unknown&rdquo; on localhost — it&rsquo;s populated from the edge once live on Vercel.
              </p>
            )}
          </>
        )}
      </div>

      {/* Chart */}
      <div className="border border-[#E2E0DB] bg-white rounded-[12px] p-6 mb-8">
        <p className="text-[10px] tracking-[0.099em] text-[#6B6B6B] mb-6">LAST 30 DAYS</p>
        {tableReady ? (
          <AnalyticsChart days={days} />
        ) : (
          <div className="h-[160px] flex items-center justify-center">
            <p className="text-[10px] tracking-[0.09em] text-[#A8A8A4]">DATA WILL APPEAR HERE ONCE THE TABLE IS CREATED</p>
          </div>
        )}
      </div>

      {/* ── Referral tracking ── */}
      <div className="border border-[#E2E0DB] bg-white rounded-[12px] p-6 mb-8">
        <p className="text-[10px] tracking-[0.099em] text-[#6B6B6B] mb-2">REFERRAL LINKS</p>
        <p className="text-[10px] tracking-[0.054em] text-[#A8A8A4] leading-relaxed mb-5 max-w-[620px]">
          Share these links so visits are attributed to each source. Just add{' '}
          <span className="font-mono text-[#6B6B6B]">/yourcode</span> to the site URL to create a new one.
        </p>

        <div className="space-y-3 mb-6 max-w-[620px]">
          <ReferralLinkCard label="@THEDATAFASHIONBRIEF" url={`${SITE_URL}/tdfb`} />
        </div>

        {!refColumnReady ? (
          <div className="border border-[#E8D9B8] bg-[#FBF6EA] rounded-[12px] p-4 max-w-[620px]">
            <p className="text-[10px] tracking-[0.063em] text-[#8A7A4E] leading-relaxed mb-2">
              Run migration <span className="font-mono">0008_landing_event_ref.sql</span> in Supabase to start
              tracking referrals:
            </p>
            <pre className="text-[9px] bg-white border border-[#E8D9B8] p-3 rounded overflow-x-auto text-[#6B6B6B] leading-relaxed">{`ALTER TABLE public.landing_event ADD COLUMN IF NOT EXISTS ref text;
CREATE INDEX IF NOT EXISTS landing_event_ref_idx ON public.landing_event (ref);`}</pre>
          </div>
        ) : refRows.length === 0 ? (
          <p className="text-[10px] tracking-[0.072em] text-[#A8A8A4] py-4">
            NO REFERRAL TRAFFIC YET · LAST 30 DAYS — IT APPEARS HERE ONCE PEOPLE VISIT VIA A ?REF LINK.
          </p>
        ) : (
          <div className="border border-[#E2E0DB] rounded-[12px] overflow-hidden max-w-[620px]">
            <div className="grid grid-cols-[1fr_80px_90px_80px] gap-2 px-4 py-2.5 bg-[#FAFAF8] border-b border-[#E2E0DB]">
              <span className="text-[9px] tracking-[0.081em] text-[#6B6B6B]">SOURCE</span>
              <span className="text-[9px] tracking-[0.081em] text-[#6B6B6B] text-right">VISITS</span>
              <span className="text-[9px] tracking-[0.081em] text-[#6B6B6B] text-right">SIGN-UPS</span>
              <span className="text-[9px] tracking-[0.081em] text-[#6B6B6B] text-right">CONV.</span>
            </div>
            {refRows.map((r, i) => (
              <div
                key={r.ref}
                className={`grid grid-cols-[1fr_80px_90px_80px] gap-2 px-4 py-3 items-center border-b border-[#E2E0DB] last:border-0 ${i % 2 ? 'bg-[#FAFAF8]' : 'bg-white'}`}
              >
                <span className="text-[11px] tracking-[0.027em] text-[#4A4E57] truncate">{r.label}</span>
                <span className="text-[12px] tracking-[0.018em] text-[#4A4E57] text-right">{r.views}</span>
                <span className="text-[12px] tracking-[0.018em] text-[#3A6B3A] text-right">{r.signups}</span>
                <span className="text-[11px] tracking-[0.018em] text-[#6B6B6B] text-right">{r.conv}%</span>
              </div>
            ))}
            <p className="text-[8px] tracking-[0.063em] text-[#A8A8A4] px-4 py-2 bg-[#FAFAF8]">LAST 30 DAYS</p>
          </div>
        )}
      </div>

      {/* Click breakdown */}
      {tableReady && Object.keys(clickTypes).length > 0 && (
        <div className="border border-[#E2E0DB] bg-white rounded-[12px] p-6 max-w-[480px]">
          <p className="text-[10px] tracking-[0.099em] text-[#6B6B6B] mb-5">CLICK BREAKDOWN · LAST 30 DAYS</p>
          <div className="space-y-3">
            {Object.entries(clickTypes)
              .sort(([, a], [, b]) => b - a)
              .map(([type, count]) => {
                const pct = last30Clicks > 0 ? (count / last30Clicks) * 100 : 0
                return (
                  <div key={type}>
                    <div className="flex justify-between mb-1">
                      <span className="text-[9px] tracking-[0.072em] text-[#4A4E57]">{CLICK_LABELS[type] ?? type.toUpperCase()}</span>
                      <span className="text-[9px] tracking-[0.054em] text-[#6B6B6B]">{count}</span>
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
