'use client'

// SIGNING ON — the door in front of her rooms.
//
// Every number below this panel starts once she is inside /me. This is what
// happened before that: the invite opened, the code sent and never typed, the
// password that did not work, the email that was not the one on file. One
// line says where she has got to; the steps underneath say how.

import { useEffect, useState } from 'react'
import { loadSignOnView } from './journey-actions'
import { STATUS } from '@/components/admin/charts/palette'
import type { SignOnEvent, SignOnStatus } from '@/lib/sign-on'

const when = (iso: string | null, withTime = false) =>
  iso
    ? new Date(iso).toLocaleString('en-GB', withTime
      ? { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }
      : { day: 'numeric', month: 'short' }).toUpperCase()
    : null

export default function SignOnPanel({
  memberId,
  onPick,
}: {
  memberId: string
  onPick: (id: string) => void
}) {
  const [data, setData] = useState<{ members: SignOnStatus[]; unmatched: SignOnEvent[] } | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    setError(null)
    loadSignOnView(memberId || null)
      .then((d) => { if (live) setData(d) })
      .catch((e) => { if (live) setError(e instanceof Error ? e.message : String(e)) })
    return () => { live = false }
  }, [memberId])

  if (error) {
    return <p className="text-[20px] tracking-[0.1em] text-[#B83A3A]">COULD NOT READ SIGNING ON — {error.toUpperCase()}</p>
  }
  if (!data) return <p className="text-[20px] tracking-[0.1em] text-[#A8A8A4]">READING HOW SHE SIGNED ON…</p>

  const notRun = data.members.some((m) => !m.available)

  return (
    <div className="border border-[#E2E0DB] p-6">
      <div className="flex items-baseline justify-between gap-4 flex-wrap mb-1">
        <p className="text-[20px] tracking-[0.14em] text-[#6B6B6B]">SIGNING ON</p>
        <p className="text-[20px] tracking-[0.06em] text-[#C9C7C2]">ALL TIME — SHE ONLY DOES IT ONCE</p>
      </div>
      <p className="text-[20px] tracking-[0.06em] text-[#C9C7C2] mb-5">
        EVERYTHING BEFORE HER ROOMS — INVITE, CODE, PASSWORD, WELCOME, TOUR
      </p>

      {notRun && (
        <p className="text-[20px] tracking-[0.08em] text-[#B83A3A] mb-5">
          MIGRATION 0104_MEMBER_SIGN_ON.SQL HAS NOT BEEN RUN — STEPS AT THE DOOR ARE NOT BEING KEPT YET.
          HER LOGIN DATES BELOW ARE READ FROM HER ACCOUNT AND ARE TRUE EITHER WAY.
        </p>
      )}

      {memberId
        ? data.members[0] && <One m={data.members[0]} />
        : <Everyone rows={data.members} unmatched={data.unmatched} onPick={onPick} />}
    </div>
  )
}

// ── One member ──────────────────────────────────────────────────────────────

function One({ m }: { m: SignOnStatus }) {
  const facts: [string, string | null][] = [
    ['LOGIN MADE', when(m.loginMadeAt)],
    ['LAST SIGNED IN', m.hasLogin ? when(m.lastSignInAt) ?? 'NEVER' : null],
    ['WELCOME SEEN', when(m.welcomedAt)],
    ['IPHONE APP', when(m.appWelcomedAt)],
    ['TOUR FINISHED', when(m.touredAt)],
    ['FIRST VISIT', when(m.firstVisitAt)],
    ['LAST VISIT', when(m.lastVisitAt)],
  ]
  // The door matches on the email Chloe has. A login under another address is
  // the quiet reason a code "never arrives".
  const emailsDiffer = m.email && m.loginEmail && m.email.toLowerCase() !== m.loginEmail.toLowerCase()

  return (
    <div className="space-y-6">
      <p className="text-[26px] tracking-[0.08em]" style={{ color: m.stuck ? STATUS.critical : '#0A0A0A' }}>
        {m.stage}
      </p>

      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-4">
        {facts.map(([label, value]) => (
          <div key={label} className="border border-[#F2F2F0] px-4 py-3">
            <p className="text-[20px] tracking-[0.1em] text-[#A8A8A4]">{label}</p>
            <p className="text-[20px] tracking-[0.06em] mt-1" style={{ color: value ? '#0A0A0A' : '#C9C7C2' }}>
              {value ?? 'NOT YET'}
            </p>
          </div>
        ))}
      </div>

      <p className="text-[20px] tracking-[0.06em] text-[#6B6B6B]">
        EMAIL ON FILE {m.email ? m.email.toUpperCase() : '— NONE, SO A CODE CANNOT FIND HER'}
        {m.loginEmail && ` · LOGIN ${m.loginEmail.toUpperCase()}`}
        {emailsDiffer && <span style={{ color: STATUS.critical }}> · THEY DIFFER</span>}
      </p>

      <Steps events={m.events} showEmail />
    </div>
  )
}

function Steps({ events, showEmail, empty }: { events: SignOnEvent[]; showEmail?: boolean; empty?: string }) {
  if (!events.length) {
    return (
      <p className="text-[20px] tracking-[0.08em] text-[#7C838B]">
        {empty ?? 'NO STEPS AT THE DOOR RECORDED YET — THEY ARE KEPT FROM 21 OCT 2026.'}
      </p>
    )
  }
  return (
    <div>
      <p className="text-[20px] tracking-[0.12em] text-[#6B6B6B] mb-2">EVERY STEP · NEWEST FIRST</p>
      {events.map((e, i) => (
        <div key={`${e.at}-${i}`} className="flex gap-5 flex-wrap py-3 border-b border-[#F2F2F0] last:border-0">
          <p className="text-[20px] tracking-[0.05em] text-[#A8A8A4] w-[260px] shrink-0">{when(e.at, true)}</p>
          <p className="text-[20px] tracking-[0.06em]" style={{ color: e.ok ? '#0A0A0A' : STATUS.critical }}>
            {e.label}
            <span className="text-[#6B6B6B]">
              {e.detail ? ` · ${e.detail.toUpperCase()}` : ''}
              {showEmail && e.email ? ` · ${e.email.toUpperCase()}` : ''}
              {e.device ? ` · ${e.device.toUpperCase()}` : ''}
            </span>
          </p>
        </div>
      ))}
    </div>
  )
}

// ── Everyone ────────────────────────────────────────────────────────────────

function Everyone({
  rows, unmatched, onPick,
}: {
  rows: SignOnStatus[]
  unmatched: SignOnEvent[]
  onPick: (id: string) => void
}) {
  return (
    <div className="space-y-8">
      <table className="w-full">
        <thead>
          <tr className="border-b border-[#E2E0DB]">
            {['MEMBER', 'WHERE SHE IS', 'LOGIN MADE', 'LAST SIGNED IN', 'FIRST VISIT', 'LAST VISIT'].map((h, i) => (
              <th
                key={h}
                className={`text-[20px] tracking-[0.1em] text-[#A8A8A4] font-normal pb-3 ${i > 1 ? 'text-right' : 'text-left'}`}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.memberId} className="border-b border-[#F2F2F0] last:border-0 align-top">
              <td className="py-3 pr-4">
                <button
                  onClick={() => onPick(r.memberId)}
                  className="text-[20px] tracking-[0.06em] text-[#0A0A0A] hover:text-[#7C838B] transition-colors text-left"
                >
                  {r.name.toUpperCase()}
                </button>
              </td>
              <td className="py-3 pr-4 text-[20px] tracking-[0.05em]" style={{ color: r.stuck ? STATUS.critical : '#4A4E57' }}>
                {r.stage}
              </td>
              <Cell>{when(r.loginMadeAt) ?? '—'}</Cell>
              <Cell>{r.hasLogin ? when(r.lastSignInAt) ?? 'NEVER' : '—'}</Cell>
              <Cell>{when(r.firstVisitAt) ?? '—'}</Cell>
              <Cell>{when(r.lastVisitAt) ?? '—'}</Cell>
            </tr>
          ))}
        </tbody>
      </table>

      <div>
        <p className="text-[20px] tracking-[0.12em] text-[#6B6B6B] mb-1">TRIED WITH AN EMAIL NO MEMBER HAS · LAST 30 DAYS</p>
        <p className="text-[20px] tracking-[0.06em] text-[#C9C7C2] mb-3">
          A MEMBER TYPING ANOTHER ADDRESS LANDS HERE, NOT ON HER OWN ROW
        </p>
        <Steps events={unmatched} showEmail empty="NONE." />
      </div>
    </div>
  )
}

function Cell({ children }: { children: React.ReactNode }) {
  return <td className="py-3 text-right text-[20px] tracking-[0.05em] text-[#4A4E57]">{children}</td>
}
