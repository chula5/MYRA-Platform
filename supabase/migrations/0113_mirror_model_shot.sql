-- MYRA Mirror — SEE ON A MODEL.
--
-- One Higgsfield shoot per piece a member asks to see worn: the extension's
-- card swaps the retailer's picture for MYRA's model wearing the piece, with
-- the product photos tucked underneath. The renderer is the Higgsfield CLI on
-- Chloe's Mac (see lib/mirror/model-shot), so an ask from the live site is
-- queued here and rendered by /api/cron/mirror-model-render on that machine;
-- a dev server with the CLI renders straight away. One row per item, shared
-- by every member who asks — the shot is of the piece, not of her.

create table if not exists public.mirror_model_shot (
  item_id      uuid primary key references public.item(item_id) on delete cascade,
  member_id    uuid references public.pilot_member(member_id) on delete set null,
  status       text not null default 'queued' check (status in ('queued', 'rendering', 'done', 'failed')),
  image_url    text,
  source_image text,
  error        text,
  attempts     int not null default 0,
  asked_at     timestamptz not null default now(),
  rendered_at  timestamptz
);
alter table public.mirror_model_shot enable row level security;
create index if not exists idx_mirror_model_shot_queue on public.mirror_model_shot (status, asked_at);
