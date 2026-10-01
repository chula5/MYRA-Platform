'use server'

// EVENTS — the browser-callable surface for what she is dressing for.
//
// Same rule as every client action here: the member is resolved on the server
// (her session, or the member Chloe names from HER VIEW, admin only). An id
// from the browser selects a row; it never grants access to one.

import { resolveClientMember } from '@/lib/client-member'
import {
  EVENTS_MIGRATION_HINT, createStylingTask, listKnownEvents, listStylingTasks, removeStylingTask, setStylingTaskStatus,
  type KnownEventView, type StylingTaskView, type TaskSource, type TaskStatus,
} from '@/lib/events/store'

export interface EventsAreaView {
  memberId: string | null
  tasks: StylingTaskView[]
  knownEvents: KnownEventView[]
  error?: string
}

export async function loadMyEvents(asMemberId?: string): Promise<EventsAreaView> {
  const me = await resolveClientMember(asMemberId)
  if (!me) return { memberId: null, tasks: [], knownEvents: [] }
  try {
    const [tasks, knownEvents] = await Promise.all([listStylingTasks(me.memberId), listKnownEvents(me.memberId)])
    return { memberId: me.memberId, tasks, knownEvents }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { memberId: me.memberId, tasks: [], knownEvents: [], error: /member_styling_task/.test(msg) ? EVENTS_MIGRATION_HINT : msg }
  }
}

export async function scheduleMyStylingTask(
  input: { calendarEventId?: string | null; eventLabel?: string; eventDate?: string; brief: string; source: TaskSource },
  asMemberId?: string,
): Promise<{ task?: StylingTaskView; error?: string }> {
  const me = await resolveClientMember(asMemberId)
  if (!me) return { error: 'Not signed in' }
  return createStylingTask(me.memberId, input)
}

export async function setMyStylingTaskStatus(
  taskId: string,
  status: TaskStatus,
  asMemberId?: string,
): Promise<{ error?: string }> {
  const me = await resolveClientMember(asMemberId)
  if (!me) return { error: 'Not signed in' }
  return setStylingTaskStatus(me.memberId, taskId, status)
}

export async function removeMyStylingTask(taskId: string, asMemberId?: string): Promise<{ error?: string }> {
  const me = await resolveClientMember(asMemberId)
  if (!me) return { error: 'Not signed in' }
  return removeStylingTask(me.memberId, taskId)
}
