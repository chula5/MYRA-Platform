-- 0085_outfit_quality_import_function_lockdown.sql
--
-- Service-role-only hygiene for the mission-created legacy import function.
-- Additive only: no earlier migration is edited, no row is rewritten, and the
-- function's definition and behavior are unchanged.
--
-- `public.oq_import_legacy_evidence()` (created by 0081) replays the exact,
-- Chloe-only, 444-outfit legacy evidence import. Like the other Quality Lab
-- mutation functions (`oq_test_cleanup`, `oq_claim_positions`,
-- `oq_release_positions`, locked down in 0082), it must be callable only by
-- the service role — never by anonymous or ordinary authenticated sessions.
-- Postgres grants EXECUTE to PUBLIC by default; this migration revokes that.

revoke all on function public.oq_import_legacy_evidence() from public, anon, authenticated;
grant execute on function public.oq_import_legacy_evidence() to service_role;
