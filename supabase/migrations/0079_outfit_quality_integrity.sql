-- 0079_outfit_quality_integrity.sql
-- OUTFIT QUALITY LAB — foundation integrity follow-up.
--
-- Append-only correction of the deployed 0078 foundation. It edits no earlier
-- migration and rewrites no existing row. It:
--
--   1. Freezes a batch's `stylist_snapshot_id` once a case exists, alongside the
--      partition/context/stylist that were already frozen.
--   2. Requires every case to repeat its batch's `stylist_snapshot_id` exactly,
--      alongside the partition/context/stylist equality 0078 already enforced.
--   3. Enforces the approved candidate slot cardinality: at most one item per
--      single-item slot, while still allowing the explicitly supported
--      multi-item slots (jewellery, accessory).
--   4. Makes the exact 444-outfit Chloe-only legacy import reproducible from
--      repository source: it derives the closed canonical set from the
--      authoritative `outfit` table, refuses to run unless that set is exactly
--      444, attributes every row to the Chloe stylist, and is idempotent.
--
-- All four changes are additive. Re-applying this migration is a no-op.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1 + 2. Batch snapshot freeze and case snapshot equality
-- ─────────────────────────────────────────────────────────────────────────────
-- The batch's generation lens is frozen on Start before any case exists. Once a
-- case exists the snapshot must not drift, exactly like the partition, context
-- and stylist. `stylist_snapshot_id` is added to the frozen row comparison.
create or replace function public.oq_batch_guard() returns trigger as $$
declare case_count int;
begin
  if tg_op = 'DELETE' then
    if not public.oq_cleanup_opt_in() then
      raise exception 'batches cannot be deleted outside authorized cleanup';
    end if;
    return old;
  end if;
  if row(new.data_partition, new.real_member_id, new.evaluation_profile_id,
         new.selected_stylist_id, new.stylist_snapshot_id)
     is distinct from
     row(old.data_partition, old.real_member_id, old.evaluation_profile_id,
         old.selected_stylist_id, old.stylist_snapshot_id) then
    select count(*) into case_count from public.outfit_quality_case where batch_id = old.batch_id;
    if case_count > 0 then
      raise exception 'batch partition, context, stylist and snapshot are immutable once a case exists';
    end if;
  end if;
  return new;
end;
$$ language plpgsql;

-- A case repeats its batch's attribution exactly, now including the frozen
-- stylist snapshot, so a case can never point at a different lens than the batch
-- that produced it.
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
  -- INSERT: must match the parent batch exactly.
  select * into b from public.outfit_quality_batch where batch_id = new.batch_id;
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
-- 3. Candidate slot cardinality
-- ─────────────────────────────────────────────────────────────────────────────
-- Single-item slots carry exactly one item per candidate version. The only
-- explicitly supported multi-item slots are jewellery and accessory (a look may
-- pair, say, earrings and a necklace, or a belt and a scarf). A partial unique
-- index enforces one item per slot for every other slot. The existing
-- (candidate_version_id, item_id) uniqueness continues to forbid duplicates.
create unique index if not exists oq_ci_version_slot_single_uq
  on public.outfit_quality_candidate_item (candidate_version_id, slot)
  where slot not in ('jewellery', 'accessory');

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Reproducible, idempotent exact-444 Chloe-only legacy import
-- ─────────────────────────────────────────────────────────────────────────────
-- The legacy canonical manifest is the closed set of existing `outfit` rows that
-- are not Quality Lab promotions. It must be exactly 444; any altered, missing,
-- or extra membership fails the import closed before a single row is written.
-- Every row is attributed to the immutable Chloe stylist only — training,
-- positive, stylist-scoped, legacy_canonical — and the CHECK constraints on the
-- table pin that shape so it can never become a global, member, or other-stylist
-- claim. ON CONFLICT (outfit_id) DO NOTHING makes a replay insert nothing.
do $$
declare
  v_chloe_stylist uuid := '0d535772-8a4f-440f-9e46-f8d637bed0d3';
  v_manifest_id   uuid := '0a9c1e44-0000-4000-8000-00000000444a';
  v_expected      int  := 444;
  v_canonical     int;
begin
  select count(*) into v_canonical
  from public.outfit o
  where not exists (
    select 1 from public.outfit_quality_promotion p where p.outfit_id = o.outfit_id
  );

  if v_canonical <> v_expected then
    raise exception
      'legacy canonical import refused: expected exactly % canonical outfits, found %',
      v_expected, v_canonical;
  end if;

  insert into public.outfit_quality_legacy_evidence
    (outfit_id, stylist_id, data_partition, polarity, scope, source, import_manifest_id)
  select o.outfit_id, v_chloe_stylist, 'training', 'positive', 'stylist', 'legacy_canonical', v_manifest_id
  from public.outfit o
  where not exists (
    select 1 from public.outfit_quality_promotion p where p.outfit_id = o.outfit_id
  )
  on conflict (outfit_id) do nothing;
end $$;
