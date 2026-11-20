import Constants from "expo-constants";
import { PermissionsAndroid, Platform } from "react-native";
import { create } from "zustand";
import { storage } from "../lib/storage";
import { supabase } from "../lib/supabase";

/**
 * Push notifications (FCM) + lock-screen call ringing (Notifee full-screen
 * intent). Native Firebase/Notifee code is compiled in only when the build
 * has a google-services.json (see app.config.ts / react-native.config.js);
 * otherwise this whole module is a no-op and the app is smaller.
 *
 * Backend contract (NOT yet present in the live database; writes fail
 * silently until it is):
 *   - table  user_push_tokens(user_id uuid, token text unique, platform text, updated_at timestamptz)
 *   - column profiles.push_notifications_enabled boolean
 *   - a sender that posts FCM data messages:
 *       { type: "call", call_id, chat_id, caller_name, call_type: "voice"|"video" }
 *       { type: "message", chat_id, title, body }
 */
export const PUSH_COMPILED_IN = Constants.expoConfig?.extra?.pushEnabled === true;

const PREF_KEY = "push.enabled";
const TOKEN_KEY = "push.token";

export const usePushPref = create<{ enabled: boolean }>(() => ({
  enabled: storage.getBoolean(PREF_KEY) ?? true,
}));

type Messaging = typeof import("@react-native-firebase/messaging");

function messagingModule(): Messaging | null {
  if (!PUSH_COMPILED_IN) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("@react-native-firebase/messaging") as Messaging;
  } catch {
    return null;
  }
}

async function requestOsPermission(m: Messaging): Promise<boolean> {
  if (Platform.OS === "android" && Number(Platform.Version) >= 33) {
    const result = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
    if (result !== PermissionsAndroid.RESULTS.GRANTED) return false;
  }
  const status = await m.requestPermission(m.getMessaging());
  return status === m.AuthorizationStatus.AUTHORIZED || status === m.AuthorizationStatus.PROVISIONAL;
}

/** Best-effort server writes: tolerate the table/column not existing yet. */
async function saveToken(userId: string, token: string) {
  await supabase
    .from("user_push_tokens" as never)
    .upsert({ user_id: userId, token, platform: Platform.OS, updated_at: new Date().toISOString() } as never, {
      onConflict: "token",
    })
    .then(
      () => {},
      () => {},
    );
}

async function deleteToken(token: string) {
  await supabase
    .from("user_push_tokens" as never)
    .delete()
    .eq("token", token)
    .then(
      () => {},
      () => {},
    );
}

async function saveProfileFlag(userId: string, enabled: boolean) {
  await supabase
    .from("profiles")
    .update({ push_notifications_enabled: enabled } as never)
    .eq("id", userId)
    .then(
      () => {},
      () => {},
    );
}

let unsubscribeRefresh: (() => void) | null = null;

async function register(userId: string) {
  const m = messagingModule();
  if (!m) return;
  try {
    if (!(await requestOsPermission(m))) return;
    const messaging = m.getMessaging();
    const token = await m.getToken(messaging);
    storage.set(TOKEN_KEY, token);
    await saveToken(userId, token);
    unsubscribeRefresh?.();
    unsubscribeRefresh = m.onTokenRefresh(messaging, (next) => {
      storage.set(TOKEN_KEY, next);
      void saveToken(userId, next);
    });
    const { ensureCallChannel } = await import("./callNotifications");
    await ensureCallChannel();
  } catch (e) {
    console.warn("Push registration failed", e);
  }
}

async function unregister() {
  unsubscribeRefresh?.();
  unsubscribeRefresh = null;
  const token = storage.getString(TOKEN_KEY);
  storage.remove(TOKEN_KEY);
  if (token) await deleteToken(token);
  const m = messagingModule();
  if (m) await m.deleteToken(m.getMessaging()).catch(() => {});
}

export const Push = {
  async attach(userId: string) {
    if (usePushPref.getState().enabled) await register(userId);
  },

  /** Signing out: this device stops receiving this account's pushes. */
  async detach() {
    await unregister();
  },

  async setEnabled(userId: string, enabled: boolean) {
    storage.set(PREF_KEY, enabled);
    usePushPref.setState({ enabled });
    await saveProfileFlag(userId, enabled);
    if (enabled) await register(userId);
    else await unregister();
  },
};
