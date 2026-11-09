-- =============================================================================
-- Screen sharing: who in a call is presenting.
--
-- A screen share replaces the sharer's camera track in Agora, so remote peers
-- can't tell a screen from a camera by the media alone. Each client announces
-- { sharing: boolean } via Realtime *presence* on the private channel
-- `call-screen:<chat_id>` (presence is state, so late joiners see it too).
--
-- Realtime Authorization: only participants of that chat may join the
-- channel (read presence) or announce themselves (write presence).
-- =============================================================================

create or replace function private.can_use_call_screen_topic(p_topic text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  -- CASE keeps the uuid cast from running on topics that aren't ours.
  select case
    when p_topic ~ '^call-screen:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then private.is_chat_participant(substr(p_topic, 13)::uuid)
    else false
  end;
$$;

revoke all on function private.can_use_call_screen_topic(text) from public;
grant execute on function private.can_use_call_screen_topic(text) to authenticated;

create policy "call-screen presence: participants can read"
  on realtime.messages for select to authenticated
  using (
    realtime.messages.extension = 'presence'
    and private.can_use_call_screen_topic((select realtime.topic()))
  );

create policy "call-screen presence: participants can announce"
  on realtime.messages for insert to authenticated
  with check (
    realtime.messages.extension = 'presence'
    and private.can_use_call_screen_topic((select realtime.topic()))
  );
