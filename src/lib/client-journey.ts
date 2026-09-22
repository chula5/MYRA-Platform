// HER SIDE OF THE PILOT — the half that touches the database.
//
// Everything the client area records about a member's own visits, and the
// aggregation that turns it into the JOURNEY tab: how often she opens the app,
// how long she stays, which rooms she walks into, what she touches, and what
// she clicks through to a retailer.
//
// SERVER ONLY. The names, shapes and maths the browser also needs live in
// ./journey, which imports nothing — a client component that reached in here
// would drag next/headers into its bundle and fail the build.
//
// Two rules are inherited from metrics-core and hold here too:
//   1. A missing table is not an error. 0063 gets run late; every read reports
//      `available: false` and the tab says "run the migration" rather than 500ing.
//   2. Supabase caps a response at 1000 rows, so anything unbounded pages.
//
// A third rule is specific to this file: WRITES NEVER THROW. The tracker calls
// into these from a member's live session. Analytics that can break her app is
// worse than no analytics, so every write swallows and returns quietly.

import { createAdminClient } from '@/lib/supabase-server'
import { dayBuckets, isMissingTable, readSince, type Bucket } from '@/lib/metrics-core'
import {
  DELIBERATE,
  EVENT_TYPE_SET,
  ROOM_LABEL,
  median,
  periodChange,
  resolveStartedAt,
  sessionActiveMs,
  type IncomingEvent,
  type JourneyEvent,
  type JourneyOverview,
  type JourneyReplay,
  type JourneySessionSummary,
  type RankRow,
  type SessionStartInput,
} from '@/lib/journey'

// Re-exported so a server caller has one import for the whole feature.
export * from '@/lib/journey'

// ── Writes (from the ingest route; never throw) ─────────────────────────────

/**
 * Register a visit. Upsert rather than insert: a page reload inside the same
 * browser session reuses the id, and a second insert would lose the events
 * already hanging off the first.
 */
export async function startJourneySession(input: SessionStartInput): Promise<{ ok: boolean }> {
  try {
    const admin = createAdminClient()
    const now = new Date().toISOString()
    const { error } = await (admin.from('client_session') as any).upsert(
      {
        session_id: input.sessionId,
        member_id: input.memberId,
        auth_user_id: input.authUserId,
        started_at: resolveStartedAt(input.startedAtMs) ?? now,
        last_seen_at: now,
        entry_path: (input.entryPath || '/me').slice(0, 300),
        is_returning: input.isReturning,
        device: input.device,
        viewport_w: input.viewportW,
        viewport_h: input.viewportH,
        user_agent: input.userAgent?.slice(0, 400) ?? null,
        country: input.country,
        referrer: input.referrer?.slice(0, 300) ?? null,
      },
      { onConflict: 'session_id', ignoreDuplicates: false },
    )
    if (error && !isMissingTable(error)) console.error('[journey start]', error.message)
    return { ok: !error }
  } catch {
    return { ok: false }
  }
}

/**
 * Does this visit belong to this member?
 *
 * The browser chooses its own session id, so without this check a client could
 * post events onto another member's visit simply by guessing one — and the
 * replay of that visit would then contain somebody else's actions. Every write
 * that is not the initial start goes through here first.
 *
 * An id that matches no row is refused rather than accepted: a session always
 * announces itself with `start` before it sends anything else.
 */
export async function sessionBelongsTo(sessionId: string, memberId: string): Promise<boolean> {
  try {
    const admin = createAdminClient()
    const { data, error } = await admin
      .from('client_session')
      .select('member_id')
      .eq('session_id', sessionId)
      .maybeSingle()
    if (error || !data) return false
    return (data as any).member_id === memberId
  } catch {
    return false
  }
}

/** Heartbeat. `activeMs` is the tab-visible total the tracker has counted so
 *  far — sent whole rather than as an increment, so a duplicated or retried
 *  beacon cannot inflate her time on the app. */
export async function pingJourneySession(
  sessionId: string,
  memberId: string,
  activeMs: number,
  ended = false,
): Promise<void> {
  try {
    const admin = createAdminClient()
    const now = new Date().toISOString()
    const patch: Record<string, unknown> = { last_seen_at: now }
    if (Number.isFinite(activeMs) && activeMs >= 0) patch.active_ms = Math.round(activeMs)
    if (ended) patch.ended_at = now
    await (admin.from('client_session') as any)
      .update(patch)
      .eq('session_id', sessionId)
      .eq('member_id', memberId)
  } catch {
    /* swallow */
  }
}

const MAX_EVENTS_PER_FLUSH = 200

/** Append a batch of events to a visit. Unknown types are dropped rather than
 *  rejected: an old tab after a deploy should still report what it can. */
export async function recordJourneyEvents(
  sessionId: string,
  memberId: string,
  events: IncomingEvent[],
): Promise<{ written: number }> {
  try {
    if (!Array.isArray(events) || !events.length) return { written: 0 }
    const rows = events
      .filter((e) => e && EVENT_TYPE_SET.has(e.type))
      .slice(0, MAX_EVENTS_PER_FLUSH)
      .map((e) => ({
        session_id: sessionId,
        member_id: memberId,
        ms_offset: clampInt(e.ms_offset, 0, 2_147_483_000),
        seq: clampInt(e.seq, 0, 2_147_483_000),
        type: e.type,
        room: str(e.room, 40),
        path: str(e.path, 300),
        label: str(e.label, 200),
        target_kind: str(e.target_kind, 40),
        target_id: str(e.target_id, 100),
        meta: e.meta && typeof e.meta === 'object' ? e.meta : {},
      }))
    if (!rows.length) return { written: 0 }
    const admin = createAdminClient()
    const { error } = await (admin.from('client_event') as any).insert(rows)
    if (error && !isMissingTable(error)) console.error('[journey events]', error.message)
    return { written: error ? 0 : rows.length }
  } catch {
    return { written: 0 }
  }
}

/** Store one slice of the DOM recording. The unique (session, index) means a
 *  retried beacon overwrites its own chunk instead of duplicating the visit. */
export async function saveRecordingChunk(
  sessionId: string,
  memberId: string,
  chunkIndex: number,
  events: unknown[],
): Promise<void> {
  try {
    if (!Array.isArray(events) || !events.length) return
    const admin = createAdminClient()
    const { error } = await (admin.from('client_recording_chunk') as any).upsert(
      { session_id: sessionId, member_id: memberId, chunk_index: chunkIndex, events },
      { onConflict: 'session_id,chunk_index' },
    )
    if (error) {
      if (!isMissingTable(error)) console.error('[journey recording]', error.message)
      return
    }
    await (admin.from('client_session') as any)
      .update({ has_recording: true })
      .eq('session_id', sessionId)
  } catch {
    /* swallow */
  }
}

function clampInt(v: unknown, min: number, max: number): number {
  const n = Math.round(Number(v))
  if (!Number.isFinite(n)) return min
  return Math.min(max, Math.max(min, n))
}

function str(v: unknown, max: number): string | null {
  if (v === null || v === undefined) return null
  const s = String(v).trim()
  return s ? s.slice(0, max) : null
}

// ── Reads (the JOURNEY tab) ─────────────────────────────────────────────────

interface SessionRow {
  session_id: string
  member_id: string
  started_at: string
  last_seen_at: string
  active_ms: number | null
  device: string | null
  country: string | null
  entry_path: string | null
  is_returning: boolean
  has_recording: boolean
}

interface EventRow {
  session_id: string
  member_id: string
  at: string
  type: string
  room: string | null
  label: string | null
  target_kind: string | null
  meta: Record<string, any> | null
}

function bucketOf(buckets: Bucket[], iso: string): number {
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return -1
  for (let i = 0; i < buckets.length; i++) {
    if (t >= buckets[i].start.getTime() && t < buckets[i].end.getTime()) return i
  }
  return -1
}

function rank(counts: Map<string, number>, limit = 10): RankRow[] {
  return Array.from(counts.entries())
    .filter(([label]) => label)
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, limit)
}

/** Every member, with whether she can actually sign in — a member with no login
 *  showing zero sessions is not a member who ignored the app. */
async function loadMembers(): Promise<{ memberId: string; name: string; hasLogin: boolean }[]> {
  try {
    const admin = createAdminClient()
    const { data } = await admin
      .from('pilot_member')
      .select('member_id, name, auth_user_id, is_synthetic')
      .order('name')
    return ((data ?? []) as any[])
      .filter((m) => !m.is_synthetic)
      .map((m) => ({ memberId: m.member_id, name: m.name, hasLogin: Boolean(m.auth_user_id) }))
  } catch {
    return []
  }
}

/**
 * Retailer click-throughs from the outbound log (item_click, 0025) for these
 * members' accounts. The journey's own `click_out` events cover what happened
 * inside a tracked visit; this is the same question asked of the log the rest of
 * the admin trusts, so the two can be read against each other.
 */
async function retailerClickCount(authUserIds: string[], since: Date): Promise<number> {
  if (!authUserIds.length) return 0
  const { rows } = await readSince<{ user_id: string }>(
    'item_click', 'clicked_at', since, 'user_id',
    { refine: (q) => q.in('user_id', authUserIds) },
  )
  return rows.length
}

export async function loadJourneyOverview(
  opts: { memberId?: string | null; days?: number } = {},
): Promise<JourneyOverview> {
  const days = Math.min(120, Math.max(7, opts.days ?? 30))
  const memberId = opts.memberId || null
  const members = await loadMembers()

  const buckets = dayBuckets(days)
  const since = buckets[0].start
  // The window before this one, for the period-over-period chips.
  const prevSince = new Date(since)
  prevSince.setUTCDate(prevSince.getUTCDate() - days)

  const empty: JourneyOverview = {
    available: false,
    days,
    members,
    memberId,
    totals: {
      sessions: 0, membersSeen: 0, daysActive: 0, activeMs: 0, avgActiveMs: 0,
      medianActiveMs: 0, events: 0, actions: 0, clickOuts: 0, retailerClicks: 0,
      looksOpened: 0, searches: 0, questions: 0, roomsPerSession: 0, recordings: 0,
    },
    deltas: { sessions: null, activeMs: null, clickOuts: null },
    daily: buckets.map((b) => ({ key: b.key, label: b.label, sessions: 0, activeMinutes: 0, actions: 0 })),
    rooms: [], taps: [], clickOuts: [], perMember: [], sessions: [],
  }

  const refineMember = (q: any) => (memberId ? q.eq('member_id', memberId) : q)

  const [sessionRead, prevSessionRead] = await Promise.all([
    readSince<SessionRow>(
      'client_session', 'started_at', since,
      'session_id, member_id, started_at, last_seen_at, active_ms, device, country, entry_path, is_returning, has_recording',
      { refine: refineMember },
    ),
    readSince<SessionRow>(
      'client_session', 'started_at', prevSince,
      'session_id, member_id, started_at, last_seen_at, active_ms',
      { refine: (q) => refineMember(q).lt('started_at', since.toISOString()) },
    ),
  ])

  if (!sessionRead.available) return empty

  const sessions = sessionRead.rows

  const [eventRead, prevEventRead] = await Promise.all([
    readSince<EventRow>(
      'client_event', 'at', since,
      'session_id, member_id, at, type, room, label, target_kind, meta',
      { refine: refineMember },
    ),
    readSince<EventRow>(
      'client_event', 'at', prevSince, 'at, type',
      { refine: (q) => refineMember(q).lt('at', since.toISOString()).eq('type', 'click_out') },
    ),
  ])

  const events = eventRead.rows
  const nameOf = new Map(members.map((m) => [m.memberId, m.name]))

  // ── Per-session rollup ────────────────────────────────────────────────────
  const bySession = new Map<string, EventRow[]>()
  for (const e of events) {
    const list = bySession.get(e.session_id)
    if (list) list.push(e)
    else bySession.set(e.session_id, [e])
  }

  const summaries: JourneySessionSummary[] = sessions.map((s) => {
    const own = bySession.get(s.session_id) ?? []
    const rooms = new Set<string>()
    let actions = 0, clickOuts = 0, looksOpened = 0, searches = 0, questions = 0
    for (const e of own) {
      if (e.room) rooms.add(e.room)
      if (DELIBERATE.has(e.type)) actions++
      if (e.type === 'click_out') clickOuts++
      if (e.type === 'look_open') looksOpened++
      if (e.type === 'search') searches++
      if (e.type === 'chat_send') questions++
    }
    return {
      sessionId: s.session_id,
      memberId: s.member_id,
      memberName: nameOf.get(s.member_id) ?? 'UNKNOWN',
      startedAt: s.started_at,
      lastSeenAt: s.last_seen_at,
      elapsedMs: Math.max(0, new Date(s.last_seen_at).getTime() - new Date(s.started_at).getTime()),
      activeMs: sessionActiveMs(s),
      device: s.device,
      country: s.country,
      entryPath: s.entry_path,
      isReturning: s.is_returning,
      hasRecording: Boolean(s.has_recording),
      eventCount: own.length,
      actions,
      rooms: Array.from(rooms),
      clickOuts,
      looksOpened,
      searches,
      questions,
    }
  }).sort((a, b) => b.startedAt.localeCompare(a.startedAt))

  // ── Daily series ──────────────────────────────────────────────────────────
  const daily = buckets.map((b) => ({ key: b.key, label: b.label, sessions: 0, activeMinutes: 0, actions: 0 }))
  for (const s of summaries) {
    const i = bucketOf(buckets, s.startedAt)
    if (i < 0) continue
    daily[i].sessions++
    daily[i].activeMinutes += s.activeMs / 60000
  }
  for (const e of events) {
    if (!DELIBERATE.has(e.type)) continue
    const i = bucketOf(buckets, e.at)
    if (i >= 0) daily[i].actions++
  }
  for (const d of daily) d.activeMinutes = Math.round(d.activeMinutes * 10) / 10

  // ── Rankings ──────────────────────────────────────────────────────────────
  const roomCounts = new Map<string, number>()
  const tapCounts = new Map<string, number>()
  const outCounts = new Map<string, number>()
  for (const e of events) {
    if ((e.type === 'room_open' || e.type === 'page_view') && e.room) {
      roomCounts.set(e.room, (roomCounts.get(e.room) ?? 0) + 1)
    }
    if (e.type === 'click' && e.label) {
      tapCounts.set(e.label.toUpperCase(), (tapCounts.get(e.label.toUpperCase()) ?? 0) + 1)
    }
    if (e.type === 'click_out') {
      const host = String(e.meta?.host ?? e.label ?? 'RETAILER').toUpperCase()
      outCounts.set(host, (outCounts.get(host) ?? 0) + 1)
    }
  }

  // ── Per member ────────────────────────────────────────────────────────────
  const perMemberMap = new Map<string, JourneyOverview['perMember'][number] & { dayKeys: Set<string> }>()
  for (const m of members) {
    if (memberId && m.memberId !== memberId) continue
    perMemberMap.set(m.memberId, {
      memberId: m.memberId, name: m.name, sessions: 0, activeMs: 0,
      actions: 0, clickOuts: 0, lastSeenAt: null, daysActive: 0, dayKeys: new Set<string>(),
    })
  }
  for (const s of summaries) {
    const row = perMemberMap.get(s.memberId)
    if (!row) continue
    row.sessions++
    row.activeMs += s.activeMs
    row.actions += s.actions
    row.clickOuts += s.clickOuts
    row.dayKeys.add(s.startedAt.slice(0, 10))
    if (!row.lastSeenAt || s.lastSeenAt > row.lastSeenAt) row.lastSeenAt = s.lastSeenAt
  }
  const perMember = Array.from(perMemberMap.values())
    .map(({ dayKeys, ...rest }) => ({ ...rest, daysActive: dayKeys.size }))
    .sort((a, b) => b.activeMs - a.activeMs)

  // ── Totals ────────────────────────────────────────────────────────────────
  const activeList = summaries.map((s) => s.activeMs).filter((n) => n > 0)
  const totalActive = activeList.reduce((a, b) => a + b, 0)
  const distinctDays = new Set(summaries.map((s) => s.startedAt.slice(0, 10)))
  const roomsSeen = summaries.reduce((a, s) => a + s.rooms.length, 0)

  const authIds = (await loadAuthIds(memberId)).filter(Boolean)
  const retailerClicks = await retailerClickCount(authIds, since)

  const prevSessions = prevSessionRead.available ? prevSessionRead.rows.length : 0
  const prevActive = prevSessionRead.available
    ? prevSessionRead.rows.reduce((a, r) => a + sessionActiveMs(r), 0)
    : 0
  const prevClickOuts = prevEventRead.available ? prevEventRead.rows.length : 0
  const clickOuts = summaries.reduce((a, s) => a + s.clickOuts, 0)

  return {
    available: true,
    days,
    members,
    memberId,
    totals: {
      sessions: summaries.length,
      membersSeen: new Set(summaries.map((s) => s.memberId)).size,
      daysActive: distinctDays.size,
      activeMs: totalActive,
      avgActiveMs: activeList.length ? Math.round(totalActive / activeList.length) : 0,
      medianActiveMs: median(activeList),
      events: events.length,
      actions: summaries.reduce((a, s) => a + s.actions, 0),
      clickOuts,
      retailerClicks,
      looksOpened: summaries.reduce((a, s) => a + s.looksOpened, 0),
      searches: summaries.reduce((a, s) => a + s.searches, 0),
      questions: summaries.reduce((a, s) => a + s.questions, 0),
      roomsPerSession: summaries.length ? Math.round((roomsSeen / summaries.length) * 10) / 10 : 0,
      recordings: summaries.filter((s) => s.hasRecording).length,
    },
    deltas: {
      sessions: periodChange(summaries.length, prevSessions),
      activeMs: periodChange(totalActive, prevActive),
      clickOuts: periodChange(clickOuts, prevClickOuts),
    },
    daily,
    rooms: rank(roomCounts).map((r) => ({ ...r, label: ROOM_LABEL[r.label] ?? r.label.toUpperCase() })),
    taps: rank(tapCounts, 12),
    clickOuts: rank(outCounts, 10),
    perMember,
    sessions: summaries.slice(0, 200),
  }
}

async function loadAuthIds(memberId: string | null): Promise<string[]> {
  try {
    const admin = createAdminClient()
    let q = admin.from('pilot_member').select('auth_user_id')
    if (memberId) q = q.eq('member_id', memberId) as any
    const { data } = await q
    return ((data ?? []) as any[]).map((r) => r.auth_user_id).filter(Boolean)
  } catch {
    return []
  }
}

/** One visit, in full: every event in order, plus the DOM recording if there
 *  is one. This is what the replay player is handed. */
export async function loadJourneyReplay(sessionId: string): Promise<JourneyReplay> {
  const blank: JourneyReplay = { available: false, session: null, events: [], recording: [] }
  if (!sessionId) return blank
  try {
    const admin = createAdminClient()
    const { data: sessionRow, error } = await admin
      .from('client_session')
      .select('*')
      .eq('session_id', sessionId)
      .maybeSingle()
    if (error) return isMissingTable(error) ? blank : { ...blank, available: true }
    if (!sessionRow) return { ...blank, available: true }

    const s = sessionRow as any
    const [{ data: eventRows }, { data: chunkRows }, { data: member }] = await Promise.all([
      // event_id is the final tiebreaker, not decoration: a reload mid-visit
      // restarts the tracker's `seq` at zero, so two events can carry the same
      // seq. Insertion order is the only thing that never repeats.
      admin.from('client_event').select('*').eq('session_id', sessionId)
        .order('ms_offset', { ascending: true })
        .order('seq', { ascending: true })
        .order('event_id', { ascending: true })
        .limit(5000),
      admin.from('client_recording_chunk').select('chunk_index, events').eq('session_id', sessionId)
        .order('chunk_index', { ascending: true }),
      admin.from('pilot_member').select('name').eq('member_id', s.member_id).maybeSingle(),
    ])

    const events: JourneyEvent[] = ((eventRows ?? []) as any[]).map((e) => ({
      eventId: Number(e.event_id),
      msOffset: Number(e.ms_offset ?? 0),
      seq: Number(e.seq ?? 0),
      at: e.at,
      type: e.type,
      room: e.room ?? null,
      path: e.path ?? null,
      label: e.label ?? null,
      targetKind: e.target_kind ?? null,
      targetId: e.target_id ?? null,
      meta: e.meta ?? {},
    }))

    const recording: any[] = []
    for (const c of (chunkRows ?? []) as any[]) {
      if (Array.isArray(c.events)) recording.push(...c.events)
    }

    const rooms = Array.from(new Set(events.map((e) => e.room).filter(Boolean) as string[]))
    return {
      available: true,
      session: {
        sessionId: s.session_id,
        memberId: s.member_id,
        memberName: (member as any)?.name ?? 'UNKNOWN',
        startedAt: s.started_at,
        lastSeenAt: s.last_seen_at,
        elapsedMs: Math.max(0, new Date(s.last_seen_at).getTime() - new Date(s.started_at).getTime()),
        activeMs: sessionActiveMs(s),
        device: s.device ?? null,
        country: s.country ?? null,
        entryPath: s.entry_path ?? null,
        isReturning: Boolean(s.is_returning),
        hasRecording: recording.length > 0,
        eventCount: events.length,
        actions: events.filter((e) => DELIBERATE.has(e.type)).length,
        rooms,
        clickOuts: events.filter((e) => e.type === 'click_out').length,
        looksOpened: events.filter((e) => e.type === 'look_open').length,
        searches: events.filter((e) => e.type === 'search').length,
        questions: events.filter((e) => e.type === 'chat_send').length,
      },
      events,
      recording,
    }
  } catch (err) {
    console.error('[journey replay]', err)
    return blank
  }
}
