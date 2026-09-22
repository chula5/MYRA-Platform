'use client'

// THE JOURNEY.
//
// The pilot has always measured its own side — looks composed, looks sent,
// verdicts collected. This is the other half: whether she opened the app at
// all, how long she stayed, which rooms she walked into, what she touched, and
// what she left for a retailer.
//
// The numbers here are the same ones the admin dashboard tracks for the public
// site, asked of one member instead of a population. That is deliberate: a
// pilot of three people cannot be read as a funnel, so every aggregate on this
// page can be opened down to the individual visit that produced it — and every
// visit can be watched back.
//
// EVERY ZERO ON THIS PAGE MEANS ONE OF THREE THINGS, and they are not the same:
//   · the migration has not been run          → the banner says so
//   · she has no login yet                    → the member row says so
//   · she has a login and has not come back   → that is the finding
// A dashboard that renders all three as "0" is worse than no dashboard, so each
// is spelled out where it applies.

import { useEffect, useMemo, useState } from 'react'
import { loadJourney } from './journey-actions'
import JourneyReplay from './JourneyReplay'
import { fmtDuration, type JourneyOverview, type JourneySessionSummary } from '@/lib/journey'
import { INK, SERIES, STATUS } from '@/components/admin/charts/palette'
import { fmtNumber, fmtPct } from '@/components/admin/charts/format'

const WINDOWS = [7, 30, 90] as const

export default function JourneyTab({
  members,
  memberId,
  setMemberId,
}: {
  members: { member_id: string; name: string }[]
  memberId: string
  setMemberId: (id: string) => void
}) {
  const [days, setDays] = useState<(typeof WINDOWS)[number]>(30)
  const [data, setData] = useState<JourneyOverview | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [watching, setWatching] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    setLoading(true)
    setError(null)
    loadJourney(memberId || null, days)
      .then((d) => { if (live) setData(d) })
      .catch((e) => { if (live) setError(e instanceof Error ? e.message : String(e)) })
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [memberId, days])

  const everyone = !memberId
  const selected = members.find((m) => m.member_id === memberId)
  const memberRow = data?.members.find((m) => m.memberId === memberId)

  return (
    <div className="space-y-8">
      {/* ── Who and over what window ───────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex gap-1.5 flex-wrap">
          <Chip label="EVERYONE" active={everyone} onClick={() => setMemberId('')} />
          {members.map((m) => (
            <Chip
              key={m.member_id}
              label={m.name.toUpperCase()}
              active={memberId === m.member_id}
              onClick={() => setMemberId(m.member_id)}
            />
          ))}
        </div>
        <div className="flex gap-1.5">
          {WINDOWS.map((d) => (
            <Chip key={d} label={`${d} DAYS`} active={days === d} onClick={() => setDays(d)} />
          ))}
        </div>
      </div>

      {error && (
        <p className="text-[20px] tracking-[0.1em] text-[#B83A3A]">
          COULD NOT LOAD THE JOURNEY — {error.toUpperCase()}
        </p>
      )}

      {data && !data.available && (
        <div className="border border-[#B83A3A] px-5 py-4">
          <p className="text-[20px] tracking-[0.1em] text-[#B83A3A]">
            MIGRATION 0063_CLIENT_JOURNEY.SQL HAS NOT BEEN RUN — RUN IT IN SUPABASE, THEN RELOAD.
          </p>
          <p className="text-[20px] tracking-[0.06em] text-[#6B6B6B] mt-2 leading-relaxed">
            Nothing is being recorded until it is. Her visits from before the migration cannot be
            recovered — this page starts counting from the moment the table exists.
          </p>
        </div>
      )}

      {loading && !data && (
        <p className="text-[20px] tracking-[0.1em] text-[#A8A8A4]">READING HER VISITS…</p>
      )}

      {data?.available && (
        <>
          {/* A member with no login has nothing to measure, and saying "0 visits"
              about her would read as disinterest rather than as plumbing. */}
          {memberRow && !memberRow.hasLogin && (
            <div className="border border-[#C4A882] px-5 py-4">
              <p className="text-[20px] tracking-[0.1em] text-[#C4A882]">
                {memberRow.name.toUpperCase()} HAS NO LOGIN YET — THERE IS NOTHING FOR HER TO OPEN.
              </p>
              <p className="text-[20px] tracking-[0.06em] text-[#6B6B6B] mt-2">
                SEND HER AN INVITE FROM HER VIEW, AND THIS PAGE STARTS FILLING FROM HER FIRST VISIT.
              </p>
            </div>
          )}

          <Headline data={data} everyone={everyone} name={selected?.name} />
          <VisitChart daily={data.daily} />

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <Panel title="ROOMS SHE WALKED INTO" note="EVERY OPEN, NOT EVERY MINUTE">
              <Bars rows={data.rooms} colour={SERIES[0]} empty="SHE HAS NOT OPENED A ROOM YET" />
            </Panel>
            <Panel title="WHAT SHE TAPPED" note="HER OWN WORDS FOR IT, WHERE THE PAGE GIVES ONE">
              <Bars rows={data.taps} colour={SERIES[1]} empty="NOTHING TAPPED YET" />
            </Panel>
            <Panel
              title="CLICKED THROUGH TO"
              note={`${fmtNumber(data.totals.retailerClicks)} IN THE OUTBOUND LOG`}
            >
              <Bars rows={data.clickOuts} colour={SERIES[2]} empty="SHE HAS NOT LEFT FOR A RETAILER YET" />
            </Panel>
          </div>

          {everyone && data.perMember.length > 1 && <MemberTable rows={data.perMember} onPick={setMemberId} />}

          <Visits
            sessions={data.sessions}
            everyone={everyone}
            onWatch={setWatching}
          />
        </>
      )}

      {watching && <JourneyReplay sessionId={watching} onClose={() => setWatching(null)} />}
    </div>
  )
}

// ── Headline numbers ────────────────────────────────────────────────────────

function Headline({ data, everyone, name }: { data: JourneyOverview; everyone: boolean; name?: string }) {
  const t = data.totals
  const who = everyone ? 'THE PILOT' : (name ?? '').toUpperCase()
  // Visits per active day says something a raw count cannot: whether she opens
  // it once and stays, or dips in repeatedly.
  const perDay = t.daysActive ? Math.round((t.sessions / t.daysActive) * 10) / 10 : 0

  return (
    <div>
      <p className="text-[20px] tracking-[0.14em] text-[#6B6B6B] mb-4">
        {who} · LAST {data.days} DAYS
      </p>
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
        <Stat
          label="TIMES SHE OPENED IT"
          value={fmtNumber(t.sessions)}
          sub={t.daysActive ? `${perDay} A DAY SHE CAME` : 'NOT YET'}
          delta={data.deltas.sessions}
        />
        <Stat
          label="TIME ON THE APP"
          value={fmtDuration(t.activeMs)}
          sub="WHILE THE TAB WAS IN FRONT OF HER"
          delta={data.deltas.activeMs}
        />
        <Stat
          label="AVERAGE VISIT"
          value={fmtDuration(t.avgActiveMs)}
          sub={`MEDIAN ${fmtDuration(t.medianActiveMs)}`}
        />
        <Stat
          label="DAYS SHE CAME BACK"
          value={fmtNumber(t.daysActive)}
          sub={`OF ${data.days} · ${fmtPct(t.daysActive / data.days, 0)}`}
        />
        <Stat
          label="THINGS SHE TAPPED"
          value={fmtNumber(t.actions)}
          sub={`${t.roomsPerSession} ROOMS A VISIT`}
        />
        <Stat
          label="CLICKED THROUGH"
          value={fmtNumber(t.clickOuts)}
          sub="LEFT FOR A RETAILER"
          delta={data.deltas.clickOuts}
          tone={t.clickOuts > 0 ? 'good' : undefined}
        />
      </div>

      {/* The three that matter most on the exit artefact get a line of their
          own rather than a seventh tile competing with the headline six. */}
      <p className="text-[20px] tracking-[0.06em] text-[#6B6B6B] mt-4 leading-relaxed">
        {fmtNumber(t.looksOpened)} LOOKS OPENED · {fmtNumber(t.searches)} SEARCHES ·{' '}
        {fmtNumber(t.questions)} QUESTIONS ASKED · {fmtNumber(t.recordings)} OF {fmtNumber(t.sessions)} VISITS RECORDED
      </p>
    </div>
  )
}

function Stat({
  label, value, sub, delta, tone,
}: {
  label: string
  value: string
  sub?: string
  delta?: number | null
  tone?: keyof typeof STATUS
}) {
  return (
    <div className="border border-[#E2E0DB] p-5">
      <p className="text-[20px] tracking-[0.12em] text-[#6B6B6B] mb-3">{label}</p>
      <p className="text-[30px] tracking-[0.02em] leading-none" style={{ color: tone ? STATUS[tone] : INK.body }}>
        {value}
      </p>
      <div className="mt-3 space-y-1">
        {delta !== undefined && <Delta delta={delta ?? null} />}
        {sub && <p className="text-[20px] tracking-[0.06em] text-[#A8A8A4]">{sub}</p>}
      </div>
    </div>
  )
}

/** Period-over-period change. The arrow and the number carry the meaning; the
 *  colour only reinforces it, never stands alone. */
function Delta({ delta }: { delta: number | null }) {
  if (delta === null || !Number.isFinite(delta)) {
    return <p className="text-[20px] tracking-[0.08em] text-[#C9C7C2]">NO PRIOR PERIOD</p>
  }
  const up = delta > 0
  const flat = Math.abs(delta) < 0.0001
  const colour = flat ? STATUS.neutral : up ? STATUS.good : STATUS.critical
  return (
    <p className="text-[20px] tracking-[0.06em]" style={{ color: colour }}>
      {flat ? '→' : up ? '↑' : '↓'} {fmtPct(Math.abs(delta), 0)} ON THE PERIOD BEFORE
    </p>
  )
}

// ── Visits per day ──────────────────────────────────────────────────────────

/**
 * Bars for visits, a line for minutes. Two units on one frame is normally a
 * mistake, but here the second series is the SHAPE of the first — whether more
 * visits meant more time or just more dipping in — and separating them into two
 * charts makes that comparison a memory test.
 */
function VisitChart({ daily }: { daily: JourneyOverview['daily'] }) {
  const maxSessions = Math.max(1, ...daily.map((d) => d.sessions))
  const maxMinutes = Math.max(1, ...daily.map((d) => d.activeMinutes))
  const totalSessions = daily.reduce((a, d) => a + d.sessions, 0)

  if (!totalSessions) {
    return (
      <div className="border border-[#E2E0DB] p-6">
        <p className="text-[20px] tracking-[0.14em] text-[#6B6B6B] mb-3">WHEN SHE CAME</p>
        <p className="text-[20px] tracking-[0.08em] text-[#7C838B]">
          NO VISITS IN THIS WINDOW. WIDEN IT, OR CHECK SHE HAS A LOGIN.
        </p>
      </div>
    )
  }

  const H = 150
  const points = daily.map((d, i) => {
    const x = daily.length > 1 ? (i / (daily.length - 1)) * 1000 : 500
    const y = H - (d.activeMinutes / maxMinutes) * (H - 14) - 7
    return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')

  // Enough labels to orient, never so many they collide.
  const step = Math.max(1, Math.ceil(daily.length / 10))

  return (
    <div className="border border-[#E2E0DB] p-6">
      <div className="flex items-baseline justify-between gap-4 flex-wrap mb-5">
        <p className="text-[20px] tracking-[0.14em] text-[#6B6B6B]">WHEN SHE CAME</p>
        <p className="text-[20px] tracking-[0.06em] text-[#A8A8A4]">
          <span style={{ color: SERIES[0] }}>▌</span> VISITS ·{' '}
          <span style={{ color: SERIES[1] }}>—</span> MINUTES ON THE APP
        </p>
      </div>

      <svg viewBox={`0 0 1000 ${H}`} className="w-full" style={{ height: H }} preserveAspectRatio="none" role="img" aria-label="Visits and minutes per day">
        {daily.map((d, i) => {
          const w = 1000 / daily.length
          const h = (d.sessions / maxSessions) * (H - 14)
          return (
            <rect
              key={d.key}
              x={i * w + 1}
              y={H - h}
              width={Math.max(1, w - 2)}
              height={h}
              fill={SERIES[0]}
              opacity={d.sessions ? 0.85 : 0}
            >
              <title>{`${d.label}: ${d.sessions} visit${d.sessions === 1 ? '' : 's'}, ${d.activeMinutes} min, ${d.actions} taps`}</title>
            </rect>
          )
        })}
        <path d={points} fill="none" stroke={SERIES[1]} strokeWidth={2} vectorEffect="non-scaling-stroke" />
      </svg>

      <div className="flex justify-between mt-2">
        {daily.filter((_, i) => i % step === 0).map((d) => (
          <span key={d.key} className="text-[20px] tracking-[0.06em] text-[#C9C7C2]">{d.label}</span>
        ))}
      </div>
    </div>
  )
}

// ── Rankings ────────────────────────────────────────────────────────────────

function Panel({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <div className="border border-[#E2E0DB] p-6">
      <p className="text-[20px] tracking-[0.14em] text-[#6B6B6B] mb-1">{title}</p>
      {note && <p className="text-[20px] tracking-[0.06em] text-[#C9C7C2] mb-4">{note}</p>}
      <div className={note ? '' : 'mt-4'}>{children}</div>
    </div>
  )
}

function Bars({
  rows, colour, empty,
}: {
  rows: { label: string; value: number }[]
  colour: string
  empty: string
}) {
  if (!rows.length) return <p className="text-[20px] tracking-[0.08em] text-[#C9C7C2]">{empty}</p>
  const max = Math.max(1, ...rows.map((r) => r.value))
  return (
    <div className="space-y-3">
      {rows.map((r) => (
        <div key={r.label}>
          <div className="flex items-baseline justify-between gap-3 mb-1">
            <span className="text-[20px] tracking-[0.05em] text-[#4A4E57] truncate">{r.label}</span>
            <span className="text-[20px] tracking-[0.04em] text-[#0A0A0A] shrink-0">{fmtNumber(r.value)}</span>
          </div>
          <div className="h-[6px] bg-[#F2F2F0] overflow-hidden">
            <div className="h-full" style={{ width: `${Math.max(2, (r.value / max) * 100)}%`, background: colour }} />
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Member comparison ───────────────────────────────────────────────────────

function MemberTable({
  rows, onPick,
}: {
  rows: JourneyOverview['perMember']
  onPick: (id: string) => void
}) {
  return (
    <div className="border border-[#E2E0DB] p-6">
      <p className="text-[20px] tracking-[0.14em] text-[#6B6B6B] mb-5">MEMBER BY MEMBER</p>
      <table className="w-full">
        <thead>
          <tr className="border-b border-[#E2E0DB]">
            {['MEMBER', 'VISITS', 'DAYS', 'TIME ON THE APP', 'TAPS', 'CLICKED THROUGH', 'LAST SEEN'].map((h, i) => (
              <th
                key={h}
                className={`text-[20px] tracking-[0.1em] text-[#A8A8A4] font-normal pb-3 ${i ? 'text-right' : 'text-left'}`}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.memberId} className="border-b border-[#F2F2F0] last:border-0">
              <td className="py-3">
                <button
                  onClick={() => onPick(r.memberId)}
                  className="text-[20px] tracking-[0.06em] text-[#0A0A0A] hover:text-[#C4A882] transition-colors"
                >
                  {r.name.toUpperCase()}
                </button>
              </td>
              <Cell>{fmtNumber(r.sessions)}</Cell>
              <Cell>{fmtNumber(r.daysActive)}</Cell>
              <Cell>{fmtDuration(r.activeMs)}</Cell>
              <Cell>{fmtNumber(r.actions)}</Cell>
              <Cell>{fmtNumber(r.clickOuts)}</Cell>
              <Cell>
                {r.lastSeenAt
                  ? new Date(r.lastSeenAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }).toUpperCase()
                  : 'NEVER'}
              </Cell>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Cell({ children }: { children: React.ReactNode }) {
  return <td className="py-3 text-right text-[20px] tracking-[0.05em] text-[#4A4E57]">{children}</td>
}

// ── The visits themselves ───────────────────────────────────────────────────

function Visits({
  sessions, everyone, onWatch,
}: {
  sessions: JourneySessionSummary[]
  everyone: boolean
  onWatch: (id: string) => void
}) {
  const [limit, setLimit] = useState(15)
  const shown = useMemo(() => sessions.slice(0, limit), [sessions, limit])

  return (
    <div className="border border-[#E2E0DB] p-6">
      <div className="flex items-baseline justify-between gap-4 flex-wrap mb-1">
        <p className="text-[20px] tracking-[0.14em] text-[#6B6B6B]">EVERY VISIT</p>
        <p className="text-[20px] tracking-[0.06em] text-[#C9C7C2]">NEWEST FIRST</p>
      </div>
      <p className="text-[20px] tracking-[0.06em] text-[#C9C7C2] mb-5">
        WATCH PLAYS THE VISIT BACK — HER SCREEN WHERE IT WAS RECORDED, THE TIMELINE ALWAYS
      </p>

      {!sessions.length && (
        <p className="text-[20px] tracking-[0.08em] text-[#7C838B]">NO VISITS IN THIS WINDOW.</p>
      )}

      <div className="space-y-px">
        {shown.map((s) => (
          <div
            key={s.sessionId}
            className="flex items-center justify-between gap-5 flex-wrap py-4 border-b border-[#F2F2F0] last:border-0"
          >
            <div className="min-w-0">
              <p className="text-[20px] tracking-[0.06em] text-[#0A0A0A]">
                {everyone && <span className="text-[#C4A882]">{s.memberName.toUpperCase()} · </span>}
                {new Date(s.startedAt).toLocaleString('en-GB', {
                  weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
                })}
                {!s.isReturning && <span className="text-[#C4A882]"> · FIRST EVER VISIT</span>}
              </p>
              <p className="text-[20px] tracking-[0.05em] text-[#6B6B6B] mt-1">
                {fmtDuration(s.activeMs)} ON THE APP · {s.actions} TAP{s.actions === 1 ? '' : 'S'} ·{' '}
                {s.rooms.length} ROOM{s.rooms.length === 1 ? '' : 'S'}
                {s.looksOpened ? ` · ${s.looksOpened} LOOKS OPENED` : ''}
                {s.clickOuts ? ` · ${s.clickOuts} CLICKED THROUGH` : ''}
                {s.questions ? ` · ${s.questions} ASKED` : ''}
                {s.device ? ` · ${s.device.toUpperCase()}` : ''}
              </p>
            </div>
            <button
              onClick={() => onWatch(s.sessionId)}
              className="text-[20px] tracking-[0.14em] text-[#0A0A0A] border border-[#0A0A0A] px-5 py-2 hover:bg-[#0A0A0A] hover:text-white transition-colors shrink-0"
            >
              {s.hasRecording ? 'WATCH' : 'TIMELINE'}
            </button>
          </div>
        ))}
      </div>

      {sessions.length > limit && (
        <button
          onClick={() => setLimit((l) => l + 25)}
          className="text-[20px] tracking-[0.12em] text-[#6B6B6B] hover:text-[#0A0A0A] transition-colors mt-5"
        >
          SHOW MORE ({sessions.length - limit} LEFT)
        </button>
      )}
    </div>
  )
}

// ── Shared ──────────────────────────────────────────────────────────────────

function Chip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`text-[20px] tracking-[0.1em] px-4 py-2 border transition-colors ${
        active ? 'border-[#0A0A0A] text-[#0A0A0A]' : 'border-[#E2E0DB] text-[#6B6B6B] hover:border-[#A8A8A4]'
      }`}
    >
      {label}
    </button>
  )
}
