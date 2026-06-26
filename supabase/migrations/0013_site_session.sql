-- 0013_site_session.sql
-- Lightweight session tracking for retention analytics: time on site + repeat
-- session rate. One row per browser session; visitor_id (a persistent
-- localStorage id) links sessions from the same person. No PII.

create table if not exists site_session (
  session_id   text primary key,
  visitor_id   text not null,
  is_returning boolean not null default false,
  path         text,
  started_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index if not exists site_session_visitor_idx on site_session (visitor_id);
create index if not exists site_session_started_idx on site_session (started_at);

alter table site_session enable row level security;
-- Writes go through the service-role client; no public policies.
