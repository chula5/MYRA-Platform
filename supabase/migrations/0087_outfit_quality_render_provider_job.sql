-- 0087_outfit_quality_render_provider_job.sql
--
-- Durable provider-job accounting for the Outfit Quality Lab render path.
-- Additive only: no earlier migration is edited, no row is rewritten, and no
-- constraint is loosened.
--
-- WHY: submission and result retrieval are two separate phases. Once Higgsfield
-- ACCEPTS a create/generate request it returns a provider job ID, and that job
-- may complete even if the subsequent wait/result retrieval transiently fails
-- (e.g. a 403). The old attempt row kept only `generation_status`/`image_url`,
-- so an accepted-but-unretrieved job was indistinguishable from a submission
-- that never happened — the provider job ID was lost and the whole operation
-- was misclassified as failed. That both discarded a paid, completed render and
-- risked a duplicate create.
--
--   1. provider_job_id — the accepted provider job ID, persisted immediately
--      after create returns and before any wait/result retrieval. Recovery
--      keys read-only reconciliation (`generate get <id>`) on this value and
--      can idempotently persist the completed result WITHOUT another create.
--
--   2. provider_status — distinguishes the retrieval phase from the submission
--      phase: `accepted` (create accepted, retrieval pending/failed),
--      `completed` (result reconciled), independent of generation_status so an
--      accepted job is never reported or retried as an unsubmitted operation.
--
--   3. An index on provider_job_id for the reconciliation lookup.

alter table public.outfit_quality_render_attempt
  add column if not exists provider_job_id text;

alter table public.outfit_quality_render_attempt
  add column if not exists provider_status text;

create index if not exists oq_render_attempt_provider_job_idx
  on public.outfit_quality_render_attempt(provider_job_id)
  where provider_job_id is not null;
