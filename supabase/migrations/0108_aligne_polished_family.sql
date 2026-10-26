-- 0108: ALIGNE is the same customer as ME+EM (Chloe, 2026-10-24) — it joins
-- the curated core family "Polished London–Paris contemporary" (0106) with
-- ME+EM, WYSE London, Gerard Darel and Vivere London. Idempotent; applied
-- with `npm run migrate`. Members are picked up on their next re-seed.

do $$
declare
  fam uuid;
  aligne uuid;
begin
  select family_id into fam from public.brand_family where name = 'Polished London–Paris contemporary';
  select brand_id into aligne from public.brand
  where trim(regexp_replace(lower(name), '[^a-z0-9]+', ' ', 'g')) = 'aligne'
  order by (status = 'stocked') desc, vector_item_count desc
  limit 1;
  if fam is null or aligne is null then
    raise notice 'family or ALIGNE not found (family %, brand %), skipped', fam, aligne;
    return;
  end if;
  insert into public.brand_family_membership (family_id, brand_id, weight)
  values (fam, aligne, 'core')
  on conflict (family_id, brand_id) do update set weight = 'core';

  -- similar_brands() results are cached; the new link changes them.
  delete from public.brand_similarity_cache;
end $$;
