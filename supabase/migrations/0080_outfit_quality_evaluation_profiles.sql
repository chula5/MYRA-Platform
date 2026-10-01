-- ─────────────────────────────────────────────────────────────────────────────
-- 0080 — Seed generic Outfit Quality evaluation profiles.
--
-- Additive and idempotent. These are NOT people: they carry no auth identity,
-- no member feedback, and (per 0078) no foreign key that could resolve them as
-- a pilot_member. They are coverage definitions that exercise varied style
-- families, brand groups, budgets, clothing/shoe sizes, and occasions, built
-- only from controlled values that already exist in the catalogue and client
-- intake vocabulary:
--
--   * occasions       — CLIENT_OCCASIONS ids (src/lib/client-occasions.ts):
--                        casual_day, dinner_drinks, work_standard,
--                        work_elevated, event, travel.
--   * brand_groups    — PRICE_BANDS hints (src/lib/style-profile.ts), which map
--                        to brand.price_tier 1..5.
--   * budget_profile  — { price_tiers:int[], max_gbp:int|null } against
--                        brand.price_tier and item.price.
--   * size_profile    — SizeProfile shape (src/lib/size-canonical.ts):
--                        { tops|bottoms|outerwear|shoes: { value, adjacent } }
--                        on the canonical UK ladder.
--   * style_families  — minimal, classic, relaxed, statement, romantic.
--
-- Fixed profile_ids keep reruns a no-op (ON CONFLICT (slug) DO NOTHING), so the
-- starter set is reproducible from repository source without duplication.
-- ─────────────────────────────────────────────────────────────────────────────

insert into public.outfit_quality_evaluation_profile
  (profile_id, slug, name, active, style_families, brand_groups, budget_profile, size_profile, occasions, preferences, notes)
values
  (
    '0b000001-0000-4000-8000-000000000001',
    'coverage-everyday-high-street',
    'Coverage — Everyday High Street',
    true,
    array['relaxed','minimal'],
    array['high_street','elevated_high_street'],
    '{"price_tiers":[1,2],"max_gbp":250}'::jsonb,
    '{"tops":{"value":10,"adjacent":12},"bottoms":{"value":10,"adjacent":12},"outerwear":{"value":10,"adjacent":null},"shoes":{"value":6,"adjacent":5}}'::jsonb,
    array['casual_day','work_standard'],
    '{}'::jsonb,
    'Generic coverage profile: everyday high-street budget, common UK sizes.'
  ),
  (
    '0b000001-0000-4000-8000-000000000002',
    'coverage-workwear-contemporary',
    'Coverage — Workwear Contemporary',
    true,
    array['classic','minimal'],
    array['contemporary'],
    '{"price_tiers":[3],"max_gbp":500}'::jsonb,
    '{"tops":{"value":8,"adjacent":10},"bottoms":{"value":8,"adjacent":10},"outerwear":{"value":8,"adjacent":null},"shoes":{"value":5,"adjacent":4}}'::jsonb,
    array['work_standard','work_elevated'],
    '{}'::jsonb,
    'Generic coverage profile: contemporary workwear, smaller UK sizes.'
  ),
  (
    '0b000001-0000-4000-8000-000000000003',
    'coverage-evening-premium',
    'Coverage — Evening Premium',
    true,
    array['statement','romantic'],
    array['premium','luxury'],
    '{"price_tiers":[4,5],"max_gbp":null}'::jsonb,
    '{"tops":{"value":12,"adjacent":14},"bottoms":{"value":12,"adjacent":14},"outerwear":{"value":12,"adjacent":null},"shoes":{"value":7,"adjacent":6}}'::jsonb,
    array['dinner_drinks','event'],
    '{}'::jsonb,
    'Generic coverage profile: premium evening wear, mid-to-larger UK sizes.'
  ),
  (
    '0b000001-0000-4000-8000-000000000004',
    'coverage-travel-relaxed',
    'Coverage — Travel Relaxed',
    true,
    array['relaxed'],
    array['elevated_high_street','contemporary'],
    '{"price_tiers":[2,3],"max_gbp":400}'::jsonb,
    '{"tops":{"value":14,"adjacent":16},"bottoms":{"value":14,"adjacent":16},"outerwear":{"value":14,"adjacent":null},"shoes":{"value":7,"adjacent":8}}'::jsonb,
    array['travel','casual_day'],
    '{}'::jsonb,
    'Generic coverage profile: relaxed travel capsule, larger UK sizes.'
  ),
  (
    '0b000001-0000-4000-8000-000000000005',
    'coverage-occasion-luxury',
    'Coverage — Occasion Luxury',
    true,
    array['romantic','statement'],
    array['luxury'],
    '{"price_tiers":[5],"max_gbp":null}'::jsonb,
    '{"tops":{"value":6,"adjacent":8},"bottoms":{"value":6,"adjacent":8},"outerwear":{"value":6,"adjacent":null},"shoes":{"value":4,"adjacent":3}}'::jsonb,
    array['event','dinner_drinks'],
    '{}'::jsonb,
    'Generic coverage profile: luxury occasion dressing, smallest UK sizes.'
  )
on conflict (slug) do nothing;
