-- 0084_outfit_quality_render_gallery.sql
--
-- Render integration follow-up for the Outfit Quality Lab. Additive only:
-- no earlier migration is edited, no row is rewritten, no constraint is
-- loosened.
--
--   1. ONE OVERRIDE PER ATTEMPT. `Not good enough` is an append-only override
--      that immediately removes an attempt from readiness. One attempt can be
--      removed once: a regenerated image is a NEW attempt in a NEW cycle, so a
--      second override row for the same attempt could only be a conflicting
--      double-submit. The unique index makes the database, not the UI, the
--      authority; the store replays the original row on conflict.
--
--   2. GALLERY/WORKER INDEXES. The Accepted Images read model filters
--      ready attempts and joins attempts by job; the local drainer lists jobs
--      by candidate version. Plain indexes, no behaviour change.

-- ── 1. One override per render attempt ──────────────────────────────────────
create unique index if not exists oq_image_override_attempt_uq
  on public.outfit_quality_image_override(render_attempt_id);

-- ── 2. Indexes for the gallery read model and the local drainer ─────────────
create index if not exists oq_render_attempt_job_idx
  on public.outfit_quality_render_attempt(render_job_id);

create index if not exists oq_render_attempt_ready_idx
  on public.outfit_quality_render_attempt(ready_at)
  where ready_at is not null;

create index if not exists oq_render_job_version_idx
  on public.outfit_quality_render_job(candidate_version_id);
