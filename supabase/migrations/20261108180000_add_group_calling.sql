-- =============================================================================
-- Phase 8: group voice / video calls.
--
-- Model
--   * A group call is one `calls` row with is_group = true, no callee and
--     status 'active' -> 'ended'. At most one active call per group (unique
--     index), so two people pressing "call" at once end up in the same room.
--   * Presence lives in call_participants (one row per person, re-used on
--     rejoin). A participant is live while left_at is null and their
--     heartbeat is < 45 s old.
--   * The room closes when the last live participant leaves, or when every
--     heartbeat has gone stale (closed lazily by start_call / heartbeat_call /
--     get_group_call). Closing posts "📞 Group voice call ended · MM:SS".
--   * No ringing: starting a group call posts "📞 Alice started a group voice
--     call" and members see an "ongoing · Join" pill. start_call on a group
--     with an active call simply joins it.
--   * Membership changes touch calls.last_seen_at so chat members (who can
--     now read their groups' call rows) get a Realtime UPDATE to refresh the
--     pill. call_participants is not in the Realtime publication.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Schema
-- -----------------------------------------------------------------------------

alter table public.calls alter column callee_id drop not null;
alter table public.calls add column is_group boolean not null default false;

alter table public.calls drop constraint calls_status_check;
alter table public.calls add constraint calls_status_check
  check (status in ('ringing', 'accepted', 'declined', 'cancelled', 'missed', 'ended', 'active'));

alter table public.calls add constraint call_shape check (
  case when is_group
    then callee_id is null and status in ('active', 'ended')
    else callee_id is not null and status <> 'active'
  end
);

create unique index calls_one_active_group_call
  on public.calls (chat_id) where is_group and status = 'active';

drop index public.calls_open_idx;
create index calls_open_idx on public.calls (status) where status in ('ringing', 'accepted', 'active');

create table public.call_participants (
  call_id      uuid not null references public.calls (id) on delete cascade,
  user_id      uuid not null references public.profiles (id) on delete cascade,
  joined_at    timestamptz not null default now(),
  left_at      timestamptz,
  last_seen_at timestamptz not null default now(),
  primary key (call_id, user_id)
);
create index call_participants_live_user_idx
  on public.call_participants (user_id) where left_at is null;

revoke all on public.call_participants from anon, authenticated;
grant select on public.call_participants to authenticated;
alter table public.call_participants enable row level security;

-- -----------------------------------------------------------------------------
-- Helpers
-- -----------------------------------------------------------------------------

create or replace function private.participant_is_live(p public.call_participants)
returns boolean
language sql
stable
set search_path = ''
as $$
  select p.left_at is null and p.last_seen_at > now() - interval '45 seconds';
$$;

-- Now also understands group calls ('active' = someone is still in the room).
create or replace function private.call_is_live(c public.calls)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case c.status
    when 'ringing'  then c.created_at   > now() - interval '45 seconds'
    when 'accepted' then c.last_seen_at > now() - interval '45 seconds'
    when 'active'   then exists (
      select 1 from public.call_participants p
      where p.call_id = c.id and private.participant_is_live(p)
    )
    else false
  end;
$$;

-- Is this user in any live call (1-on-1 or group), other than p_except?
create or replace function private.user_in_live_call(p_user_id uuid, p_except uuid default null)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.calls c
    where not c.is_group
      and c.status in ('ringing', 'accepted')
      and p_user_id in (c.caller_id, c.callee_id)
      and c.id is distinct from p_except
      and private.call_is_live(c)
  ) or exists (
    select 1
    from public.call_participants p
    join public.calls c on c.id = p.call_id
    where p.user_id = p_user_id
      and c.status = 'active'
      and c.id is distinct from p_except
      and private.participant_is_live(p)
  );
$$;

-- Who may see a call (and its participants): the two parties of a 1-on-1
-- call, or any member of the group.
create or replace function private.can_see_call(p_call_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.calls c
    where c.id = p_call_id
      and (
        (select auth.uid()) in (c.caller_id, c.callee_id)
        or (c.is_group and private.is_chat_participant(c.chat_id))
      )
  );
$$;

-- "05", "12", "123": minutes for receipts (lpad would truncate past 99).
create or replace function private.two_digits(p_n integer)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when p_n < 10 then '0' || p_n::text else p_n::text end;
$$;

-- Chat receipts for 1-on-1 and group calls.
create or replace function private.log_call_message(c public.calls)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_icon  text := case when c.call_type = 'video' then '📹' else '📞' end;
  v_kind  text := case when c.call_type = 'video' then 'video call' else 'voice call' end;
  v_label text := case when c.call_type = 'video' then 'Video call' else 'Voice call' end;
  v_secs  integer;
  v_text  text;
begin
  if c.is_group then
    if c.status <> 'ended' then
      return;
    end if;
    v_secs := greatest(0, extract(epoch from (c.ended_at - c.created_at))::integer);
    v_text := format('%s Group %s ended · %s:%s', v_icon, v_kind,
                     private.two_digits(v_secs / 60), private.two_digits(v_secs % 60));
  else
    case c.status
      when 'ended' then
        v_secs := greatest(0, extract(epoch from (c.ended_at - c.answered_at))::integer);
        v_text := format('%s %s · %s:%s', v_icon, v_label,
                         private.two_digits(v_secs / 60), private.two_digits(v_secs % 60));
      when 'missed', 'cancelled' then v_text := format('%s Missed %s', v_icon, v_kind);
      when 'declined'            then v_text := format('%s Declined %s', v_icon, v_kind);
      else return;
    end case;
  end if;

  insert into public.messages (chat_id, sender_id, message_type, content)
  values (c.chat_id, null, 'system', v_text);
end;
$$;

-- Marks stale participants as gone and closes the room if nobody is left.
-- Returns true while the call is still active. Takes the call's row lock.
create or replace function private.reap_group_call(p_call_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_call   public.calls;
  v_reaped integer;
begin
  select * into v_call from public.calls
  where id = p_call_id and is_group
  for update;
  if v_call.id is null or v_call.status <> 'active' then
    return false;
  end if;

  update public.call_participants p
  set left_at = p.last_seen_at
  where p.call_id = p_call_id
    and p.left_at is null
    and not private.participant_is_live(p);
  get diagnostics v_reaped = row_count;

  if exists (
    select 1 from public.call_participants p
    where p.call_id = p_call_id and private.participant_is_live(p)
  ) then
    if v_reaped > 0 then
      update public.calls set last_seen_at = now() where id = p_call_id; -- refresh pills
    end if;
    return true;
  end if;

  update public.calls
  set status = 'ended',
      ended_at = coalesce(
        (select max(p.left_at) from public.call_participants p where p.call_id = p_call_id),
        now()),
      last_seen_at = now()
  where id = p_call_id
  returning * into v_call;

  perform private.log_call_message(v_call);
  return false;
end;
$$;

revoke all on function private.participant_is_live(public.call_participants) from public;
revoke all on function private.call_is_live(public.calls) from public;
revoke all on function private.user_in_live_call(uuid, uuid) from public, anon, authenticated;
revoke all on function private.can_see_call(uuid) from public;
revoke all on function private.two_digits(integer) from public, anon, authenticated;
revoke all on function private.log_call_message(public.calls) from public, anon, authenticated;
revoke all on function private.reap_group_call(uuid) from public, anon, authenticated;
grant execute on function private.participant_is_live(public.call_participants) to authenticated;
grant execute on function private.call_is_live(public.calls) to authenticated;
grant execute on function private.can_see_call(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------

create policy "calls: read group calls in my chats"
  on public.calls for select to authenticated
  using (is_group and private.is_chat_participant(chat_id));

create policy "call_participants: read if the call is visible"
  on public.call_participants for select to authenticated
  using (private.can_see_call(call_id));

-- -----------------------------------------------------------------------------
-- RPCs
-- -----------------------------------------------------------------------------

-- Direct chat: ring the other person (unchanged behaviour, now group-aware
-- busy checks). Group chat: join the active call, or start one.
-- Errors: 'not authenticated' 42501 · 'chat not found' P0002 ·
--         'caller busy' / 'callee busy' / 'call full' P0001
create or replace function public.start_call(p_chat_id uuid, p_call_type text default 'voice')
returns public.calls
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me        uuid := auth.uid();
  v_type      text := coalesce(p_call_type, 'voice');
  v_chat_type text;
  v_callee    uuid;
  v_call      public.calls;
  v_active    boolean := false;
begin
  if v_me is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if v_type not in ('voice', 'video') then
    raise exception 'invalid call type' using errcode = '22023';
  end if;

  select c.type into v_chat_type
  from public.chats c
  join public.chat_participants me on me.chat_id = c.id and me.user_id = v_me
  where c.id = p_chat_id;
  if v_chat_type is null then
    raise exception 'chat not found' using errcode = 'P0002';
  end if;

  -- --- Group: join or start ------------------------------------------------
  if v_chat_type = 'group' then
    perform pg_advisory_xact_lock(hashtextextended('groupcall:' || p_chat_id::text, 0));
    perform pg_advisory_xact_lock(hashtextextended('call:' || v_me::text, 0));

    select * into v_call from public.calls c
    where c.chat_id = p_chat_id and c.is_group and c.status = 'active';
    if v_call.id is not null then
      v_active := private.reap_group_call(v_call.id);
    end if;

    if private.user_in_live_call(v_me, case when v_active then v_call.id end) then
      raise exception 'caller busy' using errcode = 'P0001';
    end if;

    if not v_active then
      insert into public.calls (chat_id, caller_id, callee_id, is_group, status, call_type, answered_at)
      values (p_chat_id, v_me, null, true, 'active', v_type, now())
      returning * into v_call;

      perform private.post_system_message(p_chat_id, format(
        '%s %s started a group %s',
        case when v_type = 'video' then '📹' else '📞' end,
        private.profile_label(v_me),
        case when v_type = 'video' then 'video call' else 'voice call' end));
    elsif (
      select count(*) from public.call_participants p
      where p.call_id = v_call.id and p.user_id <> v_me and private.participant_is_live(p)
    ) >= 16 then
      raise exception 'call full' using errcode = 'P0001';
    end if;

    insert into public.call_participants (call_id, user_id)
    values (v_call.id, v_me)
    on conflict (call_id, user_id) do update set left_at = null, last_seen_at = now();

    update public.calls set last_seen_at = now() where id = v_call.id
    returning * into v_call;
    return v_call;
  end if;

  -- --- Direct: ring the other participant ------------------------------------
  select other.user_id into v_callee
  from public.chat_participants other
  where other.chat_id = p_chat_id and other.user_id <> v_me
  limit 1;
  if v_callee is null then
    raise exception 'chat not found' using errcode = 'P0002';
  end if;

  -- Serialize call setup per user (lowest id first, so no deadlocks).
  perform pg_advisory_xact_lock(hashtextextended('call:' || least(v_me, v_callee)::text, 0));
  perform pg_advisory_xact_lock(hashtextextended('call:' || greatest(v_me, v_callee)::text, 0));

  -- Close 1-on-1 calls whose owners vanished without hanging up.
  update public.calls c
  set status   = case when c.status = 'ringing' then 'missed' else 'ended' end,
      ended_at = case when c.status = 'ringing' then now() else c.last_seen_at end
  where not c.is_group
    and c.status in ('ringing', 'accepted')
    and (v_me in (c.caller_id, c.callee_id) or v_callee in (c.caller_id, c.callee_id))
    and not private.call_is_live(c);

  if private.user_in_live_call(v_me) then
    raise exception 'caller busy' using errcode = 'P0001';
  end if;
  if private.user_in_live_call(v_callee) then
    raise exception 'callee busy' using errcode = 'P0001';
  end if;

  insert into public.calls (chat_id, caller_id, callee_id, call_type)
  values (p_chat_id, v_me, v_callee, v_type)
  returning * into v_call;

  return v_call;
end;
$$;

-- Hang up (1-on-1) or leave the room (group). Idempotent.
create or replace function public.end_call(p_call_id uuid, p_timeout boolean default false)
returns public.calls
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me   uuid := auth.uid();
  v_call public.calls;
begin
  if v_me is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select * into v_call from public.calls c where c.id = p_call_id;

  -- --- Group: leave ------------------------------------------------------------
  if v_call.id is not null and v_call.is_group then
    if not exists (
      select 1 from public.call_participants p
      where p.call_id = p_call_id and p.user_id = v_me
    ) then
      raise exception 'call not available' using errcode = 'P0002';
    end if;
    perform pg_advisory_xact_lock(hashtextextended('groupcall:' || v_call.chat_id::text, 0));

    update public.call_participants
    set left_at = now()
    where call_id = p_call_id and user_id = v_me and left_at is null;

    if found and private.reap_group_call(p_call_id) then
      update public.calls set last_seen_at = now() where id = p_call_id; -- refresh pills
    end if;

    select * into v_call from public.calls c where c.id = p_call_id;
    return v_call;
  end if;

  -- --- Direct (unchanged) -------------------------------------------------------
  v_call := null;
  update public.calls c
  set status = case
        when c.status = 'accepted'  then 'ended'
        when c.callee_id = v_me     then 'declined'
        when p_timeout              then 'missed'
        else 'cancelled'
      end,
      ended_at = now(),
      ended_by = v_me
  where c.id = p_call_id
    and not c.is_group
    and v_me in (c.caller_id, c.callee_id)
    and c.status in ('ringing', 'accepted')
  returning * into v_call;

  if v_call.id is null then
    select * into v_call from public.calls c
    where c.id = p_call_id and v_me in (c.caller_id, c.callee_id);
    if v_call.id is null then
      raise exception 'call not available' using errcode = 'P0002';
    end if;
    return v_call;
  end if;

  perform private.log_call_message(v_call);
  return v_call;
end;
$$;

-- Keeps me live in a call. false = the call is over (or I'm no longer in it).
create or replace function public.heartbeat_call(p_call_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me    uuid := auth.uid();
  v_group boolean;
begin
  select c.is_group into v_group from public.calls c where c.id = p_call_id;
  if v_group is null then
    return false;
  end if;

  if v_group then
    update public.call_participants
    set last_seen_at = now()
    where call_id = p_call_id and user_id = v_me and left_at is null;
    if not found then
      return false;
    end if;
    -- Also closes out anyone whose tab vanished.
    return private.reap_group_call(p_call_id);
  end if;

  update public.calls c
  set last_seen_at = now()
  where c.id = p_call_id
    and v_me in (c.caller_id, c.callee_id)
    and c.status = 'accepted';
  return found;
end;
$$;

-- The group's ongoing call, if any, with who is in it. Closes a stale room.
create or replace function public.get_group_call(p_chat_id uuid)
returns table (call_id uuid, call_type text, started_at timestamptz, participant_ids uuid[])
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_call public.calls;
begin
  if not private.is_chat_participant(p_chat_id) then
    return;
  end if;
  select * into v_call from public.calls c
  where c.chat_id = p_chat_id and c.is_group and c.status = 'active';
  if v_call.id is null or not private.reap_group_call(v_call.id) then
    return;
  end if;

  return query
  select v_call.id, v_call.call_type, v_call.created_at,
         coalesce(
           (select array_agg(p.user_id order by p.joined_at)
            from public.call_participants p
            where p.call_id = v_call.id and private.participant_is_live(p)),
           '{}');
end;
$$;

-- Used by /api/agora/token: may the caller join this chat's call channel?
create or replace function public.can_join_call_channel(p_chat_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.calls c
    where c.chat_id = p_chat_id
      and not c.is_group
      and c.status in ('ringing', 'accepted')
      and (select auth.uid()) in (c.caller_id, c.callee_id)
  ) or exists (
    select 1
    from public.calls c
    join public.call_participants p on p.call_id = c.id
    where c.chat_id = p_chat_id
      and c.is_group
      and c.status = 'active'
      and p.user_id = (select auth.uid())
      and p.left_at is null
  );
$$;

revoke all on function public.start_call(uuid, text) from public, anon;
revoke all on function public.end_call(uuid, boolean) from public, anon;
revoke all on function public.heartbeat_call(uuid) from public, anon;
revoke all on function public.get_group_call(uuid) from public, anon;
revoke all on function public.can_join_call_channel(uuid) from public, anon;
grant execute on function public.start_call(uuid, text) to authenticated;
grant execute on function public.end_call(uuid, boolean) to authenticated;
grant execute on function public.heartbeat_call(uuid) to authenticated;
grant execute on function public.get_group_call(uuid) to authenticated;
grant execute on function public.can_join_call_channel(uuid) to authenticated;
