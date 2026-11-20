import { Api, stringMap } from "../lib/api";
import { AppError, unwrap } from "../lib/errors";
import { supabase } from "../lib/supabase";
import { normalizeDisplayName } from "../lib/username";
import { type Profile, type ThemePreference, profileFromRow } from "../models/types";
import { uploadFile } from "./upload";

type Row = Record<string, unknown>;
const COLUMNS = "id, username, display_name, avatar_url, theme_preference";

/** Profile reads/writes (RLS); avatar uploads go through the web API (presigned R2 PUT). */
export const ProfileRepo = {
  /** The signed-in user's own profile (created by the signup trigger). */
  async fetchMine(userId: string): Promise<Profile> {
    const row = unwrap(await supabase.from("profiles").select(COLUMNS).eq("id", userId).maybeSingle()) as Row | null;
    return row ? profileFromRow(row) : { id: userId, username: null, displayName: null, avatarUrl: null };
  },

  /** Exact @username lookup via the `find_profile_by_username` RPC. */
  async findByUsername(username: string): Promise<Profile | null> {
    const rows = unwrap(await supabase.rpc("find_profile_by_username", { p_username: username })) as Row[];
    return rows[0] ? profileFromRow(rows[0]) : null;
  },

  /** A contact's public profile (RLS: self and people I share a chat with). */
  async fetchPublic(userId: string): Promise<Profile | null> {
    const row = unwrap(
      await supabase.from("profiles").select("id, username, display_name, avatar_url").eq("id", userId).maybeSingle(),
    ) as Row | null;
    return row ? profileFromRow(row) : null;
  },

  /** Sets username + display name (23505 = username taken, 23514 = invalid format). */
  async completeOnboarding(userId: string, username: string, displayName: string): Promise<Profile> {
    const name = displayName.trim();
    const row = unwrap(
      await supabase
        .from("profiles")
        .update({ username, display_name: name || username })
        .eq("id", userId)
        .select(COLUMNS)
        .maybeSingle(),
    ) as Row | null;
    // RLS matched no row: the session no longer belongs to this profile.
    if (!row) throw Object.assign(new Error("Profile not found"), { code: "42501" });
    return profileFromRow(row);
  },

  async updateDisplayName(userId: string, displayName: string): Promise<Profile> {
    const name = normalizeDisplayName(displayName);
    const row = unwrap(
      await supabase
        .from("profiles")
        .update({ display_name: name || null })
        .eq("id", userId)
        .select(COLUMNS)
        .single(),
    ) as Row;
    return profileFromRow(row);
  },

  async saveTheme(userId: string, theme: ThemePreference) {
    unwrap(await supabase.from("profiles").update({ theme_preference: theme }).eq("id", userId));
  },

  /** Uploads an already-resized JPEG and makes it the avatar. Returns the new object key. */
  async uploadAvatar(uri: string, size: number, mime: "image/jpeg" | "image/png" | "image/webp" = "image/jpeg") {
    if (size > 1024 * 1024) throw new AppError("That photo is too large.");
    const target = await Api.post("/api/profile/avatar/upload-url", { fileType: mime, fileSize: size });
    await uploadFile({ uploadUrl: String(target.uploadUrl), headers: stringMap(target.headers), uri });
    const result = await Api.put("/api/profile/avatar", { fileId: target.fileId, fileType: target.fileType ?? mime });
    return String(result.avatarUrl);
  },

  removeAvatar: () => Api.delete("/api/profile/avatar"),
};
