-- 0063: the looks MYRA composed and Chloe passed over.
-- Run manually in the Supabase SQL editor (idempotent).
--
-- Keeping a look teaches the composer; ignoring one taught it nothing, so the
-- same outfit came back on the next brief. A passed-over look is a decision:
-- its combination is not offered again, and the piece it was built on does not
-- anchor another look until the library has moved on.
--
-- Signature = the look's item ids, sorted, joined — the combination, not the
-- order it was composed in.
create table if not exists public.pilot_passed_look (
  passed_id   uuid primary key default gen_random_uuid(),
  member_id   uuid not null references public.pilot_member(member_id) on delete cascade,
  signature   text not null,
  anchor_item uuid,
  items       jsonb not null default '[]'::jsonb,
  occasion    text,
  created_at  timestamptz not null default now()
);

create unique index if not exists pilot_passed_look_unique on public.pilot_passed_look (member_id, signature);
create index if not exists pilot_passed_look_member on public.pilot_passed_look (member_id);
alter table public.pilot_passed_look enable row level security;
