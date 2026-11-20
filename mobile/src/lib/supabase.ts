import "react-native-url-polyfill/auto";
import { createClient } from "@supabase/supabase-js";
import { AppState } from "react-native";
import { Config } from "./config";
import { readJson, supabaseStorage } from "./storage";

/** Where the auth session lives in MMKV (read synchronously at launch). */
export const AUTH_STORAGE_KEY = "sb-chat-auth";

export const supabase = createClient(Config.supabaseUrl || "https://invalid.local", Config.supabasePublishableKey || "missing", {
  auth: {
    storage: supabaseStorage,
    storageKey: AUTH_STORAGE_KEY,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
  realtime: { params: { eventsPerSecond: 20 } },
});

// Refresh tokens only while in the foreground (Supabase's React Native guidance).
// A refresh that fails for network reasons keeps the stored session; only a
// refresh token the server rejects ends it (a SIGNED_OUT event).
AppState.addEventListener("change", (state) => {
  if (state === "active") supabase.auth.startAutoRefresh();
  else supabase.auth.stopAutoRefresh();
});

type StoredSession = { user?: { id?: string; email?: string | null } | null };

/**
 * The persisted session's user, read synchronously (0 ms) so a signed-in user
 * goes straight to their chats on the first frame, online or not.
 */
export function storedUser(): { id: string; email: string | null } | null {
  const session = readJson<StoredSession>(AUTH_STORAGE_KEY);
  const id = session?.user?.id;
  return id ? { id, email: session?.user?.email ?? null } : null;
}
