-- 0081_outfit_quality_guard_locks_legacy_pin.sql
-- OUTFIT QUALITY LAB — scrutiny round-1 hardening.
--
-- Append-only. Edits no earlier migration and rewrites no existing row. It:
--
--   1. Closes the attribution-freeze TOCTOU. 0078/0079 used an unlocked
--      read-then-check: under READ COMMITTED a concurrent case insert and a
--      batch partition/context/stylist/snapshot update could both pass (each
--      reading pre-commit state). `oq_case_guard()` now locks the parent batch
--      row FOR UPDATE before checking it, so a case insert serializes against
--      any batch attribution update:
--        * insert first  → the batch UPDATE waits on the row lock, then its
--          guard re-counts cases on a fresh snapshot, sees the committed case,
--          and raises;
--        * update first  → the insert's SELECT FOR UPDATE waits, then reads
--          the latest committed batch row and the exact-match checks reject
--          the stale case attribution.
--      A batch UPDATE already holds the same row lock before its own guard
--      trigger runs, so the case-side lock is the only addition needed.
--
--   2. Makes the exact-444 legacy import verify the approved ID SET, not only
--      the count. A non-secret immutable artifact — the approved count and the
--      sha256 digest of the sorted approved outfit IDs — is captured once in
--      `outfit_quality_legacy_import_manifest`. `oq_import_legacy_evidence()`
--      refuses an altered, missing, extra, duplicate, or unknown membership
--      (count, duplicate, and digest checks), inserts idempotently, and on
--      every replay also verifies the attribution of the rows ALREADY in the
--      table, so an ON CONFLICT skip can never silently keep a drifted row.
--
--   3. Pins Chloe-only legacy attribution at the database boundary with an
--      additive CHECK on outfit_quality_legacy_evidence.stylist_id. Until now
--      Chloe-only was enforced only by the import path.
--
-- All three changes are additive. Re-applying this migration is a no-op.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Case insert locks the parent batch row (TOCTOU fix)
-- ─────────────────────────────────────────────────────────────────────────────
-- Identical to the 0079 guard except the INSERT branch's batch fetch is now
-- SELECT ... FOR UPDATE: the case insert holds the batch row lock until its
-- transaction ends, so the two race orderings above can no longer both commit
-- with drifted attribution.
create or replace function public.oq_case_guard() returns trigger as $$
declare b record;
begin
  if tg_op = 'DELETE' then
    if not public.oq_cleanup_opt_in() then
      raise exception 'cases cannot be deleted outside authorized cleanup';
    end if;
    return old;
  end if;
  if tg_op = 'UPDATE' then
    if row(new.case_id, new.batch_id, new.data_partition, new.real_member_id,
           new.evaluation_profile_id, new.selected_stylist_id, new.stylist_snapshot_id,
           new.source, new.created_at)
       is distinct from
       row(old.case_id, old.batch_id, old.data_partition, old.real_member_id,
           old.evaluation_profile_id, old.selected_stylist_id, old.stylist_snapshot_id,
           old.source, old.created_at) then
      raise exception 'case attribution is immutable; only current_version_id and status may change';
    end if;
    return new;
  end if;
  -- INSERT: lock the parent batch row, then require an exact attribution match.
  select * into b from public.outfit_quality_batch where batch_id = new.batch_id for update;
  if not found then raise exception 'case references an unknown batch'; end if;
  if new.data_partition <> b.data_partition then raise exception 'case partition must equal its batch partition'; end if;
  if new.real_member_id is distinct from b.real_member_id then raise exception 'case real member must equal its batch'; end if;
  if new.evaluation_profile_id is distinct from b.evaluation_profile_id then raise exception 'case profile must equal its batch'; end if;
  if new.selected_stylist_id <> b.selected_stylist_id then raise exception 'case stylist must equal its batch'; end if;
  if new.stylist_snapshot_id is distinct from b.stylist_snapshot_id then raise exception 'case stylist snapshot must equal its batch'; end if;
  return new;
end;
$$ language plpgsql;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2a. Immutable, non-secret artifact of the approved 444-ID set
-- ─────────────────────────────────────────────────────────────────────────────
-- One row: the fixed import manifest ID, the approved count, and the sha256
-- hex digest of the sorted approved outfit IDs. Outfit IDs are identifiers,
-- not secrets. The row is append-only like every other evidence table.
create table if not exists public.outfit_quality_legacy_import_manifest (
  manifest_id    uuid primary key,
  approved_count int not null,
  id_digest      text not null,
  captured_at    timestamptz not null default now()
);
alter table public.outfit_quality_legacy_import_manifest enable row level security;

drop trigger if exists oq_legacy_import_manifest_immutable on public.outfit_quality_legacy_import_manifest;
create trigger oq_legacy_import_manifest_immutable
  before update or delete on public.outfit_quality_legacy_import_manifest
  for each row execute function public.oq_block_evidence_mutation();

-- ─────────────────────────────────────────────────────────────────────────────
-- 2b. Canonical digest of an outfit ID set
-- ─────────────────────────────────────────────────────────────────────────────
-- sha256 hex over the comma-joined, text-sorted, de-duplicated IDs. Sorting by
-- the canonical uuid text form keeps the digest reproducible across languages.
create or replace function public.oq_legacy_set_digest(p_ids uuid[]) returns text
language sql immutable as $$
  select encode(
    digest(string_agg(t.id_text, ',' order by t.id_text), 'sha256'),
    'hex'
  )
  from (select distinct p.id::text as id_text from unnest(p_ids) as p(id)) as t
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2c. Membership assertion against the captured artifact
-- ─────────────────────────────────────────────────────────────────────────────
-- Raises unless p_ids is exactly the approved set: exact count, no duplicates,
-- and a matching set digest (an altered, missing, extra, or unknown ID changes
-- the digest even when the count still reads 444).
create or replace function public.oq_legacy_assert_approved_ids(p_ids uuid[]) returns void
language plpgsql stable as $$
declare
  v_expected int;
  v_digest   text;
  v_len      int;
  v_distinct int;
begin
  select m.approved_count, m.id_digest into v_expected, v_digest
  from public.outfit_quality_legacy_import_manifest m
  where m.manifest_id = '0a9c1e44-0000-4000-8000-00000000444a';
  if not found then
    raise exception 'legacy canonical import refused: the approved manifest artifact was never captured';
  end if;

  v_len := coalesce(array_length(p_ids, 1), 0);
  if v_len <> v_expected then
    raise exception 'legacy canonical import refused: expected exactly % approved outfit ids, got %', v_expected, v_len;
  end if;

  select count(*) into v_distinct from (select distinct i from unnest(p_ids) as i) as d;
  if v_distinct <> v_len then
    raise exception 'legacy canonical import refused: manifest contains duplicate outfit ids';
  end if;

  if public.oq_legacy_set_digest(p_ids) is distinct from v_digest then
    raise exception 'legacy canonical import refused: id membership does not match the approved 444-outfit set';
  end if;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2d. Verified, idempotent import / replay
-- ─────────────────────────────────────────────────────────────────────────────
-- Derives the closed canonical set (outfit rows that are not Quality Lab
-- promotions), asserts it IS the captured approved set — membership, not just
-- count — inserts Chloe-only rows idempotently, then verifies the rows already
-- present carry the exact pinned attribution and that the evidence table holds
-- precisely the approved set. Any failure raises before/without writing.
create or replace function public.oq_import_legacy_evidence()
returns table(inserted_count int, total_count int)
language plpgsql as $$
declare
  v_chloe    uuid := '0d535772-8a4f-440f-9e46-f8d637bed0d3';
  v_manifest uuid := '0a9c1e44-0000-4000-8000-00000000444a';
  v_ids      uuid[];
  v_inserted int;
  v_drifted  int;
begin
  select array_agg(o.outfit_id) into v_ids
  from public.outfit o
  where not exists (
    select 1 from public.outfit_quality_promotion p where p.outfit_id = o.outfit_id
  );

  perform public.oq_legacy_assert_approved_ids(v_ids);

  insert into public.outfit_quality_legacy_evidence
    (outfit_id, stylist_id, data_partition, polarity, scope, source, import_manifest_id)
  select i, v_chloe, 'training', 'positive', 'stylist', 'legacy_canonical', v_manifest
  from unnest(v_ids) as i
  on conflict (outfit_id) do nothing;
  get diagnostics v_inserted = row_count;

  -- Replay verifies existing-row attribution; an ON CONFLICT skip must never
  -- silently keep a drifted row.
  select count(*) into v_drifted
  from public.outfit_quality_legacy_evidence e
  where e.stylist_id <> v_chloe
     or e.data_partition <> 'training'
     or e.polarity <> 'positive'
     or e.scope <> 'stylist'
     or e.source <> 'legacy_canonical'
     or e.import_manifest_id <> v_manifest;
  if v_drifted > 0 then
    raise exception 'legacy evidence attribution drift detected: % rows are not Chloe-only legacy_canonical', v_drifted;
  end if;

  perform public.oq_legacy_assert_approved_ids(array(select e.outfit_id from public.outfit_quality_legacy_evidence e));

  return query select v_inserted, coalesce(array_length(v_ids, 1), 0);
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Chloe-only attribution pinned at the CHECK boundary
-- ─────────────────────────────────────────────────────────────────────────────
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'oq_legacy_evidence_chloe_stylist'
      and conrelid = 'public.outfit_quality_legacy_evidence'::regclass
  ) then
    alter table public.outfit_quality_legacy_evidence
      add constraint oq_legacy_evidence_chloe_stylist
      check (stylist_id = '0d535772-8a4f-440f-9e46-f8d637bed0d3'::uuid);
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2e. Capture the artifact once, from the approved set
-- ─────────────────────────────────────────────────────────────────────────────
-- The captured set is the one the approved import already produced. Refuse to
-- capture unless the derived canonical set is exactly 444, the deployed
-- evidence matches it with zero anti-join rows in both directions, and every
-- existing row is Chloe-only legacy_canonical (now also pinned by the CHECK
-- above). Idempotent: ON CONFLICT on the manifest primary key.
do $$
declare
  v_ids   uuid[];
  v_count int;
begin
  select array_agg(o.outfit_id), count(*) into v_ids, v_count
  from public.outfit o
  where not exists (
    select 1 from public.outfit_quality_promotion p where p.outfit_id = o.outfit_id
  );

  if v_count <> 444 then
    raise exception 'legacy manifest capture refused: expected exactly 444 canonical outfits, found %', v_count;
  end if;

  if (select count(*) from public.outfit_quality_legacy_evidence e where not (e.outfit_id = any(v_ids))) > 0
     or (select count(*) from unnest(v_ids) as i
         where not exists (select 1 from public.outfit_quality_legacy_evidence e where e.outfit_id = i)) > 0 then
    raise exception 'legacy manifest capture refused: deployed evidence set differs from the derived canonical set';
  end if;

  if (select count(*) from public.outfit_quality_legacy_evidence e
      where e.stylist_id <> '0d535772-8a4f-440f-9e46-f8d637bed0d3'
         or e.data_partition <> 'training'
         or e.polarity <> 'positive'
         or e.scope <> 'stylist'
         or e.source <> 'legacy_canonical'
         or e.import_manifest_id <> '0a9c1e44-0000-4000-8000-00000000444a') > 0 then
    raise exception 'legacy manifest capture refused: deployed evidence has non-Chloe or non-legacy attribution';
  end if;

  insert into public.outfit_quality_legacy_import_manifest (manifest_id, approved_count, id_digest)
  values ('0a9c1e44-0000-4000-8000-00000000444a', v_count, public.oq_legacy_set_digest(v_ids))
  on conflict (manifest_id) do nothing;
end $$;

-- Verified replay at apply time: inserts nothing, verifies membership and
-- existing-row attribution, and returns the counts.
select * from public.oq_import_legacy_evidence();
