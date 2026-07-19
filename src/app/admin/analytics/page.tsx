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

// A labelled top-N list used in the per-referral behaviour breakdown.
function RefList({ title, rows, empty }: { title: string; rows: [string, number][]; empty: string }) {
  return (
    <div>
      <p className="text-[9px] tracking-[0.09em] text-[#6B6B6B] mb-2">{title}</p>
      {rows.length === 0 ? (
        <p className="text-[9px] tracking-[0.054em] text-[#C9C7C2]">{empty}</p>
      ) : (
        <div className="space-y-1.5">
          {rows.map(([name, count]) => (
            <div key={name} className="flex justify-between gap-2">
              <span className="text-[10px] tracking-[0.027em] text-[#4A4E57] truncate">{name.toUpperCase()}</span>
              <span className="text-[9px] tracking-[0.045em] text-[#A8A8A4] flex-shrink-0">{count}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
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

  // Account sign-ups (auth users) — emails so we can see exactly who joined.
  let signupUsers: { email: string; created_at: string }[] = []
  try {
    const { data: usersData } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 })
    signupUsers = (usersData?.users ?? [])
      .map((u: any) => ({ email: (u.email as string) ?? '(no email)', created_at: u.created_at as string }))
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
  } catch {
    /* listUsers may be unavailable in some environments */
  }

  // ── Engagement: outfit views + style-item / similar / explore clicks ──
  let engagement: {
    views: number; styleClicks: number; similarClicks: number; exploreClicks: number; shopClicks: number; sourceClicks: number
    topOutfits: { id: string; label: string; image: string | null; views: number; similar: number; explore: number }[]
    topItems: { id: string; label: string; clicks: number }[]
    topSourceOutfits: { id: string; label: string; image: string | null; clicks: number }[]
    topOccasions: { name: string; clicks: number }[]
  } | null = null
  {
    const { data: ev } = await admin
      .from('landing_event' as any)
      .select('event_type, path')
      .in('event_type', ['outfit_view', 'style_item', 'similar_looks', 'explore_styles', 'source_items', 'occasion_click'])
      .gte('occurred_at', since.toISOString())
      .limit(100000)
    // Retailer shop-throughs (product clicked → went to the retailer site).
    let shopClicks = 0
    const { count: sc } = await admin.from('item_click' as any).select('*', { count: 'exact', head: true }).gte('clicked_at', since.toISOString())
    shopClicks = sc ?? 0
    const rows = (ev ?? []) as { event_type: string; path: string }[]
    if (rows.length || shopClicks > 0) {
      const viewC = new Map<string, number>(), simC = new Map<string, number>(), expC = new Map<string, number>(), styleC = new Map<string, number>(), srcC = new Map<string, number>(), occC = new Map<string, number>()
      const bump = (m: Map<string, number>, k: string) => { if (k) m.set(k, (m.get(k) ?? 0) + 1) }
      for (const e of rows) {
        if (e.event_type === 'outfit_view') bump(viewC, e.path)
        else if (e.event_type === 'similar_looks') bump(simC, e.path)
        else if (e.event_type === 'explore_styles') bump(expC, e.path)
        else if (e.event_type === 'style_item') bump(styleC, e.path)
        else if (e.event_type === 'source_items') bump(srcC, e.path)
        else if (e.event_type === 'occasion_click') bump(occC, (e.path || '').trim().toLowerCase())
      }
      const isUuid = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
      const outfitIds = [...new Set([...viewC.keys(), ...simC.keys(), ...expC.keys(), ...srcC.keys()])].filter(isUuid)
      const itemIds = [...styleC.keys()].filter(isUuid)
      const outfitMap = new Map<string, { label: string; image: string | null }>()
      if (outfitIds.length) {
        const { data: outs } = await admin.from('outfit' as any).select('outfit_id, aesthetic_label, image_url, occasion_tags').in('outfit_id', outfitIds.slice(0, 300))
        for (const o of (outs ?? []) as any[]) outfitMap.set(o.outfit_id, { label: o.aesthetic_label || (o.occasion_tags?.[0] ?? 'OUTFIT'), image: o.image_url })
      }
      const itemMap = new Map<string, string>()
      if (itemIds.length) {
        const { data: its } = await admin.from('item' as any).select('item_id, product_name, brand(name)').in('item_id', itemIds.slice(0, 300))
        for (const it of (its ?? []) as any[]) itemMap.set(it.item_id, [it.brand?.name, it.product_name].filter(Boolean).join(' — '))
      }
      const topOutfits = outfitIds
        .map((id) => ({ id, label: outfitMap.get(id)?.label ?? '—', image: outfitMap.get(id)?.image ?? null, views: viewC.get(id) ?? 0, similar: simC.get(id) ?? 0, explore: expC.get(id) ?? 0 }))
        .sort((a, b) => (b.views + b.similar + b.explore) - (a.views + a.similar + a.explore))
        .slice(0, 12)
      const topItems = [...styleC.keys()].filter(isUuid)
        .map((id) => ({ id, label: itemMap.get(id) ?? '—', clicks: styleC.get(id) ?? 0 }))
        .sort((a, b) => b.clicks - a.clicks)
        .slice(0, 12)
      const topSourceOutfits = [...srcC.keys()].filter(isUuid)
        .map((id) => ({ id, label: outfitMap.get(id)?.label ?? '—', image: outfitMap.get(id)?.image ?? null, clicks: srcC.get(id) ?? 0 }))
        .sort((a, b) => b.clicks - a.clicks)
        .slice(0, 12)
      const topOccasions = [...occC.entries()]
        .map(([name, clicks]) => ({ name, clicks }))
        .sort((a, b) => b.clicks - a.clicks)
        .slice(0, 20)
      const sum = (m: Map<string, number>) => [...m.values()].reduce((s, n) => s + n, 0)
      engagement = { views: sum(viewC), styleClicks: sum(styleC), similarClicks: sum(simC), exploreClicks: sum(expC), shopClicks, sourceClicks: sum(srcC), topOutfits, topItems, topSourceOutfits, topOccasions }
    }
  }

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
  let avgVisits = '—'                       // avg sessions per visitor (30 days)
  let uniqueVisitors = 0
  const visitDist = { once: 0, twice: 0, three: 0, power: 0 }  // 1 / 2 / 3 / 4+ visits
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
        uniqueVisitors = visitors
        const returningVisitors = [...sessionsByVisitor.values()].filter((n) => n > 1).length
        returningVisitorRate = visitors > 0 ? `${((returningVisitors / visitors) * 100).toFixed(0)}%` : '—'

        // Repeat-use frequency: average visits per visitor + distribution.
        avgVisits = visitors > 0 ? (totalSessions / visitors).toFixed(1) : '—'
        for (const n of sessionsByVisitor.values()) {
          if (n >= 4) visitDist.power++
          else if (n === 3) visitDist.three++
          else if (n === 2) visitDist.twice++
          else visitDist.once++
        }
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

  // ── Per-referral behaviour: what each referred visitor actually did ──
  const refDetail = new Map<string, { occasions: Map<string, number>; items: Map<string, number>; searches: Map<string, number> }>()
  {
    const { data: refEvents } = await admin
      .from('landing_event' as any)
      .select('event_type, path, ref')
      .not('ref', 'is', null)
      .in('event_type', ['occasion_click', 'item_click', 'search'])
      .gte('occurred_at', since.toISOString())
      .limit(50000)
    const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1)
    for (const e of (refEvents ?? []) as { event_type: string; path: string; ref: string }[]) {
      if (!refDetail.has(e.ref)) refDetail.set(e.ref, { occasions: new Map(), items: new Map(), searches: new Map() })
      const d = refDetail.get(e.ref)!
      if (e.event_type === 'occasion_click') bump(d.occasions, e.path)
      else if (e.event_type === 'item_click') bump(d.items, e.path)
      else if (e.event_type === 'search') bump(d.searches, e.path)
    }
  }
  const topN = (m: Map<string, number> | undefined, n: number) =>
    m ? [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n) : []

  const refRows = [...refMap.entries()]
    .map(([ref, v]) => ({
      ref,
      label: REF_LABELS[ref] ?? ref,
      views: v.views,
      signups: v.signups,
      conv: v.views > 0 ? ((v.signups / v.views) * 100).toFixed(1) : '—',
      occasions: topN(refDetail.get(ref)?.occasions, 6),
      items: topN(refDetail.get(ref)?.items, 6),
      searches: topN(refDetail.get(ref)?.searches, 6),
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
  // Denominator for the location % is total views across ALL countries (not just
  // the top 12), so the shares are accurate even when the tail is truncated.
  const totalCountryViews = [...viewsByCountry.values()].reduce((sum, n) => sum + n, 0)
  const countryRows = [...countryCodes]
    .map((code) => ({
      code,
      label: COUNTRY_NAMES[code] ?? code,
      views: viewsByCountry.get(code) ?? 0,
      signups: signupsByCountry.get(code) ?? 0,
      sessions: sessionsByCountry.get(code) ?? 0,
      pct: totalCountryViews ? ((viewsByCountry.get(code) ?? 0) / totalCountryViews) * 100 : 0,
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

      {/* Who signed up — account emails */}
      <div className="border border-[#E2E0DB] bg-white rounded-[12px] p-6 mb-10 max-w-[620px]">
        <div className="flex items-baseline justify-between mb-4">
          <p className="text-[10px] tracking-[0.099em] text-[#6B6B6B]">ACCOUNT SIGN-UPS · EMAILS</p>
          <p className="text-[9px] tracking-[0.072em] text-[#A8A8A4]">{signupUsers.length} TOTAL</p>
        </div>
        {signupUsers.length === 0 ? (
          <p className="text-[10px] tracking-[0.072em] text-[#A8A8A4] py-3">No accounts yet.</p>
        ) : (
          <div className="divide-y divide-[#F2F2F2] max-h-[360px] overflow-y-auto">
            {signupUsers.map((u) => (
              <div key={u.email} className="flex items-center justify-between gap-3 py-2.5">
                <span className="text-[11px] tracking-[0.018em] text-[#4A4E57] truncate">{u.email}</span>
                <span className="text-[9px] tracking-[0.054em] text-[#A8A8A4] flex-shrink-0">
                  {new Date(u.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                </span>
              </div>
            ))}
          </div>
        )}
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

      {/* ── Repeat use (proves multiple visits per month) ── */}
      {retentionReady && totalSessions > 0 && (
        <div className="border border-[#E2E0DB] bg-white rounded-[12px] p-6 mb-10">
          <p className="text-[10px] tracking-[0.099em] text-[#6B6B6B] mb-5">REPEAT USE · LAST 30 DAYS</p>
          <div className="grid grid-cols-1 md:grid-cols-[180px_1fr] gap-8 items-center">
            <div>
              <p className="text-[40px] tracking-[0.01em] text-[#4A4E57] leading-none">{avgVisits}</p>
              <p className="text-[9px] tracking-[0.072em] text-[#C4A882] mt-2">AVG VISITS / VISITOR</p>
              <p className="text-[9px] tracking-[0.054em] text-[#A8A8A4] mt-1">{uniqueVisitors} UNIQUE VISITORS</p>
            </div>
            <div className="space-y-2.5">
              {([
                { label: '1 VISIT', n: visitDist.once },
                { label: '2 VISITS', n: visitDist.twice },
                { label: '3 VISITS', n: visitDist.three },
                { label: '4+ VISITS', n: visitDist.power },
              ] as const).map((b) => {
                const maxN = Math.max(1, visitDist.once, visitDist.twice, visitDist.three, visitDist.power)
                const repeat = b.label !== '1 VISIT'
                return (
                  <div key={b.label} className="flex items-center gap-3">
                    <span className="text-[10px] tracking-[0.045em] text-[#4A4E57] w-[70px] flex-shrink-0">{b.label}</span>
                    <div className="flex-1 h-[8px] bg-[#F2F2F2] rounded-full overflow-hidden">
                      <div className={`h-full rounded-full ${repeat ? 'bg-[#C4A882]' : 'bg-[#D8D6D1]'}`} style={{ width: `${(b.n / maxN) * 100}%` }} />
                    </div>
                    <span className="text-[10px] tracking-[0.045em] text-[#6B6B6B] w-[34px] text-right flex-shrink-0">{b.n}</span>
                  </div>
                )
              })}
              <p className="text-[9px] tracking-[0.054em] text-[#A8A8A4] pt-1">
                {visitDist.twice + visitDist.three + visitDist.power} of {uniqueVisitors} visitors came back 2+ times this month.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ── Location ── */}
      <div className="border border-[#E2E0DB] bg-white rounded-[12px] p-6 mb-10">
        <div className="flex items-baseline justify-between mb-5">
          <p className="text-[10px] tracking-[0.099em] text-[#6B6B6B]">BY LOCATION · LAST 30 DAYS</p>
          <p className="text-[8px] tracking-[0.072em] text-[#A8A8A4]">% OF VIEWS · VIEWS · SIGN-UPS</p>
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
                  <span className="w-[64px] text-right flex-shrink-0 leading-tight">
                    <span className="block text-[11px] tracking-[0.02em] text-[#4A4E57]">
                      {c.pct < 10 ? c.pct.toFixed(1) : Math.round(c.pct)}%
                    </span>
                    <span className="block text-[8px] tracking-[0.045em] text-[#A8A8A4]">
                      {c.views} · {c.signups}
                    </span>
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

      {/* Engagement — outfit views + style/similar/explore clicks */}
      {engagement && (
        <div className="mb-10">
          <p className="text-[10px] tracking-[0.135em] text-[#6B6B6B] mb-4">ENGAGEMENT · LAST 30 DAYS</p>
          <div className="grid grid-cols-2 md:grid-cols-6 gap-4 mb-6">
            {[
              { label: 'OUTFIT VIEWS', value: engagement.views, sub: 'CLICKED INTO AN OUTFIT' },
              { label: 'SOURCE ITEMS', value: engagement.sourceClicks, sub: 'OPENED SHOP-THE-LOOK' },
              { label: 'STYLE-ITEM CLICKS', value: engagement.styleClicks, sub: 'TAPPED “STYLE THIS ITEM”' },
              { label: 'SIMILAR LOOKS', value: engagement.similarClicks, sub: 'CLICKS' },
              { label: 'EXPLORE STYLES', value: engagement.exploreClicks, sub: 'CLICKS' },
              { label: 'SHOP CLICK-OUTS', value: engagement.shopClicks, sub: 'WENT TO RETAILER SITE' },
            ].map((s) => (
              <div key={s.label} className="border border-[#E2E0DB] bg-white rounded-[12px] px-5 py-4">
                <p className="text-[9px] tracking-[0.09em] text-[#A8A8A4] mb-2">{s.label}</p>
                <p className="text-[28px] tracking-[0.023em] text-[#4A4E57] leading-none">{s.value.toLocaleString()}</p>
                <p className="text-[8px] tracking-[0.072em] text-[#C4A882] mt-1">{s.sub}</p>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Most-viewed outfits */}
            <div className="border border-[#E2E0DB] bg-white rounded-[12px] p-6">
              <p className="text-[10px] tracking-[0.099em] text-[#6B6B6B] mb-1">MOST-VIEWED OUTFITS</p>
              <p className="text-[8px] tracking-[0.063em] text-[#A8A8A4] mb-4">VIEWS · SIMILAR · EXPLORE</p>
              {engagement.topOutfits.length === 0 ? (
                <p className="text-[10px] tracking-[0.072em] text-[#A8A8A4] py-3">No outfit clicks yet.</p>
              ) : (
                <div className="space-y-2.5">
                  {engagement.topOutfits.map((o) => (
                    <div key={o.id} className="flex items-center gap-3">
                      {o.image
                        // eslint-disable-next-line @next/next/no-img-element
                        ? <img src={o.image} alt="" className="w-8 h-10 rounded object-cover bg-[#F2F2F0] flex-shrink-0" />
                        : <div className="w-8 h-10 rounded bg-[#F2F2F0] flex-shrink-0" />}
                      <span className="flex-1 min-w-0 text-[10px] tracking-[0.04em] text-[#4A4E57] truncate">{o.label.toUpperCase()}</span>
                      <span className="text-[10px] tracking-[0.045em] text-[#4A4E57] flex-shrink-0">{o.views}</span>
                      <span className="text-[9px] tracking-[0.045em] text-[#A8A8A4] w-[52px] text-right flex-shrink-0">{o.similar} · {o.explore}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Most-styled items */}
            <div className="border border-[#E2E0DB] bg-white rounded-[12px] p-6">
              <p className="text-[10px] tracking-[0.099em] text-[#6B6B6B] mb-4">MOST-STYLED ITEMS</p>
              {engagement.topItems.length === 0 ? (
                <p className="text-[10px] tracking-[0.072em] text-[#A8A8A4] py-3">No “style this item” clicks yet.</p>
              ) : (
                <div className="space-y-2">
                  {engagement.topItems.map((it) => (
                    <div key={it.id} className="flex items-center justify-between gap-3">
                      <span className="text-[10px] tracking-[0.04em] text-[#4A4E57] truncate">{it.label.toUpperCase()}</span>
                      <span className="text-[10px] tracking-[0.045em] text-[#6B6B6B] flex-shrink-0">{it.clicks}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
            {/* Occasions clicked the most */}
            <div className="border border-[#E2E0DB] bg-white rounded-[12px] p-6">
              <p className="text-[10px] tracking-[0.099em] text-[#6B6B6B] mb-1">OCCASIONS CLICKED · MOST POPULAR</p>
              <p className="text-[8px] tracking-[0.063em] text-[#A8A8A4] mb-4">FROM THE OCCASION CHIPS ON THE EDIT</p>
              {engagement.topOccasions.length === 0 ? (
                <p className="text-[10px] tracking-[0.072em] text-[#A8A8A4] py-3">No occasion clicks yet.</p>
              ) : (
                <div className="space-y-2">
                  {engagement.topOccasions.map((o) => (
                    <div key={o.name} className="flex items-center justify-between gap-3">
                      <span className="text-[10px] tracking-[0.04em] text-[#4A4E57] truncate">{o.name.toUpperCase()}</span>
                      <span className="text-[10px] tracking-[0.045em] text-[#6B6B6B] flex-shrink-0">{o.clicks}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Source-items clicks by outfit */}
            <div className="border border-[#E2E0DB] bg-white rounded-[12px] p-6">
              <p className="text-[10px] tracking-[0.099em] text-[#6B6B6B] mb-1">SOURCE ITEMS · BY OUTFIT</p>
              <p className="text-[8px] tracking-[0.063em] text-[#A8A8A4] mb-4">{engagement.sourceClicks.toLocaleString()} TOTAL “SOURCE ITEMS” CLICKS</p>
              {engagement.topSourceOutfits.length === 0 ? (
                <p className="text-[10px] tracking-[0.072em] text-[#A8A8A4] py-3">No source-items clicks yet.</p>
              ) : (
                <div className="space-y-2.5">
                  {engagement.topSourceOutfits.map((o) => (
                    <div key={o.id} className="flex items-center gap-3">
                      {o.image
                        // eslint-disable-next-line @next/next/no-img-element
                        ? <img src={o.image} alt="" className="w-8 h-10 rounded object-cover bg-[#F2F2F0] flex-shrink-0" />
                        : <div className="w-8 h-10 rounded bg-[#F2F2F0] flex-shrink-0" />}
                      <span className="flex-1 min-w-0 text-[10px] tracking-[0.04em] text-[#4A4E57] truncate">{o.label.toUpperCase()}</span>
                      <span className="text-[10px] tracking-[0.045em] text-[#6B6B6B] flex-shrink-0">{o.clicks}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

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

        {/* What referred visitors did on the site */}
        {refRows.some((r) => r.occasions.length || r.items.length || r.searches.length) && (
          <div className="mt-7 space-y-5">
            <p className="text-[9px] tracking-[0.099em] text-[#A8A8A4]">WHAT REFERRED VISITORS DID</p>
            {refRows
              .filter((r) => r.occasions.length || r.items.length || r.searches.length)
              .map((r) => (
                <div key={r.ref} className="border border-[#E2E0DB] rounded-[12px] p-5 max-w-[880px]">
                  <p className="text-[11px] tracking-[0.045em] text-[#4A4E57] mb-4">
                    {r.label} <span className="text-[#A8A8A4]">· {r.views} VISITS · {r.signups} SIGN-UPS</span>
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
                    <RefList title="OCCASIONS CLICKED" rows={r.occasions} empty="None yet" />
                    <RefList title="ITEMS CLICKED" rows={r.items} empty="None yet" />
                    <RefList title="SEARCHES" rows={r.searches} empty="None yet" />
                  </div>
                </div>
              ))}
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
