-- 0086_outfit_quality_active_hold_unique.sql
--
-- One ACTIVE queue hold per candidate version, enforced at the database
-- boundary. Additive only: no earlier migration is edited and no row is
-- rewritten.
--
-- `outfit_quality_queue_hold` (0078) records Hold/Release queue dispositions.
-- The application planner (`planHold`) already reuses an existing active hold,
-- but the read-then-insert sequence leaves a rare race: two concurrent holds
-- on the same candidate version could both pass the planner check and both
-- insert, leaving two active holds. A partial unique index closes the race —
-- the loser's INSERT is rejected with 23505, and the store returns the
-- winning hold as a reuse. Released holds (released_at IS NOT NULL) keep
-- unlimited history, so hold/release cycles remain fully auditable.

create unique index if not exists oq_queue_hold_active_uq
  on public.outfit_quality_queue_hold (candidate_version_id)
  where released_at is null;
