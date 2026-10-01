'use client'

// EVENTS — what she is dressing for, and what she is looking for.
//
// Her calendar says which days are worth dressing for; this room answers the
// next question. For any of those days she can set MYRA a task — "find a black
// dress" — and say, every single time, where the outfit may come from: the
// wardrobe she already has, new pieces, or both. She can also add an occasion
// by hand when it never made it into her calendar.
//
// The calendar plumbing (connect, read, disconnect) is the calendar panel's,
// reused rather than rebuilt.

import { useEffect, useState } from 'react'
import {
  disconnectMyCalendar, loadCalendarPanel, setMyEventStatus, syncMyCalendar, type CalendarPanelView,
} from '../dressing-room/calendar-actions'
import {
  loadMyEvents, removeMyStylingTask, scheduleMyStylingTask, setMyStylingTaskStatus, type EventsAreaView,
} from './actions'

type Task = EventsAreaView['tasks'][number]
type TaskSource = Task['source']

const T = 'text-[clamp(20px,1.2vw,36px)]'
const SMALL = 'text-[clamp(18px,1.05vw,30px)]'
const FIELD = `${SMALL} w-full bg-white border border-[#C3BFB8] rounded-full px-5 py-[0.7em] text-[#2B2B2B] placeholder:text-[#8C8A85] focus:outline-none focus:border-[#2B2B2B]`
const CARD = 'w-full rounded-[18px] bg-white/85 shadow-[0_2px_14px_rgba(43,43,43,0.08)] px-5 md:px-8 py-7'
const ROW = 'bg-white rounded-[16px] shadow-[0_1px_8px_rgba(43,43,43,0.06)] px-5 py-4'
const HEADING = 'text-[clamp(26px,1.6vw,46px)] tracking-[0.06em] text-[#2B2B2B]'

const OCCASION: Record<string, string> = { event: 'An occasion', dinner_drinks: 'Dinner or drinks', travel: 'A trip', work_elevated: 'Work, visible', casual_day: 'A day out' }
const SOURCES: { id: TaskSource; label: string }[] = [
  { id: 'wardrobe', label: 'My wardrobe' },
  { id: 'new', label: 'New pieces' },
  { id: 'both', label: 'Both' },
]
const SOURCE_LABEL: Record<string, string> = { wardrobe: 'From my wardrobe', new: 'New pieces', both: 'Wardrobe and new' }
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/** A day written as YYYY-MM-DD, read as plain text so it cannot drift a day. */
function readDay(iso: string): { month: string; day: string; full: string } {
  const [y, m, d] = (iso ?? '').split('-')
  const name = MONTHS[Number(m) - 1] ?? ''
  return {
    month: name.slice(0, 3).toUpperCase(),
    day: d ? String(Number(d)) : '',
    full: [d ? Number(d) : null, name, y].filter(Boolean).join(' '),
  }
}

/** Where the outfit may come from. One answer per task; nothing assumed. */
function SourcePicker({ value, onChange }: { value: TaskSource; onChange: (v: TaskSource) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {SOURCES.map((s) => (
        <button
          key={s.id}
          type="button"
          aria-pressed={value === s.id}
          onClick={() => onChange(s.id)}
          className={`${SMALL} px-[1em] py-[0.45em] rounded-full border transition-colors ${value === s.id ? 'bg-[#2B2B2B] text-white border-[#2B2B2B]' : 'bg-white text-[#2B2B2B] border-[#C3BFB8] hover:border-[#2B2B2B]'}`}
        >
          {s.label}
        </button>
      ))}
    </div>
  )
}

export default function EventsClient({ testMemberId }: { testMemberId?: string }) {
  const [calendar, setCalendar] = useState<CalendarPanelView | null>(null)
  const [area, setArea] = useState<EventsAreaView | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState<string[]>([])
  const [open, setOpen] = useState<string | null>(null)
  const [brief, setBrief] = useState('')
  const [source, setSource] = useState<TaskSource>('both')
  const [adding, setAdding] = useState(false)
  const [mine, setMine] = useState({ label: '', date: '', brief: '', source: 'both' as TaskSource })

  const working = (k: string) => busy.includes(k)
  const run = async (k: string, fn: () => Promise<void>) => {
    setBusy((b) => [...b, k])
    try { await fn() } finally { setBusy((b) => b.filter((x) => x !== k)) }
  }

  const refresh = async () => {
    const [c, a] = await Promise.all([loadCalendarPanel(testMemberId), loadMyEvents(testMemberId)])
    setCalendar(c)
    setArea(a)
    if (a.error) setMsg(a.error)
  }

  const sync = () => run('sync', async () => {
    setMsg('Reading your calendar…')
    const r = await syncMyCalendar(testMemberId)
    setMsg(r.error ?? (r.found ? `${r.found} thing${r.found === 1 ? '' : 's'} coming up worth dressing for.` : 'Nothing to dress for in the next three months.'))
    await refresh()
  })

  useEffect(() => {
    void (async () => {
      const [c, a] = await Promise.all([loadCalendarPanel(testMemberId), loadMyEvents(testMemberId)])
      setCalendar(c)
      setArea(a)
      if (a.error) { setMsg(a.error); return }
      const q = new URLSearchParams(window.location.search)
      const err = q.get('calendar_error')
      if (err) setMsg(err)
      // Just connected, or not looked at today: read it.
      const stale = c.connections.some((x) => !x.last_synced_at || Date.now() - new Date(x.last_synced_at).getTime() > 12 * 3_600_000)
      if (q.get('calendar_connected') || (c.connections.length && stale)) void sync()
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [testMemberId])

  const schedule = (calendarEventId: string | null) => run(`new:${calendarEventId ?? 'own'}`, async () => {
    const input = calendarEventId
      ? { calendarEventId, brief: brief.trim(), source }
      : { eventLabel: mine.label.trim(), eventDate: mine.date, brief: mine.brief.trim(), source: mine.source }
    const r = await scheduleMyStylingTask(input, testMemberId)
    if (r.error) { setMsg(r.error); return }
    setMsg('Set. MYRA will come back to you on this one.')
    setBrief(''); setSource('both'); setOpen(null)
    setMine({ label: '', date: '', brief: '', source: 'both' }); setAdding(false)
    await refresh()
  })

  if (!calendar || !area || !area.memberId) return null
  const connected = calendar.connections.filter((c) => c.status !== 'disconnected')
  const returnPath = typeof window !== 'undefined' ? window.location.pathname : '/me/events'
  const connectHref = `/api/calendar/google/start?return=${encodeURIComponent(returnPath)}${testMemberId ? `&member=${testMemberId}` : ''}`

  return (
    <div className="space-y-8">
      {/* Who is connected, and the way in for anyone who is not. */}
      <section className={CARD}>
        <div className="space-y-6">
          <div className="flex flex-wrap items-baseline justify-between gap-x-8 gap-y-2">
            <h1 className="text-[clamp(28px,1.8vw,52px)] tracking-[0.06em] text-[#2B2B2B]">EVENTS</h1>
            {connected.map((c) => (
              <p key={c.connection_id} className={`${SMALL} text-[#6E6B65]`}>
                {c.email}{c.status === 'error' && c.error ? <span className="text-[#B83A3A]"> · {c.error}</span> : null}
                {' · '}<button disabled={working('sync')} onClick={sync} className="underline underline-offset-4 text-[#2B2B2B] disabled:opacity-40">{working('sync') ? 'Reading…' : 'Refresh'}</button>
                {' · '}<button onClick={() => run('dc', async () => { await disconnectMyCalendar(c.connection_id, testMemberId); await refresh() })} className="underline underline-offset-4">Disconnect</button>
              </p>
            ))}
          </div>

          {calendar.error && <p className={`${T} text-[#B83A3A]`}>{calendar.error}</p>}
          {msg && <p className={`${T} text-[#2B2B2B]`}>{msg}</p>}

          {!connected.length && (
            <div className="space-y-4">
              <p className={`${T} text-[#4A4E57]`}>
                Connect your calendar and MYRA sees what is coming up worth dressing for. Set a task for any of it, and say whether to use
                what you already own, find something new, or both.
              </p>
              {calendar.ready
                ? <a href={connectHref} className="inline-block text-[clamp(22px,1.25vw,38px)] px-[1.3em] py-[0.6em] bg-[#2B2B2B] text-white rounded-full">Connect Google Calendar</a>
                : <span className={`${T} inline-block px-6 py-3 border border-[#C3BFB8] text-[#8C8A85] rounded-full`}>Connect Google Calendar (not set up yet)</span>}
              <p className={`${SMALL} text-[#6E6B65]`}>Read only. MYRA keeps the title, time and place of events worth dressing for, nothing else.</p>
            </div>
          )}
        </div>
      </section>

      {/* The days worth dressing for, and the task set for each. */}
      {connected.length > 0 && (
        <section className={`${CARD} space-y-4`}>
          <h2 className={HEADING}>COMING UP</h2>
          {!calendar.events.length && <p className={`${T} text-[#4A4E57]`}>Nothing to dress for in the next three months.</p>}
          <div className="space-y-3">
            {calendar.events.map((e) => {
              const d = new Date(e.starts_at)
              const task = area.tasks.find((t) => t.calendar_event_id === e.event_id)
              const isOpen = open === e.event_id
              return (
                <div key={e.event_id} className={`${ROW} space-y-3`}>
                  <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
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
                    {task ? (
                      <p className={`${SMALL} text-[#2B2B2B] md:max-w-[46%] md:text-right`}>
                        Asked for: “{task.brief}”<span className="text-[#6E6B65]"> · {SOURCE_LABEL[task.source]}</span>
                      </p>
                    ) : (
                      <div className="flex items-center gap-4">
                        <button
                          disabled={working(`new:${e.event_id}`)}
                          onClick={() => { setOpen(isOpen ? null : e.event_id); setBrief(''); setSource('both') }}
                          className={`${T} px-[1.1em] py-[0.5em] bg-[#2B2B2B] text-white rounded-full disabled:opacity-40`}
                        >
                          Style it
                        </button>
                        <button
                          disabled={working(e.event_id)}
                          onClick={() => run(e.event_id, async () => { await setMyEventStatus(e.event_id, 'ignored', testMemberId); await refresh() })}
                          className={`${SMALL} underline underline-offset-4 text-[#6E6B65] disabled:opacity-40`}
                        >
                          Not this one
                        </button>
                      </div>
                    )}
                  </div>

                  {isOpen && !task && (
                    <div className="space-y-4 border-t border-[#EDEBE7] pt-4">
                      <div className="space-y-2">
                        <label className={`${SMALL} block text-[#6E6B65]`} htmlFor={`brief-${e.event_id}`}>What are you looking for?</label>
                        <input
                          id={`brief-${e.event_id}`}
                          value={brief}
                          onChange={(ev) => setBrief(ev.target.value)}
                          placeholder="A black dress"
                          className={FIELD}
                        />
                      </div>
                      <div className="space-y-2">
                        <p className={`${SMALL} text-[#6E6B65]`}>Where may MYRA look?</p>
                        <SourcePicker value={source} onChange={setSource} />
                      </div>
                      <div className="flex flex-wrap items-center gap-4">
                        <button
                          disabled={working(`new:${e.event_id}`) || !brief.trim()}
                          onClick={() => schedule(e.event_id)}
                          className={`${T} px-[1.1em] py-[0.5em] bg-[#2B2B2B] text-white rounded-full disabled:opacity-40`}
                        >
                          {working(`new:${e.event_id}`) ? 'Saving…' : 'Schedule it'}
                        </button>
                        <button onClick={() => setOpen(null)} className={`${SMALL} underline underline-offset-4 text-[#6E6B65]`}>Cancel</button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* Everything she has set, calendar or not, and the way to add one by hand. */}
      <section className={`${CARD} space-y-4`}>
        <h2 className={HEADING}>YOUR TASKS</h2>
        {!area.tasks.length && (
          <p className={`${T} text-[#4A4E57]`}>
            Nothing set yet. Pick a day from your calendar, or add something yourself below.
          </p>
        )}
        <div className="space-y-3">
          {area.tasks.map((t) => {
            const day = readDay(t.event_date)
            return (
              <div key={t.task_id} className={`${ROW} flex flex-wrap items-center gap-x-6 gap-y-3`}>
                <div className="text-center shrink-0 w-[4.2em]">
                  <p className={`${SMALL} tracking-[0.1em] text-[#6E6B65]`}>{day.month}</p>
                  <p className="text-[clamp(30px,1.9vw,56px)] leading-none text-[#2B2B2B]">{day.day}</p>
                </div>
                <div className="min-w-0 flex-1">
                  <p className={`${T} text-[#2B2B2B] leading-tight`}>{t.brief}</p>
                  <p className={`${SMALL} text-[#6E6B65]`}>{[t.event_label, day.full, SOURCE_LABEL[t.source]].filter(Boolean).join(' · ')}</p>
                </div>
                <div className="flex flex-wrap items-center gap-4">
                  {t.status === 'styled' && <span className={`${T} text-[#2B2B2B]`}>✓ Styled</span>}
                  <button
                    disabled={working(t.task_id)}
                    onClick={() => run(t.task_id, async () => { await setMyStylingTaskStatus(t.task_id, t.status === 'styled' ? 'planned' : 'styled', testMemberId); await refresh() })}
                    className={`${SMALL} underline underline-offset-4 text-[#2B2B2B] disabled:opacity-40`}
                  >
                    {t.status === 'styled' ? 'Reopen' : 'Mark styled'}
                  </button>
                  <button
                    disabled={working(t.task_id)}
                    onClick={() => run(t.task_id, async () => { await removeMyStylingTask(t.task_id, testMemberId); await refresh() })}
                    className={`${SMALL} underline underline-offset-4 text-[#6E6B65] disabled:opacity-40`}
                  >
                    Remove
                  </button>
                </div>
              </div>
            )
          })}
        </div>

        <div className="border-t border-[#EDEBE7] pt-5">
          {adding ? (
            <div className="space-y-4">
              <div className="grid sm:grid-cols-2 gap-3">
                <input
                  aria-label="What you are dressing for"
                  value={mine.label}
                  onChange={(e) => setMine((m) => ({ ...m, label: e.target.value }))}
                  placeholder="A wedding, a trip, dinner…"
                  className={FIELD}
                />
                <input
                  aria-label="Date"
                  type="date"
                  value={mine.date}
                  onChange={(e) => setMine((m) => ({ ...m, date: e.target.value }))}
                  className={FIELD}
                />
              </div>
              <input
                aria-label="What you are looking for"
                value={mine.brief}
                onChange={(e) => setMine((m) => ({ ...m, brief: e.target.value }))}
                placeholder="A black dress"
                className={FIELD}
              />
              <div className="space-y-2">
                <p className={`${SMALL} text-[#6E6B65]`}>Where may MYRA look?</p>
                <SourcePicker value={mine.source} onChange={(v) => setMine((m) => ({ ...m, source: v }))} />
              </div>
              <div className="flex flex-wrap items-center gap-4">
                <button
                  disabled={working('new:own') || !mine.label.trim() || !mine.date || !mine.brief.trim()}
                  onClick={() => schedule(null)}
                  className={`${T} px-[1.1em] py-[0.5em] bg-[#2B2B2B] text-white rounded-full disabled:opacity-40`}
                >
                  {working('new:own') ? 'Saving…' : 'Schedule it'}
                </button>
                <button onClick={() => setAdding(false)} className={`${SMALL} underline underline-offset-4 text-[#6E6B65]`}>Cancel</button>
              </div>
            </div>
          ) : (
            <button onClick={() => setAdding(true)} className={`${T} underline underline-offset-4 text-[#2B2B2B]`}>
              Dressing for something else? Add it yourself
            </button>
          )}
        </div>
      </section>
    </div>
  )
}
