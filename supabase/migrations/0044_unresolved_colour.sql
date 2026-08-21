-- 0044: Colour names the scanner could not read.
-- Run AFTER 0043, manually in the Supabase SQL editor (idempotent).
--
-- Colour is 3 of the 7 house-style points, so a name the lexicon can't resolve
-- caps a piece at 4 and it never clears a min score of 5. Rather than that
-- failing silently, every unreadable name is recorded with how often it appears
-- and which brand uses it — the list IS the to-do for growing the lexicon,
-- ordered by how much stock each name is costing.
create table if not exists public.unresolved_colour (
  name        text primary key,
  seen_count  int not null default 1,
  brands      text[] not null default '{}',
  sample_product text,
  resolved_to text,          -- set by hand once the lexicon learns it
  first_seen  timestamptz not null default now(),
  last_seen   timestamptz not null default now()
);
create index if not exists idx_unresolved_colour_count on public.unresolved_colour (seen_count desc);
alter table public.unresolved_colour enable row level security;
-- Service-role only, same as the other admin-side tables.
