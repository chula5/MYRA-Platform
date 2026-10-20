-- 0103: APPLICATION REVIEW — what Chloe decided about each person who applied.
-- Idempotent; applied with `npm run migrate`.
--
-- The application table (0053) only ever had a status. /admin/applications
-- now lets Chloe ACCEPT (make her a member with her brands already in,
-- email her invitation) or DECLINE (recorded, no email), so each row keeps
-- when it was decided, which member it became, and whether the invitation
-- actually went out.

alter table public.application add column if not exists reviewed_at timestamptz;
alter table public.application add column if not exists review_note text;
alter table public.application add column if not exists member_id uuid references public.pilot_member(member_id) on delete set null;
alter table public.application add column if not exists invite_url text;
alter table public.application add column if not exists emailed_at timestamptz;

-- Every item_id-style FK gets an index (deletes of the parent scan it).
create index if not exists application_member_id_idx on public.application (member_id) where member_id is not null;

comment on column public.application.member_id is 'The pilot_member ACCEPT created for her; null until accepted.';
comment on column public.application.invite_url is 'The /join link in the invitation ACCEPT sent (14 days, once).';
comment on column public.application.emailed_at is 'When the invitation email was accepted by Resend; null if it could not be sent.';
