// EVENTS — what she is dressing for, and what she is looking for.
//
// Her calendar (0062) holds the dressable events. This is the other half: the
// brief she sets MYRA for one of them ("find a black dress") and, the question
// a brief cannot answer, where the outfit may come from — her own wardrobe,
// new pieces, or both. She answers it every time; nothing is assumed.
//
// A task can hang off a calendar event or stand on its own (something she added
// herself). Either way it becomes a pilot_known_event (0029) — the thing the
// studio already plans anticipation around — and removing the task takes that
// back, exactly as "not this one" does on the calendar.

import 'server-only'
import { createAdminClient } from '@/lib/supabase-server'
import { planEvent, setEventStatus } from '@/lib/calendar/store'

export const EVENTS_MIGRATION_HINT = 'Run migration 0077_member_styling_task.sql in Supabase first'
const missing = (m: string) => /member_styling_task|schema cache|does not exist/i.test(m)

export type TaskSource = 'wardrobe' | 'new' | 'both'
export type TaskStatus = 'planned' | 'styled'

export interface StylingTaskView {
  task_id: string
  calendar_event_id: string | null
  event_label: string
  event_date: string
  brief: string
  source: TaskSource
  status: TaskStatus
  created_at: string
}

const COLUMNS = 'task_id, calendar_event_id, event_label, event_date, brief, source, status, created_at'

export interface CreateStylingTaskInput {
  /** Set when the task is for a calendar event; the event supplies the label and date. */
  calendarEventId?: string | null
  /** Her own occasion, when there is no calendar event behind it. */
  eventLabel?: string
  eventDate?: string
  brief: string
  source: TaskSource
}

export async function listStylingTasks(memberId: string): Promise<StylingTaskView[]> {
  const admin = createAdminClient() as any
  const { data, error } = await admin
    .from('member_styling_task')
    .select(COLUMNS)
    .eq('member_id', memberId)
    .order('event_date')
    .order('created_at')
  if (error) throw new Error(error.message)
  return data ?? []
}

export async function createStylingTask(
  memberId: string,
  input: CreateStylingTaskInput,
): Promise<{ task?: StylingTaskView; error?: string }> {
  const admin = createAdminClient() as any
  const brief = (input.brief ?? '').trim().slice(0, 300)
  if (!brief) return { error: 'Say what you are looking for' }

  let calendarEventId: string | null = null
  let label = (input.eventLabel ?? '').trim().slice(0, 200)
  let date = (input.eventDate ?? '').trim().slice(0, 10)

  if (input.calendarEventId) {
    // Read the event back from HER calendar: the browser sends an id, never a
    // title or a date it could have made up.
    const { data: e } = await admin
      .from('member_calendar_event')
      .select('event_id, title, starts_at')
      .eq('event_id', input.calendarEventId)
      .eq('member_id', memberId)
      .maybeSingle()
    if (!e) return { error: 'Event not found' }
    calendarEventId = e.event_id
    label = e.title
    date = String(e.starts_at).slice(0, 10)
  } else {
    if (!label) return { error: 'Name what you are dressing for' }
    if (!date) return { error: 'Add a date' }
  }

  // The task first, so a half-run migration fails before anything is written
  // anywhere else (no orphaned known events).
  const { data: task, error } = await admin
    .from('member_styling_task')
    .insert({
      member_id: memberId,
      calendar_event_id: calendarEventId,
      event_label: label,
      event_date: date,
      brief,
      source: input.source === 'wardrobe' || input.source === 'new' ? input.source : 'both',
    })
    .select(COLUMNS)
    .single()
  if (error) return { error: missing(error.message) ? EVENTS_MIGRATION_HINT : error.message }

  // Best effort: make it an event the studio knows to plan around. A calendar
  // event goes through the same move the calendar itself makes when she says
  // MYRA should plan an outfit; her own occasion is added by hand.
  const knownEventId = calendarEventId
    ? await linkCalendarKnownEvent(memberId, calendarEventId)
    : await addManualKnownEvent(admin, memberId, label, date)
  if (knownEventId) {
    await admin.from('member_styling_task')
      .update({ known_event_id: knownEventId, updated_at: new Date().toISOString() })
      .eq('task_id', task.task_id)
      .eq('member_id', memberId)
  }

  return { task }
}

export async function setStylingTaskStatus(
  memberId: string,
  taskId: string,
  status: TaskStatus,
): Promise<{ error?: string }> {
  const admin = createAdminClient() as any
  const { error } = await admin
    .from('member_styling_task')
    .update({ status: status === 'styled' ? 'styled' : 'planned', updated_at: new Date().toISOString() })
    .eq('task_id', taskId)
    .eq('member_id', memberId)
  return error ? { error: missing(error.message) ? EVENTS_MIGRATION_HINT : error.message } : {}
}

export async function removeStylingTask(memberId: string, taskId: string): Promise<{ error?: string }> {
  const admin = createAdminClient() as any
  const { data: task } = await admin
    .from('member_styling_task')
    .select('task_id, calendar_event_id, known_event_id')
    .eq('task_id', taskId)
    .eq('member_id', memberId)
    .maybeSingle()
  if (!task) return { error: 'Task not found' }
  const { error } = await admin.from('member_styling_task').delete().eq('task_id', taskId).eq('member_id', memberId)
  if (error) return { error: missing(error.message) ? EVENTS_MIGRATION_HINT : error.message }
  await forgetTaskEvent(memberId, task)
  return {}
}

/** Take the event back out of the studio's plans. The task is already gone. */
async function forgetTaskEvent(
  memberId: string,
  task: { calendar_event_id: string | null; known_event_id: string | null },
): Promise<void> {
  try {
    if (task.calendar_event_id) {
      // The same retraction the calendar makes for "not this one": the day goes
      // back to worth dressing for and its known event is deleted.
      await setEventStatus(memberId, task.calendar_event_id, 'suggested')
      return
    }
    if (task.known_event_id) {
      const admin = createAdminClient() as any
      await admin.from('pilot_known_event').delete().eq('event_id', task.known_event_id).eq('member_id', memberId)
    }
  } catch { /* the task is gone; the clean-up is best effort */ }
}

async function linkCalendarKnownEvent(memberId: string, calendarEventId: string): Promise<string | null> {
  try {
    const planned = await planEvent(memberId, calendarEventId)
    if (planned.error) return null
    const admin = createAdminClient() as any
    const { data } = await admin
      .from('member_calendar_event')
      .select('known_event_id')
      .eq('event_id', calendarEventId)
      .eq('member_id', memberId)
      .maybeSingle()
    return data?.known_event_id ?? null
  } catch { return null }
}

async function addManualKnownEvent(admin: any, memberId: string, label: string, date: string): Promise<string | null> {
  try {
    const { data } = await admin
      .from('pilot_known_event')
      .insert({ member_id: memberId, label, event_date: date })
      .select('event_id')
      .single()
    return data?.event_id ?? null
  } catch { return null }
}
