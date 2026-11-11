import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { UploadError, compressImage, uploadToR2 } from "@/lib/media-client";
import {
  AVATAR_DIMENSION,
  AVATAR_INPUT_TYPES,
  AVATAR_MAX_INPUT_BYTES,
  DISPLAY_NAME_MAX,
  normalizeDisplayName,
  type AvatarUploadUrlResponse,
  type ThemePreference,
} from "@/lib/profile";

// Browser-only profile helpers. Text fields go straight to Supabase (RLS +
// column grants: own row only); avatars go through /api/profile/avatar so the
// server controls the R2 key and cleans up replaced photos.

type Client = SupabaseClient<Database>;

async function api<T>(url: string, init: RequestInit, fallback: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, headers: init.body ? { "Content-Type": "application/json" } : undefined });
  } catch {
    throw new UploadError("Can't reach the server. Check your connection.");
  }
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new UploadError(data?.error ?? fallback);
  }
  return (await res.json()) as T;
}

/** Throws a user-facing UploadError if the file can't be a profile photo. */
export function checkAvatarFile(file: File) {
  if (!AVATAR_INPUT_TYPES.includes(file.type)) throw new UploadError("Profile photos must be PNG, JPG or WebP.");
  if (file.size > AVATAR_MAX_INPUT_BYTES) throw new UploadError("Profile photos must be 5 MB or smaller.");
  if (file.size === 0) throw new UploadError("That file is empty.");
}

/** Resizes to 512 px, uploads to R2 and makes it the avatar. Returns the new key. */
export async function uploadAvatar(file: File, onProgress: (fraction: number) => void): Promise<string> {
  checkAvatarFile(file);
  const image = await compressImage(file, { maxBytes: 150 * 1024, maxDimension: AVATAR_DIMENSION });
  const target = await api<AvatarUploadUrlResponse>(
    "/api/profile/avatar/upload-url",
    { method: "POST", body: JSON.stringify({ fileType: image.type, fileSize: image.blob.size }) },
    "Couldn't prepare the upload.",
  );
  await uploadToR2(target, image.blob, onProgress);
  const { avatarUrl } = await api<{ avatarUrl: string }>(
    "/api/profile/avatar",
    { method: "PUT", body: JSON.stringify({ fileId: target.fileId, fileType: target.fileType }) },
    "Couldn't update your photo.",
  );
  return avatarUrl;
}

export const removeAvatar = () =>
  api<{ avatarUrl: null }>("/api/profile/avatar", { method: "DELETE" }, "Couldn't remove your photo.");

/** Validates and saves the display name; "" clears it (your @username shows instead). */
export async function saveDisplayName(supabase: Client, userId: string, raw: string): Promise<string | null> {
  const name = normalizeDisplayName(raw);
  if (name.length > DISPLAY_NAME_MAX) throw new UploadError(`Display names can be at most ${DISPLAY_NAME_MAX} characters.`);
  const displayName = name || null;
  const { error } = await supabase.from("profiles").update({ display_name: displayName }).eq("id", userId);
  if (error) throw new UploadError("Couldn't save your display name. Please try again.");
  return displayName;
}

export async function saveThemePreference(supabase: Client, userId: string, theme: ThemePreference) {
  const { error } = await supabase.from("profiles").update({ theme_preference: theme }).eq("id", userId);
  if (error) throw new UploadError("Couldn't save your theme on your profile.");
}
