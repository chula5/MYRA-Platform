-- 0041: Keep every Higgsfield shoot generated for a private-stylist look.
-- Run AFTER 0040, manually in the Supabase SQL editor (idempotent).
--
-- Regenerating used to overwrite image_url and the previous shoot was gone —
-- the file survived on Cloudinary but its URL was lost. Now each generation is
-- appended here, so a redo can be compared against what came before and
-- reverted if the new one is worse.
--
-- [{ "url": "...", "pose": "E5", "created_at": "..." }]
alter table public.pilot_look
  add column if not exists shoot_history jsonb not null default '[]'::jsonb;
