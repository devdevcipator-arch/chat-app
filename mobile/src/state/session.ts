import { AppState } from "react-native";
import { supabase } from "../lib/supabase";
import { LocalNotifications } from "../services/localNotifications";
import { Push } from "../services/push";
import { Auth, useAuth } from "./auth";
import { Calls } from "./calls";
import { Chats } from "./chats";
import { Messages } from "./messages";
import { MissedCalls } from "./missedCalls";
import { Network } from "./network";
import { Realtime } from "./realtime";

let started = false;
let attachedUser: string | null = null;

function apply(userId: string | null) {
  if (userId === attachedUser) return;
  attachedUser = userId;
  if (userId) {
    // Synchronous cache hydration first (0 ms), network sync after.
    Chats.attach(userId);
    Messages.attach(userId);
    MissedCalls.attach(userId);
    Realtime.attach(userId);
    void Calls.attach(userId);
    void LocalNotifications.attach(userId);
    void Push.attach(userId);
  } else {
    void Push.detach();
    LocalNotifications.detach();
    void Calls.detach();
    Realtime.detach();
    MissedCalls.detach();
    Messages.detach();
    Chats.detach();
  }
}

/**
 * Boots the signed-in session. Called once at module load, before the first
 * render, so every store is already hydrated from MMKV on frame one.
 */
export function startSession() {
  if (started) return;
  started = true;
  Network.start();
  Auth.start();
  apply(useAuth.getState().userId);
  Auth.onAccountChange(apply);

  // Every new access token goes onto the Realtime socket too, so RLS keeps
  // delivering this user's rows after a refresh (and after an offline launch).
  supabase.auth.onAuthStateChange((_event, session) => Realtime.setToken(session?.access_token));

  Network.onReconnect(() => {
    if (!attachedUser) return;
    Realtime.ensure();
    void Chats.refresh();
    Messages.flushOutbox();
    MissedCalls.refreshSoon();
  });

  AppState.addEventListener("change", (state) => {
    if (state !== "active" || !attachedUser) return;
    Realtime.ensure();
    Chats.refreshSoon();
    Messages.flushOutbox();
    void Calls.checkRinging();
  });
}
