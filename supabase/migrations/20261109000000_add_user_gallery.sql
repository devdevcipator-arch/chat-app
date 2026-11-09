-- =============================================================================
-- Personal Gallery / Cloud Vault.
--
-- user_gallery.media_url stores an R2 *object key*, never a URL, exactly like
-- messages.media_url:  vault/<user_id>/<id>.<ext>
-- The row id doubles as the file id, so a key can only ever belong to its own
-- row and its own owner.
--
-- Forwarding a gallery item to a chat copies the object server-side into
-- chats/<chat_id>/<sender_id>/<uuid>.<ext>, so chat messages never point into
-- someone's vault and deleting a gallery item never breaks sent messages.
-- =============================================================================

create table public.user_gallery (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  media_url  text not null,
  file_name  text not null check (char_length(file_name) between 1 and 255),
  file_type  text not null check (file_type in ('image', 'video', 'audio', 'document')),
  file_size  bigint not null check (file_size > 0),
  created_at timestamptz not null default now(),
  constraint gallery_media_url_is_vault_key check (
    media_url ~ '^vault/[0-9a-f-]{36}/[0-9a-f-]{36}\.[a-z0-9]{2,5}$'
    and split_part(media_url, '/', 2) = user_id::text
    and split_part(split_part(media_url, '/', 3), '.', 1) = id::text
  )
);

create index user_gallery_user_id_created_at_idx
  on public.user_gallery (user_id, created_at desc);

alter table public.user_gallery enable row level security;

-- Items are immutable: select, insert and delete only.
revoke all on public.user_gallery from anon, authenticated;
grant select, insert, delete on public.user_gallery to authenticated;

create policy "user_gallery: read own"
  on public.user_gallery for select to authenticated
  using (user_id = (select auth.uid()));

create policy "user_gallery: insert own"
  on public.user_gallery for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy "user_gallery: delete own"
  on public.user_gallery for delete to authenticated
  using (user_id = (select auth.uid()));

-- -----------------------------------------------------------------------------
-- Messages: forwarded gallery items can be videos and documents too.
-- 'file' already existed; 'video' is new. For video/file messages, content
-- holds the original file name (shown in the bubble).
-- -----------------------------------------------------------------------------

alter table public.messages drop constraint messages_message_type_check;
alter table public.messages
  add constraint messages_message_type_check
  check (message_type in ('text', 'image', 'audio', 'video', 'file', 'system'));

alter table public.messages drop constraint media_url_is_object_key;
alter table public.messages
  add constraint media_url_is_object_key check (
    media_url is null
    or media_url ~ '^chats/[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.(webp|jpg|png|gif|webm|ogg|mp3|m4a|aac|wav|mp4|mov|pdf|txt|csv|zip|docx|xlsx|pptx)$'
  );
