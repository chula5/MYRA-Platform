'use server'

// EVENTS — the browser-callable surface for what she is dressing for.
//
// Same rule as every client action here: the member is resolved on the server
// (her session, or the member Chloe names from HER VIEW, admin only). An id
// from the browser selects a row; it never grants access to one.

import { resolveClientMember } from '@/lib/client-member'
import { createAdminClient } from '@/lib/supabase-server'
import {
  EVENTS_MIGRATION_HINT, createStylingTask, listKnownEvents, listStylingTasks, removeStylingTask, setStylingTaskStatus,
  type KnownEventView, type StylingTaskView, type TaskSource, type TaskStatus,
} from '@/lib/events/store'
import { dismissPick, eventsWithPicks, setKnownEventBrief, type EventWithPicks } from '@/lib/events/picks'

export interface EventsAreaView {
  memberId: string | null
  tasks: StylingTaskView[]
  knownEvents: KnownEventView[]
  /** The options MYRA has picked for each upcoming event (shown ones only), with their outfits. */
  picks: EventWithPicks[]
  error?: string
}

export async function loadMyEvents(asMemberId?: string): Promise<EventsAreaView> {
  const me = await resolveClientMember(asMemberId)
  if (!me) return { memberId: null, tasks: [], knownEvents: [], picks: [] }
  try {
    const [tasks, knownEvents, picks] = await Promise.all([
      listStylingTasks(me.memberId),
      listKnownEvents(me.memberId),
      // Picks are additive: a missing table (migration not run) costs the picks, never the room.
      eventsWithPicks(me.memberId).catch((err) => { console.error('[events] picks', err); return [] as EventWithPicks[] }),
    ])
    return { memberId: me.memberId, tasks, knownEvents, picks }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { memberId: me.memberId, tasks: [], knownEvents: [], picks: [], error: /member_styling_task/.test(msg) ? EVENTS_MIGRATION_HINT : msg }
  }
}

/** What she is looking for, on one of her events, in her words. */
export async function setMyEventBrief(eventId: string, brief: string, asMemberId?: string): Promise<{ error?: string }> {
  const me = await resolveClientMember(asMemberId)
  if (!me) return { error: 'Not signed in' }
  return setKnownEventBrief(createAdminClient() as any, me.memberId, eventId, brief)
}

/** Not this one: the option goes and is not picked again for that event. */
export async function dismissMyEventPick(pickId: string, asMemberId?: string): Promise<{ error?: string }> {
  const me = await resolveClientMember(asMemberId)
  if (!me) return { error: 'Not signed in' }
  return dismissPick(createAdminClient() as any, me.memberId, pickId)
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
