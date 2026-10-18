-- 0101: NOT FOR ME — the brands a member says she would never wear.
-- Idempotent; applied with `npm run migrate`.
--
-- Chloe asked (2026-10-17) for the onboarding brand picker to have a "not for
-- me" side as well as "I love these". That is not the same list as
-- brands_input_only: input-only is the Zara rule ("I wear it, don't send it"),
-- and it still SEEDS her brand affinities because wearing it is taste signal.
-- A brand she would never wear must not seed anything, so it has its own
-- column. The composer treats it exactly like input-only at pick time (never
-- in a look), and the affinity row is hidden and floored when she names it.

alter table public.pilot_member
  add column if not exists brands_never text[] not null default '{}';

comment on column public.pilot_member.brands_never is
  'Brands she said are not for her. Never composed, never seeded as taste.';
