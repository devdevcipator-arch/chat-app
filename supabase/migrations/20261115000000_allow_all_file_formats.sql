-- =============================================================================
-- Allow any file format in chats and the gallery (ebooks such as .epub,
-- office files, archives, …), except executables.
--
-- Before: object keys had to end in one of ~20 whitelisted extensions.
-- After:  any lowercase extension of 1–10 letters/digits, except Windows
--         executables, installers and script hosts. Keep the list in sync with
--         web/src/lib/file-types.ts and mobile/lib/core/media.dart.
--
-- Ownership is unchanged and still enforced:
--   - messages: chats/<chat_id>/<sender_id>/<uuid>.<ext>, checked by the
--     "messages: send as self to own chats" insert policy (split_part on the
--     chat and sender folders) on top of the shape check below.
--   - gallery:  vault/<user_id>/<id>.<ext>, checked right here.
--
-- Generic files keep message_type 'file' (already allowed). They also get an
-- optional file_size so bubbles can show "2.4 MB" without fetching the file.
-- =============================================================================

-- Executables we never store. Immutable so it can be used in check constraints.
create or replace function public.is_blocked_file_extension(p_key text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_key ~ '\.(exe|bat|cmd|com|scr|msi|msp|pif|cpl|dll|vbs|vbe|js|jse|ws|wsf|wsh|ps1|hta|reg|lnk|jar)$';
$$;

revoke all on function public.is_blocked_file_extension(text) from public, anon;
grant execute on function public.is_blocked_file_extension(text) to authenticated;

-- --- Messages -----------------------------------------------------------------

alter table public.messages drop constraint media_url_is_object_key;
alter table public.messages
  add constraint media_url_is_object_key check (
    media_url is null
    or (
      media_url ~ '^chats/[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.[a-z0-9]{1,10}$'
      and not public.is_blocked_file_extension(media_url)
    )
  );

alter table public.messages
  add column file_size bigint
    constraint messages_file_size_check check (file_size is null or (file_size > 0 and media_url is not null));

comment on column public.messages.file_size is
  'Size in bytes of the attached file, as declared by the uploader (display only).';

-- Column-level INSERT grants are additive: this keeps the existing ones.
grant insert (file_size) on public.messages to authenticated;

-- --- Gallery ------------------------------------------------------------------

alter table public.user_gallery drop constraint gallery_media_url_is_vault_key;
alter table public.user_gallery
  add constraint gallery_media_url_is_vault_key check (
    media_url ~ '^vault/[0-9a-f-]{36}/[0-9a-f-]{36}\.[a-z0-9]{1,10}$'
    and not public.is_blocked_file_extension(media_url)
    and split_part(media_url, '/', 2) = user_id::text
    and split_part(split_part(media_url, '/', 3), '.', 1) = id::text
  );
