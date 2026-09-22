-- 0063_client_journey.sql
-- WHAT SHE ACTUALLY DID.
--
-- The pilot has measured the stylist's side since 0029 — looks composed, looks
-- sent, verdicts recorded. What it has never measured is HER side: whether she
-- opened the app at all, how long she stayed, which rooms she walked into and
-- what she touched once she was in them. A "no" on a look is the only signal
-- the pilot currently gets, and by then the interesting part already happened.
--
-- Three tables, one per grain:
--   client_session        — one visit. Answers "how often, how long".
--   client_event          — one action inside a visit. Answers "what she did".
--   client_recording_chunk— the DOM recording of a visit, so it can be watched.
--
-- IDENTITY IS RESOLVED SERVER-SIDE, ALWAYS. The browser posts a session id and
-- a list of events; it never asserts who it is. The ingest route reads the
-- signed-in user from the cookie and looks up pilot_member.auth_user_id itself.
-- A client therefore cannot write events onto another member's record.
--
-- Chloe's own browsing is not data. The admin previews the client area in HER
-- VIEW, which renders the same components under the same layout — so both the
-- tracker and the ingest route drop anything coming from ADMIN_USER_ID.
--
-- Same lock as every other pilot table: RLS on with zero policies, meaning only
-- the service-role client reaches it. Nothing here is readable from the site.

-- ── One visit ───────────────────────────────────────────────────────────────
create table if not exists public.client_session (
  session_id    uuid primary key,
  member_id     uuid not null references public.pilot_member(member_id) on delete cascade,
  auth_user_id  uuid,

  started_at    timestamptz not null default now(),
  -- Bumped by the heartbeat and by every event flush. Duration is
  -- last_seen_at - started_at: the same definition site_session (0013) uses, so
  -- the two dashboards cannot disagree about what "time on app" means.
  last_seen_at  timestamptz not null default now(),
  -- Counts only the time she was actually looking: the tracker stops the clock
  -- when the tab is hidden and restarts it when she comes back. Without this a
  -- tab left open all afternoon reads as a four-hour styling session.
  active_ms     bigint not null default 0,

  entry_path    text,
  -- False on her very first visit, true on every one after.
  is_returning  boolean not null default false,

  -- 'mobile' | 'tablet' | 'desktop', from the viewport at session start.
  device        text,
  viewport_w    int,
  viewport_h    int,
  user_agent    text,
  country       text,
  referrer      text,

  -- True once a recording exists for this visit, so the session list can show
  -- which rows are watchable without counting chunks.
  has_recording boolean not null default false,

  ended_at      timestamptz
);

create index if not exists idx_client_session_member
  on public.client_session (member_id, started_at desc);
create index if not exists idx_client_session_started
  on public.client_session (started_at desc);

alter table public.client_session enable row level security;

-- ── One action inside a visit ───────────────────────────────────────────────
create table if not exists public.client_event (
  event_id   bigserial primary key,
  session_id uuid not null references public.client_session(session_id) on delete cascade,
  member_id  uuid not null references public.pilot_member(member_id) on delete cascade,

  at         timestamptz not null default now(),
  -- Milliseconds since the session started. The replay scrubber runs off this
  -- rather than `at`, so playback keeps the real rhythm of the visit — the long
  -- pause on a look she was deciding about is the whole point.
  ms_offset  int not null default 0,
  -- Order within the session. Two events in the same millisecond still replay
  -- in the order they happened.
  seq        int not null default 0,

  type       text not null check (type in (
               'session_start','page_view','room_open','click','look_open',
               'look_view','item_open','click_out','scroll','search','chat_send',
               'save','upload','verdict','idle','resume','session_end')),

  -- Which of her rooms it happened in (RoomNav ids: for_you, all_looks,
  -- dressing_room, inspiration, magazine, threads, profile).
  room       text,
  path       text,
  -- What it reads as in the replay: "SENT LOOK 3", "BURBERRY TRENCH", "SHOP AT NET-A-PORTER".
  label      text,
  -- 'look' | 'item' | 'brand' | 'nav' | 'button' | 'link' | 'field'
  target_kind text,
  target_id  text,
  -- Everything that is only interesting for one event type: scroll depth,
  -- search query, click coordinates, the outbound host on a click_out.
  meta       jsonb not null default '{}'::jsonb
);

create index if not exists idx_client_event_session
  on public.client_event (session_id, seq);
create index if not exists idx_client_event_member
  on public.client_event (member_id, at desc);
create index if not exists idx_client_event_type
  on public.client_event (type, at desc);

alter table public.client_event enable row level security;

-- ── The recording of a visit ────────────────────────────────────────────────
-- rrweb emits a full DOM snapshot followed by a stream of mutations. Kept in
-- chunks rather than one growing row: a visit is appended to while it is still
-- happening, and rewriting a multi-megabyte jsonb every ten seconds would be
-- the most expensive thing the pilot does.
--
-- Recording is capped in the tracker (chunk count per session), so one long
-- visit cannot fill the table. Past the cap the events above still record —
-- the timeline always works, the video is the part that stops.
create table if not exists public.client_recording_chunk (
  chunk_id    bigserial primary key,
  session_id  uuid not null references public.client_session(session_id) on delete cascade,
  member_id   uuid not null references public.pilot_member(member_id) on delete cascade,
  chunk_index int not null,
  -- The rrweb event array for this slice of the visit.
  events      jsonb not null,
  created_at  timestamptz not null default now(),
  unique (session_id, chunk_index)
);

create index if not exists idx_client_recording_session
  on public.client_recording_chunk (session_id, chunk_index);

alter table public.client_recording_chunk enable row level security;

-- No anon/authenticated policies on purpose, exactly as 0029: RLS on with zero
-- policies means only the service-role admin client can read or write these.
-- The client area writes through the ingest route, which uses that client after
-- checking the signed-in user; the admin reads through server actions.
