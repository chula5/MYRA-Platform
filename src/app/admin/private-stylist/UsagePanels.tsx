'use client'

// WHAT SHE DID WITH IT — pieces, brands, searches, emails, retention.
//
// The numbers above this say whether she came. These say what she did once
// she was there, by name: the brands she clicked through to, the pieces she
// opened and saved, the words she searched with, which emails brought her
// back, and — week by week — whether she keeps coming.

import { useEffect, useState } from 'react'
import { loadUsage } from './journey-actions'
import { SERIES, STATUS } from '@/components/admin/charts/palette'
import { fmtNumber, fmtPct } from '@/components/admin/charts/format'
import type { JourneyUsage, UsageRank, UsageRow } from '@/lib/journey-usage'

const day = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }).toUpperCase() : '—'
const stamp = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).toUpperCase()

export default function UsagePanels({
  memberId, days, onPick,
}: {
  memberId: string
  days: number
  onPick: (id: string) => void
}) {
  const [data, setData] = useState<JourneyUsage | null>(null)
  const [error, setError] = useState<string | null>(null)
  const everyone = !memberId

  useEffect(() => {
    let live = true
    setError(null)
    loadUsage(memberId || null, days)
      .then((d) => { if (live) setData(d) })
      .catch((e) => { if (live) setError(e instanceof Error ? e.message : String(e)) })
    return () => { live = false }
  }, [memberId, days])

  if (error) return <p className="text-[20px] tracking-[0.1em] text-[#B83A3A]">COULD NOT READ WHAT SHE DID — {error.toUpperCase()}</p>
  if (!data) return <p className="text-[20px] tracking-[0.1em] text-[#A8A8A4]">READING WHAT SHE DID…</p>

  return (
    <div className="space-y-6">
      <Retention data={data} everyone={everyone} onPick={onPick} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Box title="BRANDS SHE CLICKED THROUGH TO" note={`${fmtNumber(data.clickTotal)} CLICKS TO A RETAILER · FROM THE OUTBOUND LOG`}>
          <Ranks rows={data.clickedBrands} colour={SERIES[2]} empty="NO CLICK-THROUGHS IN THIS WINDOW" />
        </Box>
        <Box title="BRANDS SHE OPENED" note="PIECES OPENED, BY BRAND">
          <Ranks rows={data.openedBrands} colour={SERIES[0]} empty="NO PIECES OPENED YET" />
        </Box>
        <Box title="BRANDS SHE SAVED" note="SAVED IN HER ROOMS OR FROM THE MIRROR">
          <Ranks rows={data.savedBrands} colour={SERIES[1]} empty="NOTHING SAVED IN THIS WINDOW" />
        </Box>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Box title="PIECES SHE CLICKED THROUGH TO" note="EACH CLICK TO A RETAILER, BY PIECE">
          <Pieces rows={data.clickedPieces} everyone={everyone} empty="SHE HAS NOT LEFT FOR A RETAILER IN THIS WINDOW" />
        </Box>
        <Box title="PIECES SHE OPENED" note="A PIECE PAGE OR ITS WAYS TO WEAR">
          <Pieces rows={data.openedPieces} everyone={everyone} empty="NO PIECES OPENED YET — RECORDED FROM 21 OCT 2026" />
        </Box>
        <Box title="PIECES SHE SAVED" note="NEWEST SAVE LAST SEEN">
          <Pieces rows={data.savedPieces} everyone={everyone} empty="NOTHING SAVED IN THIS WINDOW" />
        </Box>
        <Box title="LOOKS SHE OPENED" note="BY THE OCCASION THEY WERE STYLED FOR">
          <Pieces rows={data.openedLooks} everyone={everyone} empty="NO LOOKS OPENED YET — RECORDED FROM 21 OCT 2026" />
        </Box>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Box title="WHAT SHE SEARCHED FOR AND ASKED" note="HER OWN WORDS · NEWEST FIRST">
          {!data.searches.length && <Empty>NO SEARCHES OR QUESTIONS IN THIS WINDOW</Empty>}
          <div className="max-h-[520px] overflow-y-auto" data-lenis-prevent>
            {data.searches.map((s, i) => (
              <div key={`${s.at}-${i}`} className="py-3 border-b border-[#F2F2F0] last:border-0">
                <p className="text-[20px] tracking-[0.02em] text-[#0A0A0A] normal-case">“{s.text}”</p>
                <p className="text-[20px] tracking-[0.06em] text-[#A8A8A4] mt-1">
                  {s.kind === 'question' ? 'ASKED' : 'SEARCHED'} · {stamp(s.at)}{everyone && s.member ? ` · ${s.member.toUpperCase()}` : ''}
                </p>
              </div>
            ))}
          </div>
        </Box>
        <Emails data={data} everyone={everyone} />
      </div>
    </div>
  )
}

// ── Retention ───────────────────────────────────────────────────────────────

function Retention({ data, everyone, onPick }: { data: JourneyUsage; everyone: boolean; onPick: (id: string) => void }) {
  const r = data.retention
  const max = Math.max(1, ...r.members.flatMap((m) => m.weeks))
  const rate = (n: number) => (r.everVisited ? fmtPct(n / r.everVisited, 0) : '—')

  return (
    <Box title="RETENTION" note="ALL TIME — WHETHER SHE KEEPS COMING BACK, NOT JUST THIS WINDOW">
      {everyone && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
          <Fact label="HAVE A LOGIN" value={fmtNumber(r.withLogin)} />
          <Fact label="EVER CAME IN" value={fmtNumber(r.everVisited)} sub={r.withLogin ? `${fmtPct(r.everVisited / r.withLogin, 0)} OF LOGINS` : undefined} />
          <Fact label="CAME BACK ANOTHER DAY" value={fmtNumber(r.cameBack)} sub={`${rate(r.cameBack)} OF THOSE WHO CAME`} />
          <Fact label="ACTIVE LAST 7 DAYS" value={fmtNumber(r.active7)} sub={`${rate(r.active7)} OF THOSE WHO CAME`} />
          <Fact label="ACTIVE LAST 30 DAYS" value={fmtNumber(r.active30)} sub={`${rate(r.active30)} OF THOSE WHO CAME`} />
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px]">
          <thead>
            <tr className="border-b border-[#E2E0DB]">
              <th className="text-left text-[20px] tracking-[0.1em] text-[#A8A8A4] font-normal pb-3">MEMBER</th>
              {r.weekLabels.map((w) => (
                <th key={w} className="text-center text-[20px] tracking-[0.06em] text-[#A8A8A4] font-normal pb-3">{w}</th>
              ))}
              <th className="text-right text-[20px] tracking-[0.1em] text-[#A8A8A4] font-normal pb-3">DAYS IN</th>
              <th className="text-right text-[20px] tracking-[0.1em] text-[#A8A8A4] font-normal pb-3">FIRST · LAST</th>
            </tr>
          </thead>
          <tbody>
            {r.members.map((m) => (
              <tr key={m.memberId} className="border-b border-[#F2F2F0] last:border-0">
                <td className="py-3 pr-4">
                  <button onClick={() => onPick(m.memberId)} className="text-[20px] tracking-[0.06em] text-[#0A0A0A] hover:text-[#7C838B] transition-colors text-left">
                    {m.name.toUpperCase()}
                  </button>
                </td>
                {m.weeks.map((n, i) => (
                  <td key={i} className="py-3 px-1 text-center">
                    {/* A filled square is a week she came; its depth is how often. */}
                    <span
                      title={`${n} visit${n === 1 ? '' : 's'}`}
                      className="inline-flex items-center justify-center w-11 h-11 text-[18px]"
                      style={{
                        background: n ? SERIES[0] : '#F2F2F0',
                        opacity: n ? 0.35 + 0.65 * (n / max) : 1,
                        color: n ? '#FFFFFF' : '#C9C7C2',
                      }}
                    >
                      {n || '·'}
                    </span>
                  </td>
                ))}
                <td className="py-3 text-right text-[20px] tracking-[0.05em] text-[#4A4E57]">{fmtNumber(m.daysActive)}</td>
                <td className="py-3 text-right text-[20px] tracking-[0.05em] text-[#4A4E57]">
                  {m.firstVisit ? `${day(m.firstVisit)} · ${day(m.lastVisit)}` : 'NEVER CAME IN'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[20px] tracking-[0.06em] text-[#C9C7C2] mt-4">
        VISITS PER WEEK, LAST EIGHT WEEKS · A VISIT ENDS AFTER 30 MINUTES AWAY (FROM 21 OCT 2026; BEFORE THAT THE IPHONE APP COUNTED A RETURN AS THE SAME VISIT)
      </p>
    </Box>
  )
}

// ── Emails ──────────────────────────────────────────────────────────────────

function Emails({ data, everyone }: { data: JourneyUsage; everyone: boolean }) {
  return (
    <Box title="CLICK-THROUGHS FROM EMAILS" note="SENT IN THIS WINDOW, AND HOW MANY SHE FOLLOWED · TRACKED FROM 21 OCT 2026">
      {!data.emails.length && <Empty>NO MEMBER EMAILS IN THIS WINDOW</Empty>}
      {data.emails.map((e) => (
        <div key={e.kind} className="flex items-baseline justify-between gap-4 py-3 border-b border-[#F2F2F0] last:border-0">
          <p className="text-[20px] tracking-[0.06em] text-[#0A0A0A]">{e.label}</p>
          <p className="text-[20px] tracking-[0.05em] text-[#4A4E57] text-right">
            {fmtNumber(e.sent)} SENT · <span style={{ color: e.clicks ? STATUS.good : undefined }}>{fmtNumber(e.clicks)} CLICKED</span>
            {e.scannerClicks ? <span className="text-[#C9C7C2]"> · {e.scannerClicks} BY A MAIL SCANNER</span> : null}
          </p>
        </div>
      ))}
      {data.emailClicksRecent.length > 0 && (
        <div className="mt-5">
          <p className="text-[20px] tracking-[0.12em] text-[#6B6B6B] mb-2">LATEST CLICKS</p>
          {data.emailClicksRecent.map((c, i) => (
            <p key={`${c.at}-${i}`} className="text-[20px] tracking-[0.05em] text-[#4A4E57] py-2 border-b border-[#F2F2F0] last:border-0">
              {stamp(c.at)} · {c.label}{everyone && c.member ? ` · ${c.member.toUpperCase()}` : ''}
              <span className="text-[#A8A8A4]"> → {c.target.replace(/^https?:\/\/(www\.)?/, '').slice(0, 60)}</span>
            </p>
          ))}
        </div>
      )}
    </Box>
  )
}

// ── Shared ──────────────────────────────────────────────────────────────────

function Box({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <div className="border border-[#E2E0DB] p-6">
      <p className="text-[20px] tracking-[0.14em] text-[#6B6B6B]">{title}</p>
      {note && <p className="text-[20px] tracking-[0.06em] text-[#C9C7C2] mt-1 mb-5">{note}</p>}
      {children}
    </div>
  )
}

function Fact({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="border border-[#F2F2F0] px-4 py-3">
      <p className="text-[20px] tracking-[0.1em] text-[#A8A8A4]">{label}</p>
      <p className="text-[30px] tracking-[0.02em] text-[#0A0A0A] mt-1 leading-none">{value}</p>
      {sub && <p className="text-[20px] tracking-[0.06em] text-[#A8A8A4] mt-2">{sub}</p>}
    </div>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-[20px] tracking-[0.08em] text-[#7C838B]">{children}</p>
}

function Ranks({ rows, colour, empty }: { rows: UsageRank[]; colour: string; empty: string }) {
  if (!rows.length) return <Empty>{empty}</Empty>
  const max = Math.max(...rows.map((r) => r.value))
  return (
    <div className="space-y-3">
      {rows.map((r) => (
        <div key={r.label}>
          <div className="flex justify-between gap-3">
            <p className="text-[20px] tracking-[0.06em] text-[#0A0A0A] truncate">{r.label}</p>
            <p className="text-[20px] tracking-[0.05em] text-[#4A4E57]">{fmtNumber(r.value)}</p>
          </div>
          <div className="h-[6px] bg-[#F2F2F0] mt-1.5">
            <div className="h-full" style={{ width: `${(r.value / max) * 100}%`, background: colour }} />
          </div>
        </div>
      ))}
    </div>
  )
}

function Pieces({ rows, everyone, empty }: { rows: UsageRow[]; everyone: boolean; empty: string }) {
  if (!rows.length) return <Empty>{empty}</Empty>
  return (
    <div className="max-h-[520px] overflow-y-auto" data-lenis-prevent>
      {rows.map((r) => (
        <div key={r.key} className="flex items-baseline justify-between gap-4 py-3 border-b border-[#F2F2F0] last:border-0">
          <div className="min-w-0">
            <p className="text-[20px] tracking-[0.04em] text-[#0A0A0A] truncate">{r.label.toUpperCase()}</p>
            <p className="text-[20px] tracking-[0.05em] text-[#A8A8A4] mt-1">
              LAST {day(r.last)}{everyone && r.who?.length ? ` · ${r.who.map((w) => w.toUpperCase()).join(', ')}` : ''}
            </p>
          </div>
          <p className="text-[20px] tracking-[0.05em] text-[#4A4E57] shrink-0">×{fmtNumber(r.value)}</p>
        </div>
      ))}
    </div>
  )
}
