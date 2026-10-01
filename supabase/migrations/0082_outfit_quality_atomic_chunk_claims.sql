-- 0082_outfit_quality_atomic_chunk_claims.sql
-- OUTFIT QUALITY LAB — scrutiny round-1 pipeline integrity fixes.
--
-- Append-only. Edits no earlier migration; the only data touch is a backfill
-- of the NEW claimed_count column on outfit_quality_batch from existing case
-- counts (a column this migration itself adds).
--
--   1. ATOMIC CHUNK CLAIMS. Previously a chunk request counted produced cases
--      in one read and inserted them later: two overlapping requests could
--      read the same count, double-claim positions, and push a batch past its
--      target_count. Now `oq_claim_positions()` locks the batch row
--      SELECT ... FOR UPDATE, validates status and remaining capacity against
--      a persistent `claimed_count` reservation counter, increments it, and
--      returns the disjoint [start_position, start_position + claim) range —
--      all in one serialized step. Overlapping requests can never claim the
--      same position or exceed the batch target.
--
--   2. NO ORPHANED CAPACITY. `oq_release_positions()` returns reservations
--      that produced no case (a failed generation chunk releases exactly
--      claim - persisted), so aborted work never permanently consumes target
--      capacity. Defense in depth: `oq_case_guard()` now also rejects a case
--      insert once the batch already holds target_count cases, so no path can
--      write an orphan case past the target even if a caller skips the claim.
--
--   3. AUTHORIZED TEST CLEANUP RPC. `oq_test_cleanup()` performs the
--      documented opt-in cleanup (set local app.oq_allow_cleanup = 'on' +
--      exact-ID deletes) inside one function transaction, whitelisted to the
--      Quality Lab tables and their primary keys only. It exists so tagged
--      `test` runs can clean their exact recorded IDs through PostgREST,
--      which cannot issue multi-statement transactions. It accepts only
--      exact uuid arrays — no predicates, no ranges — and is revoked from
--      every role except service_role.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1a. Reservation counter on the batch
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.outfit_quality_batch
  add column if not exists claimed_count int not null default 0;

-- Existing batches: reservations equal the cases already produced.
update public.outfit_quality_batch b
   set claimed_count = (select count(*) from public.outfit_quality_case c where c.batch_id = b.batch_id)
 where b.claimed_count = 0;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1b. Atomic claim: row-lock the batch, bound the claim, record it, return the
--     disjoint range. The whole function runs in the caller's transaction, so
--     two concurrent claims on one batch serialize on the row lock.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.oq_claim_positions(p_batch_id uuid, p_requested int)
returns table(claim int, start_position int, remaining_after int)
language plpgsql as $$
declare
  b           public.outfit_quality_batch%rowtype;
  v_remaining int;
  v_claim     int;
begin
  if p_requested is null or p_requested < 1 or p_requested > 25 then
    raise exception 'a processing request must be between 1 and 25';
  end if;

  select * into b from public.outfit_quality_batch where batch_id = p_batch_id for update;
  if not found then
    raise exception 'batch not found';
  end if;
  if b.status <> 'active' then
    raise exception 'a % batch cannot claim new work', b.status;
  end if;

  v_remaining := b.target_count - b.claimed_count;
  if v_remaining <= 0 then
    raise exception 'the batch has no remaining positions';
  end if;

  v_claim := least(p_requested, 25, v_remaining);

  update public.outfit_quality_batch
     set claimed_count = claimed_count + v_claim,
         updated_at = now()
   where batch_id = p_batch_id;

  -- b.claimed_count is the pre-claim value: this request owns
  -- [b.claimed_count, b.claimed_count + v_claim).
  return query select v_claim, b.claimed_count, v_remaining - v_claim;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2a. Release reservations that produced no case (failure recovery only).
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.oq_release_positions(p_batch_id uuid, p_count int)
returns void
language plpgsql as $$
begin
  if p_count is null or p_count <= 0 then
    return;
  end if;
  update public.outfit_quality_batch
     set claimed_count = greatest(0, claimed_count - p_count),
         updated_at = now()
   where batch_id = p_batch_id;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2b. Case-capacity guard: no case may be inserted past the batch target.
--     Identical to the 0081 guard plus the capacity check, which runs while
--     holding the batch row lock, so concurrent inserts serialize and the
--     count is exact.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.oq_case_guard() returns trigger as $$
declare b record;
declare case_count int;
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
  -- INSERT: lock the parent batch row, then require an exact attribution match
  -- and remaining capacity.
  select * into b from public.outfit_quality_batch where batch_id = new.batch_id for update;
  if not found then raise exception 'case references an unknown batch'; end if;
  if new.data_partition <> b.data_partition then raise exception 'case partition must equal its batch partition'; end if;
  if new.real_member_id is distinct from b.real_member_id then raise exception 'case real member must equal its batch'; end if;
  if new.evaluation_profile_id is distinct from b.evaluation_profile_id then raise exception 'case profile must equal its batch'; end if;
  if new.selected_stylist_id <> b.selected_stylist_id then raise exception 'case stylist must equal its batch'; end if;
  if new.stylist_snapshot_id is distinct from b.stylist_snapshot_id then raise exception 'case stylist snapshot must equal its batch'; end if;
  select count(*) into case_count from public.outfit_quality_case where batch_id = new.batch_id;
  if case_count >= b.target_count then
    raise exception 'batch has no remaining candidate capacity';
  end if;
  return new;
end;
$$ language plpgsql;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Authorized exact-ID test cleanup, callable through PostgREST.
--    Whitelisted tables and primary-key columns only; the opt-in flag is set
--    locally for this function's transaction, exactly as the documented
--    cleanup protocol requires. Never a broad predicate: only the exact ids
--    supplied by the caller's run manifest.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.oq_test_cleanup(p_table text, p_ids uuid[])
returns int
language plpgsql as $$
declare
  v_id_column text;
  n int;
begin
  if p_ids is null or coalesce(array_length(p_ids, 1), 0) = 0 then
    return 0;
  end if;
  if array_length(p_ids, 1) > 1000 then
    raise exception 'cleanup refused: more than 1000 ids in one call';
  end if;

  v_id_column := case p_table
    when 'outfit_quality_learning_projection' then 'projection_id'
    when 'outfit_quality_image_override'      then 'override_id'
    when 'outfit_quality_render_attempt'      then 'render_attempt_id'
    when 'outfit_quality_render_job'          then 'render_job_id'
    when 'outfit_quality_promotion'           then 'promotion_id'
    when 'outfit_quality_review_event'        then 'review_event_id'
    when 'outfit_quality_queue_hold'          then 'hold_id'
    when 'outfit_quality_machine_check'       then 'check_id'
    when 'outfit_quality_candidate_item'      then 'candidate_item_id'
    when 'outfit_quality_candidate_version'   then 'candidate_version_id'
    when 'outfit_quality_case'                then 'case_id'
    when 'outfit_quality_batch'               then 'batch_id'
    when 'outfit_quality_stylist_snapshot'    then 'snapshot_id'
    when 'outfit_quality_legacy_evidence'     then 'outfit_id'
    when 'outfit_quality_evaluation_profile'  then 'profile_id'
    else null
  end;
  if v_id_column is null then
    raise exception 'cleanup refused: % is not a cleanable Quality Lab table', p_table;
  end if;

  -- Opt in for THIS transaction only, mirroring the documented protocol:
  --   begin; set local app.oq_allow_cleanup = 'on'; delete <exact ids>; commit;
  perform set_config('app.oq_allow_cleanup', 'on', true);

  execute format('delete from public.%I where %I = any($1)', p_table, v_id_column)
    using p_ids;
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function public.oq_test_cleanup(text, uuid[]) from public, anon, authenticated;
grant execute on function public.oq_test_cleanup(text, uuid[]) to service_role;
revoke all on function public.oq_claim_positions(uuid, int) from public, anon, authenticated;
grant execute on function public.oq_claim_positions(uuid, int) to service_role;
revoke all on function public.oq_release_positions(uuid, int) from public, anon, authenticated;
grant execute on function public.oq_release_positions(uuid, int) to service_role;
