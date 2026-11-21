-- =============================================================================
-- Push notifications: device tokens, a per-user on/off switch, and the
-- lookup the push route uses to find who to wake.
--
-- * user_push_tokens: one row per (user, device token). RLS: you can only
--   see, add, change or remove your own tokens.
-- * profiles.push_notifications_enabled: the Settings toggle (default on).
--   Users update it on their own row (column grant + "profiles: update own").
-- * get_push_targets(): called by /api/push/notify *as the sender*. It only
--   answers for a call you just started (still ringing, < 60 s old) or a
--   message you just sent (< 5 min old), once per call / message, and only
--   returns recipients who have push on (and, for messages, haven't muted
--   the chat). The route then delivers through FCM with server credentials,
--   so a token alone is useless to whoever sees it.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Preference
-- -----------------------------------------------------------------------------

alter table public.profiles
  add column if not exists push_notifications_enabled boolean not null default true;

grant update (push_notifications_enabled) on public.profiles to authenticated;

-- -----------------------------------------------------------------------------
-- Device tokens
-- -----------------------------------------------------------------------------

create table public.user_push_tokens (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  token      text not null constraint push_token_length check (char_length(token) between 1 and 4096),
  platform   text not null constraint push_token_platform check (platform in ('android', 'ios', 'web')),
  updated_at timestamptz not null default now(),
  constraint user_push_tokens_user_token unique (user_id, token)
);

create index user_push_tokens_user_idx on public.user_push_tokens (user_id);

alter table public.user_push_tokens enable row level security;

revoke all on public.user_push_tokens from public, anon, authenticated;
grant select, insert, delete on public.user_push_tokens to authenticated;
grant update (platform, updated_at) on public.user_push_tokens to authenticated;

create policy "push tokens: read own"
  on public.user_push_tokens for select to authenticated
  using (user_id = (select auth.uid()));

create policy "push tokens: insert own"
  on public.user_push_tokens for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy "push tokens: update own"
  on public.user_push_tokens for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "push tokens: delete own"
  on public.user_push_tokens for delete to authenticated
  using (user_id = (select auth.uid()));

-- A device token belongs to one account at a time: registering it for me
-- removes it from whoever was signed in on this device before. Runs as the
-- definer because the old row belongs to someone else (RLS would hide it).
create or replace function public.register_push_token(p_token text, p_platform text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  if p_token is null or char_length(p_token) not between 1 and 4096 then
    raise exception 'invalid token' using errcode = '22023';
  end if;
  if p_platform not in ('android', 'ios', 'web') then
    raise exception 'invalid platform' using errcode = '22023';
  end if;

  delete from public.user_push_tokens where token = p_token and user_id <> v_me;

  insert into public.user_push_tokens (user_id, token, platform, updated_at)
  values (v_me, p_token, p_platform, now())
  on conflict (user_id, token) do update
    set platform = excluded.platform, updated_at = now();
end;
$$;

-- -----------------------------------------------------------------------------
-- Dispatch lookup
-- -----------------------------------------------------------------------------

-- Each call / message may be pushed once, so a sender can't replay it to spam.
create table private.push_dispatches (
  ref_id       uuid primary key,
  kind         text not null check (kind in ('call', 'message')),
  dispatched_at timestamptz not null default now()
);

create index push_dispatches_dispatched_at_idx on private.push_dispatches (dispatched_at);
revoke all on private.push_dispatches from public, anon, authenticated;

-- Returns null when there is nothing (more) to send. Otherwise:
-- { kind, chat_id, sender_id, sender_name, sender_avatar, is_group,
--   chat_title, call_id, call_type, created_at,              -- calls
--   message_id, message_type, content, duration_seconds,     -- messages
--   targets: [{ user_id, token, platform }] }
create or replace function public.get_push_targets(p_call_id uuid default null, p_message_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me      uuid := auth.uid();
  v_call    public.calls;
  v_msg     public.messages;
  v_chat    public.chats;
  v_targets jsonb;
  v_sender  public.profiles;
begin
  if v_me is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  if (p_call_id is null) = (p_message_id is null) then
    raise exception 'pass exactly one of p_call_id, p_message_id' using errcode = '22023';
  end if;

  -- Markers only matter inside the freshness windows below.
  delete from private.push_dispatches where dispatched_at < now() - interval '1 day';

  select * into v_sender from public.profiles where id = v_me;

  if p_call_id is not null then
    select * into v_call from public.calls
    where id = p_call_id
      and caller_id = v_me
      and not is_group
      and status = 'ringing'
      and created_at > now() - interval '60 seconds';
    if not found then return null; end if;

    insert into private.push_dispatches (ref_id, kind) values (p_call_id, 'call')
    on conflict do nothing;
    if not found then return null; end if;

    -- Calls ring even in a muted chat (like a phone); only the switch stops them.
    select coalesce(jsonb_agg(jsonb_build_object('user_id', t.user_id, 'token', t.token, 'platform', t.platform)), '[]'::jsonb)
      into v_targets
    from public.user_push_tokens t
    join public.profiles p on p.id = t.user_id
    where t.user_id = v_call.callee_id
      and p.push_notifications_enabled;

    return jsonb_build_object(
      'kind', 'call',
      'call_id', v_call.id,
      'chat_id', v_call.chat_id,
      'call_type', v_call.call_type,
      'created_at', v_call.created_at,
      'sender_id', v_me,
      'sender_name', private.profile_label(v_me),
      'sender_avatar', v_sender.avatar_url,
      'is_group', false,
      'targets', v_targets
    );
  end if;

  select * into v_msg from public.messages
  where id = p_message_id
    and sender_id = v_me
    and message_type <> 'system'
    and created_at > now() - interval '5 minutes';
  if not found then return null; end if;

  insert into private.push_dispatches (ref_id, kind) values (p_message_id, 'message')
  on conflict do nothing;
  if not found then return null; end if;

  select * into v_chat from public.chats where id = v_msg.chat_id;

  select coalesce(jsonb_agg(jsonb_build_object('user_id', t.user_id, 'token', t.token, 'platform', t.platform)), '[]'::jsonb)
    into v_targets
  from public.chat_participants cp
  join public.profiles p on p.id = cp.user_id
  join public.user_push_tokens t on t.user_id = cp.user_id
  where cp.chat_id = v_msg.chat_id
    and cp.user_id <> v_me
    and not cp.is_muted
    and p.push_notifications_enabled;

  return jsonb_build_object(
    'kind', 'message',
    'message_id', v_msg.id,
    'chat_id', v_msg.chat_id,
    'message_type', v_msg.message_type,
    'content', left(v_msg.content, 300),
    'duration_seconds', v_msg.duration_seconds,
    'created_at', v_msg.created_at,
    'sender_id', v_me,
    'sender_name', private.profile_label(v_me),
    'sender_avatar', v_sender.avatar_url,
    'is_group', v_chat.type = 'group',
    'chat_title', v_chat.title,
    'targets', v_targets
  );
end;
$$;

revoke all on function public.register_push_token(text, text) from public, anon;
revoke all on function public.get_push_targets(uuid, uuid) from public, anon;
grant execute on function public.register_push_token(text, text) to authenticated;
grant execute on function public.get_push_targets(uuid, uuid) to authenticated;
