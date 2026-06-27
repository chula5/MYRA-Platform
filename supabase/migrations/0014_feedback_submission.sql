-- 0014_feedback_submission.sql
-- Brand suggestions + general feedback submitted from the landing page.

create table if not exists feedback_submission (
  id         uuid primary key default gen_random_uuid(),
  kind       text not null,            -- 'brand' | 'feedback'
  message    text not null,
  email      text,
  created_at timestamptz not null default now()
);

create index if not exists feedback_submission_created_idx on feedback_submission (created_at);

alter table feedback_submission enable row level security;
-- Inserts go through the service-role client server-side; no public policies.
