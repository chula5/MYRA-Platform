'use server'

// COMING UP: the browser-callable surface for her calendar. Every action
// resolves the member on the server (her session, or the member Chloe names
// from HER VIEW, admin only). Connecting from HER VIEW is real: it is her
// actual calendar.

import { resolveClientMember } from '@/lib/client-member'
import { emailSecretsConfigured } from '@/lib/email/secrets'
import { calendarConfigured } from '@/lib/calendar/google'
import {
  CALENDAR_MIGRATION_HINT, disconnectCalendar, listCalendarConnections, listUpcoming, planEvent, setEventStatus, syncCalendar,
  type CalendarConnectionView, type CalendarEventView,
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
