import { IMAGE_TYPES, publicBase, type ImageMimeType } from "@/lib/media";

// Shared (client + server) profile rules. Keep in sync with the profiles
// checks in supabase/migrations (display_name_length, avatar_url_is_own_key,
// theme_preference_value).

export const DISPLAY_NAME_MAX = 50;

/** Trims and collapses runs of whitespace; "" means "no display name". */
export const normalizeDisplayName = (value: string) => value.replace(/\s+/g, " ").trim();

export const THEMES = ["light", "dark", "system"] as const;
export type ThemePreference = (typeof THEMES)[number];
export const DEFAULT_THEME: ThemePreference = "dark";

export const asTheme = (value: unknown): ThemePreference =>
  THEMES.includes(value as ThemePreference) ? (value as ThemePreference) : DEFAULT_THEME;

/** What people can pick (before we re-encode it in the browser). */
export const AVATAR_INPUT_TYPES = ["image/png", "image/jpeg", "image/webp"];
export const AVATAR_MAX_INPUT_BYTES = 5 * 1024 * 1024;
/** After client-side resizing; the presign route enforces this. */
export const AVATAR_MAX_UPLOAD_BYTES = 1024 * 1024;
export const AVATAR_DIMENSION = 512;

export const AVATAR_KEY_PATTERN = /^avatars\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(webp|jpg|png)$/;

export const avatarKey = (userId: string, fileId: string, type: ImageMimeType) =>
  `avatars/${userId}/${fileId}.${IMAGE_TYPES[type]}`;

/** Public URL for an avatar key; null for anything that isn't one of ours. */
export function avatarPublicUrl(key: string | null | undefined): string | null {
  if (!key || !AVATAR_KEY_PATTERN.test(key)) return null;
  const base = publicBase();
  return base ? `${base}/${key}` : null;
}

export type AvatarUploadUrlResponse = {
  fileId: string;
  fileType: ImageMimeType;
  uploadUrl: string;
  headers: Record<string, string>;
  expiresIn: number;
};
