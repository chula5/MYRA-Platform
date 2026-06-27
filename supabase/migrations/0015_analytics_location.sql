-- 0015_analytics_location.sql
-- Country attribution for analytics (from the edge geo header on Vercel).

alter table site_session  add column if not exists country text;
alter table landing_event add column if not exists country text;
