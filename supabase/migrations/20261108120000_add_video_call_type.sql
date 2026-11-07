-- =============================================================================
-- Phase 7: video calls. A call is 'voice' or 'video'; the media itself still
-- flows through Agora, so only signaling and the chat receipt change.
-- =============================================================================

alter table public.calls
  add column call_type text not null default 'voice'
             constraint call_type_valid check (call_type in ('voice', 'video'));

-- Chat receipts: "📹 Video call · 01:23" / "📞 Voice call · 01:23",
-- "📹 Missed video call", "📞 Declined voice call", ...
create or replace function private.log_call_message(c public.calls)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_icon text := case when c.call_type = 'video' then '📹' else '📞' end;
  v_kind text := case when c.call_type = 'video' then 'video call' else 'voice call' end;
  v_label text := case when c.call_type = 'video' then 'Video call' else 'Voice call' end;
  v_text text;
  v_secs integer;
begin
  case c.status
    when 'ended' then
      v_secs := greatest(0, extract(epoch from (c.ended_at - c.answered_at))::integer);
      v_text := format('%s %s · %s:%s', v_icon, v_label,
                       lpad((v_secs / 60)::text, 2, '0'), lpad((v_secs % 60)::text, 2, '0'));
    when 'missed', 'cancelled' then v_text := format('%s Missed %s', v_icon, v_kind);
    when 'declined'            then v_text := format('%s Declined %s', v_icon, v_kind);
    else return;
  end case;

  insert into public.messages (chat_id, sender_id, message_type, content)
  values (c.chat_id, null, 'system', v_text);
end;
$$;

revoke all on function private.log_call_message(public.calls) from public, anon, authenticated;

-- start_call gains a call type. Same body as Phase 5 otherwise; the default
-- keeps one-argument callers working.
drop function public.start_call(uuid);

create function public.start_call(p_chat_id uuid, p_call_type text default 'voice')
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
  if coalesce(p_call_type, 'voice') not in ('voice', 'video') then
    raise exception 'invalid call type' using errcode = '22023';
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

  insert into public.calls (chat_id, caller_id, callee_id, call_type)
  values (p_chat_id, v_me, v_callee, coalesce(p_call_type, 'voice'))
  returning * into v_call;

  return v_call;
end;
$$;

revoke all on function public.start_call(uuid, text) from public, anon;
grant execute on function public.start_call(uuid, text) to authenticated;
