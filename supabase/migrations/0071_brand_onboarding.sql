-- 0071: brand onboarding from the Mirror.
-- Run manually in the Supabase SQL editor (idempotent).
--
-- A request for a shop is now judged by MYRA (brand-onboarding-rules.ts):
-- watched, declined, or set aside for Chloe with the numbers. The verdict and
-- the read of the catalogue live on the request row so the Mirror can say
-- what happened and the admin page can show why.
alter table public.mirror_site_request add column if not exists verdict text;              -- accepted | review | declined | unreadable | admin
alter table public.mirror_site_request add column if not exists verdict_note text;
alter table public.mirror_site_request add column if not exists assessment jsonb;          -- CatalogueAssessment
alter table public.mirror_site_request add column if not exists assessed_at timestamptz;
alter table public.mirror_site_request add column if not exists decided_by text;           -- myra | chloe
alter table public.mirror_site_request add column if not exists requested_by_admin boolean not null default false;
alter table public.mirror_site_request add column if not exists watched_brand_id uuid references public.watched_brand(watched_brand_id) on delete set null;

-- 'assessing' while MYRA reads the catalogue.
alter table public.mirror_site_request drop constraint if exists mirror_site_request_status_check;
alter table public.mirror_site_request add constraint mirror_site_request_status_check check (status in ('open', 'assessing', 'watching', 'declined'));
