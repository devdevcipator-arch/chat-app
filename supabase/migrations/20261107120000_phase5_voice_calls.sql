-- =============================================================================
-- Phase 5: 1-on-1 voice calls (Agora RTC for media, Supabase for signaling).
--
-- Signaling model
--   * One row per call attempt in public.calls. Clients never write the table
--     directly: every state change goes through a SECURITY DEFINER RPC that
--     checks who may make it, so a client cannot e.g. "accept" a call on
--     someone else's behalf or fake a busy state.
--   * Both parties subscribe to postgres_changes on their own rows (RLS-scoped)
--     and map transitions to the client events
--       call:outgoing / call:incoming   (INSERT, status = ringing)
--       call:accepted                   (ringing  -> accepted)
--       call:declined                   (ringing  -> declined)
--       call:ended                      (-> ended | cancelled | missed)
--   * Busy detection happens inside start_call() under per-user advisory
--     locks, so two simultaneous calls to the same person cannot both ring.
--   * A tab that disappears mid-call cannot always say goodbye, so a call is
--     only "live" while it is ringing (< 45 s) or accepted with a recent
--     heartbeat (< 45 s). Stale calls never block new ones and are closed
--     lazily by start_call().
--
-- State machine
--   ringing  --answer(accept)-->  accepted --end--> ended
--   ringing  --answer(decline)--> declined
--   ringing  --end by caller-->   cancelled  (or missed, on ring timeout)
--   ringing  --end by callee-->   declined
-- =============================================================================

create table public.calls (
  id           uuid primary key default gen_random_uuid(),
  chat_id      uuid not null references public.chats (id) on delete cascade,
  caller_id    uuid not null references public.profiles (id) on delete cascade,
  callee_id    uuid not null references public.profiles (id) on delete cascade,
  status       text not null default 'ringing'
               check (status in ('ringing', 'accepted', 'declined', 'cancelled', 'missed', 'ended')),
  created_at   timestamptz not null default now(),
  answered_at  timestamptz,
  ended_at     timestamptz,
  ended_by     uuid references public.profiles (id) on delete set null,
  -- Bumped by heartbeat_call() while accepted; see "live" above.
  last_seen_at timestamptz not null default now(),
  constraint call_parties_differ check (caller_id <> callee_id)
);

create index calls_caller_id_idx on public.calls (caller_id, created_at desc);
create index calls_callee_id_idx on public.calls (callee_id, created_at desc);
create index calls_chat_id_idx on public.calls (chat_id, created_at desc);
create index calls_open_idx on public.calls (status) where status in ('ringing', 'accepted');

revoke all on public.calls from anon, authenticated;
grant select on public.calls to authenticated;

alter table public.calls enable row level security;

create policy "calls: read own"
  on public.calls for select to authenticated
  using ((select auth.uid()) in (caller_id, callee_id));

-- -----------------------------------------------------------------------------
-- Helpers
-- -----------------------------------------------------------------------------

-- Is this open call still live (see header)?
create or replace function private.call_is_live(c public.calls)
returns boolean
language sql
stable
set search_path = ''
as $$
  select case c.status
    when 'ringing'  then c.created_at   > now() - interval '45 seconds'
    when 'accepted' then c.last_seen_at > now() - interval '45 seconds'
    else false
  end;
$$;

-- Records the outcome in the chat as a system message.
create or replace function private.log_call_message(c public.calls)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_text text;
  v_secs integer;
begin
  case c.status
    when 'ended' then
      v_secs := greatest(0, extract(epoch from (c.ended_at - c.answered_at))::integer);
      v_text := format('📞 Voice call · %s:%s', v_secs / 60, lpad((v_secs % 60)::text, 2, '0'));
    when 'missed', 'cancelled' then v_text := '📞 Missed voice call';
    when 'declined'            then v_text := '📞 Declined voice call';
    else return;
  end case;

  insert into public.messages (chat_id, sender_id, message_type, content)
  values (c.chat_id, null, 'system', v_text);
end;
$$;

revoke all on function private.call_is_live(public.calls) from public;
revoke all on function private.log_call_message(public.calls) from public, anon, authenticated;
grant execute on function private.call_is_live(public.calls) to authenticated;

-- -----------------------------------------------------------------------------
-- RPCs
-- -----------------------------------------------------------------------------

-- Starts ringing the other participant of a direct chat.
-- Errors (message text is the stable contract for clients):
--   'not authenticated' 42501 · 'chat not found' P0002
--   'caller busy' / 'callee busy' P0001 (someone is already in a live call)
create or replace function public.start_call(p_chat_id uuid)
returns public.calls
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me     uuid := auth.uid();
  v_callee uuid;
  v_call   public.calls;
begin
  if v_me is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select other.user_id into v_callee
  from public.chats c
  join public.chat_participants me    on me.chat_id = c.id and me.user_id = v_me
  join public.chat_participants other on other.chat_id = c.id and other.user_id <> v_me
  where c.id = p_chat_id and c.type = 'direct'
  limit 1;

  if v_callee is null then
    raise exception 'chat not found' using errcode = 'P0002';
  end if;

  -- Serialize call setup per user (lowest id first, so no deadlocks).
  perform pg_advisory_xact_lock(hashtextextended('call:' || least(v_me, v_callee)::text, 0));
  perform pg_advisory_xact_lock(hashtextextended('call:' || greatest(v_me, v_callee)::text, 0));

  -- Close calls whose owners vanished without hanging up.
  update public.calls c
  set status   = case when c.status = 'ringing' then 'missed' else 'ended' end,
      ended_at = case when c.status = 'ringing' then now() else c.last_seen_at end
  where c.status in ('ringing', 'accepted')
    and (v_me in (c.caller_id, c.callee_id) or v_callee in (c.caller_id, c.callee_id))
    and not private.call_is_live(c);

  if exists (
    select 1 from public.calls c
    where c.status in ('ringing', 'accepted') and v_me in (c.caller_id, c.callee_id)
  ) then
    raise exception 'caller busy' using errcode = 'P0001';
  end if;

  if exists (
    select 1 from public.calls c
    where c.status in ('ringing', 'accepted') and v_callee in (c.caller_id, c.callee_id)
  ) then
    raise exception 'callee busy' using errcode = 'P0001';
  end if;

  insert into public.calls (chat_id, caller_id, callee_id)
  values (p_chat_id, v_me, v_callee)
  returning * into v_call;

  return v_call;
end;
$$;

-- Callee accepts or declines a ringing call. Errors: 'call not available' P0002.
create or replace function public.answer_call(p_call_id uuid, p_accept boolean)
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

  update public.calls c
  set status       = case when p_accept then 'accepted' else 'declined' end,
      answered_at  = case when p_accept then now() end,
      ended_at     = case when p_accept then null else now() end,
      ended_by     = case when p_accept then null else v_me end,
      last_seen_at = now()
  where c.id = p_call_id
    and c.callee_id = v_me
    and c.status = 'ringing'
    and private.call_is_live(c)
  returning * into v_call;

  if v_call.id is null then
    raise exception 'call not available' using errcode = 'P0002';
  end if;

  perform private.log_call_message(v_call);
  return v_call;
end;
$$;

-- Either party hangs up. Idempotent: ending a finished call returns it as is.
-- p_timeout = true marks an unanswered call as missed (caller's ring timeout).
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

-- Keeps an accepted call live. Returns false if the call is no longer open.
create or replace function public.heartbeat_call(p_call_id uuid)
returns boolean
language sql
security definer
set search_path = ''
as $$
  with touched as (
    update public.calls c
    set last_seen_at = now()
    where c.id = p_call_id
      and (select auth.uid()) in (c.caller_id, c.callee_id)
      and c.status = 'accepted'
    returning 1
  )
  select exists (select 1 from touched);
$$;

revoke all on function public.start_call(uuid) from public, anon;
revoke all on function public.answer_call(uuid, boolean) from public, anon;
revoke all on function public.end_call(uuid, boolean) from public, anon;
revoke all on function public.heartbeat_call(uuid) from public, anon;
grant execute on function public.start_call(uuid) to authenticated;
grant execute on function public.answer_call(uuid, boolean) to authenticated;
grant execute on function public.end_call(uuid, boolean) to authenticated;
grant execute on function public.heartbeat_call(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Realtime
-- -----------------------------------------------------------------------------

alter publication supabase_realtime add table public.calls;
