-- =============================================================================
-- Voicemail: a recorded audio note left after an unanswered 1-on-1 call.
--
-- Model
--   * A voicemail is a regular message with message_type = 'voicemail'.
--     media_url holds the R2 object key of the recording, under the sender's
--     own folder of the chat (same rule as every other media message):
--       chats/<chat_id>/<sender_id>/<uuid>.(webm|ogg|m4a|mp4)
--   * duration_seconds (1–120) is recorded by the client so bubbles and the
--     chat list can show "00:34" without downloading the audio.
--   * call_id optionally links the voicemail to the call attempt it follows.
--     Only the caller of that call, in that chat, after it went unanswered
--     (missed / declined / cancelled) may reference it, once per call.
--     A "busy" outcome never creates a call row, so call_id is null there.
--   * Voicemails are direct-chat only.
--   * voicemail_played_at is set by the recipient through
--     mark_voicemail_played() the first time they listen (drives the
--     "unplayed" dot). Clients cannot write it directly, and the UPDATE is
--     streamed over Realtime so the sender's bubble flips to "Played".
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Schema
-- -----------------------------------------------------------------------------

alter table public.messages drop constraint messages_message_type_check;
alter table public.messages
  add constraint messages_message_type_check
  check (message_type in ('text', 'image', 'audio', 'video', 'file', 'voicemail', 'system'));

alter table public.messages
  add column duration_seconds    integer,
  add column call_id             uuid references public.calls (id) on delete set null,
  add column voicemail_played_at timestamptz;

-- Voicemail-only columns stay empty on every other message type.
alter table public.messages
  add constraint voicemail_shape check (
    case when message_type = 'voicemail'
      then media_url ~ '\.(webm|ogg|m4a|mp4)$'
           and duration_seconds between 1 and 120
      else duration_seconds is null
           and call_id is null
           and voicemail_played_at is null
    end
  );

-- One voicemail per call attempt.
create unique index messages_one_voicemail_per_call
  on public.messages (call_id) where call_id is not null;

-- Clients may now also send duration_seconds and call_id (never played_at).
revoke insert on public.messages from authenticated;
grant insert (id, chat_id, sender_id, message_type, content, media_url, duration_seconds, call_id)
  on public.messages to authenticated;

-- -----------------------------------------------------------------------------
-- RLS: who may leave a voicemail
-- -----------------------------------------------------------------------------

-- Direct chat only; a referenced call must be the caller's own unanswered
-- 1-on-1 call in this chat.
create or replace function private.can_send_voicemail(p_chat_id uuid, p_call_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.chats c where c.id = p_chat_id and c.type = 'direct')
    and (
      p_call_id is null
      or exists (
        select 1
        from public.calls k
        where k.id = p_call_id
          and k.chat_id = p_chat_id
          and k.caller_id = (select auth.uid())
          and not k.is_group
          and k.status in ('missed', 'declined', 'cancelled')
      )
    );
$$;

revoke all on function private.can_send_voicemail(uuid, uuid) from public;
grant execute on function private.can_send_voicemail(uuid, uuid) to authenticated;

-- Same sender-key rule as before (objects in my own folder of this chat),
-- plus the voicemail rule above.
drop policy "messages: send as self to own chats" on public.messages;

create policy "messages: send as self to own chats"
  on public.messages for insert to authenticated
  with check (
    sender_id = (select auth.uid())
    and message_type <> 'system'
    and private.is_chat_participant(chat_id)
    and (
      media_url is null
      or (
        split_part(media_url, '/', 2) = chat_id::text
        and split_part(media_url, '/', 3) = sender_id::text
      )
    )
    and (message_type <> 'voicemail' or private.can_send_voicemail(chat_id, call_id))
  );

-- -----------------------------------------------------------------------------
-- RPC: the recipient listened
-- -----------------------------------------------------------------------------

-- Idempotent. Returns the played-at time, or null if this isn't a voicemail
-- the caller received (and can still see).
create or replace function public.mark_voicemail_played(p_message_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me     uuid := auth.uid();
  v_played timestamptz;
begin
  if v_me is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  update public.messages m
  set voicemail_played_at = now()
  where m.id = p_message_id
    and m.message_type = 'voicemail'
    and m.voicemail_played_at is null
    and m.sender_id is distinct from v_me
    and private.can_read_message(m.chat_id, m.created_at)
  returning m.voicemail_played_at into v_played;

  if v_played is null then
    select m.voicemail_played_at into v_played
    from public.messages m
    where m.id = p_message_id
      and m.message_type = 'voicemail'
      and m.sender_id is distinct from v_me
      and private.can_read_message(m.chat_id, m.created_at);
  end if;

  return v_played;
end;
$$;

revoke all on function public.mark_voicemail_played(uuid) from public, anon;
grant execute on function public.mark_voicemail_played(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Chat list: also returns the last message's duration ("🎙️ Voicemail · 00:34").
-- Same body as Phase 6 plus one column.
-- -----------------------------------------------------------------------------

drop function public.list_my_chats();

create function public.list_my_chats()
returns table (
  chat_id                       uuid,
  chat_type                     text,
  chat_created_at               timestamptz,
  title                         text,
  avatar_url                    text,
  member_count                  integer,
  my_role                       text,
  is_muted                      boolean,
  unread_count                  integer,
  other_user_id                 uuid,
  other_username                text,
  other_display_name            text,
  other_avatar_url              text,
  last_message_content          text,
  last_message_type             text,
  last_message_sender_id        uuid,
  last_message_sender_name      text,
  last_message_at               timestamptz,
  last_message_duration_seconds integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    c.id,
    c.type,
    c.created_at,
    c.title,
    c.avatar_url,
    (select count(*)::integer from public.chat_participants cp where cp.chat_id = c.id),
    me.role,
    me.is_muted,
    (select count(*)::integer
     from public.messages m
     where m.chat_id = c.id
       and m.message_type <> 'system'
       and m.sender_id is distinct from me.user_id
       and m.created_at > coalesce(me.last_read_at, me.joined_at)
       and (me.cleared_at is null or m.created_at > me.cleared_at)),
    other.user_id,
    p.username,
    p.display_name,
    p.avatar_url,
    lm.content,
    lm.message_type,
    lm.sender_id,
    coalesce(nullif(btrim(sp.display_name), ''), '@' || sp.username),
    lm.created_at,
    lm.duration_seconds
  from public.chat_participants me
  join public.chats c on c.id = me.chat_id
  left join lateral (
    select cp.user_id
    from public.chat_participants cp
    where cp.chat_id = c.id and cp.user_id <> me.user_id
    limit 1
  ) other on c.type = 'direct'
  left join public.profiles p on p.id = other.user_id
  left join lateral (
    select m.content, m.message_type, m.sender_id, m.created_at, m.duration_seconds
    from public.messages m
    where m.chat_id = c.id
      and (me.cleared_at is null or m.created_at > me.cleared_at)
    order by m.created_at desc
    limit 1
  ) lm on true
  left join public.profiles sp on sp.id = lm.sender_id
  where me.user_id = (select auth.uid())
    and (me.hidden_at is null or lm.created_at > me.hidden_at)
  order by coalesce(lm.created_at, c.created_at) desc;
$$;

revoke all on function public.list_my_chats() from public, anon;
grant execute on function public.list_my_chats() to authenticated;
