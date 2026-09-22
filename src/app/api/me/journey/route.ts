// The client area's own telemetry, coming back in.
//
// A route handler rather than a server action for one reason: Next runs server
// actions SEQUENTIALLY, and this endpoint fires every few seconds from a live
// member's browser. Queued behind it would be the action that loads her looks.
// A route handler runs in parallel and never blocks her page.
//
// It is also the only shape that survives the tab closing. The last flush of a
// visit goes out from `pagehide` with `keepalive: true`, which server actions
// cannot express.
//
// WHO IS WRITING IS NEVER TAKEN FROM THE BODY. The browser posts a session id
// and a list of events; the member is resolved from the signed-in user, and a
// session that belongs to someone else is refused. Chloe previewing the client
// area in HER VIEW resolves to no member at all, so her own browsing is never
// recorded as a client's.

import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { resolveClientMember } from '@/lib/client-member'
import {
  startJourneySession,
  recordJourneyEvents,
  saveRecordingChunk,
  pingJourneySession,
  sessionBelongsTo,
  type IncomingEvent,
} from '@/lib/client-journey'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Analytics never reports failure back to her browser in a way that could be
// retried into a loop. Everything answers 200 with a flag.
const ok = (extra: Record<string, unknown> = {}) => NextResponse.json({ ok: true, ...extra })
const nope = (reason: string) => NextResponse.json({ ok: false, reason })

function country(): string | null {
  try {
    const h = headers()
    return h.get('x-vercel-ip-country') || h.get('cf-ipcountry') || null
  } catch {
    return null
  }
}

export async function POST(request: Request) {
  let body: any
  try {
    body = await request.json()
  } catch {
    return nope('bad-json')
  }

  const sessionId = String(body?.sessionId ?? '')
  if (!UUID_RE.test(sessionId)) return nope('bad-session')

  // Her identity, from the cookie — never from the payload. `resolveClientMember`
  // with no argument answers only for the signed-in member, so an admin (who has
  // no pilot_member row of her own) resolves to null and is dropped here.
  const member = await resolveClientMember()
  if (!member || member.test) return nope('no-member')

  const kind = String(body?.kind ?? '')

  if (kind === 'start') {
    const h = (() => { try { return headers() } catch { return null } })()
    await startJourneySession({
      sessionId,
      memberId: member.memberId,
      authUserId: member.authUserId,
      entryPath: String(body?.entryPath ?? '/me'),
      isReturning: Boolean(body?.isReturning),
      device: typeof body?.device === 'string' ? body.device.slice(0, 20) : null,
      viewportW: Number.isFinite(body?.viewportW) ? Math.round(body.viewportW) : null,
      viewportH: Number.isFinite(body?.viewportH) ? Math.round(body.viewportH) : null,
      userAgent: h?.get('user-agent') ?? null,
      country: country(),
      referrer: typeof body?.referrer === 'string' ? body.referrer : null,
      startedAtMs: Number(body?.startedAtMs) || null,
    })
    return ok()
  }

  // Everything past `start` writes into an existing visit, so it has to be one
  // of hers.
  if (!(await sessionBelongsTo(sessionId, member.memberId))) return nope('not-yours')

  if (kind === 'events') {
    const events: IncomingEvent[] = Array.isArray(body?.events) ? body.events : []
    const [{ written }] = await Promise.all([
      recordJourneyEvents(sessionId, member.memberId, events),
      pingJourneySession(sessionId, member.memberId, Number(body?.activeMs ?? 0), Boolean(body?.ended)),
    ])
    return ok({ written })
  }

  if (kind === 'recording') {
    const chunkIndex = Number(body?.chunkIndex)
    const events = Array.isArray(body?.events) ? body.events : []
    if (!Number.isFinite(chunkIndex) || chunkIndex < 0) return nope('bad-chunk')
    await saveRecordingChunk(sessionId, member.memberId, Math.round(chunkIndex), events)
    return ok()
  }

  if (kind === 'ping') {
    await pingJourneySession(
      sessionId,
      member.memberId,
      Number(body?.activeMs ?? 0),
      Boolean(body?.ended),
    )
    return ok()
  }

  return nope('bad-kind')
}
