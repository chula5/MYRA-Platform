-- 0106: brand pairing corrections from Chloe's review of a member's brand
-- world in /studio/taste (2026-10-24). Idempotent; applied with `npm run migrate`.
--
-- Pairs that are NOT the same customer (exclusions — beat families and vectors):
--   Nuovo        × WYSE London   Nuovo is second-hand, not a contemporary label
--   Simon Miller × Sézane        too extravagant for Sézane's Parisian chic
--   Mos Mosh     × WYSE London   adjacent Scandi, not close enough to WYSE
--   Munthe       × WYSE London   same
--
-- Pairs that ARE the same customer (one curated core family):
--   Gerard Darel, Vivière, ME+EM, WYSE London
--
-- Then any member affinity that was seeded ONLY by an excluded pair (trace
-- "… via WYSE London" on Nuovo, etc.) drops back to baseline, so the bad
-- suggestion leaves her circle without waiting for skips to decay it. Named
-- and learned rows are never touched. Re-seed the member afterwards (Taste
-- Inspector → re-seed from intake) to pick up the new family links.
--
-- Brands are matched by the same key brandKey() uses (lowercase, accents
-- stripped, & → and, punctuation → space) against name and aliases. A brand
-- that doesn't resolve is reported with a NOTICE and skipped, never guessed.

create or replace function pg_temp.brand_key(t text) returns text language sql immutable as $$
  select trim(regexp_replace(
    replace(translate(lower(t),
      'àáâãäåèéêëìíîïòóôõöùúûüýÿçñ',
      'aaaaaaeeeeiiiiooooouuuuyycn'), '&', ' and '),
    '[^a-z0-9]+', ' ', 'g'))
$$;

create or replace function pg_temp.brand_id_for(keys text[]) returns uuid language plpgsql as $$
declare hit uuid;
begin
  select b.brand_id into hit
  from public.brand b
  where pg_temp.brand_key(b.name) = any(keys)
     or exists (select 1 from unnest(b.aliases) a where pg_temp.brand_key(a) = any(keys))
  order by (b.status = 'stocked') desc, b.vector_item_count desc
  limit 1;
  if hit is null then
    raise notice 'brand not found for %, skipped', keys;
  end if;
  return hit;
end $$;

do $$
declare
  wyse   uuid := pg_temp.brand_id_for(array['wyse london', 'wyse']);
  sezane uuid := pg_temp.brand_id_for(array['sezane']);
  meem   uuid := pg_temp.brand_id_for(array['me and em', 'me em', 'meandem']);
  fam    uuid;
  a uuid; b uuid; seeder text;
  r record; r2 record;
begin
  -- ── exclusions ────────────────────────────────────────────────────────────
  for r in
    select * from (values
      (pg_temp.brand_id_for(array['nuovo', 'nuovo paris']), wyse,
        'Nuovo is second-hand, not a WYSE customer'),
      (pg_temp.brand_id_for(array['simon miller']), sezane,
        'Simon Miller too extravagant for Sézane''s Parisian chic'),
      (pg_temp.brand_id_for(array['mos mosh']), wyse,
        'Mos Mosh adjacent but not close to WYSE'),
      (pg_temp.brand_id_for(array['munthe']), wyse,
        'Munthe adjacent but not close to WYSE')
    ) v(x, y, why)
  loop
    continue when r.x is null or r.y is null;
    a := least(r.x, r.y); b := greatest(r.x, r.y);
    insert into public.brand_exclusion (brand_a, brand_b, note)
    values (a, b, r.why)
    on conflict (brand_a, brand_b) do update set note = excluded.note;

    -- An expansion row whose only reason was this pair goes back to baseline.
    select name into seeder from public.brand where brand_id = r.y;
    for r2 in
      select uba.user_id, uba.affinity
      from public.user_brand_affinity uba
      where uba.brand_id = r.x
        and uba.source = 'expanded'
        and right(uba.expansion_trace, length(' via ' || seeder)) = ' via ' || seeder
        and uba.affinity > 0.1
    loop
      update public.user_brand_affinity
        set affinity = 0.1, expansion_trace = 'baseline', updated_at = now()
        where user_id = r2.user_id and brand_id = r.x;
      insert into public.brand_affinity_event (user_id, brand_id, old_value, new_value, source, reason)
      values (r2.user_id, r.x, r2.affinity, 0.1, 'admin_override', 'pair excluded: ' || r.why);
    end loop;
  end loop;

  -- ── curated family ────────────────────────────────────────────────────────
  insert into public.brand_family (name, description)
  values ('Polished London–Paris contemporary',
          'Elevated everyday — ME+EM, WYSE, Gerard Darel, Vivière. Same customer, same price reach.')
  on conflict (name) do nothing;
  select family_id into fam from public.brand_family where name = 'Polished London–Paris contemporary';

  for r in
    select unnest(array[
      meem, wyse,
      pg_temp.brand_id_for(array['gerard darel']),
      pg_temp.brand_id_for(array['viviere', 'vivere', 'vivere london'])
    ]) as id
  loop
    continue when r.id is null;
    insert into public.brand_family_membership (family_id, brand_id, weight)
    values (fam, r.id, 'core')
    on conflict (family_id, brand_id) do update set weight = 'core';
  end loop;

  -- similar_brands() results are cached; every edit above changes them.
  delete from public.brand_similarity_cache;
end $$;
