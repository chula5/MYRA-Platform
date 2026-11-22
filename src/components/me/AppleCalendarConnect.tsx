'use client'

// The one way in to her calendar: the iPhone's own (Apple) calendar, read by
// the MYRA app. Google Calendar is no longer offered (Chloe, 2026-11-22): MYRA
// asks Google for Gmail only, so Google's review covers one permission.

import { useState } from 'react'
import { appleCalendarAvailable, readAppleCalendar } from '@/lib/native/apple-calendar'
import { importAppleCalendar } from '@/app/me/dressing-room/calendar-actions'

export function AppleIcon({ className = 'w-5 h-5' }: { className?: string }) {
  return <svg viewBox="0 0 24 24" className={className} aria-hidden><path fill="currentColor" d="M16.4 12.7c0-2.5 2-3.6 2.1-3.7-1.2-1.7-3-1.9-3.6-2-1.5-.2-3 .9-3.7.9-.8 0-2-.9-3.2-.9-1.7 0-3.2 1-4.1 2.5-1.7 3-.4 7.5 1.3 10 .8 1.2 1.8 2.5 3.1 2.5 1.2 0 1.7-.8 3.2-.8s1.9.8 3.2.8c1.3 0 2.2-1.2 3-2.4.9-1.4 1.3-2.7 1.3-2.8-.1 0-2.6-1-2.6-4.1zM14 5.4c.7-.8 1.1-1.9 1-3-1 0-2.1.7-2.8 1.5-.6.7-1.2 1.8-1 2.9 1.1.1 2.2-.6 2.8-1.4z" /></svg>
}

/** Read the phone's calendar into MYRA. Inside the app only; a browser is told where to go. */
export async function connectAppleCalendar(testMemberId?: string): Promise<string> {
  if (!appleCalendarAvailable()) return 'Apple Calendar connects from the MYRA iPhone app.'
  const r = await readAppleCalendar(90)
  if (r.denied) return 'Calendar access is off for MYRA. Settings → MYRA → Calendars turns it on.'
  if (r.error || !r.events) return r.error ?? 'Could not read the calendar'
  const saved = await importAppleCalendar(r.events, testMemberId)
  if (saved.error) return saved.error
  return saved.found ? `Connected. ${saved.found} thing${saved.found === 1 ? '' : 's'} coming up worth dressing for.` : 'Connected. Nothing to dress for in the next three months.'
}

export default function AppleCalendarConnect({ testMemberId, onDone, textClass = 'text-[clamp(18px,1.05vw,30px)]' }: {
  testMemberId?: string
  onDone?: (message: string) => void | Promise<void>
  textClass?: string
}) {
  const [busy, setBusy] = useState(false)
  const inApp = appleCalendarAvailable()
  return (
    <div className="space-y-3">
      {inApp ? (
        <button
          type="button"
          disabled={busy}
          onClick={async () => { setBusy(true); try { await onDone?.(await connectAppleCalendar(testMemberId)) } finally { setBusy(false) } }}
          className="inline-flex items-center gap-3 rounded-full bg-[#2B2B2B] px-5 py-3 text-[20px] text-white disabled:opacity-40"
        >
          <span className="grid h-7 w-7 place-items-center rounded-md bg-white text-[#2B2B2B]"><AppleIcon /></span>
          {busy ? 'Reading…' : 'Connect Apple Calendar'}
        </button>
      ) : (
        <p className={`${textClass} text-[#6E6B65]`}>Apple Calendar connects from the MYRA iPhone app.</p>
      )}
    </div>
  )
}
