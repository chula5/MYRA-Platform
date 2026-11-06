-- THE WEEK'S NEW BRANDS — one note a week to members, read by Chloe first.
--
-- Saturday night /api/cron/new-brands-note drafts it from the brands filed into
-- the brand picker that week (brand.picker_group_at, migration 0112). Chloe
-- reads and edits it on /admin/new-brands on Sunday morning and presses SEND:
-- a note in the app, a push where the member said yes, and an email. Nothing
-- goes to members without that press.

create table if not exists public.new_brands_note (
  note_id     uuid primary key default gen_random_uuid(),
  -- The Saturday the week ends on (UTC date). One note per week.
  week_of     date not null unique,
  -- [{ brand_id, name, group, group_name }] — Chloe can remove any before sending.
  brands      jsonb not null default '[]'::jsonb,
  -- Bold line on the lock screen, and the email subject.
  title       text not null,
  -- The app note / push line.
  body        text not null,
  -- The opening paragraph of the email, above the brand list.
  email_intro text not null,
  status      text not null default 'draft' check (status in ('draft', 'sent', 'skipped')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  sent_at     timestamptz,
  sent_report jsonb
);

alter table public.new_brands_note enable row level security;
