-- ─────────────────────────────────────────────────────────────────────────────
-- 0083 — Reseed evaluation-profile brand_groups with the CONTROLLED taxonomy.
--
-- Additive and idempotent (plain UPDATEs keyed by the fixed profile_ids;
-- rerunning is a no-op). Scrutiny round-1 correction: the 0080 seed used
-- price-tier labels (high_street, elevated_high_street, premium, luxury) plus
-- a colliding 'contemporary' — none of which are keys of the controlled
-- brand-group taxonomy. The controlled taxonomy is BRAND_GROUPS in
-- src/app/onboarding/brand-groups.ts:
--
--   parisian, quiet_luxury, tailoring, romantic, contemporary, designer,
--   directional
--
-- Scoring is by actual brand-list membership (profile-context
-- brandGroupsForBrand), never by a price-tier map; each profile's budget tiers
-- still come from budget_profile.price_tiers, unchanged here.
--
-- Mapping, keeping each profile's coverage intent:
--   coverage-everyday-high-street   → parisian + contemporary (accessible)
--   coverage-workwear-contemporary  → tailoring (modern workwear)
--   coverage-evening-premium        → romantic + designer (evening occasion)
--   coverage-travel-relaxed         → quiet_luxury + contemporary
--   coverage-occasion-luxury        → designer + directional
-- ─────────────────────────────────────────────────────────────────────────────

update public.outfit_quality_evaluation_profile
set brand_groups = array['parisian', 'contemporary']
where profile_id = '0b000001-0000-4000-8000-000000000001';

update public.outfit_quality_evaluation_profile
set brand_groups = array['tailoring']
where profile_id = '0b000001-0000-4000-8000-000000000002';

update public.outfit_quality_evaluation_profile
set brand_groups = array['romantic', 'designer']
where profile_id = '0b000001-0000-4000-8000-000000000003';

update public.outfit_quality_evaluation_profile
set brand_groups = array['quiet_luxury', 'contemporary']
where profile_id = '0b000001-0000-4000-8000-000000000004';

update public.outfit_quality_evaluation_profile
set brand_groups = array['designer', 'directional']
where profile_id = '0b000001-0000-4000-8000-000000000005';
