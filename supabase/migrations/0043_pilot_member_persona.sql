-- 0043: Assign a stylist persona to a private-stylist member.
-- Run AFTER 0042, manually in the Supabase SQL editor (idempotent).
--
-- user_persona already models a SOFT assignment that decays (0040). Pilot
-- members are not auth users, so the subject kind is made explicit here —
-- the same pattern user_brand_affinity.user_kind already uses.
--
-- The persona is a lens for composing, not a label: the member's looks are
-- built through the persona's moodboard envelope at first, and the weight
-- falls as she responds, until her own yes/no history is doing the work.
alter table public.user_persona add column if not exists subject_kind text
  not null default 'auth_user'
  check (subject_kind in ('auth_user', 'pilot_member'));

alter table public.user_persona_weight_log add column if not exists subject_kind text
  not null default 'auth_user'
  check (subject_kind in ('auth_user', 'pilot_member'));

create index if not exists idx_user_persona_kind on public.user_persona (subject_kind);
