-- =============================================================================
-- Phase 4: media messages.
--
-- messages.media_url stores an R2 *object key*, never an arbitrary URL:
--   chats/<chat_id>/<sender_id>/<uuid>.<ext>
-- Clients build the display URL from the configured public domain. This stops
-- a malicious client from posting e.g. a tracking-pixel URL that would leak
-- every recipient's IP address, and keeps the door open to private
-- (presigned GET) delivery later without rewriting data.
-- =============================================================================

alter table public.messages
  add constraint media_url_is_object_key check (
    media_url is null
    or media_url ~ '^chats/[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.(webp|jpg|png|webm|ogg|mp3|m4a|aac|wav)$'
  );

-- A sender may only reference objects in their own folder of this chat
-- (the upload endpoint only signs keys of that shape).
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
  );
