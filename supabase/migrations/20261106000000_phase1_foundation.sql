-- =============================================================================
-- Phase 1 foundation: profiles, chats, participants, messages, wallets.
--
-- Security model
--   * Every table has RLS enabled. Policies are granted only to `authenticated`;
--     `anon` gets nothing.
--   * Emails live only in auth.users and are never copied into public tables.
--   * Profiles are NOT a public directory: you see your own profile plus the
--     profiles of people you share a chat with. Finding a stranger requires the
--     exact @username via public.find_profile_by_username().
--   * Chats / participants / wallets have no client write policies. Chats are
--     created through the public.create_direct_chat() RPC. Wallet balances can
--     only change through server-side code (future transfer functions).
--   * SECURITY DEFINER helpers live in the `private` schema, which is not
--     exposed through the Data API.
-- =============================================================================

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

-- -----------------------------------------------------------------------------
-- Tables
-- -----------------------------------------------------------------------------

create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  -- Null until the user finishes onboarding. Unique allows multiple nulls.
  username     text unique
               constraint username_format
               check (username ~ '^[a-z0-9_]{3,20}$'),   -- lowercase only
  display_name text
               constraint display_name_length
               check (char_length(btrim(display_name)) between 1 and 50),
  avatar_url   text,
  created_at   timestamptz not null default now()
);

create table public.chats (
  id         uuid primary key default gen_random_uuid(),
  type       text not null check (type in ('direct', 'group')),
  created_at timestamptz not null default now()
);

create table public.chat_participants (
  chat_id   uuid not null references public.chats (id) on delete cascade,
  user_id   uuid not null references public.profiles (id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (chat_id, user_id)
);
create index chat_participants_user_id_idx on public.chat_participants (user_id);

create table public.messages (
  id           uuid primary key default gen_random_uuid(),
  chat_id      uuid not null references public.chats (id) on delete cascade,
  -- Null for system messages, or if the sender's account was deleted.
  sender_id    uuid references public.profiles (id) on delete set null,
  message_type text not null
               check (message_type in ('text', 'image', 'audio', 'file', 'system')),
  content      text check (char_length(content) <= 4000),
  -- R2 object key (served via presigned GET URLs), not a public URL.
  media_url    text,
  created_at   timestamptz not null default now(),
  constraint message_payload check (
    case message_type
      when 'text'   then content is not null and media_url is null
      when 'system' then content is not null
      else media_url is not null                -- image / audio / file
    end
  )
);
create index messages_chat_id_created_at_idx
  on public.messages (chat_id, created_at desc);
create index messages_sender_id_idx on public.messages (sender_id);

create table public.wallets (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null unique references auth.users (id) on delete cascade,
  balance    numeric(20, 2) not null default 0 check (balance >= 0),
  status     text not null default 'active'
             check (status in ('active', 'frozen', 'closed')),
  created_at timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- Private helpers (SECURITY DEFINER so they can read chat_participants without
-- triggering its own RLS policy recursively).
-- -----------------------------------------------------------------------------

create or replace function private.is_chat_participant(p_chat_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.chat_participants cp
    where cp.chat_id = p_chat_id
      and cp.user_id = (select auth.uid())
  );
$$;

create or replace function private.shares_chat_with(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.chat_participants mine
    join public.chat_participants theirs on theirs.chat_id = mine.chat_id
    where mine.user_id = (select auth.uid())
      and theirs.user_id = p_user_id
  );
$$;

revoke all on function private.is_chat_participant(uuid) from public;
revoke all on function private.shares_chat_with(uuid) from public;
grant execute on function private.is_chat_participant(uuid) to authenticated;
grant execute on function private.shares_chat_with(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Table privileges (defence in depth on top of RLS)
-- -----------------------------------------------------------------------------

revoke all on public.profiles, public.chats, public.chat_participants,
              public.messages, public.wallets
  from anon, authenticated;

grant select on public.profiles to authenticated;
grant update (username, display_name, avatar_url) on public.profiles to authenticated;

grant select on public.chats to authenticated;
grant select on public.chat_participants to authenticated;
grant select, insert on public.messages to authenticated;
grant select on public.wallets to authenticated;

-- -----------------------------------------------------------------------------
-- Row-Level Security
-- -----------------------------------------------------------------------------

alter table public.profiles          enable row level security;
alter table public.chats             enable row level security;
alter table public.chat_participants enable row level security;
alter table public.messages          enable row level security;
alter table public.wallets           enable row level security;

-- profiles: yourself + people you share a chat with. Update only your own row.
create policy "profiles: read self and chat contacts"
  on public.profiles for select to authenticated
  using (id = (select auth.uid()) or private.shares_chat_with(id));

create policy "profiles: update own"
  on public.profiles for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- chats: only chats you participate in.
create policy "chats: read if participant"
  on public.chats for select to authenticated
  using (private.is_chat_participant(id));

-- chat_participants: membership rows of chats you are in.
create policy "chat_participants: read if participant"
  on public.chat_participants for select to authenticated
  using (private.is_chat_participant(chat_id));

-- messages: read in your chats; send as yourself, never 'system'.
create policy "messages: read if participant"
  on public.messages for select to authenticated
  using (private.is_chat_participant(chat_id));

create policy "messages: send as self to own chats"
  on public.messages for insert to authenticated
  with check (
    sender_id = (select auth.uid())
    and message_type <> 'system'
    and private.is_chat_participant(chat_id)
  );

-- wallets: read your own only. No client writes.
create policy "wallets: read own"
  on public.wallets for select to authenticated
  using (user_id = (select auth.uid()));

-- -----------------------------------------------------------------------------
-- Signup trigger: blank profile + zero-balance wallet for every new auth user.
-- -----------------------------------------------------------------------------

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id) values (new.id)
  on conflict (id) do nothing;

  insert into public.wallets (user_id) values (new.id)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

revoke all on function private.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- -----------------------------------------------------------------------------
-- RPCs exposed to clients
-- -----------------------------------------------------------------------------

-- Exact-match lookup so users can start a chat with a known @username without
-- exposing a browsable directory. Returns no email or other private data.
create or replace function public.find_profile_by_username(p_username text)
returns table (id uuid, username text, display_name text, avatar_url text)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.username, p.display_name, p.avatar_url
  from public.profiles p
  where (select auth.uid()) is not null
    and p.username = lower(btrim(ltrim(p_username, '@')));
$$;

revoke all on function public.find_profile_by_username(text) from public, anon;
grant execute on function public.find_profile_by_username(text) to authenticated;

-- Returns the existing direct chat with p_other_user, or creates it.
-- An advisory lock on the user pair prevents duplicate chats from races.
create or replace function public.create_direct_chat(p_other_user uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me      uuid := auth.uid();
  v_chat_id uuid;
begin
  if v_me is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_other_user is null or p_other_user = v_me then
    raise exception 'invalid recipient' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.profiles
    where id = p_other_user and username is not null
  ) then
    raise exception 'recipient not found' using errcode = 'P0002';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(least(v_me, p_other_user)::text
                     || greatest(v_me, p_other_user)::text, 0)
  );

  select c.id into v_chat_id
  from public.chats c
  join public.chat_participants a on a.chat_id = c.id and a.user_id = v_me
  join public.chat_participants b on b.chat_id = c.id and b.user_id = p_other_user
  where c.type = 'direct'
  limit 1;

  if v_chat_id is null then
    insert into public.chats (type) values ('direct') returning id into v_chat_id;
    insert into public.chat_participants (chat_id, user_id)
    values (v_chat_id, v_me), (v_chat_id, p_other_user);
  end if;

  return v_chat_id;
end;
$$;

revoke all on function public.create_direct_chat(uuid) from public, anon;
grant execute on function public.create_direct_chat(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Realtime: postgres_changes respects the RLS policies above.
-- -----------------------------------------------------------------------------

alter publication supabase_realtime add table public.messages;
alter publication supabase_realtime add table public.chat_participants;
