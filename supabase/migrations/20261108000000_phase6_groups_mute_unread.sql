-- =============================================================================
-- Phase 6: group chats, per-user mute / clear / delete, unread counts.
--
-- Security model (unchanged principle: no client writes to these tables)
--   * Every group or membership change goes through a SECURITY DEFINER RPC
--     that checks the caller's role. Only admins rename a group, add or remove
--     members, change roles or delete the group; anyone may leave.
--   * Per-user settings (is_muted, last_read_at, cleared_at, hidden_at) are
--     private: co-members can read who is in a chat and their role, but not
--     these columns (column-level SELECT grant), so no read-receipt leaks.
--   * "Clear chat" is enforced by RLS: messages older than your cleared_at
--     are invisible to you (also over Realtime). New group members get a
--     cleared_at of their join time, so they don't see earlier history.
--   * "Delete conversation" (direct chats) clears + hides the chat for you
--     only. It reappears when a newer message arrives, or when you open it
--     again from search.
--   * chat_participants leaves the Realtime publication: Realtime cannot apply
--     RLS to DELETE events, so leaving/removal would broadcast membership to
--     every subscriber. Clients learn about new chats from their first
--     message (group creation/additions always post a system message).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Schema
-- -----------------------------------------------------------------------------

alter table public.chats
  add column title      text
             constraint chat_title_length
             check (title is null or char_length(btrim(title)) between 1 and 60),
  -- Reserved for an R2 object key once group avatar uploads exist.
  add column avatar_url text,
  add column created_by uuid references public.profiles (id) on delete set null,
  add constraint group_has_title check (type <> 'group' or title is not null);

alter table public.chat_participants
  add column role         text not null default 'member'
                          check (role in ('admin', 'member')),
  add column is_muted     boolean not null default false,
  add column last_read_at timestamptz,
  add column cleared_at   timestamptz,
  add column hidden_at    timestamptz;

-- Existing conversations start out read (no flood of old "unread" messages).
update public.chat_participants set last_read_at = now();

-- Co-members may see membership and roles only.
revoke select on public.chat_participants from authenticated;
grant select (chat_id, user_id, joined_at, role) on public.chat_participants to authenticated;

alter publication supabase_realtime drop table public.chat_participants;

-- -----------------------------------------------------------------------------
-- Message visibility: participant AND newer than my cleared_at.
-- -----------------------------------------------------------------------------

create or replace function private.can_read_message(p_chat_id uuid, p_created_at timestamptz)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.chat_participants cp
    where cp.chat_id = p_chat_id
      and cp.user_id = (select auth.uid())
      and (cp.cleared_at is null or p_created_at > cp.cleared_at)
  );
$$;

revoke all on function private.can_read_message(uuid, timestamptz) from public;
grant execute on function private.can_read_message(uuid, timestamptz) to authenticated;

drop policy "messages: read if participant" on public.messages;

create policy "messages: read if participant and not cleared"
  on public.messages for select to authenticated
  using (private.can_read_message(chat_id, created_at));

-- -----------------------------------------------------------------------------
-- Private helpers
-- -----------------------------------------------------------------------------

-- "Alice" / "@alice" / "Someone", for system messages.
create or replace function private.profile_label(p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select coalesce(nullif(btrim(p.display_name), ''), '@' || p.username)
     from public.profiles p where p.id = p_user_id),
    'Someone'
  );
$$;

create or replace function private.post_system_message(p_chat_id uuid, p_text text)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.messages (chat_id, sender_id, message_type, content)
  values (p_chat_id, null, 'system', left(p_text, 4000));
$$;

-- Raises unless the caller is an admin of this group.
create or replace function private.assert_group_admin(p_chat_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if not exists (
    select 1
    from public.chat_participants cp
    join public.chats c on c.id = cp.chat_id
    where cp.chat_id = p_chat_id
      and cp.user_id = (select auth.uid())
      and cp.role = 'admin'
      and c.type = 'group'
  ) then
    raise exception 'not a group admin' using errcode = '42501';
  end if;
end;
$$;

revoke all on function private.profile_label(uuid) from public, anon, authenticated;
revoke all on function private.post_system_message(uuid, text) from public, anon, authenticated;
revoke all on function private.assert_group_admin(uuid) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- Group RPCs
-- -----------------------------------------------------------------------------

-- Creates a group with the caller as admin. Members must be onboarded users.
create or replace function public.create_group_chat(p_title text, p_member_ids uuid[])
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me      uuid := auth.uid();
  v_title   text := btrim(p_title);
  v_members uuid[];
  v_chat_id uuid;
begin
  if v_me is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if v_title is null or char_length(v_title) not between 1 and 60 then
    raise exception 'invalid title' using errcode = '22023';
  end if;

  select coalesce(array_agg(distinct p.id), '{}') into v_members
  from public.profiles p
  where p.id = any (p_member_ids)
    and p.id <> v_me
    and p.username is not null;

  if cardinality(v_members) = 0 then
    raise exception 'no members' using errcode = '22023';
  end if;
  if cardinality(v_members) + 1 > 100 then
    raise exception 'too many members' using errcode = '22023';
  end if;

  insert into public.chats (type, title, created_by)
  values ('group', v_title, v_me)
  returning id into v_chat_id;

  insert into public.chat_participants (chat_id, user_id, role, last_read_at)
  values (v_chat_id, v_me, 'admin', now());
  insert into public.chat_participants (chat_id, user_id, role)
  select v_chat_id, m, 'member' from unnest(v_members) as m;

  perform private.post_system_message(
    v_chat_id, format('%s created the group "%s"', private.profile_label(v_me), v_title));

  return v_chat_id;
end;
$$;

-- Admin: rename. Errors: 'invalid title' 22023, 'not a group admin' 42501.
create or replace function public.update_group(p_chat_id uuid, p_title text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_title text := btrim(p_title);
begin
  perform private.assert_group_admin(p_chat_id);
  if v_title is null or char_length(v_title) not between 1 and 60 then
    raise exception 'invalid title' using errcode = '22023';
  end if;

  update public.chats set title = v_title
  where id = p_chat_id and title is distinct from v_title;

  if found then
    perform private.post_system_message(
      p_chat_id, format('%s renamed the group to "%s"', private.profile_label(auth.uid()), v_title));
  end if;
end;
$$;

-- Admin: add members. They don't see history from before they joined.
-- Returns the number of people actually added.
create or replace function public.add_group_members(p_chat_id uuid, p_member_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_new   uuid[];
  v_names text;
begin
  perform private.assert_group_admin(p_chat_id);
  perform pg_advisory_xact_lock(hashtextextended('group:' || p_chat_id::text, 0));

  select coalesce(array_agg(distinct p.id), '{}') into v_new
  from public.profiles p
  where p.id = any (p_member_ids)
    and p.username is not null
    and not exists (
      select 1 from public.chat_participants cp
      where cp.chat_id = p_chat_id and cp.user_id = p.id
    );

  if cardinality(v_new) = 0 then
    return 0;
  end if;
  if (select count(*) from public.chat_participants where chat_id = p_chat_id) + cardinality(v_new) > 100 then
    raise exception 'too many members' using errcode = '22023';
  end if;

  -- cleared_at just before now(), so they do see the "added" message below.
  insert into public.chat_participants (chat_id, user_id, role, cleared_at, last_read_at)
  select p_chat_id, m, 'member', now() - interval '1 microsecond', now() - interval '1 microsecond'
  from unnest(v_new) as m;

  select string_agg(private.profile_label(m), ', ') into v_names from unnest(v_new) as m;
  perform private.post_system_message(
    p_chat_id, format('%s added %s', private.profile_label(auth.uid()), v_names));

  return cardinality(v_new);
end;
$$;

-- Admin: remove someone else (use leave_group for yourself).
create or replace function public.remove_group_member(p_chat_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_group_admin(p_chat_id);
  if p_user_id = auth.uid() then
    raise exception 'use leave_group to leave' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('group:' || p_chat_id::text, 0));

  delete from public.chat_participants
  where chat_id = p_chat_id and user_id = p_user_id;
  if not found then
    raise exception 'not a member' using errcode = 'P0002';
  end if;

  perform private.post_system_message(
    p_chat_id,
    format('%s removed %s', private.profile_label(auth.uid()), private.profile_label(p_user_id)));
end;
$$;

-- Admin: promote / demote. A group always keeps at least one admin.
create or replace function public.set_group_role(p_chat_id uuid, p_user_id uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old text;
begin
  perform private.assert_group_admin(p_chat_id);
  if p_role not in ('admin', 'member') then
    raise exception 'invalid role' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('group:' || p_chat_id::text, 0));

  select role into v_old from public.chat_participants
  where chat_id = p_chat_id and user_id = p_user_id;
  if v_old is null then
    raise exception 'not a member' using errcode = 'P0002';
  end if;
  if v_old = p_role then
    return;
  end if;
  if p_role = 'member' and (
    select count(*) from public.chat_participants
    where chat_id = p_chat_id and role = 'admin'
  ) <= 1 then
    raise exception 'last admin' using errcode = '22023';
  end if;

  update public.chat_participants set role = p_role
  where chat_id = p_chat_id and user_id = p_user_id;

  if p_role = 'admin' then
    perform private.post_system_message(
      p_chat_id,
      format('%s made %s an admin', private.profile_label(auth.uid()), private.profile_label(p_user_id)));
  end if;
end;
$$;

-- Anyone leaves. The last one out deletes the group; if the last admin
-- leaves, the longest-standing member is promoted.
create or replace function public.leave_group(p_chat_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.chat_participants cp
    join public.chats c on c.id = cp.chat_id
    where cp.chat_id = p_chat_id and cp.user_id = v_me and c.type = 'group'
  ) then
    raise exception 'not a member' using errcode = 'P0002';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('group:' || p_chat_id::text, 0));

  perform private.post_system_message(p_chat_id, format('%s left', private.profile_label(v_me)));
  delete from public.chat_participants where chat_id = p_chat_id and user_id = v_me;

  if not exists (select 1 from public.chat_participants where chat_id = p_chat_id) then
    delete from public.chats where id = p_chat_id;
    return;
  end if;

  if not exists (
    select 1 from public.chat_participants where chat_id = p_chat_id and role = 'admin'
  ) then
    update public.chat_participants set role = 'admin'
    where chat_id = p_chat_id
      and user_id = (
        select user_id from public.chat_participants
        where chat_id = p_chat_id
        order by joined_at, user_id
        limit 1
      );
  end if;
end;
$$;

-- Admin: delete the group for everyone (messages and calls cascade).
create or replace function public.delete_group(p_chat_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_group_admin(p_chat_id);
  delete from public.chats where id = p_chat_id and type = 'group';
end;
$$;

-- -----------------------------------------------------------------------------
-- Per-user conversation settings
-- -----------------------------------------------------------------------------

create or replace function public.set_chat_muted(p_chat_id uuid, p_muted boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.chat_participants set is_muted = coalesce(p_muted, false)
  where chat_id = p_chat_id and user_id = auth.uid();
  if not found then
    raise exception 'not a member' using errcode = 'P0002';
  end if;
end;
$$;

-- Hides every message so far, for the caller only.
create or replace function public.clear_chat(p_chat_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.chat_participants set cleared_at = now(), last_read_at = now()
  where chat_id = p_chat_id and user_id = auth.uid();
  if not found then
    raise exception 'not a member' using errcode = 'P0002';
  end if;
end;
$$;

-- "Delete conversation" for a direct chat: clear + hide, for the caller only.
create or replace function public.hide_chat(p_chat_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.chat_participants cp
  set cleared_at = now(), hidden_at = now(), last_read_at = now()
  from public.chats c
  where c.id = cp.chat_id
    and c.type = 'direct'
    and cp.chat_id = p_chat_id
    and cp.user_id = auth.uid();
  if not found then
    raise exception 'not a member' using errcode = 'P0002';
  end if;
end;
$$;

create or replace function public.mark_chat_read(p_chat_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.chat_participants set last_read_at = now()
  where chat_id = p_chat_id and user_id = (select auth.uid());
$$;

-- The caller's own settings for one chat (these columns aren't selectable).
create or replace function public.get_chat_membership(p_chat_id uuid)
returns table (role text, is_muted boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select cp.role, cp.is_muted
  from public.chat_participants cp
  where cp.chat_id = p_chat_id and cp.user_id = (select auth.uid());
$$;

-- -----------------------------------------------------------------------------
-- Direct chats: reopening a deleted conversation un-hides it.
-- (Same as Phase 1, plus the un-hide.)
-- -----------------------------------------------------------------------------

create or replace function public.create_direct_chat(p_other_user uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me      uuid := auth.uid();
  v_chat_id uuid;
begin
  if v_me is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_other_user is null or p_other_user = v_me then
    raise exception 'invalid recipient' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.profiles
    where id = p_other_user and username is not null
  ) then
    raise exception 'recipient not found' using errcode = 'P0002';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(least(v_me, p_other_user)::text
                     || greatest(v_me, p_other_user)::text, 0)
  );

  select c.id into v_chat_id
  from public.chats c
  join public.chat_participants a on a.chat_id = c.id and a.user_id = v_me
  join public.chat_participants b on b.chat_id = c.id and b.user_id = p_other_user
  where c.type = 'direct'
  limit 1;

  if v_chat_id is null then
    insert into public.chats (type) values ('direct') returning id into v_chat_id;
    insert into public.chat_participants (chat_id, user_id, last_read_at)
    values (v_chat_id, v_me, now()), (v_chat_id, p_other_user, now());
  else
    update public.chat_participants set hidden_at = null
    where chat_id = v_chat_id and user_id = v_me;
  end if;

  return v_chat_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Chat list: now with groups, mute, unread and the last sender's name.
-- SECURITY DEFINER because it reads the caller's private settings columns;
-- every row is scoped to auth.uid() and honours cleared_at / hidden_at.
-- -----------------------------------------------------------------------------

drop function public.list_my_chats();

create function public.list_my_chats()
returns table (
  chat_id                  uuid,
  chat_type                text,
  chat_created_at          timestamptz,
  title                    text,
  avatar_url               text,
  member_count             integer,
  my_role                  text,
  is_muted                 boolean,
  unread_count             integer,
  other_user_id            uuid,
  other_username           text,
  other_display_name       text,
  other_avatar_url         text,
  last_message_content     text,
  last_message_type        text,
  last_message_sender_id   uuid,
  last_message_sender_name text,
  last_message_at          timestamptz
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
      and (me.cleared_at is null or m.created_at > me.cleared_at)
    order by m.created_at desc
    limit 1
  ) lm on true
  left join public.profiles sp on sp.id = lm.sender_id
  where me.user_id = (select auth.uid())
    and (me.hidden_at is null or lm.created_at > me.hidden_at)
  order by coalesce(lm.created_at, c.created_at) desc;
$$;

-- -----------------------------------------------------------------------------
-- Grants
-- -----------------------------------------------------------------------------

revoke all on function public.list_my_chats() from public, anon;
revoke all on function public.create_group_chat(text, uuid[]) from public, anon;
revoke all on function public.update_group(uuid, text) from public, anon;
revoke all on function public.add_group_members(uuid, uuid[]) from public, anon;
revoke all on function public.remove_group_member(uuid, uuid) from public, anon;
revoke all on function public.set_group_role(uuid, uuid, text) from public, anon;
revoke all on function public.leave_group(uuid) from public, anon;
revoke all on function public.delete_group(uuid) from public, anon;
revoke all on function public.set_chat_muted(uuid, boolean) from public, anon;
revoke all on function public.clear_chat(uuid) from public, anon;
revoke all on function public.hide_chat(uuid) from public, anon;
revoke all on function public.mark_chat_read(uuid) from public, anon;
revoke all on function public.get_chat_membership(uuid) from public, anon;

grant execute on function public.list_my_chats() to authenticated;
grant execute on function public.create_group_chat(text, uuid[]) to authenticated;
grant execute on function public.update_group(uuid, text) to authenticated;
grant execute on function public.add_group_members(uuid, uuid[]) to authenticated;
grant execute on function public.remove_group_member(uuid, uuid) to authenticated;
grant execute on function public.set_group_role(uuid, uuid, text) to authenticated;
grant execute on function public.leave_group(uuid) to authenticated;
grant execute on function public.delete_group(uuid) to authenticated;
grant execute on function public.set_chat_muted(uuid, boolean) to authenticated;
grant execute on function public.clear_chat(uuid) to authenticated;
grant execute on function public.hide_chat(uuid) to authenticated;
grant execute on function public.mark_chat_read(uuid) to authenticated;
grant execute on function public.get_chat_membership(uuid) to authenticated;
