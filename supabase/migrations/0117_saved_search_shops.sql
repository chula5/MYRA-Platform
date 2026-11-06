-- SAVED SEARCHES, built out (2026-11-06). Chloe chose: search the shops too,
-- say why each piece matched with YES / NOT THIS, and tell her sooner.
--
-- saved_search_hit.why: what the piece answered ("DRIES VAN NOTEN · TRAINERS ·
-- YOUR SIZE"). verdict: her YES (kept to her saved pieces) or NOT THIS (gone
-- from the search, and taught: a colour or label she keeps refusing is held
-- back from that search). source: found in MYRA, or brought in from a shop's
-- new pieces for this search.
-- saved_search.shop_note: what MYRA did for a label it does not read yet
-- ("Asked to add Dries Van Noten's shop"); last_instant_at: the last time a
-- strong match went to her phone at once.

alter table public.saved_search_hit
  add column if not exists why        text,
  add column if not exists verdict    text check (verdict in ('yes', 'no')),
  add column if not exists verdict_at timestamptz,
  add column if not exists source     text not null default 'myra' check (source in ('myra', 'shop'));

alter table public.saved_search
  add column if not exists shop_note       text,
  add column if not exists last_instant_at timestamptz;
