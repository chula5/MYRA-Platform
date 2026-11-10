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
import { dismissPick, eventsWithPicks, setKnownEventBrief, setKnownEventNevers, type EventWithPicks } from '@/lib/events/picks'
import {
  addEventPicture, listEventPictures, removeEventPicture, setEventPictureKind, type EventPictureView, type PictureKind,
} from '@/lib/events/inspiration'

export interface EventsAreaView {
  memberId: string | null
  tasks: StylingTaskView[]
  knownEvents: KnownEventView[]
  /** The options MYRA has picked for each upcoming event (shown ones only), with their outfits. */
  picks: EventWithPicks[]
  /** The pictures she added to her events: what she loves, and what is "not this". */
  pictures: EventPictureView[]
  error?: string
}

export async function loadMyEvents(asMemberId?: string): Promise<EventsAreaView> {
  const me = await resolveClientMember(asMemberId)
  if (!me) return { memberId: null, tasks: [], knownEvents: [], picks: [], pictures: [] }
  try {
    const [tasks, knownEvents, picks] = await Promise.all([
      listStylingTasks(me.memberId),
      listKnownEvents(me.memberId),
      // Picks are additive: a missing table (migration not run) costs the picks, never the room.
      eventsWithPicks(me.memberId).catch((err) => { console.error('[events] picks', err); return [] as EventWithPicks[] }),
    ])
    const pictures = await listEventPictures(createAdminClient() as any, me.memberId, knownEvents.map((e) => e.event_id))
      .catch((err) => { console.error('[events] pictures', err); return [] as EventPictureView[] })
    return { memberId: me.memberId, tasks, knownEvents, picks, pictures }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { memberId: me.memberId, tasks: [], knownEvents: [], picks: [], pictures: [], error: /member_styling_task/.test(msg) ? EVENTS_MIGRATION_HINT : msg }
  }
}

/** What she is looking for, on one of her events, in her words. */
export async function setMyEventBrief(eventId: string, brief: string, asMemberId?: string): Promise<{ error?: string }> {
  const me = await resolveClientMember(asMemberId)
  if (!me) return { error: 'Not signed in' }
  return setKnownEventBrief(createAdminClient() as any, me.memberId, eventId, brief)
}

/** What she does not want for one of her events: her words, a price cap, brands. */
export async function setMyEventNevers(
  eventId: string,
  input: { nevers?: string; max_price_gbp?: number | string | null; never_brands?: string[] },
  asMemberId?: string,
): Promise<{ error?: string }> {
  const me = await resolveClientMember(asMemberId)
  if (!me) return { error: 'Not signed in' }
  return setKnownEventNevers(createAdminClient() as any, me.memberId, eventId, input)
}

/** A picture for one of her events (form: file, eventId, kind, member). */
export async function addMyEventPicture(formData: FormData): Promise<{ picture?: EventPictureView; error?: string }> {
  const me = await resolveClientMember(String(formData.get('member') ?? '') || undefined)
  if (!me) return { error: 'Not signed in' }
  const file = formData.get('file')
  const eventId = String(formData.get('eventId') ?? '')
  if (!(file instanceof File) || file.size === 0) return { error: 'No picture selected' }
  if (file.size > 15 * 1024 * 1024) return { error: 'That picture is very large — try one under 15MB' }
  if (!/^image\//.test(file.type || 'image/jpeg')) return { error: 'That is not a picture' }
  const kind: PictureKind = formData.get('kind') === 'not' ? 'not' : 'love'
  return addEventPicture(createAdminClient() as any, me.memberId, eventId, { data: Buffer.from(await file.arrayBuffer()), contentType: file.type || 'image/jpeg' }, kind)
}

export async function setMyEventPictureKind(imageId: string, kind: PictureKind, asMemberId?: string): Promise<{ error?: string }> {
  const me = await resolveClientMember(asMemberId)
  if (!me) return { error: 'Not signed in' }
  return setEventPictureKind(createAdminClient() as any, me.memberId, imageId, kind)
}

export async function removeMyEventPicture(imageId: string, asMemberId?: string): Promise<{ error?: string }> {
  const me = await resolveClientMember(asMemberId)
  if (!me) return { error: 'Not signed in' }
  return removeEventPicture(createAdminClient() as any, me.memberId, imageId)
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
