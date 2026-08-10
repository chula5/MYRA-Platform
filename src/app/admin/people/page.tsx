import { getPeopleActivity, type PersonActivity, type Ref, type AnonymousVisitor } from '@/lib/people-activity'
import TrendChart from '@/components/admin/charts/TrendChart'
import { SERIES, INK, STATUS } from '@/components/admin/charts/palette'

export const dynamic = 'force-dynamic'

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).toUpperCase()
}

function ago(iso: string | null): string {
  if (!iso) return 'NEVER'
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)
  if (days <= 0) return 'TODAY'
  if (days === 1) return 'YESTERDAY'
  if (days < 30) return `${days} DAYS AGO`
  return fmtDate(iso)
}

export default async function PeoplePage() {
  const { people, totals, daily, attributionReady, anonymous } = await getPeopleActivity()

  const attributedShare = totals.clicks > 0 ? (totals.clicks - totals.anonymousClicks) / totals.clicks : 0

  return (
    <div>
      <div className="mb-8">
        <a href="/admin" className="text-[10px] tracking-[0.14em] text-[#A8A8A4] hover:text-[#0A0A0A] transition-colors duration-300">
          ← DASHBOARD
        </a>
        <h1 className="text-[28px] tracking-[0.045em] text-[#4A4E57] mt-4">PEOPLE</h1>
        <p className="text-[10px] tracking-[0.09em] text-[#6B6B6B] mt-2 max-w-2xl leading-relaxed">
          EVERY ACCOUNT, AND WHAT THEY ACTUALLY DID — SAVED, LIKED AT SIGN-UP, AND CLICKED THROUGH TO A RETAILER.
          MOST ENGAGED FIRST.
        </p>
      </div>

      {!attributionReady && (
        <div className="mb-6 border border-[#E2D6B8] bg-[#FBF6E9] rounded-[12px] p-5">
          <p className="text-[10px] tracking-[0.09em] text-[#8A6D3B] mb-1">CLICK ATTRIBUTION NOT ENABLED YET</p>
          <p className="text-[9px] tracking-[0.054em] text-[#8A6D3B]/80 leading-relaxed">
            RUN <span className="font-mono">0025_click_attribution.sql</span> IN SUPABASE. UNTIL THEN EVERY
            CLICK-THROUGH IS COUNTED BUT NONE CAN BE TIED TO A PERSON.
          </p>
        </div>
      )}

      {/* Totals */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-8">
        <Figure label="ACCOUNTS" value={String(totals.accounts)} note="SIGNED UP" big />
        <Figure label="HAVE SAVED" value={String(totals.savers)} note={`${totals.savedOutfits} OUTFITS · ${totals.savedItems} ITEMS`} />
        <Figure label="HAVE CLICKED OUT" value={String(totals.clickers)} note="TO A RETAILER" />
        <Figure label="CLICK-THROUGHS" value={String(totals.clicks)} note="ALL TIME, ALL VISITORS" />
        <Figure
          label="TIED TO A PERSON"
          value={`${Math.round(attributedShare * 100)}%`}
          note={`${totals.anonymousClicks} ANONYMOUS`}
          tone={attributedShare > 0 ? undefined : STATUS.warning}
        />
      </div>

      {/* Daily click-throughs */}
      <div className="bg-white border border-[#E2E0DB] rounded-[14px] p-6 mb-8">
        <div className="flex items-baseline justify-between mb-4">
          <p className="text-[10px] tracking-[0.14em] text-[#4A4E57]">CLICK-THROUGHS PER DAY · LAST 30 DAYS</p>
          <a href="/admin/metrics/retailer-clicks" className="text-[9px] tracking-[0.14em] text-[#A8A8A4] hover:text-[#0A0A0A] transition-colors duration-300">
            WEEKLY VIEW →
          </a>
        </div>
        <TrendChart
          labels={daily.map((d) => d.label)}
          series={[
            { name: 'ALL CLICK-THROUGHS', values: daily.map((d) => d.total), colour: SERIES[1] },
            { name: 'TIED TO AN ACCOUNT', values: daily.map((d) => d.attributed), colour: SERIES[3] },
          ]}
          height={210}
          format="count"
        />
        <p className="text-[9px] tracking-[0.054em] text-[#C9C7C2] mt-4 leading-relaxed">
          THE GAP BETWEEN THE TWO LINES IS LOGGED-OUT BROWSING. IT IS REAL DEMAND — IT JUST HAS NO NAME ON IT.
        </p>
      </div>

      {/* Anonymous browsing */}
      {anonymous.visitors.length > 0 && (
        <div className="mb-10">
          <div className="flex items-baseline justify-between mb-4">
            <p className="text-[10px] tracking-[0.113em] text-[#6B6B6B]">
              ANONYMOUS BROWSING · {anonymous.identifiedBrowsers} BROWSERS
            </p>
            <p className="text-[9px] tracking-[0.09em] text-[#C9C7C2]">
              NO ACCOUNT · CLAIMED AUTOMATICALLY IF THEY SIGN UP
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {anonymous.visitors.slice(0, 6).map((v) => (
              <AnonymousCard key={v.visitorId} visitor={v} />
            ))}
          </div>
          {anonymous.untraceableClicks > 0 && (
            <p className="text-[9px] tracking-[0.054em] text-[#C9C7C2] mt-4 leading-relaxed">
              {anonymous.untraceableClicks} FURTHER CLICK-THROUGHS CANNOT BE GROUPED AT ALL — LOGGED BEFORE VISITOR
              TRACKING, OR FROM A BROWSER BLOCKING STORAGE. THEY STILL COUNT IN EVERY TOTAL.
            </p>
          )}
        </div>
      )}

      {/* People */}
      <p className="text-[10px] tracking-[0.113em] text-[#6B6B6B] mb-4">EVERY ACCOUNT · {people.length}</p>

      {people.length === 0 ? (
        <p className="text-[10px] tracking-[0.09em] text-[#C9C7C2]">NO ACCOUNTS YET.</p>
      ) : (
        <div className="space-y-4">
          {people.map((p) => (
            <PersonCard key={p.userId} person={p} />
          ))}
        </div>
      )}
    </div>
  )
}

function PersonCard({ person: p }: { person: PersonActivity }) {
  const quiet = p.totals.saves === 0 && p.totals.clicks === 0 && p.totals.likes === 0

  return (
    <div className="bg-white border border-[#E2E0DB] rounded-[14px] p-6">
      <div className="flex flex-wrap items-start justify-between gap-4 mb-5">
        <div className="min-w-0">
          <p className="text-[12px] tracking-[0.054em] text-[#0A0A0A] break-all">{p.email.toUpperCase()}</p>
          <p className="text-[9px] tracking-[0.09em] text-[#A8A8A4] mt-1.5">
            JOINED {fmtDate(p.createdAt)} · LAST ACTIVE {ago(p.lastActiveAt)}
            {p.ageRange ? ` · ${p.ageRange.toUpperCase()}` : ''}
          </p>
          {p.brandGroups.length > 0 && (
            <p className="text-[9px] tracking-[0.054em] text-[#C9C7C2] mt-1.5">
              PICKED AT SIGN-UP: {p.brandGroups.join(' · ').toUpperCase()}
            </p>
          )}
        </div>
        <div className="flex items-center gap-6 flex-shrink-0">
          <Tally label="SAVED" value={p.totals.saves} />
          <Tally label="LIKED" value={p.totals.likes} />
          <Tally label="CLICKED OUT" value={p.totals.clicks} highlight />
        </div>
      </div>

      {quiet ? (
        <p className="text-[9px] tracking-[0.09em] text-[#C9C7C2]">
          SIGNED UP, NOTHING RECORDED SINCE.
        </p>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-4 gap-6">
          <RefList title="CLICKED THROUGH TO RETAILER" rows={p.clicks} empty="NO CLICK-THROUGHS" withDate />
          <RefList title="SAVED OUTFITS" rows={p.savedOutfits} empty="NONE SAVED" withDate />
          <RefList title="SAVED ITEMS" rows={p.savedItems} empty="NONE SAVED" withDate />
          <div className="space-y-5">
            <RefList title="LIKED AT SIGN-UP" rows={p.likedOutfits} empty="NONE" />
            {p.dislikedOutfits.length > 0 && (
              <RefList title="DISLIKED AT SIGN-UP" rows={p.dislikedOutfits} empty="NONE" muted />
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function AnonymousCard({ visitor: v }: { visitor: AnonymousVisitor }) {
  return (
    <div className="bg-white border border-[#E2E0DB] rounded-[12px] p-5">
      <div className="flex items-baseline justify-between gap-3 mb-4">
        {/* A short prefix is enough to tell two browsers apart on screen. */}
        <p className="font-mono text-[10px] text-[#A8A8A4]">VISITOR {v.visitorId.slice(0, 8)}</p>
        <p className="text-[9px] tracking-[0.09em] text-[#4A4E57]">
          {v.clicks.length} CLICK{v.clicks.length === 1 ? '' : 'S'}
        </p>
      </div>
      <RefList title="CLICKED THROUGH TO RETAILER" rows={v.clicks} empty="—" withDate />
      <p className="text-[8px] tracking-[0.09em] text-[#C9C7C2] mt-3">
        FIRST SEEN {fmtDate(v.firstSeen)} · LAST {ago(v.lastSeen)}
      </p>
    </div>
  )
}

function Tally({ label, value, highlight = false }: { label: string; value: number; highlight?: boolean }) {
  return (
    <div className="text-center">
      <p
        className="text-[22px] leading-none tracking-[0.02em]"
        style={{ color: value === 0 ? INK.faint : highlight && value > 0 ? SERIES[1] : INK.body }}
      >
        {value}
      </p>
      <p className="text-[8px] tracking-[0.14em] text-[#A8A8A4] mt-1.5">{label}</p>
    </div>
  )
}

const MAX_ROWS = 8

function RefList({
  title,
  rows,
  empty,
  withDate = false,
  muted = false,
}: {
  title: string
  rows: Ref[]
  empty: string
  withDate?: boolean
  muted?: boolean
}) {
  return (
    <div>
      <p className="text-[9px] tracking-[0.14em] text-[#A8A8A4] mb-3">{title}</p>
      {rows.length === 0 ? (
        <p className="text-[9px] tracking-[0.09em] text-[#C9C7C2]">{empty}</p>
      ) : (
        <div className="space-y-2">
          {rows.slice(0, MAX_ROWS).map((r, i) => (
            <div key={`${r.id}-${i}`} className="flex items-center gap-2.5">
              {r.image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={r.image}
                  alt=""
                  className="w-8 h-10 object-cover rounded-[3px] flex-shrink-0 bg-[#F2F2F0]"
                />
              ) : (
                <span className="w-8 h-10 rounded-[3px] bg-[#F2F2F0] flex-shrink-0" aria-hidden />
              )}
              <span className="min-w-0">
                <span
                  className="block text-[10px] tracking-[0.027em] truncate"
                  style={{ color: muted ? INK.faint : INK.body }}
                >
                  {r.label}
                </span>
                {withDate && r.at && (
                  <span className="block text-[8px] tracking-[0.09em] text-[#C9C7C2] mt-0.5">{fmtDate(r.at)}</span>
                )}
              </span>
            </div>
          ))}
          {rows.length > MAX_ROWS && (
            <p className="text-[9px] tracking-[0.09em] text-[#C9C7C2] pt-1">+{rows.length - MAX_ROWS} MORE</p>
          )}
        </div>
      )}
    </div>
  )
}

function Figure({
  label,
  value,
  note,
  big = false,
  tone,
}: {
  label: string
  value: string
  note?: string
  big?: boolean
  tone?: string
}) {
  return (
    <div className="bg-white border border-[#E2E0DB] rounded-[12px] p-5">
      <p className="text-[9px] tracking-[0.14em] text-[#A8A8A4] mb-2">{label}</p>
      <p className="tracking-[0.02em] leading-none" style={{ fontSize: big ? 30 : 24, color: tone ?? INK.body }}>
        {value}
      </p>
      {note && <p className="text-[9px] tracking-[0.054em] text-[#C9C7C2] mt-2">{note}</p>}
    </div>
  )
}
