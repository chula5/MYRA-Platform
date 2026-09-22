// THE JOURNEY'S VOCABULARY — the half of it that both sides share.
//
// Kept apart from client-journey.ts for one hard reason: that file reaches the
// database, so it imports next/headers, and a client component that imports it
// pulls a server-only module into the browser bundle and fails the build. The
// JOURNEY tab and the replay player need the room names, the event words, the
// duration formatting and the shapes — and none of that needs a database.
//
// So: names, types and pure functions live here and run anywhere. Reads and
// writes live in client-journey.ts and run only on the server.

// ── Rooms ───────────────────────────────────────────────────────────────────

/** Her rooms, mirroring RoomNav's RoomId. Plain data, so the aggregation never
 *  has to import the client component that draws them. */
export const ROOM_LABEL: Record<string, string> = {
  for_you: 'FOR YOU',
  all_looks: 'YOUR LOOKS',
  dressing_room: 'DRESSING ROOM',
  inspiration: 'INSPIRATION',
  magazine: 'MYRA MAGAZINE',
  threads: 'THREADS',
  profile: 'YOU',
}

// ── Events ──────────────────────────────────────────────────────────────────

export const EVENT_TYPES = [
  'session_start', 'page_view', 'room_open', 'click', 'look_open', 'look_view',
  'item_open', 'click_out', 'scroll', 'search', 'chat_send', 'save', 'upload',
  'verdict', 'idle', 'resume', 'session_end',
] as const
export type JourneyEventType = (typeof EVENT_TYPES)[number]

export const EVENT_TYPE_SET: ReadonlySet<string> = new Set<string>(EVENT_TYPES)

/** How each event reads in the replay's running log. */
export const EVENT_LABEL: Record<JourneyEventType, string> = {
  session_start: 'OPENED THE APP',
  page_view: 'VIEWED',
  room_open: 'WENT INTO',
  click: 'TAPPED',
  look_open: 'OPENED LOOK',
  look_view: 'LOOKED AT',
  item_open: 'OPENED PIECE',
  click_out: 'CLICKED THROUGH TO',
  scroll: 'SCROLLED',
  search: 'SEARCHED',
  chat_send: 'ASKED',
  save: 'SAVED',
  upload: 'UPLOADED',
  verdict: 'SAID',
  idle: 'LEFT THE TAB',
  resume: 'CAME BACK',
  session_end: 'CLOSED THE APP',
}

/** Events that mean she did something, as opposed to the app noting state.
 *  This is what "things she tapped" counts — a scroll and an idle are not
 *  decisions, and padding the number with them would flatter the pilot. */
export const DELIBERATE: ReadonlySet<string> = new Set([
  'click', 'look_open', 'item_open', 'click_out', 'search', 'chat_send', 'save', 'upload', 'verdict',
])

// ── Shapes ──────────────────────────────────────────────────────────────────

export interface IncomingEvent {
  type: string
  ms_offset?: number
  seq?: number
  room?: string | null
  path?: string | null
  label?: string | null
  target_kind?: string | null
  target_id?: string | null
  meta?: Record<string, unknown> | null
}

export interface SessionStartInput {
  sessionId: string
  memberId: string
  authUserId: string | null
  entryPath: string
  isReturning: boolean
  device: string | null
  viewportW: number | null
  viewportH: number | null
  userAgent: string | null
  country: string | null
  referrer: string | null
  /** When the browser says the visit began, in epoch ms. A reload re-announces
   *  the same visit, and without this the upsert would stamp `started_at` as
   *  now every time — turning a twenty-minute visit into a one-minute one. */
  startedAtMs?: number | null
}

export interface JourneyEvent {
  eventId: number
  msOffset: number
  seq: number
  at: string
  type: JourneyEventType
  room: string | null
  path: string | null
  label: string | null
  targetKind: string | null
  targetId: string | null
  meta: Record<string, any>
}

export interface JourneySessionSummary {
  sessionId: string
  memberId: string
  memberName: string
  startedAt: string
  lastSeenAt: string
  /** Wall-clock from first to last sign of life. */
  elapsedMs: number
  /** Time the tab was actually in front of her — what "time on app" means here. */
  activeMs: number
  device: string | null
  country: string | null
  entryPath: string | null
  isReturning: boolean
  hasRecording: boolean
  eventCount: number
  actions: number
  rooms: string[]
  clickOuts: number
  looksOpened: number
  searches: number
  questions: number
}

export interface RankRow {
  label: string
  value: number
  note?: string
}

export interface JourneyOverview {
  /** False until 0063_client_journey.sql has been run. */
  available: boolean
  days: number
  members: { memberId: string; name: string; hasLogin: boolean }[]
  /** The member this view is filtered to, or null for everyone. */
  memberId: string | null
  totals: {
    sessions: number
    membersSeen: number
    daysActive: number
    activeMs: number
    avgActiveMs: number
    medianActiveMs: number
    events: number
    actions: number
    clickOuts: number
    retailerClicks: number
    looksOpened: number
    searches: number
    questions: number
    roomsPerSession: number
    recordings: number
  }
  deltas: {
    sessions: number | null
    activeMs: number | null
    clickOuts: number | null
  }
  daily: { key: string; label: string; sessions: number; activeMinutes: number; actions: number }[]
  rooms: RankRow[]
  taps: RankRow[]
  clickOuts: RankRow[]
  perMember: {
    memberId: string
    name: string
    sessions: number
    activeMs: number
    actions: number
    clickOuts: number
    lastSeenAt: string | null
    daysActive: number
  }[]
  sessions: JourneySessionSummary[]
}

export interface JourneyReplay {
  available: boolean
  session: JourneySessionSummary | null
  events: JourneyEvent[]
  /** rrweb events, flattened from their chunks in order. Empty when the visit
   *  was not recorded (recording capped, or blocked in her browser). */
  recording: any[]
}

// ── Maths ───────────────────────────────────────────────────────────────────

/** A visit is never allowed to be longer than this. A laptop lid closed
 *  mid-session leaves a last_seen_at that is a lie, and an afternoon-long
 *  "styling session" in the averages is worse than a missing one. */
export const MAX_SESSION_MS = 4 * 60 * 60 * 1000

/**
 * What a visit is worth in minutes.
 *
 * active_ms is the truthful number — the tracker stops the clock when the tab
 * is hidden. It is zero for a visit that closed before its first heartbeat, and
 * for anything recorded before that column was being written; there, elapsed
 * time is the honest fallback.
 */
export function sessionActiveMs(row: {
  active_ms?: number | null
  started_at: string
  last_seen_at: string
}): number {
  const declared = Number(row.active_ms ?? 0)
  if (Number.isFinite(declared) && declared > 0) return Math.min(declared, MAX_SESSION_MS)
  const elapsed = new Date(row.last_seen_at).getTime() - new Date(row.started_at).getTime()
  if (!Number.isFinite(elapsed) || elapsed <= 0) return 0
  return Math.min(elapsed, MAX_SESSION_MS)
}

/**
 * A browser-supplied start time, accepted only where it could be true.
 *
 * It is the browser's clock, so it is not trusted: a future timestamp, or one
 * older than a session could possibly be, is discarded in favour of the
 * server's own now. What it can do at worst is misstate the length of its own
 * visit, which `sessionActiveMs` caps on the way out anyway.
 */
export function resolveStartedAt(ms: number | null | undefined, now = Date.now()): string | null {
  const n = Number(ms)
  if (!Number.isFinite(n) || n <= 0) return null
  if (n > now + 60_000) return null
  if (n < now - MAX_SESSION_MS) return null
  return new Date(n).toISOString()
}

export function median(values: number[]): number {
  if (!values.length) return 0
  const s = [...values].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2)
}

/** Fractional change, or null when the baseline is empty — her first-ever week
 *  is not an infinite improvement on the week before it. */
export function periodChange(curr: number, prev: number): number | null {
  if (!Number.isFinite(prev) || prev === 0) return null
  return (curr - prev) / Math.abs(prev)
}

// ── Words ───────────────────────────────────────────────────────────────────

/** "4M 12S" — durations here are minutes, not hours, and a bare "252s" reads
 *  as noise next to a session count. */
export function fmtDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0S'
  const total = Math.round(ms / 1000)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h) return `${h}H ${m}M`
  if (m) return `${m}M ${s}S`
  return `${s}S`
}

/** Clock position inside a replay, "1:04". */
export function fmtClock(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

/** A sentence for the replay log: "CLICKED THROUGH TO NET-A-PORTER". */
export function describeEvent(e: JourneyEvent): string {
  const verb = EVENT_LABEL[e.type] ?? String(e.type).toUpperCase()
  const room = e.room ? ROOM_LABEL[e.room] ?? e.room.toUpperCase() : ''
  switch (e.type) {
    case 'session_start':
    case 'session_end':
    case 'idle':
    case 'resume':
      return verb
    case 'room_open':
    case 'page_view':
      return `${verb} ${room || e.path || ''}`.trim()
    case 'scroll':
      return `${verb} ${Math.round(Number(e.meta?.depth ?? 0) * 100)}% OF ${room || 'THE PAGE'}`
    case 'search':
      return `${verb} "${e.label ?? ''}"`
    case 'chat_send':
      return `${verb} "${e.label ?? ''}"`
    default:
      return `${verb} ${e.label ?? ''}`.trim()
  }
}
