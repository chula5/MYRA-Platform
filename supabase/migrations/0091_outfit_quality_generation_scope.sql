-- 0091 · Outfit Quality: scope-level dedupe for generation.
--
-- Why: GENERATE NEXT CHUNK rebuilt the same first N anchors every time because
-- the generator never excluded compositions already cased for the stylist.
-- `composition_hash` is unique only within a case, so nothing stopped the
-- repeat. We record a plain items signature (sorted item ids) and the anchor
-- garment on every candidate version so the generator can skip both anything
-- already composed and any anchor already led, across every batch in the same
-- (stylist, member|profile) scope.

alter table public.outfit_quality_candidate_version
  add column if not exists items_signature text,
  add column if not exists anchor_item_id  uuid references public.item(item_id);

-- Backfill from the frozen item manifests. (Allowed now: the immutability
-- guard below is recreated AFTER this so the new columns become frozen too.)
alter table public.outfit_quality_candidate_version disable trigger oq_candidate_version_guard_t;

update public.outfit_quality_candidate_version v
   set items_signature = sub.sig
  from (
    select ci.candidate_version_id, string_agg(ci.item_id::text, '|' order by ci.item_id::text) as sig
      from public.outfit_quality_candidate_item ci
     group by ci.candidate_version_id
  ) sub
 where sub.candidate_version_id = v.candidate_version_id
   and v.items_signature is null;

-- Anchor = the lead garment: a dress, else a top, else a bottom (first by sort_order).
update public.outfit_quality_candidate_version v
   set anchor_item_id = sub.item_id
  from (
    select distinct on (ci.candidate_version_id) ci.candidate_version_id, ci.item_id
      from public.outfit_quality_candidate_item ci
     where ci.slot in ('dress', 'top', 'bottom')
     order by ci.candidate_version_id,
              case ci.slot when 'dress' then 0 when 'top' then 1 else 2 end,
              ci.sort_order
  ) sub
 where sub.candidate_version_id = v.candidate_version_id
   and v.anchor_item_id is null;

alter table public.outfit_quality_candidate_version enable trigger oq_candidate_version_guard_t;

create index if not exists oq_cv_items_signature_idx on public.outfit_quality_candidate_version(items_signature);
create index if not exists oq_cv_anchor_idx on public.outfit_quality_candidate_version(anchor_item_id);

-- Recreate the guard so the two new columns are immutable after insert, like
-- every other provenance column on a version.
create or replace function public.oq_candidate_version_guard() returns trigger as $$
begin
  if tg_op = 'DELETE' then
    if not public.oq_cleanup_opt_in() then
      raise exception 'candidate versions cannot be deleted';
    end if;
    return old;
  end if;
  if row(new.candidate_version_id, new.case_id, new.version_no, new.parent_version_id,
         new.context_snapshot, new.composition_hash, new.generation_request_key,
         new.composer_version, new.generator_model, new.prompt_version, new.created_at,
         new.items_signature, new.anchor_item_id)
     is distinct from
     row(old.candidate_version_id, old.case_id, old.version_no, old.parent_version_id,
         old.context_snapshot, old.composition_hash, old.generation_request_key,
         old.composer_version, old.generator_model, old.prompt_version, old.created_at,
         old.items_signature, old.anchor_item_id) then
    raise exception 'candidate versions are immutable except for state';
  end if;
  return new;
end;
$$ language plpgsql;

-- Everything already cased for one (stylist, member|profile) scope. A single
-- RPC rather than an `.in()` filter so the id list never hits URL limits.
create or replace function public.oq_scope_signatures(
  p_stylist_id uuid,
  p_real_member_id uuid,
  p_evaluation_profile_id uuid
) returns table(items_signature text, anchor_item_id uuid)
language sql stable as $$
  select distinct v.items_signature, v.anchor_item_id
    from public.outfit_quality_candidate_version v
    join public.outfit_quality_case c on c.case_id = v.case_id
   where c.selected_stylist_id = p_stylist_id
     and c.real_member_id is not distinct from p_real_member_id
     and c.evaluation_profile_id is not distinct from p_evaluation_profile_id
     and (v.items_signature is not null or v.anchor_item_id is not null)
$$;
