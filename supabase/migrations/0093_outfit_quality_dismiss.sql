-- 0093 · DISMISS a candidate: take it out of the queue with NO verdict and NO
-- learning, reversibly, and keep it in history. Versions stay immutable and
-- undeletable; a dismissal is one more append-only review event, reversed by
-- an ordinary `undo` event that points at it.
alter table public.outfit_quality_review_event
  drop constraint if exists outfit_quality_review_event_action_check,
  drop constraint if exists oq_review_decide_shape,
  drop constraint if exists oq_review_reversal_ref;

alter table public.outfit_quality_review_event
  add constraint outfit_quality_review_event_action_check
    check (action in ('decide','undo','withdraw','dismiss')),
  add constraint oq_review_decide_shape
    check ((action = 'decide' and decision is not null) or (action in ('undo','withdraw','dismiss') and decision is null)),
  add constraint oq_review_reversal_ref
    check ((action in ('undo','withdraw') and reverses_event_id is not null) or (action in ('decide','dismiss') and reverses_event_id is null));
