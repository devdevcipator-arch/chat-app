import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
import { type CallRow, type ChatMessage, callFromRow, messageFromRow } from "../models/types";
import { Chats } from "./chats";
import { Messages } from "./messages";
import { MissedCalls } from "./missedCalls";
import { Network } from "./network";

/**
 * ONE multiplexed Realtime channel for the whole app (instead of a channel
 * per chat / per screen). RLS decides which rows reach this user, so the
 * unfiltered `messages` and `calls` listeners only ever see my chats.
 *
 *  - messages INSERT/UPDATE → chat list + open conversations
 *  - chat_participants (mine) → chat list (new chats, mute, clear, hide)
 *  - calls INSERT/UPDATE → call controller, missed-call badge, group rooms
 */
type CallListener = (event: "INSERT" | "UPDATE", row: CallRow) => void;
type MessageListener = (message: ChatMessage, isUpdate: boolean) => void;

let channel: RealtimeChannel | null = null;
let meId: string | null = null;
let live = false;
const callListeners = new Set<CallListener>();
const messageListeners = new Set<MessageListener>();
const statusListeners = new Set<(live: boolean) => void>();

function setLive(value: boolean) {
  if (live === value) return;
  live = value;
  for (const fn of statusListeners) fn(value);
}

/**
 * One row change can arrive on more than one calls binding (the filtered
 * caller/callee ones below plus the unfiltered one); deliver it once.
 */
const seenCallChanges = new Map<string, number>();
function firstSighting(key: string) {
  const now = Date.now();
  for (const [k, t] of seenCallChanges) if (now - t > 15_000) seenCallChanges.delete(k);
  if (seenCallChanges.has(key)) return false;
  seenCallChanges.set(key, now);
  return true;
}

function onCallPayload(payload: { eventType: string; commit_timestamp?: string; new: unknown }) {
  if (payload.eventType !== "INSERT" && payload.eventType !== "UPDATE") return;
  const raw = payload.new as Record<string, unknown>;
  const row = callFromRow(raw);
  const key = `${payload.eventType}:${row.id}:${row.status}:${payload.commit_timestamp ?? String(raw.updated_at ?? "")}`;
  if (!firstSighting(key)) return;
  MissedCalls.onCallRow(row);
  for (const fn of callListeners) fn(payload.eventType, row);
}

let subscribeGen = 0;

/**
 * Joins the channel only once the signed-in user's access token is on the
 * Realtime socket. At launch the user id comes from MMKV synchronously, before
 * supabase-js has loaded the session; joining then authorizes the channel as
 * anon and RLS silently drops every messages/calls row (no incoming calls, no
 * "accepted" for outgoing ones, no message notifications).
 */
async function subscribe(userId: string) {
  const myGen = ++subscribeGen;
  try {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (token) await supabase.realtime.setAuth(token);
  } catch {
    // Offline: join anyway; Realtime.setToken re-authorizes after a refresh.
  }
  if (myGen !== subscribeGen || meId !== userId) return;
  channel = supabase
    .channel(`app:${userId}`)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, (payload) => {
      const message = messageFromRow(payload.new as Record<string, unknown>);
      Messages.onRemote(message, false);
      Chats.onMessage(message);
      for (const fn of messageListeners) fn(message, false);
    })
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "messages" }, (payload) => {
      const message = messageFromRow(payload.new as Record<string, unknown>);
      Messages.onRemote(message, true);
      for (const fn of messageListeners) fn(message, true);
    })
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "chat_participants", filter: `user_id=eq.${userId}` },
      () => Chats.refreshSoon(),
    )
    // The same two bindings web uses (web/src/lib/call/signaling.ts) for
    // 1-on-1 calls, plus an unfiltered one for group rooms (RLS: my chats only).
    .on("postgres_changes", { event: "*", schema: "public", table: "calls", filter: `callee_id=eq.${userId}` }, onCallPayload)
    .on("postgres_changes", { event: "*", schema: "public", table: "calls", filter: `caller_id=eq.${userId}` }, onCallPayload)
    .on("postgres_changes", { event: "*", schema: "public", table: "calls" }, onCallPayload)
    .subscribe((status) => {
      if (status === "SUBSCRIBED") {
        setLive(true);
        Network.reportSuccess();
        // Catch up on anything missed while (re)connecting.
        Chats.refreshSoon();
        Messages.flushOutbox();
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
        setLive(false);
      }
    });
}

export const Realtime = {
  attach(userId: string) {
    if (meId === userId && channel) return;
    Realtime.detach();
    meId = userId;
    void subscribe(userId);
  },

  detach() {
    subscribeGen++;
    const c = channel;
    channel = null;
    meId = null;
    setLive(false);
    if (c) void supabase.removeChannel(c);
  },

  /** Back online: re-join if the channel gave up. */
  ensure() {
    if (!meId || live) return;
    const user = meId;
    const c = channel;
    channel = null;
    if (c) void supabase.removeChannel(c);
    void subscribe(user);
  },

  /** A new access token (sign-in / refresh): keep the live channel authorized. */
  setToken(token: string | null | undefined) {
    if (!token) return;
    void Promise.resolve(supabase.realtime.setAuth(token)).catch(() => {});
  },

  get live() {
    return live;
  },

  onCall(fn: CallListener) {
    callListeners.add(fn);
    return () => {
      callListeners.delete(fn);
    };
  },
  onMessage(fn: MessageListener) {
    messageListeners.add(fn);
    return () => {
      messageListeners.delete(fn);
    };
  },
  onStatus(fn: (live: boolean) => void) {
    statusListeners.add(fn);
    return () => {
      statusListeners.delete(fn);
    };
  },
};
