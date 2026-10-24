-- 0107: customer age — how old a brand's customer is (2026-10-24).
-- Applied with `npm run migrate`. Idempotent.
--
-- Some brands skew younger than MYRA's members (Reformation, Djerf Avenue)
-- and still get suggested, because nothing scored the customer's age
-- (era_orientation is trend vs heritage, not age).
--
-- customer_age_register, 1-5, decimals allowed, set by hand only:
--   1 under 25 · 2 25–32 · 3 30–45 or spans ages · 4 38–50 · 5 45+
--
-- It is stored in brand_codes under its own dimension so it is scored in the
-- BRAND CODES matrix and logged in brand_code_event like a code — but it is
-- NOT one: the app keeps it out of CODE_DIMENSIONS (a brand without it is
-- still fully coded) and out of the codes cosine. It works like price:
-- a proximity factor on brand pairs (lib ageProximity) and a gate on what
-- may be suggested to a member, from her age range.

-- ── the dimension ───────────────────────────────────────────────────────────
insert into public.brand_code_dimension (dimension_key, label, sort, anchors) values
  ('customer_age_register', 'CUSTOMER AGE', 12,
   '{"1":"under 25","2":"25–32","3":"30–45 or spans ages","4":"38–50","5":"45+"}')
on conflict (dimension_key) do nothing;

-- ── her age range (pilot members) ───────────────────────────────────────────
-- Same values as onboarding's AGE_RANGES ('30-40', '40-50', …). Members who
-- came through /onboarding already have one on signup_preference; the app
-- falls back to that when this is empty.
alter table public.pilot_member add column if not exists age_range text;

-- ── starting values for Chloe to correct ────────────────────────────────────
-- Matched by brandKey() rules against name and aliases (every match — the
-- duplicate Simkhai/SIMKHAI rows both get it). Never overwrites a value
-- already authored; a key that doesn't resolve is skipped with a NOTICE,
-- never guessed.
create or replace function pg_temp.brand_key(t text) returns text language sql immutable as $$
  select trim(regexp_replace(
    replace(translate(lower(t),
      'àáâãäåèéêëìíîïòóôõöùúûüýÿçñ',
      'aaaaaaeeeeiiiiooooouuuuyycn'), '&', ' and '),
    '[^a-z0-9]+', ' ', 'g'))
$$;

do $$
declare
  r record;
  b record;
  matched boolean;
  added int := 0;
begin
  for r in
    select * from (values
      -- younger customer
      ('djerf avenue', 1.3), ('with jean', 1.4), ('reformation', 1.6), ('gimaguas', 1.6),
      ('bec and bridge', 1.7), ('sirthelabel', 1.8), ('paloma wool', 1.8), ('free people', 1.8),
      ('conner ives', 1.8), ('rouje', 2.0), ('sensi studio', 2.0), ('cult gaia', 2.0),
      ('zara', 2.2), ('staud', 2.2), ('dissh boutiques', 2.2), ('almada label', 2.2),
      ('anine bing', 2.3), ('madewell', 2.3), ('simon miller', 2.3),
      ('doen', 2.4), ('farm rio', 2.4), ('simkhai', 2.4), ('anonymous copenhagen', 2.4),
      ('sea new york', 2.4), ('baum und pferdgarten', 2.5),
      ('rixo', 2.6), ('maje', 2.6), ('self portrait', 2.6), ('varley', 2.6), ('soeur', 2.6),
      ('rabens saloner', 2.6), ('christopher esber', 2.6), ('skall studio', 2.6),
      ('sezane', 2.7),
      -- the middle: 30–45, or spans ages
      ('sandro', 2.8), ('nanushka', 2.8), ('sessun', 2.8), ('frame denim', 2.8),
      ('claudie pierlot', 2.9), ('isabel marant', 2.9),
      ('toteme', 3.0), ('house of dagmar', 3.0), ('mos mosh', 3.0), ('loeffler randall', 3.0), ('destree', 3.0),
      ('khaite', 3.1),
      ('j crew', 3.2), ('massimo dutti', 3.2), ('agnes b', 3.2), ('vanessabruno', 3.2), ('lemaire', 3.2),
      ('tibi', 3.2), ('ulla johnson', 3.2), ('proenza schouler', 3.2), ('munthe', 3.2), ('whistles', 3.2),
      ('demellier', 3.2),
      ('twinset', 3.3), ('reiss', 3.3),
      ('wyse london', 3.4), ('by malene birger', 3.4), ('veronica beard', 3.4),
      ('tory burch', 3.5), ('ralph lauren', 3.5), ('nili lotan', 3.5), ('baukjen', 3.5),
      -- older customer
      ('me em', 3.6), ('jigsaw', 3.6), ('rae feather', 3.6), ('tara jarmon', 3.6), ('dries van noten', 3.6),
      ('boden', 3.7), ('adolfo dominguez', 3.8), ('erdem', 3.8),
      ('mint velvet', 3.9), ('toast', 3.9),
      ('gerard darel', 4.0), ('broraonline', 4.2)
    ) v(k, val)
  loop
    matched := false;
    for b in
      select br.brand_id from public.brand br
      where pg_temp.brand_key(br.name) = r.k
         or exists (select 1 from unnest(br.aliases) a where pg_temp.brand_key(a) = r.k)
    loop
      matched := true;
      insert into public.brand_codes (brand_id, dimension_key, value, updated_by)
      values (b.brand_id, 'customer_age_register', r.val, '0107 starting value')
      on conflict (brand_id, dimension_key) do nothing;
      if found then
        insert into public.brand_code_event (brand_id, dimension_key, old_value, new_value, updated_by)
        values (b.brand_id, 'customer_age_register', null, r.val, '0107 starting value');
        added := added + 1;
      end if;
    end loop;
    if not matched then
      raise notice 'brand not found for %, skipped', r.k;
    end if;
  end loop;
  raise notice 'customer age starting values written: %', added;

  -- similar_brands() results are cached; the age factor changes them.
  delete from public.brand_similarity_cache;
end $$;
