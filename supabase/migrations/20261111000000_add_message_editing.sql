-- =============================================================================
-- Message editing: authors may fix their own text messages for 10 minutes.
--
-- * messages.edited_at: when the text was last edited (null = never).
-- * public.edit_message(p_message_id, p_new_content): the only way to edit.
--   Authenticated users still have no UPDATE grant on messages, so file keys,
--   types, durations etc. can't be changed. The RPC enforces, in Postgres:
--     - caller is the original sender (and can still read the message),
--     - the message is a 'text' message (not media, voicemail or system),
--     - now() - created_at <= 10 minutes,
--     - trimmed content is non-empty and within the 4000-char limit.
-- * messages is already in the supabase_realtime publication, so the UPDATE
--   reaches everyone in the chat through postgres_changes (filtered by the
--   existing "read if participant and not cleared" SELECT policy).
-- =============================================================================

alter table public.messages
  add column edited_at timestamptz default null;

alter table public.messages
  add constraint edited_only_text check (edited_at is null or message_type = 'text');

create or replace function public.edit_message(p_message_id uuid, p_new_content text)
returns public.messages
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me      uuid := auth.uid();
  v_msg     public.messages;
  -- Trim all surrounding whitespace, newlines included.
  v_content text := regexp_replace(coalesce(p_new_content, ''), '^\s+|\s+$', '', 'g');
begin
  if v_me is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select * into v_msg
  from public.messages m
  where m.id = p_message_id
  for update;

  if not found or not private.can_read_message(v_msg.chat_id, v_msg.created_at) then
    raise exception 'Message not found' using errcode = 'P0002';
  end if;

  if v_msg.sender_id is distinct from v_me then
    raise exception 'You can only edit your own messages' using errcode = '42501';
  end if;

  if v_msg.message_type <> 'text' then
    raise exception 'Only text messages can be edited' using errcode = '22023';
  end if;

  if now() - v_msg.created_at > interval '10 minutes' then
    raise exception 'Messages can only be edited within 10 minutes of sending'
      using errcode = 'P0001', hint = 'edit_window_expired';
  end if;

  if v_content = '' then
    raise exception 'Message can''t be empty' using errcode = '22023';
  end if;

  if char_length(v_content) > 4000 then
    raise exception 'Message is too long' using errcode = '22001';
  end if;

  -- Nothing changed: don't mark it as edited.
  if v_content = v_msg.content then
    return v_msg;
  end if;

  update public.messages m
  set content = v_content,
      edited_at = now()
  where m.id = p_message_id
  returning m.* into v_msg;

  return v_msg;
end;
$$;

revoke all on function public.edit_message(uuid, text) from public, anon;
grant execute on function public.edit_message(uuid, text) to authenticated;
