// GOOGLE CALENDAR — read-only, through the same Google app as Connect Gmail
// (GOOGLE_CLIENT_ID / SECRET / REDIRECT_URI), with one extra permission:
// calendar.events.readonly. It returns to the SAME redirect URI as Gmail, with
// `kind: 'calendar'` in the signed state, so nothing new needs registering in
// Google Cloud beyond enabling the Calendar API and adding the scope.

import 'server-only'

const SCOPES = 'https://www.googleapis.com/auth/calendar.events.readonly https://www.googleapis.com/auth/userinfo.email'

export function calendarConfigured(): boolean {
  return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_REDIRECT_URI)
}

export function calendarAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID ?? '',
    redirect_uri: process.env.GOOGLE_REDIRECT_URI ?? '',
    response_type: 'code',
    scope: SCOPES,
    access_type: 'offline',
    prompt: 'consent',
    state,
  })
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
}

async function tokenRequest(body: Record<string, string>): Promise<any> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID ?? '', client_secret: process.env.GOOGLE_CLIENT_SECRET ?? '', ...body }).toString(),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`Google token request failed: ${data?.error_description ?? data?.error ?? res.status}`)
  return data
}

export async function exchangeCalendarCode(code: string): Promise<{ refreshToken: string; email: string }> {
  const t = await tokenRequest({ code, grant_type: 'authorization_code', redirect_uri: process.env.GOOGLE_REDIRECT_URI ?? '' })
  if (!t.refresh_token) throw new Error('Google did not return a refresh token. Remove MYRA from your Google account permissions and connect again.')
  const who: any = await (await fetch('https://www.googleapis.com/oauth2/v2/userinfo', { headers: { Authorization: `Bearer ${t.access_token}` } })).json().catch(() => ({}))
  return { refreshToken: t.refresh_token, email: who.email ?? 'calendar' }
}

export async function calendarAccessToken(refreshToken: string): Promise<string> {
  return (await tokenRequest({ refresh_token: refreshToken, grant_type: 'refresh_token' })).access_token
}

export interface CalendarEvent { id: string; title: string; startsAt: string; endsAt: string | null; allDay: boolean; location: string | null }

/** Her primary calendar, from now, soonest first. Cancelled and declined events are left out. */
export async function listUpcomingEvents(accessToken: string, days = 90): Promise<CalendarEvent[]> {
  const out: CalendarEvent[] = []
  let pageToken: string | undefined
  const timeMin = new Date().toISOString()
  const timeMax = new Date(Date.now() + days * 86_400_000).toISOString()
  do {
    const q = new URLSearchParams({ timeMin, timeMax, singleEvents: 'true', orderBy: 'startTime', maxResults: '250', ...(pageToken ? { pageToken } : {}) })
    const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${q}`, { headers: { Authorization: `Bearer ${accessToken}` } })
    const data: any = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data?.error?.message ?? `Google Calendar returned ${res.status}`)
    for (const e of data.items ?? []) {
      if (e.status === 'cancelled' || !e.summary) continue
      if ((e.attendees ?? []).some((a: any) => a.self && a.responseStatus === 'declined')) continue
      const allDay = !!e.start?.date
      const startsAt = allDay ? `${e.start.date}T09:00:00.000Z` : e.start?.dateTime
      if (!startsAt) continue
      out.push({ id: String(e.id), title: String(e.summary).slice(0, 200), startsAt, endsAt: allDay ? (e.end?.date ? `${e.end.date}T09:00:00.000Z` : null) : e.end?.dateTime ?? null, allDay, location: e.location ? String(e.location).slice(0, 200) : null })
    }
    pageToken = data.nextPageToken
  } while (pageToken && out.length < 600)
  return out
}
