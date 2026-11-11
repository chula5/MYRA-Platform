-- 0122 · OUTFIT REVIEW PROJECTS — built around a LOOK, not a piece.
--
-- A project could start from a brief or from a screenshot of one piece. Chloe
-- also wants to hand MYRA a picture of a whole outfit — a runway exit, a
-- street-style shot — and get outfits IN THAT STYLE: a couple that sit close
-- to the picture, colours included, and the rest the same formula (the same
-- pieces, cloths and proportions) in other colours.
--
-- kind 'inspiration'  the project is composed from a picture of a look.
-- inspiration         what MYRA kept of the picture: where it is hosted, how
--                     the eye read it (pieces, palette, a line of summary) and
--                     the two asks the composer works from — closest to the
--                     picture, and in this style.

alter table public.review_project add column if not exists inspiration jsonb;
alter table public.review_project drop constraint if exists review_project_kind_check;
alter table public.review_project add constraint review_project_kind_check check (kind in ('looks','three_ways','inspiration'));
