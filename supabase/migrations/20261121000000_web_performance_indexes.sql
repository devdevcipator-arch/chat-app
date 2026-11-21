-- Web performance: indexes for the hottest reads that weren't covered yet.
--
-- Already in place (not repeated here, a duplicate index only slows writes):
--   messages_chat_id_created_at_idx      messages (chat_id, created_at desc)
--   user_gallery_user_id_created_at_idx  user_gallery (user_id, created_at desc)
--   calls_caller_id_idx / calls_callee_id_idx (caller_id|callee_id, created_at desc)
--
-- Additive and idempotent; no table, column, policy or function changes.

-- list_my_chats() and every "my chats" lookup filter chat_participants by
-- user_id and then join on chat_id. The composite serves both from the index
-- (index-only scans) and supersedes the single-column user_id index.
create index if not exists idx_chat_participants_user_chat
  on public.chat_participants (user_id, chat_id);
drop index if exists public.chat_participants_user_id_idx;

-- Call history (Calls tab, web and mobile) has no WHERE clause of its own:
-- RLS ("caller or callee" OR "participant of the group") decides visibility,
-- then it orders by created_at desc limit 50. A (caller_id, callee_id, ...)
-- composite can't serve that OR; a created_at index lets Postgres walk the
-- newest calls first and stop after 50 visible rows instead of sorting the
-- whole table.
create index if not exists idx_calls_created
  on public.calls (created_at desc);
