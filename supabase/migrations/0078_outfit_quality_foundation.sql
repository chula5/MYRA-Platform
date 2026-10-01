-- 0078_outfit_quality_foundation.sql
-- THE OUTFIT QUALITY LAB FOUNDATION.
--
-- Everything here is additive and namespaced `outfit_quality_`. It adds no
-- column to, and rewrites no row of, the existing member, stylist, outfit, or
-- outfit_item tables. Existing customer behaviour is untouched.
--
-- The Lab records attributable training evidence without ever confusing three
-- different things: whether an outfit is globally good, whether it fits a
-- chosen stylist, and what one real member personally likes. The database — not
-- just the UI — is where those lines are drawn:
--
--   * Only five dataset partitions exist, and a batch's partition is frozen the
--     moment its first case appears, so attribution can never drift.
--   * Every batch and case has EXACTLY ONE context — a real member or an
--     evaluation profile, never both, never neither — and a case must repeat
--     its batch's partition, context and stylist exactly.
--   * Evaluation profiles live in their own table. They are not members, cannot
--     own member feedback, and cannot resolve a member session.
--   * The frozen evidence tables (snapshots, candidate versions and items,
--     machine checks, review/reversal events, image overrides, learning
--     applications and legacy evidence) are append-only at the boundary.
--     Corrections append a new version or a compensating event; they never
--     rewrite history. A direct UPDATE is refused; a DELETE is refused unless an
--     authorized cleanup explicitly opts in (see app.oq_allow_cleanup below).
--   * Every table has RLS enabled with NO policies — exactly like the other
--     admin-only pilot tables — so no anon or ordinary authenticated client can
--     read or write directly. Server code reaches these through the service role
--     after an admin check.
--
-- AUTHORIZED TEST CLEANUP.
-- Automated tests insert only `data_partition='test'` rows under a unique
-- run_id, record every exact id, and delete only those ids. Because the frozen
-- tables refuse ordinary deletes, cleanup opts in for one transaction with:
--     begin; set local app.oq_allow_cleanup = 'on'; delete ... where id in (...);
--     commit;
-- The flag never relaxes the UPDATE ban and never permits a broad predicate.

-- ─────────────────────────────────────────────────────────────────────────────
-- Shared guard functions
-- ─────────────────────────────────────────────────────────────────────────────

-- True only inside a transaction that deliberately opted into cleanup.
create or replace function public.oq_cleanup_opt_in() returns boolean as $$
  select coalesce(current_setting('app.oq_allow_cleanup', true), '') = 'on';
$$ language sql stable;

-- Fully immutable evidence: no UPDATE ever; DELETE only during opted-in cleanup.
create or replace function public.oq_block_evidence_mutation() returns trigger as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'append-only: %.% is immutable; corrections append new rows', tg_table_schema, tg_table_name;
  elsif tg_op = 'DELETE' then
    if not public.oq_cleanup_opt_in() then
      raise exception 'append-only: %.% rows cannot be deleted', tg_table_schema, tg_table_name;
    end if;
    return old;
  end if;
  return new;
end;
$$ language plpgsql;

-- Reject a synthetic pilot_member being used as a real-member context.
create or replace function public.oq_reject_synthetic_member() returns trigger as $$
begin
  if new.real_member_id is not null
     and exists (select 1 from public.pilot_member m where m.member_id = new.real_member_id and m.is_synthetic) then
    raise exception 'a synthetic pilot_member cannot be a Quality Lab real-member context';
  end if;
  return new;
end;
$$ language plpgsql;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Evaluation profiles — synthetic coverage contexts, NOT members
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.outfit_quality_evaluation_profile (
  profile_id            uuid primary key default gen_random_uuid(),
  slug                  text not null unique,
  name                  text not null,
  active                boolean not null default true,
  style_families        text[] not null default '{}',
  brand_groups          text[] not null default '{}',
  budget_profile        jsonb not null default '{}'::jsonb,
  size_profile          jsonb not null default '{}'::jsonb,
  occasions             text[] not null default '{}',
  preferences           jsonb not null default '{}'::jsonb,
  notes                 text,
  -- Provenance only: a useful legacy synthetic member definition may be copied
  -- in. It is NOT a foreign key, so this row can never resolve as that member.
  source_legacy_member_id uuid,
  created_at            timestamptz not null default now(),
  retired_at            timestamptz
);
alter table public.outfit_quality_evaluation_profile enable row level security;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Stylist snapshots — the one frozen lens, insert-only
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.outfit_quality_stylist_snapshot (
  snapshot_id                uuid primary key default gen_random_uuid(),
  stylist_id                 uuid not null references public.stylist(stylist_id),
  constitution_version       int,
  payload                    jsonb not null,
  confirmed_inspiration_count int not null default 0,
  rules_only                 boolean not null default false,
  generation_model           text,
  prompt_version             text,
  objective_rules_version    text,
  subjective_check_model     text,
  subjective_prompt_version  text,
  composer_version           text,
  item_query_version         text,
  payload_hash               text not null,
  idempotency_key            text not null unique,
  created_at                 timestamptz not null default now()
);
alter table public.outfit_quality_stylist_snapshot enable row level security;
create index if not exists oq_snapshot_stylist_idx on public.outfit_quality_stylist_snapshot(stylist_id);
create trigger oq_snapshot_immutable
  before update or delete on public.outfit_quality_stylist_snapshot
  for each row execute function public.oq_block_evidence_mutation();

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Batches — explicit, bounded, one partition + one context + one stylist
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.outfit_quality_batch (
  batch_id              uuid primary key default gen_random_uuid(),
  run_id                uuid not null unique,
  data_partition        text not null check (data_partition in ('training','validation','holdout','synthetic','test')),
  real_member_id        uuid references public.pilot_member(member_id),
  evaluation_profile_id uuid references public.outfit_quality_evaluation_profile(profile_id),
  selected_stylist_id   uuid not null references public.stylist(stylist_id),
  stylist_snapshot_id   uuid references public.outfit_quality_stylist_snapshot(snapshot_id),
  target_count          int not null check (target_count between 1 and 150),
  chunk_limit           int not null default 25 check (chunk_limit between 1 and 25),
  generation_config     jsonb not null default '{}'::jsonb,
  coverage_targets      jsonb not null default '{}'::jsonb,
  status                text not null default 'draft' check (status in ('draft','active','paused','completed','failed')),
  created_by            uuid,
  last_error            text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  -- Exactly one context.
  constraint oq_batch_one_context check (num_nonnulls(real_member_id, evaluation_profile_id) = 1)
);
alter table public.outfit_quality_batch enable row level security;
create index if not exists oq_batch_partition_idx on public.outfit_quality_batch(data_partition);
create index if not exists oq_batch_stylist_idx on public.outfit_quality_batch(selected_stylist_id);

create trigger oq_batch_reject_synthetic
  before insert or update on public.outfit_quality_batch
  for each row execute function public.oq_reject_synthetic_member();

-- Partition/context/stylist freeze once a case exists; gated delete.
create or replace function public.oq_batch_guard() returns trigger as $$
declare case_count int;
begin
  if tg_op = 'DELETE' then
    if not public.oq_cleanup_opt_in() then
      raise exception 'batches cannot be deleted outside authorized cleanup';
    end if;
    return old;
  end if;
  if row(new.data_partition, new.real_member_id, new.evaluation_profile_id, new.selected_stylist_id)
     is distinct from
     row(old.data_partition, old.real_member_id, old.evaluation_profile_id, old.selected_stylist_id) then
    select count(*) into case_count from public.outfit_quality_case where batch_id = old.batch_id;
    if case_count > 0 then
      raise exception 'batch partition, context and stylist are immutable once a case exists';
    end if;
  end if;
  return new;
end;
$$ language plpgsql;
create trigger oq_batch_guard_t
  before update or delete on public.outfit_quality_batch
  for each row execute function public.oq_batch_guard();

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Cases — repeat the batch attribution exactly; cannot drift
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.outfit_quality_case (
  case_id               uuid primary key default gen_random_uuid(),
  batch_id              uuid not null references public.outfit_quality_batch(batch_id),
  data_partition        text not null check (data_partition in ('training','validation','holdout','synthetic','test')),
  real_member_id        uuid references public.pilot_member(member_id),
  evaluation_profile_id uuid references public.outfit_quality_evaluation_profile(profile_id),
  selected_stylist_id   uuid not null references public.stylist(stylist_id),
  stylist_snapshot_id   uuid references public.outfit_quality_stylist_snapshot(snapshot_id),
  source                text not null default 'generated' check (source in ('generated','edited')),
  -- Derived pointer to the latest version; not a FK to avoid a circular table
  -- dependency with candidate_version (which references case).
  current_version_id    uuid,
  status                text not null default 'open',
  created_at            timestamptz not null default now(),
  constraint oq_case_one_context check (num_nonnulls(real_member_id, evaluation_profile_id) = 1)
);
alter table public.outfit_quality_case enable row level security;
create index if not exists oq_case_batch_idx on public.outfit_quality_case(batch_id);

create trigger oq_case_reject_synthetic
  before insert or update on public.outfit_quality_case
  for each row execute function public.oq_reject_synthetic_member();

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
  return new;
end;
$$ language plpgsql;
create trigger oq_case_guard_t
  before insert or update or delete on public.outfit_quality_case
  for each row execute function public.oq_case_guard();

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Candidate versions — immutable facts; only `state` may advance
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.outfit_quality_candidate_version (
  candidate_version_id   uuid primary key default gen_random_uuid(),
  case_id                uuid not null references public.outfit_quality_case(case_id),
  version_no             int not null,
  parent_version_id      uuid references public.outfit_quality_candidate_version(candidate_version_id),
  context_snapshot       jsonb not null,
  composition_hash       text not null,
  generation_request_key text not null unique,
  composer_version       text,
  generator_model        text,
  prompt_version         text,
  state                  text not null default 'generated',
  created_at             timestamptz not null default now(),
  constraint oq_cv_case_version_uq unique (case_id, version_no),
  constraint oq_cv_case_hash_uq unique (case_id, composition_hash)
);
alter table public.outfit_quality_candidate_version enable row level security;
create index if not exists oq_cv_case_idx on public.outfit_quality_candidate_version(case_id);

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
         new.composer_version, new.generator_model, new.prompt_version, new.created_at)
     is distinct from
     row(old.candidate_version_id, old.case_id, old.version_no, old.parent_version_id,
         old.context_snapshot, old.composition_hash, old.generation_request_key,
         old.composer_version, old.generator_model, old.prompt_version, old.created_at) then
    raise exception 'candidate versions are immutable except for state';
  end if;
  return new;
end;
$$ language plpgsql;
create trigger oq_candidate_version_guard_t
  before update or delete on public.outfit_quality_candidate_version
  for each row execute function public.oq_candidate_version_guard();

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Candidate items — normalized, ordered, frozen membership
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.outfit_quality_candidate_item (
  candidate_item_id      uuid primary key default gen_random_uuid(),
  candidate_version_id   uuid not null references public.outfit_quality_candidate_version(candidate_version_id),
  item_id                uuid not null references public.item(item_id),
  slot                   text not null,
  sort_order             int not null,
  item_snapshot          jsonb not null,
  source_image_url       text not null,
  source_image_asset_version text,
  source_image_hash      text,
  constraint oq_ci_version_item_uq unique (candidate_version_id, item_id)
);
alter table public.outfit_quality_candidate_item enable row level security;
create index if not exists oq_ci_version_idx on public.outfit_quality_candidate_item(candidate_version_id);
create trigger oq_candidate_item_immutable
  before update or delete on public.outfit_quality_candidate_item
  for each row execute function public.oq_block_evidence_mutation();

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Machine checks — append-only objective/subjective/fidelity results
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.outfit_quality_machine_check (
  check_id              uuid primary key default gen_random_uuid(),
  candidate_version_id  uuid not null references public.outfit_quality_candidate_version(candidate_version_id),
  kind                  text not null check (kind in ('objective','subjective','fidelity')),
  check_name            text not null,
  status                text not null check (status in ('passed','failed','unavailable','error')),
  verdict               text,
  score                 numeric,
  issues                jsonb,
  model                 text,
  prompt_version        text,
  raw_response_hash     text,
  attempt               int not null default 1,
  idempotency_key       text not null unique,
  created_at            timestamptz not null default now()
);
alter table public.outfit_quality_machine_check enable row level security;
create index if not exists oq_check_version_idx on public.outfit_quality_machine_check(candidate_version_id, kind);
create trigger oq_machine_check_immutable
  before update or delete on public.outfit_quality_machine_check
  for each row execute function public.oq_block_evidence_mutation();

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. Review events — append-only decisions, reversals and withdrawals
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.outfit_quality_review_event (
  review_event_id       uuid primary key default gen_random_uuid(),
  candidate_version_id  uuid not null references public.outfit_quality_candidate_version(candidate_version_id),
  action                text not null check (action in ('decide','undo','withdraw')),
  decision              text check (decision in ('yes','no')),
  reason_code           text,
  candidate_item_id     uuid references public.outfit_quality_candidate_item(candidate_item_id),
  note                  text,
  reverses_event_id     uuid references public.outfit_quality_review_event(review_event_id),
  reviewer_user_id      uuid not null,
  idempotency_key       text not null unique,
  created_at            timestamptz not null default now(),
  -- A decide must carry a decision; a No must carry a reason; undo/withdraw must
  -- reference a prior event.
  constraint oq_review_decide_shape check (
    (action = 'decide' and decision is not null) or (action in ('undo','withdraw'))
  ),
  constraint oq_review_no_reason check (
    not (action = 'decide' and decision = 'no' and reason_code is null)
  ),
  constraint oq_review_reversal_ref check (
    (action in ('undo','withdraw') and reverses_event_id is not null) or action = 'decide'
  )
);
alter table public.outfit_quality_review_event enable row level security;
create index if not exists oq_review_version_idx on public.outfit_quality_review_event(candidate_version_id, created_at);
create trigger oq_review_event_immutable
  before update or delete on public.outfit_quality_review_event
  for each row execute function public.oq_block_evidence_mutation();

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. Queue holds — a disposition, not a verdict
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.outfit_quality_queue_hold (
  hold_id               uuid primary key default gen_random_uuid(),
  candidate_version_id  uuid not null references public.outfit_quality_candidate_version(candidate_version_id),
  held_by               uuid not null,
  reason                text,
  released_by           uuid,
  created_at            timestamptz not null default now(),
  released_at           timestamptz
);
alter table public.outfit_quality_queue_hold enable row level security;
create index if not exists oq_hold_version_idx on public.outfit_quality_queue_hold(candidate_version_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 10. Promotion — one internal, non-live outfit per approved version
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.outfit_quality_promotion (
  promotion_id          uuid primary key default gen_random_uuid(),
  candidate_version_id  uuid not null unique references public.outfit_quality_candidate_version(candidate_version_id),
  outfit_id             uuid not null unique references public.outfit(outfit_id),
  status                text not null default 'active' check (status in ('active','withdrawn')),
  created_at            timestamptz not null default now(),
  withdrawn_at          timestamptz
);
alter table public.outfit_quality_promotion enable row level security;

-- ─────────────────────────────────────────────────────────────────────────────
-- 11. Render jobs — approval-gated, idempotent
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.outfit_quality_render_job (
  render_job_id         uuid primary key default gen_random_uuid(),
  candidate_version_id  uuid not null references public.outfit_quality_candidate_version(candidate_version_id),
  approval_event_id     uuid not null references public.outfit_quality_review_event(review_event_id),
  promotion_id          uuid references public.outfit_quality_promotion(promotion_id),
  cycle_no              int not null default 1,
  status                text not null default 'queued' check (status in ('queued','running','ready','attention_required','cancelled')),
  lease_token           text,
  leased_at             timestamptz,
  worker_id             text,
  generation_count      int not null default 0,
  last_error            text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint oq_render_job_cycle_uq unique (candidate_version_id, approval_event_id, cycle_no)
);
alter table public.outfit_quality_render_job enable row level security;
create index if not exists oq_render_job_status_idx on public.outfit_quality_render_job(status);

-- ─────────────────────────────────────────────────────────────────────────────
-- 12. Render attempts — at most two per cycle
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.outfit_quality_render_attempt (
  render_attempt_id     uuid primary key default gen_random_uuid(),
  render_job_id         uuid not null references public.outfit_quality_render_job(render_job_id),
  attempt_no            int not null check (attempt_no in (1,2)),
  prompt                text,
  reference_manifest    jsonb,
  renderer_model        text,
  renderer_version      text,
  image_url             text,
  cloudinary_asset      text,
  generation_status     text,
  generation_error      text,
  fidelity_check_id     uuid references public.outfit_quality_machine_check(check_id),
  ready_at              timestamptz,
  created_at            timestamptz not null default now(),
  constraint oq_render_attempt_uq unique (render_job_id, attempt_no)
);
alter table public.outfit_quality_render_attempt enable row level security;

-- ─────────────────────────────────────────────────────────────────────────────
-- 13. Image overrides — append-only `Not good enough`
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.outfit_quality_image_override (
  override_id           uuid primary key default gen_random_uuid(),
  render_attempt_id     uuid not null references public.outfit_quality_render_attempt(render_attempt_id),
  action                text not null default 'not_good_enough' check (action = 'not_good_enough'),
  reason                text not null check (reason in ('image_fidelity','image_quality','underlying_outfit')),
  reviewer_user_id      uuid not null,
  note                  text,
  idempotency_key       text not null unique,
  created_at            timestamptz not null default now()
);
alter table public.outfit_quality_image_override enable row level security;
create trigger oq_image_override_immutable
  before update or delete on public.outfit_quality_image_override
  for each row execute function public.oq_block_evidence_mutation();

-- ─────────────────────────────────────────────────────────────────────────────
-- 14. Learning projections — global quality or exactly one stylist; never member
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.outfit_quality_learning_projection (
  projection_id         uuid primary key default gen_random_uuid(),
  review_event_id       uuid not null references public.outfit_quality_review_event(review_event_id),
  candidate_version_id  uuid not null references public.outfit_quality_candidate_version(candidate_version_id),
  scope                 text not null check (scope in ('global_quality','stylist')),
  target_stylist_id     uuid references public.stylist(stylist_id),
  polarity              text not null check (polarity in ('positive','negative')),
  payload               jsonb not null default '{}'::jsonb,
  status                text not null default 'pending' check (status in ('pending','applied','reversed','ineligible')),
  application_key       text not null unique,
  reverses_projection_id uuid references public.outfit_quality_learning_projection(projection_id),
  created_at            timestamptz not null default now(),
  -- A stylist scope targets exactly one stylist; global scope targets none.
  constraint oq_projection_scope_target check (
    (scope = 'stylist' and target_stylist_id is not null) or
    (scope = 'global_quality' and target_stylist_id is null)
  )
);
alter table public.outfit_quality_learning_projection enable row level security;
create index if not exists oq_projection_review_idx on public.outfit_quality_learning_projection(review_event_id);
create trigger oq_learning_projection_immutable
  before update or delete on public.outfit_quality_learning_projection
  for each row execute function public.oq_block_evidence_mutation();

-- ─────────────────────────────────────────────────────────────────────────────
-- 15. Legacy evidence — the exact 444, Chloe-only, append-only
-- ─────────────────────────────────────────────────────────────────────────────
-- The attribution shape is pinned by CHECK constraints: training partition,
-- positive polarity, stylist scope, legacy_canonical source. There is no member
-- column and no global flag, so this evidence cannot become anything else.
create table if not exists public.outfit_quality_legacy_evidence (
  outfit_id             uuid primary key references public.outfit(outfit_id),
  stylist_id            uuid not null references public.stylist(stylist_id),
  data_partition        text not null default 'training' check (data_partition = 'training'),
  polarity              text not null default 'positive' check (polarity = 'positive'),
  scope                 text not null default 'stylist' check (scope = 'stylist'),
  source                text not null default 'legacy_canonical' check (source = 'legacy_canonical'),
  import_manifest_id    uuid not null,
  created_at            timestamptz not null default now()
);
alter table public.outfit_quality_legacy_evidence enable row level security;
create index if not exists oq_legacy_stylist_idx on public.outfit_quality_legacy_evidence(stylist_id);
create trigger oq_legacy_evidence_immutable
  before update or delete on public.outfit_quality_legacy_evidence
  for each row execute function public.oq_block_evidence_mutation();
