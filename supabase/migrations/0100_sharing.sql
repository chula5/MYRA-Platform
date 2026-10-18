-- 0100: SHARING — friends on MYRA, and the chats they share outfits in.
-- Idempotent; applied with `npm run migrate`.
--
-- Chloe asked (2026-10-17) for a sharing area: a member adds a friend by her
-- email or her handle, the friend accepts on her side (both sides agree, or
-- there is no friendship), and the two of them — or a small group — have a
-- chat where outfits, pieces she found and recommendations are passed along.
-- One day influencers share here too; for now it is friends only.

-- ── Who she is to her friends ──────────────────────────────────────────────
-- A handle to be found by (lower-case, letters/digits/dots/underscores) and
-- the email her login uses, copied here so a friend can type it. Both are
-- backfilled from what exists: the handle from her first name, numbered when
-- two share it; the email from auth.users through auth_user_id.
alter table public.pilot_member add column if not exists handle text;
alter table public.pilot_member add column if not exists email text;
create unique index if not exists idx_pilot_member_handle on public.pilot_member (lower(handle)) where handle is not null;
create index if not exists idx_pilot_member_email on public.pilot_member (lower(email)) where email is not null;

update public.pilot_member m
   set email = lower(u.email)
  from auth.users u
 where u.id = m.auth_user_id and m.email is null and u.email is not null;

with named as (
  select member_id,
         nullif(lower(regexp_replace(split_part(trim(name), ' ', 1), '[^A-Za-z0-9]', '', 'g')), '') as base,
         row_number() over (partition by lower(regexp_replace(split_part(trim(name), ' ', 1), '[^A-Za-z0-9]', '', 'g')) order by created_at) as n
    from public.pilot_member
   where handle is null and not is_synthetic
)
update public.pilot_member m
   set handle = case when named.n = 1 then named.base else named.base || named.n end
  from named
 where named.member_id = m.member_id and named.base is not null;

-- ── Friendships ────────────────────────────────────────────────────────────
-- One row per pair. The requester asks; the addressee accepts or declines.
-- A declined ask can be asked again later (the row is reused).
create table if not exists public.member_friendship (
  friendship_id uuid primary key default gen_random_uuid(),
  requester_id  uuid not null references public.pilot_member(member_id) on delete cascade,
  addressee_id  uuid not null references public.pilot_member(member_id) on delete cascade,
  status        text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  created_at    timestamptz not null default now(),
  responded_at  timestamptz,
  check (requester_id <> addressee_id)
);
alter table public.member_friendship enable row level security;
-- The pair is unique whichever way round it was asked.
create unique index if not exists idx_member_friendship_pair
  on public.member_friendship (least(requester_id, addressee_id), greatest(requester_id, addressee_id));
create index if not exists idx_member_friendship_addressee on public.member_friendship (addressee_id, status);
create index if not exists idx_member_friendship_requester on public.member_friendship (requester_id, status);

-- ── Chats ──────────────────────────────────────────────────────────────────
-- A direct chat is made for two friends the moment the friendship is accepted;
-- a group chat is started by hand with two or more friends.
create table if not exists public.share_chat (
  chat_id         uuid primary key default gen_random_uuid(),
  created_by      uuid references public.pilot_member(member_id) on delete set null,
  title           text,
  is_group        boolean not null default false,
  created_at      timestamptz not null default now(),
  last_message_at timestamptz
);
alter table public.share_chat enable row level security;

create table if not exists public.share_chat_member (
  chat_id      uuid not null references public.share_chat(chat_id) on delete cascade,
  member_id    uuid not null references public.pilot_member(member_id) on delete cascade,
  joined_at    timestamptz not null default now(),
  last_read_at timestamptz,
  primary key (chat_id, member_id)
);
alter table public.share_chat_member enable row level security;
create index if not exists idx_share_chat_member_member on public.share_chat_member (member_id);

-- A message is words, or words with something attached: one of her looks, a
-- piece she found, or a link. The attachment is a snapshot (payload) so the
-- chat still reads if the look or the piece is later gone.
create table if not exists public.share_message (
  message_id uuid primary key default gen_random_uuid(),
  chat_id    uuid not null references public.share_chat(chat_id) on delete cascade,
  sender_id  uuid references public.pilot_member(member_id) on delete set null,
  kind       text not null default 'text' check (kind in ('text', 'look', 'piece', 'link')),
  body       text not null default '',
  payload    jsonb,
  created_at timestamptz not null default now()
);
alter table public.share_message enable row level security;
create index if not exists idx_share_message_chat on public.share_message (chat_id, created_at desc);

-- The app note when a friend asks, accepts, or sends something.
alter table public.pilot_notification drop constraint if exists pilot_notification_kind_check;
alter table public.pilot_notification add constraint pilot_notification_kind_check
  check (kind in ('looks_ready', 'note', 'event_picks', 'share'));

-- Service-role only on all of it, as every other pilot table: the sharing
-- room reads through server actions that resolve the signed-in member.
