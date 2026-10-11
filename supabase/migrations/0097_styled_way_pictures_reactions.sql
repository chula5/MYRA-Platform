-- WAYS TO WEAR IT — pictures and reactions on kept ways (Chloe's asks, 2026-10-11).
--
-- image_url: MYRA's picture of the outfit (a Higgsfield shoot, made on Chloe's
-- Mac where the CLI lives — never on Vercel), so a way can open as a picture
-- rather than a grid of pieces. reaction: like saves the outfit to her looks
-- at once; dislike retires the way (stale, reason 'disliked') so it never
-- shows again. saved_look_id links a way to the pilot_look a like/save made.

alter table public.styled_way
  add column if not exists image_url     text,
  add column if not exists image_at      timestamptz,
  add column if not exists shoot_error   text,
  add column if not exists reaction      text check (reaction in ('like','dislike')),
  add column if not exists reacted_at    timestamptz,
  add column if not exists saved_look_id uuid;

-- What still wants a picture, per member, newest first.
create index if not exists styled_way_unshot_idx
  on public.styled_way (member_id, judged_at desc)
  where image_url is null and shoot_error is null and stale = false;
