-- =============================================================================
-- Profile settings: avatars on R2 and a synced theme preference.
--
-- * profiles.theme_preference: 'light' | 'dark' | 'system' (default 'dark').
--   Users may update it on their own row (column grant + the existing
--   "profiles: update own" policy, which checks id = auth.uid()).
-- * profiles.avatar_url now stores an R2 object key, never an arbitrary URL:
--   avatars/<own user id>/<uuid>.<webp|jpg|png>. It's set and cleared by
--   /api/profile/avatar, which also deletes the replaced object.
-- * display_name already allows 1–50 trimmed characters (or null).
-- =============================================================================

alter table public.profiles
  add column theme_preference text not null default 'dark'
    constraint theme_preference_value check (theme_preference in ('light', 'dark', 'system'));

grant update (theme_preference) on public.profiles to authenticated;

-- Avatars were never implemented before, so any existing value isn't one of
-- our keys (and could point anywhere): drop it before adding the rule.
update public.profiles
set avatar_url = null
where avatar_url is not null
  and avatar_url !~ ('^avatars/' || id::text || '/[0-9a-f-]{36}\.(webp|jpg|png)$');

alter table public.profiles
  add constraint avatar_url_is_own_key check (
    avatar_url is null
    or avatar_url ~ ('^avatars/' || id::text || '/[0-9a-f-]{36}\.(webp|jpg|png)$')
  );
