-- 0045: Private Stylist — authored style preferences per pilot member.
-- Run manually in the Supabase SQL editor (idempotent).
--
-- What a member SAYS about her own taste, in Chloe's words after talking to
-- her: colours she loves and won't wear, shapes/silhouettes that work and
-- don't (oversized fit, wide trousers, high necklines...), and the item types
-- she lives in or never touches.
--
-- These are AUTHORED, not learned — they are never overwritten by the
-- feedback loop. The learned signals (taste vector, brand affinity, item
-- swap history) sit on top of them. Avoided entries act as a hard gate on
-- composition; loved entries are a scoring bonus.

alter table public.pilot_member add column if not exists colours_loved   text[] not null default '{}';
alter table public.pilot_member add column if not exists colours_avoided text[] not null default '{}';
-- shape ids from SHAPE_PREFERENCES in src/lib/pilot-stylist.ts (each maps to a
-- predicate over the item's scored dimensions: fit, leg_opening, rise, ...)
alter table public.pilot_member add column if not exists shapes_loved    text[] not null default '{}';
alter table public.pilot_member add column if not exists shapes_avoided  text[] not null default '{}';
-- item_type values she wears a lot / never wears
alter table public.pilot_member add column if not exists types_loved     text[] not null default '{}';
alter table public.pilot_member add column if not exists types_avoided   text[] not null default '{}';
