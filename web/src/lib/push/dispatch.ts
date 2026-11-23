import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { TokenMessage } from "firebase-admin/messaging";
import { messageSnippet } from "@/lib/chat";
import type { Database } from "@/lib/database.types";
import { avatarPublicUrl } from "@/lib/profile";
import { getFirebaseApp, sendFcm } from "./fcm";

type Client = SupabaseClient<Database>;

/** Shape of get_push_targets() (see the push_tokens_and_prefs migration). */
type PushTargets = {
  kind: "call" | "message";
  chat_id: string;
  sender_id: string;
  sender_name: string;
  sender_avatar: string | null;
  is_group: boolean;
  chat_title?: string | null;
  created_at: string;
  call_id?: string;
  call_type?: string;
  message_id?: string;
  message_type?: string;
  content?: string | null;
  duration_seconds?: number | null;
  targets: { user_id: string; token: string; platform: "android" | "ios" | "web" }[];
};

export type PushRequest = { callId: string } | { messageId: string };

export type DispatchResult =
  | { status: "sent"; sent: number; failed: number }
  | { status: "skipped"; reason: "not-configured" | "nothing-to-send" }
  | { status: "error" };

/** How long a ringing call is worth delivering (the ring timeout). */
const CALL_TTL_MS = 30_000;

/**
 * Pushes a call or message to its recipients. Runs as the *sender*:
 * get_push_targets() refuses anything they didn't just start or send, applies
 * the push / mute preferences, and allows each call or message only once.
 * Names and previews come from the database, never from the client.
 */
export async function dispatchPush(supabase: Client, request: PushRequest): Promise<DispatchResult> {
  // Checked first so an unconfigured server doesn't use up the one-shot marker.
  const firebase = getFirebaseApp();
  if (!firebase) return { status: "skipped", reason: "not-configured" };

  const { data, error } = await supabase.rpc(
    "get_push_targets",
    "callId" in request ? { p_call_id: request.callId } : { p_message_id: request.messageId },
  );
  if (error) {
    console.error("[push] get_push_targets failed:", error.message);
    return { status: "error" };
  }
  const info = data as unknown as PushTargets | null;
  // Only the native apps register tokens.
  const targets = (info?.targets ?? []).filter((t) => t.platform !== "web");
  if (!info || targets.length === 0) return { status: "skipped", reason: "nothing-to-send" };

  const messages = targets.map((t) =>
    info.kind === "call" ? callMessage(info, t.token) : chatMessage(info, t.token),
  );
  const { sent, failed, staleTokens } = await sendFcm(firebase, messages);
  if (staleTokens.length) await removeStaleTokens(staleTokens);
  return { status: "sent", sent, failed };
}

/**
 * Stale tokens belong to the *recipients*, so the sender's RLS session can't
 * delete them. This needs the server-only service role key.
 */
async function removeStaleTokens(tokens: string[]) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.warn(`[push] ${tokens.length} stale token(s) kept: SUPABASE_SERVICE_ROLE_KEY is not set.`);
    return;
  }
  const admin = createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { error } = await admin.from("user_push_tokens").delete().in("token", tokens);
  if (error) console.error("[push] removing stale tokens failed:", error.message);
}

/** Data-only on Android, so the app's headless handler can ring full-screen. */
function callMessage(info: PushTargets, token: string): TokenMessage {
  const video = info.call_type === "video";
  return {
    token,
    data: {
      type: "incoming_call",
      callId: info.call_id ?? "",
      chatId: info.chat_id,
      callType: video ? "video" : "voice",
      callerId: info.sender_id,
      callerName: info.sender_name,
      callerAvatar: avatarPublicUrl(info.sender_avatar) ?? "",
      createdAt: info.created_at,
    },
    android: { priority: "high", ttl: CALL_TTL_MS },
    apns: {
      headers: {
        "apns-priority": "10",
        "apns-push-type": "alert",
        "apns-expiration": String(Math.floor((Date.now() + CALL_TTL_MS) / 1000)),
      },
      payload: {
        aps: {
          alert: { title: info.sender_name, body: video ? "Incoming video call" : "Incoming voice call" },
          sound: "default",
        },
      },
    },
  };
}

function chatMessage(info: PushTargets, token: string): TokenMessage {
  const snippet =
    messageSnippet(info.message_type ?? "text", info.content ?? null, info.duration_seconds) || "New message";
  const preview = (info.is_group ? `${info.sender_name}: ${snippet}` : snippet).slice(0, 200);
  const title = info.is_group ? (info.chat_title ?? "Group") : info.sender_name;
  return {
    token,
    data: {
      type: "new_message",
      messageId: info.message_id ?? "",
      chatId: info.chat_id,
      senderName: info.sender_name,
      title,
      preview,
    },
    android: { priority: "high" },
    apns: {
      headers: { "apns-priority": "10", "apns-push-type": "alert" },
      payload: { aps: { alert: { title, body: preview }, sound: "default", "thread-id": info.chat_id } },
    },
  };
}
