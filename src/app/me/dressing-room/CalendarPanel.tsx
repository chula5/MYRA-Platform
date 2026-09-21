'use client'

// COMING UP: her calendar, kept small. A month at a glance with a dot on the
// days worth dressing for, and the list beside it. She says which ones MYRA
// should plan an outfit for; everything else is left alone.

import { useEffect, useMemo, useState } from 'react'
import {
  disconnectMyCalendar, loadCalendarPanel, planMyEvent, setMyEventStatus, syncMyCalendar,
  type CalendarPanelView,
} from './calendar-actions'

const T = 'text-[clamp(20px,1.2vw,36px)]'
const SMALL = 'text-[clamp(18px,1.05vw,30px)]'
const OCCASION: Record<string, string> = { event: 'An occasion', dinner_drinks: 'Dinner or drinks', travel: 'A trip', work_elevated: 'Work, visible', casual_day: 'A day out' }
const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

export default function CalendarPanel({ testMemberId }: { testMemberId?: string }) {
  const [view, setView] = useState<CalendarPanelView | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState<string[]>([])
  const [month, setMonth] = useState(() => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), 1) })

  const refresh = async () => setView(await loadCalendarPanel(testMemberId))
  const working = (k: string) => busy.includes(k)
  const run = async (k: string, fn: () => Promise<void>) => { setBusy((b) => [...b, k]); try { await fn() } finally { setBusy((b) => b.filter((x) => x !== k)) } }

  const sync = () => run('sync', async () => {
    setMsg('Reading your calendar…')
    const r = await syncMyCalendar(testMemberId)
    setMsg(r.error ?? (r.found ? `${r.found} thing${r.found === 1 ? '' : 's'} coming up worth dressing for.` : 'Nothing to dress for in the next three months.'))
    await refresh()
  })

  useEffect(() => {
    void (async () => {
      const v = await loadCalendarPanel(testMemberId)
      setView(v)
      const q = new URLSearchParams(window.location.search)
      const err = q.get('calendar_error')
      if (err) setMsg(err)
      // Just connected, or not looked at today: read it.
      const stale = v.connections.some((c) => !c.last_synced_at || Date.now() - new Date(c.last_synced_at).getTime() > 12 * 3_600_000)
      if (q.get('calendar_connected') || (v.connections.length && stale)) void sync()
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [testMemberId])

  const byDay = useMemo(() => {
    const m = new Map<string, 'planning' | 'suggested'>()
    for (const e of view?.events ?? []) {
      const k = dayKey(new Date(e.starts_at))
      if (e.status === 'planning' || !m.has(k)) m.set(k, e.status === 'planning' ? 'planning' : 'suggested')
    }
    return m
  }, [view])

  if (!view || !view.memberId) return null
  const returnPath = typeof window !== 'undefined' ? window.location.pathname : '/me/dressing-room'
  const connectHref = `/api/calendar/google/start?return=${encodeURIComponent(returnPath)}${testMemberId ? `&member=${testMemberId}` : ''}`
  const connected = view.connections.filter((c) => c.status !== 'disconnected')

  // The month grid, Monday first.
  const first = new Date(month)
  const lead = (first.getDay() + 6) % 7
  const daysIn = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate()
  const cells: (number | null)[] = [...Array(lead).fill(null), ...Array.from({ length: daysIn }, (_, i) => i + 1)]
  const today = dayKey(new Date())

  return (
    <section id="coming-up" className="w-full rounded-[18px] bg-white/85 shadow-[0_2px_14px_rgba(43,43,43,0.08)] px-5 md:px-8 py-7 space-y-6 scroll-mt-6">
      <div className="flex flex-wrap items-baseline justify-between gap-x-8 gap-y-2">
        <h2 className="text-[clamp(26px,1.6vw,46px)] tracking-[0.06em] text-[#2B2B2B]">COMING UP</h2>
        {connected.map((c) => (
          <p key={c.connection_id} className={`${SMALL} text-[#6E6B65]`}>
            {c.email}{c.status === 'error' && c.error ? <span className="text-[#B83A3A]"> · {c.error}</span> : null}
            {' · '}<button disabled={working('sync')} onClick={sync} className="underline underline-offset-4 text-[#2B2B2B] disabled:opacity-40">{working('sync') ? 'Reading…' : 'Refresh'}</button>
            {' · '}<button onClick={() => run('dc', async () => { await disconnectMyCalendar(c.connection_id, testMemberId); await refresh() })} className="underline underline-offset-4">Disconnect</button>
          </p>
        ))}
      </div>

      {view.error && <p className={`${T} text-[#B83A3A]`}>{view.error}</p>}
      {msg && <p className={`${T} text-[#2B2B2B]`}>{msg}</p>}

      {!connected.length ? (
        <div className="space-y-4">
          <p className={`${T} text-[#4A4E57]`}>Connect your calendar and MYRA plans outfits for what is coming up.</p>
          {view.ready
            ? <a href={connectHref} className="inline-block text-[clamp(22px,1.25vw,38px)] px-[1.3em] py-[0.6em] bg-[#2B2B2B] text-white rounded-full">Connect Google Calendar</a>
            : <span className={`${T} inline-block px-6 py-3 border border-[#C3BFB8] text-[#8C8A85] rounded-full`}>Connect Google Calendar (not set up yet)</span>}
          <p className={`${SMALL} text-[#6E6B65]`}>Read only. MYRA keeps the title, time and place of events worth dressing for, nothing else.</p>
        </div>
      ) : (
        <div className="grid lg:grid-cols-[minmax(280px,26%)_minmax(0,1fr)] gap-8 items-start">
          {/* The month */}
          <div className="bg-white rounded-[16px] shadow-[0_1px_8px_rgba(43,43,43,0.06)] px-5 py-5">
            <div className="flex items-center justify-between">
              <button aria-label="Previous month" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} className={`${T} px-3 text-[#2B2B2B]`}>‹</button>
              <p className={`${T} tracking-[0.08em] text-[#2B2B2B]`}>{month.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }).toUpperCase()}</p>
              <button aria-label="Next month" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} className={`${T} px-3 text-[#2B2B2B]`}>›</button>
            </div>
            <div className={`mt-4 grid grid-cols-7 gap-y-1 text-center ${SMALL}`}>
              {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => <span key={i} className="text-[#8C8A85] pb-1">{d}</span>)}
              {cells.map((d, i) => {
                if (!d) return <span key={i} />
                const k = dayKey(new Date(month.getFullYear(), month.getMonth(), d))
                const mark = byDay.get(k)
                return (
                  <span key={i} className={`relative py-[0.35em] rounded-full ${k === today ? 'bg-[#EDEBE7]' : ''} ${mark ? 'text-[#2B2B2B]' : 'text-[#8C8A85]'}`}>
                    {d}
                    {mark && <span className={`absolute left-1/2 -translate-x-1/2 bottom-0 w-[0.34em] h-[0.34em] rounded-full ${mark === 'planning' ? 'bg-[#2B2B2B]' : 'border border-[#2B2B2B]'}`} />}
                  </span>
                )
              })}
            </div>
            <p className={`${SMALL} text-[#6E6B65] mt-4`}>● MYRA is planning · ○ worth dressing for</p>
          </div>

          {/* The list */}
          <div className="space-y-3">
            {!view.events.length && <p className={`${T} text-[#4A4E57]`}>Nothing to dress for in the next three months.</p>}
            {view.events.map((e) => {
              const d = new Date(e.starts_at)
              return (
                <div key={e.event_id} className="flex flex-wrap items-center gap-x-6 gap-y-2 bg-white rounded-[16px] shadow-[0_1px_8px_rgba(43,43,43,0.06)] px-5 py-4">
                  <div className="text-center shrink-0 w-[4.2em]">
                    <p className={`${SMALL} tracking-[0.1em] text-[#6E6B65]`}>{d.toLocaleDateString('en-GB', { month: 'short' }).toUpperCase()}</p>
                    <p className="text-[clamp(30px,1.9vw,56px)] leading-none text-[#2B2B2B]">{d.getDate()}</p>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className={`${T} text-[#2B2B2B] leading-tight`}>{e.title}</p>
                    <p className={`${SMALL} text-[#6E6B65]`}>
                      {[OCCASION[e.occasion ?? ''] ?? null, e.all_day ? null : d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }), e.location].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                  {e.status === 'planning' ? (
                    <div className="flex items-center gap-4">
                      <span className={`${T} text-[#2B2B2B]`}>✓ MYRA is planning this</span>
                      <button disabled={working(e.event_id)} onClick={() => run(e.event_id, async () => { await setMyEventStatus(e.event_id, 'suggested', testMemberId); await refresh() })} className={`${SMALL} underline underline-offset-4 text-[#6E6B65] disabled:opacity-40`}>Undo</button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-4">
                      <button disabled={working(e.event_id)} onClick={() => run(e.event_id, async () => { const r = await planMyEvent(e.event_id, testMemberId); setMsg(r.error ?? null); await refresh() })} className={`${T} px-[1.1em] py-[0.5em] bg-[#2B2B2B] text-white rounded-full disabled:opacity-40`}>Plan an outfit</button>
                      <button disabled={working(e.event_id)} onClick={() => run(e.event_id, async () => { await setMyEventStatus(e.event_id, 'ignored', testMemberId); await refresh() })} className={`${SMALL} underline underline-offset-4 text-[#6E6B65] disabled:opacity-40`}>Not this one</button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </section>
  )
}
