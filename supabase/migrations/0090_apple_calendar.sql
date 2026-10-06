-- 0090_apple_calendar.sql
-- HER IPHONE'S CALENDAR. Read on the phone by the MYRA app (EventKit) and
-- handed to the site as plain events; the site keeps only the ones worth
-- dressing for, exactly as it does for Google. There is no token to keep,
-- so the secret column becomes optional and the provider list grows by one.
-- Run manually in the Supabase SQL editor (idempotent).

alter table public.member_calendar_connection
  alter column secret_enc drop not null;

alter table public.member_calendar_connection
  drop constraint if exists member_calendar_connection_provider_check;
alter table public.member_calendar_connection
  add constraint member_calendar_connection_provider_check
  check (provider in ('google', 'apple'));
