-- 0114 · WAYS TO WEAR IT — a running job says it is alive.
--
-- A job was called dead when it had been `running` for 90 seconds, and given
-- back to the queue. A cold compose on the nano database takes longer than
-- that, so the next drain claimed the same job while the first was still
-- composing: two composes for one tap, and then the second was failed as
-- "ran out of time" although the first had kept its ways (2026-11-03, the
-- Flora skirt). The runner now touches heartbeat_at every 20 seconds; a job
-- is stale only when its last heartbeat (or its start, before the first
-- beat) is older than the stale limit.

alter table public.styled_way_job add column if not exists heartbeat_at timestamptz;
