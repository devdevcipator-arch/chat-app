-- =============================================================================
-- Group discovery: search every group by title, and join one yourself.
--
-- * chats / chat_participants RLS only shows rows of chats you're in, so a
--   group someone else created was invisible to search. search_groups is a
--   SECURITY DEFINER read that returns only public-safe columns (id, title,
--   avatar, member count, whether I'm in it): never messages or member lists.
-- * join_group adds the caller as a member. Like add_group_members, the new
--   member's cleared_at is set to the join time, so history from before they
--   joined stays hidden (RLS on messages), and the 100-member cap applies.
-- =============================================================================

create or replace function public.search_groups(p_query text)
returns table (
  id           uuid,
  title        text,
  avatar_url   text,
  member_count integer,
  is_member    boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_me    uuid := auth.uid();
  v_query text := btrim(coalesce(p_query, ''));
begin
  if v_me is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if char_length(v_query) < 2 then
    return;
  end if;
  -- Literal substring match: escape LIKE wildcards in the user's input.
  v_query := replace(replace(replace(left(v_query, 60), '\', '\\'), '%', '\%'), '_', '\_');

  return query
  select
    c.id,
    c.title,
    c.avatar_url,
    (select count(*)::integer from public.chat_participants cp where cp.chat_id = c.id) as member_count,
    exists (
      select 1 from public.chat_participants cp
      where cp.chat_id = c.id and cp.user_id = v_me
    ) as is_member
  from public.chats c
  where c.type = 'group'
    and c.title ilike '%' || v_query || '%'
  -- Prefix matches first, then bigger groups.
  -- (4 = member_count; by position, since the name is also an OUT parameter.)
  order by (c.title ilike (v_query || '%')) desc, 4 desc, c.title
  limit 50;
end;
$$;

revoke all on function public.search_groups(text) from public, anon;
grant execute on function public.search_groups(text) to authenticated;

-- Join a group as a member. Already in it: un-hides it and returns.
-- Errors: 'not authenticated' 42501, 'not a group' P0002, 'too many members' 22023.
create or replace function public.join_group(p_group_id uuid)
returns uuid
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
    select 1 from public.profiles p where p.id = v_me and p.username is not null
  ) then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if not exists (select 1 from public.chats c where c.id = p_group_id and c.type = 'group') then
    raise exception 'not a group' using errcode = 'P0002';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('group:' || p_group_id::text, 0));

  if exists (
    select 1 from public.chat_participants cp
    where cp.chat_id = p_group_id and cp.user_id = v_me
  ) then
    update public.chat_participants set hidden_at = null
    where chat_id = p_group_id and user_id = v_me and hidden_at is not null;
    return p_group_id;
  end if;

  if (select count(*) from public.chat_participants where chat_id = p_group_id) + 1 > 100 then
    raise exception 'too many members' using errcode = '22023';
  end if;

  -- cleared_at just before now(), so they see the "joined" message below
  -- but nothing from before.
  insert into public.chat_participants (chat_id, user_id, role, cleared_at, last_read_at)
  values (p_group_id, v_me, 'member', now() - interval '1 microsecond', now() - interval '1 microsecond');

  perform private.post_system_message(p_group_id, format('%s joined', private.profile_label(v_me)));

  return p_group_id;
end;
$$;

revoke all on function public.join_group(uuid) from public, anon;
grant execute on function public.join_group(uuid) to authenticated;
