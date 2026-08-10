-- 0026_click_visitor.sql
-- Makes the ANONYMOUS half of the click log legible.
--
-- Most retailer click-throughs are made by people who are not signed in, so
-- 0025's user_id is null for them. That does not mean the click is unknowable:
-- the site already keeps a persistent visitor id (localStorage `myra_vid`, used
-- by site_session for retention). Recording it here lets a run of anonymous
-- clicks be grouped as ONE person's browsing, even without an account.
--
-- It also makes clicks retro-attributable: when a visitor eventually signs in,
-- their earlier anonymous clicks share the same visitor_id and can be joined to
-- the account. That back-link happens on the next signed-in click.
--
-- visitor_id is a random opaque id. It carries no personal data and is never
-- set for admin browsers (SessionTracker opts those out entirely).

alter table public.item_click add column if not exists visitor_id text;
alter table public.item_click add column if not exists session_id text;

create index if not exists item_click_visitor_idx on public.item_click (visitor_id, clicked_at desc);

-- The same identity on the affiliate click log, so the two agree.
alter table public.click add column if not exists visitor_id text;
create index if not exists click_visitor_idx on public.click (visitor_id, created_at desc);
