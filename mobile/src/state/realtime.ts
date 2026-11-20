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

function subscribe(userId: string) {
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
    .on("postgres_changes", { event: "*", schema: "public", table: "calls" }, (payload) => {
      if (payload.eventType !== "INSERT" && payload.eventType !== "UPDATE") return;
      const row = callFromRow(payload.new as Record<string, unknown>);
      MissedCalls.onCallRow(row);
      for (const fn of callListeners) fn(payload.eventType, row);
    })
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
    subscribe(userId);
  },

  detach() {
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
    subscribe(user);
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
