-- =============================================================================
-- Phase 3: direct messaging helpers.
-- =============================================================================

-- Clients may choose a message id (for optimistic UI de-duplication) but must
-- not backdate messages: created_at is always set by the server.
revoke insert on public.messages from authenticated;
grant insert (id, chat_id, sender_id, message_type, content, media_url)
  on public.messages to authenticated;

-- The caller's chats with the other participant (for direct chats) and the
-- latest message, most recently active first.
-- SECURITY INVOKER: every read goes through the normal RLS policies.
create or replace function public.list_my_chats()
returns table (
  chat_id                uuid,
  chat_type              text,
  chat_created_at        timestamptz,
  other_user_id          uuid,
  other_username         text,
  other_display_name     text,
  other_avatar_url       text,
  last_message_content   text,
  last_message_type      text,
  last_message_sender_id uuid,
  last_message_at        timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    c.id,
    c.type,
    c.created_at,
    other.user_id,
    p.username,
    p.display_name,
    p.avatar_url,
    lm.content,
    lm.message_type,
    lm.sender_id,
    lm.created_at
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
    select m.content, m.message_type, m.sender_id, m.created_at
    from public.messages m
    where m.chat_id = c.id
    order by m.created_at desc
    limit 1
  ) lm on true
  where me.user_id = (select auth.uid())
  order by coalesce(lm.created_at, c.created_at) desc;
$$;

revoke all on function public.list_my_chats() from public, anon;
grant execute on function public.list_my_chats() to authenticated;
