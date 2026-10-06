'use server'

// COMING UP: the browser-callable surface for her calendar. Every action
// resolves the member on the server (her session, or the member Chloe names
// from HER VIEW, admin only). Connecting from HER VIEW is real: it is her
// actual calendar.

import { resolveClientMember } from '@/lib/client-member'
import { emailSecretsConfigured } from '@/lib/email/secrets'
import { calendarConfigured } from '@/lib/calendar/google'
import {
  CALENDAR_MIGRATION_HINT, disconnectCalendar, importDeviceEvents, listCalendarConnections, listUpcoming, planEvent, setEventStatus, syncCalendar,
  type CalendarConnectionView, type CalendarEventView, type IncomingCalendarEvent,
} from '@/lib/calendar/store'

export interface CalendarPanelView { memberId: string | null; ready: boolean; connections: CalendarConnectionView[]; events: CalendarEventView[]; error?: string }

export async function loadCalendarPanel(asMemberId?: string): Promise<CalendarPanelView> {
  const me = await resolveClientMember(asMemberId)
  const ready = calendarConfigured() && emailSecretsConfigured()
  if (!me) return { memberId: null, ready, connections: [], events: [] }
  try {
    const [connections, events] = await Promise.all([listCalendarConnections(me.memberId), listUpcoming(me.memberId)])
    return { memberId: me.memberId, ready, connections, events }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { memberId: me.memberId, ready, connections: [], events: [], error: /member_calendar_/.test(msg) ? CALENDAR_MIGRATION_HINT : msg }
  }
}

export async function syncMyCalendar(asMemberId?: string): Promise<{ found?: number; error?: string }> {
  const me = await resolveClientMember(asMemberId)
  if (!me) return { error: 'Not signed in' }
  return syncCalendar(me.memberId)
}

export async function planMyEvent(eventId: string, asMemberId?: string): Promise<{ error?: string }> {
  const me = await resolveClientMember(asMemberId)
  if (!me) return { error: 'Not signed in' }
  return planEvent(me.memberId, eventId)
}

export async function setMyEventStatus(eventId: string, status: 'suggested' | 'ignored', asMemberId?: string): Promise<{ error?: string }> {
  const me = await resolveClientMember(asMemberId)
  if (!me) return { error: 'Not signed in' }
  return setEventStatus(me.memberId, eventId, status)
}

export async function disconnectMyCalendar(connectionId: string, asMemberId?: string): Promise<{ error?: string }> {
  const me = await resolveClientMember(asMemberId)
  if (!me) return { error: 'Not signed in' }
  return disconnectCalendar(me.memberId, connectionId)
}

/**
 * The iPhone's calendar, read by the MYRA app and handed over as plain events.
 * Only what is worth dressing for is kept, by the same rule as Google.
 */
export async function importAppleCalendar(events: unknown, asMemberId?: string): Promise<{ found?: number; error?: string }> {
  const me = await resolveClientMember(asMemberId)
  if (!me) return { error: 'Not signed in' }
  const clean: IncomingCalendarEvent[] = (Array.isArray(events) ? events : []).slice(0, 400)
    .filter((e: any) => e && typeof e.id === 'string' && typeof e.title === 'string' && typeof e.startsAt === 'string' && !Number.isNaN(Date.parse(e.startsAt)))
    .map((e: any) => ({
      id: `apple:${e.id}`.slice(0, 200),
      title: e.title.trim().slice(0, 200) || 'Untitled',
      startsAt: new Date(e.startsAt).toISOString(),
      endsAt: typeof e.endsAt === 'string' && !Number.isNaN(Date.parse(e.endsAt)) ? new Date(e.endsAt).toISOString() : null,
      allDay: !!e.allDay,
      location: typeof e.location === 'string' && e.location.trim() ? e.location.trim().slice(0, 200) : null,
    }))
  return importDeviceEvents(me.memberId, clean)
}
