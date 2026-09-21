// HER CALENDAR, kept small. Only events that look like something to dress for
// are stored (title, time, place), she decides which ones MYRA plans, and a
// planned event becomes a pilot_known_event, the thing that already drives
// anticipation looks in the studio. Nothing is sent to her unwatched.

import 'server-only'
import { createAdminClient } from '@/lib/supabase-server'
import { encryptSecret, decryptSecret } from '@/lib/email/secrets'
import { calendarAccessToken, listUpcomingEvents } from './google'
import { readCalendarOccasion } from './occasion'

export const CALENDAR_MIGRATION_HINT = 'Run migration 0062_member_calendar.sql in Supabase first'
const missing = (m: string) => /member_calendar_|schema cache|does not exist/i.test(m)

export interface CalendarConnectionView { connection_id: string; email: string; status: string; error: string | null; last_synced_at: string | null }
export interface CalendarEventView { event_id: string; title: string; starts_at: string; ends_at: string | null; all_day: boolean; location: string | null; occasion: string | null; status: 'suggested' | 'planning' | 'ignored' }

export async function saveCalendarConnection(memberId: string, email: string, refreshToken: string): Promise<{ error?: string }> {
  const admin = createAdminClient() as any
  const { error } = await admin.from('member_calendar_connection').upsert(
    { member_id: memberId, provider: 'google', email, secret_enc: encryptSecret(refreshToken), status: 'connected', error: null },
    { onConflict: 'member_id,provider,email' })
  return error ? { error: missing(error.message) ? CALENDAR_MIGRATION_HINT : error.message } : {}
}

export async function listCalendarConnections(memberId: string): Promise<CalendarConnectionView[]> {
  const admin = createAdminClient() as any
  const { data, error } = await admin.from('member_calendar_connection').select('connection_id, email, status, error, last_synced_at').eq('member_id', memberId).neq('status', 'disconnected').order('created_at')
  if (error) throw new Error(error.message)
  return data ?? []
}

export async function disconnectCalendar(memberId: string, connectionId: string): Promise<{ error?: string }> {
  const admin = createAdminClient() as any
  const { data: c } = await admin.from('member_calendar_connection').select('secret_enc').eq('connection_id', connectionId).eq('member_id', memberId).maybeSingle()
  if (c?.secret_enc) { try { await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(decryptSecret(c.secret_enc))}`, { method: 'POST' }) } catch { /* best effort */ } }
  await admin.from('member_calendar_event').delete().eq('connection_id', connectionId).eq('status', 'suggested')
  const { error } = await admin.from('member_calendar_connection').update({ status: 'disconnected', secret_enc: encryptSecret('revoked') }).eq('connection_id', connectionId).eq('member_id', memberId)
  return error ? { error: error.message } : {}
}

/** Read the next 90 days and keep what is worth dressing for. Her choices (planning / ignored) are never overwritten. */
export async function syncCalendar(memberId: string): Promise<{ found: number; error?: string }> {
  const admin = createAdminClient() as any
  const { data: conns, error } = await admin.from('member_calendar_connection').select('*').eq('member_id', memberId).eq('status', 'connected')
  if (error) return { found: 0, error: missing(error.message) ? CALENDAR_MIGRATION_HINT : error.message }
  let found = 0
  for (const c of conns ?? []) {
    try {
      const events = await listUpcomingEvents(await calendarAccessToken(decryptSecret(c.secret_enc)), 90)
      const dressy = events.map((e) => ({ e, read: readCalendarOccasion(e.title, e.location) })).filter((x) => x.read)
      const { data: have } = await admin.from('member_calendar_event').select('event_id, source_id, status').eq('connection_id', c.connection_id)
      const bySource = new Map<string, any>((have ?? []).map((r: any) => [r.source_id, r]))
      const now = new Date().toISOString()
      for (const { e, read } of dressy) {
        const row = { title: e.title, starts_at: e.startsAt, ends_at: e.endsAt, all_day: e.allDay, location: e.location, occasion: read!.occasion, updated_at: now }
        const existing = bySource.get(e.id)
        if (existing) await admin.from('member_calendar_event').update(row).eq('event_id', existing.event_id)
        else await admin.from('member_calendar_event').insert({ ...row, member_id: memberId, connection_id: c.connection_id, source_id: e.id })
        bySource.delete(e.id)
      }
      // Gone from her calendar and never acted on: gone from here too.
      const stale = [...bySource.values()].filter((r) => r.status === 'suggested').map((r) => r.event_id)
      if (stale.length) await admin.from('member_calendar_event').delete().in('event_id', stale)
      found += dressy.length
      await admin.from('member_calendar_connection').update({ last_synced_at: now, status: 'connected', error: null }).eq('connection_id', c.connection_id)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Calendar sync failed'
      await admin.from('member_calendar_connection').update({ status: 'error', error: msg.slice(0, 300) }).eq('connection_id', c.connection_id)
      return { found, error: msg }
    }
  }
  return { found }
}

export async function listUpcoming(memberId: string): Promise<CalendarEventView[]> {
  const admin = createAdminClient() as any
  const { data, error } = await admin.from('member_calendar_event')
    .select('event_id, title, starts_at, ends_at, all_day, location, occasion, status')
    .eq('member_id', memberId).neq('status', 'ignored').gte('starts_at', new Date(Date.now() - 86_400_000).toISOString()).order('starts_at').limit(80)
  if (error) throw new Error(error.message)
  return data ?? []
}

/** She wants an outfit for this: it joins the known events the studio already plans around. */
export async function planEvent(memberId: string, eventId: string): Promise<{ error?: string }> {
  const admin = createAdminClient() as any
  const { data: e } = await admin.from('member_calendar_event').select('*').eq('event_id', eventId).eq('member_id', memberId).maybeSingle()
  if (!e) return { error: 'Event not found' }
  if (e.status === 'planning') return {}
  const { data: known, error } = await admin.from('pilot_known_event').insert({ member_id: memberId, label: e.title, event_date: String(e.starts_at).slice(0, 10) }).select('event_id').single()
  if (error) return { error: error.message }
  await admin.from('member_calendar_event').update({ status: 'planning', known_event_id: known.event_id, updated_at: new Date().toISOString() }).eq('event_id', eventId)
  return {}
}

export async function setEventStatus(memberId: string, eventId: string, status: 'suggested' | 'ignored'): Promise<{ error?: string }> {
  const admin = createAdminClient() as any
  const { data: e } = await admin.from('member_calendar_event').select('known_event_id').eq('event_id', eventId).eq('member_id', memberId).maybeSingle()
  if (!e) return { error: 'Event not found' }
  if (e.known_event_id) await admin.from('pilot_known_event').delete().eq('event_id', e.known_event_id).eq('member_id', memberId)
  const { error } = await admin.from('member_calendar_event').update({ status, known_event_id: null, updated_at: new Date().toISOString() }).eq('event_id', eventId)
  return error ? { error: error.message } : {}
}
