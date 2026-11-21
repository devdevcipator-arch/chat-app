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
 * Backend contract (supabase/migrations/20261119120000_push_tokens_and_prefs.sql):
 *   - rpc    register_push_token(p_token text, p_platform 'android'|'ios'|'web'):
 *            upserts (user_id, token) for me and takes the token away from any
 *            other account that had this device before (security definer)
 *   - table  user_push_tokens, unique (user_id, token); RLS lets me delete my own rows
 *   - column profiles.push_notifications_enabled boolean (I may update my own)
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

/**
 * Registers this device for the signed-in user via the register_push_token
 * RPC. It upserts on (user_id, token) server-side and moves the token off any
 * account that used this device before, which a direct table write can't do
 * under RLS. Best-effort: a failure just means no remote pushes until the next
 * launch / token refresh retries it.
 */
async function saveToken(token: string) {
  const platform = Platform.OS === "ios" ? "ios" : Platform.OS === "android" ? "android" : null;
  if (!platform) return;
  try {
    const { error } = await supabase.rpc("register_push_token", { p_token: token, p_platform: platform });
    if (error) console.warn("register_push_token failed", error.message);
  } catch (e) {
    console.warn("register_push_token failed", e);
  }
}

/**
 * Removes this device's token row. Must run while still signed in: RLS only
 * lets me delete my own rows, so after sign-out the delete would match nothing.
 */
async function deleteToken(token: string) {
  try {
    const { error } = await supabase.from("user_push_tokens").delete().eq("token", token);
    if (error) console.warn("Removing push token failed", error.message);
  } catch (e) {
    console.warn("Removing push token failed", e);
  }
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

async function register() {
  const m = messagingModule();
  if (!m) return;
  try {
    if (!(await requestOsPermission(m))) return;
    const messaging = m.getMessaging();
    const token = await m.getToken(messaging);
    // FCM rotated the token since last time: drop the stale row first.
    const previous = storage.getString(TOKEN_KEY);
    if (previous && previous !== token) await deleteToken(previous);
    storage.set(TOKEN_KEY, token);
    await saveToken(token);
    unsubscribeRefresh?.();
    unsubscribeRefresh = m.onTokenRefresh(messaging, (next) => {
      const old = storage.getString(TOKEN_KEY);
      storage.set(TOKEN_KEY, next);
      void (async () => {
        if (old && old !== next) await deleteToken(old);
        await saveToken(next);
      })();
    });
    const { ensureCallChannel } = await import("./callNotifications");
    await ensureCallChannel();
  } catch (e) {
    console.warn("Push registration failed", e);
  }
}

/** Forgets this device: server row first (needs the session), then the FCM token. */
async function unregister() {
  unsubscribeRefresh?.();
  unsubscribeRefresh = null;
  const token = storage.getString(TOKEN_KEY);
  if (token) await deleteToken(token);
  storage.remove(TOKEN_KEY);
  const m = messagingModule();
  if (m) await m.deleteToken(m.getMessaging()).catch(() => {});
}

export const Push = {
  async attach(_userId: string) {
    if (usePushPref.getState().enabled) await register();
  },

  /**
   * Called by Auth.signOut *before* the session is cleared, so the token row
   * can still be deleted under RLS (afterwards the delete would match nothing).
   */
  async beforeSignOut() {
    await unregister();
  },

  /** Signed out (or the session ended): stop token refresh and drop the local token. */
  async detach() {
    await unregister();
  },

  async setEnabled(userId: string, enabled: boolean) {
    storage.set(PREF_KEY, enabled);
    usePushPref.setState({ enabled });
    await saveProfileFlag(userId, enabled);
    if (enabled) await register();
    else await unregister();
  },
};
