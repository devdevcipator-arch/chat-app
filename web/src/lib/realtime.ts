import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import type { MessageRow } from "@/lib/chat";
import type { CallRow } from "@/lib/call/types";
import type { Database } from "@/lib/database.types";

// ONE multiplexed Realtime channel for the whole app instead of one per
// feature (sidebar, open chat, call signaling, missed-call badge, group-call
// banner). Joining happens once per page load, so switching chats doesn't
// wait for a fresh channel join, and each row change crosses the wire once.
//
// The bindings are unfiltered: Realtime applies RLS per subscriber, so only
// rows of my chats / my calls ever arrive, and listeners filter by chat or
// user id on the client. (Screen-share presence keeps its own private channel,
// see joinScreenShareRoom: presence authorization is per topic.)

type Client = SupabaseClient<Database>;
export type HubStatus = "SUBSCRIBED" | "DOWN";
type CallListener = (event: "INSERT" | "UPDATE", call: CallRow) => void;

/** Keep the channel briefly after the last listener leaves (route changes remount listeners). */
const CLOSE_GRACE_MS = 5_000;

class RealtimeHub {
  private channel: RealtimeChannel | null = null;
  private subscribed = false;
  private closeTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly inserts = new Set<(m: MessageRow) => void>();
  private readonly updates = new Set<(m: MessageRow) => void>();
  private readonly calls = new Set<CallListener>();
  private readonly statuses = new Set<(s: HubStatus) => void>();

  constructor(private readonly supabase: Client) {}

  /** New messages in any of my chats. */
  onMessageInsert(fn: (m: MessageRow) => void) {
    return this.add(this.inserts, fn);
  }

  /** Message edits / voicemail-played updates in any of my chats. */
  onMessageUpdate(fn: (m: MessageRow) => void) {
    return this.add(this.updates, fn);
  }

  /** Inserts / updates of any call row I can see (1-on-1 and group rooms). */
  onCall(fn: CallListener) {
    return this.add(this.calls, fn);
  }

  /**
   * "SUBSCRIBED" on every (re)join, so listeners can catch up on anything
   * missed; "DOWN" when the channel drops. A listener added while the channel
   * is already live hears "SUBSCRIBED" right away.
   */
  onStatus(fn: (s: HubStatus) => void) {
    const off = this.add(this.statuses, fn);
    if (this.subscribed) {
      queueMicrotask(() => {
        if (this.statuses.has(fn) && this.subscribed) fn("SUBSCRIBED");
      });
    }
    return off;
  }

  private add<T>(set: Set<T>, fn: T) {
    set.add(fn);
    this.open();
    return () => {
      set.delete(fn);
      this.closeSoonIfIdle();
    };
  }

  private get idle() {
    return !this.inserts.size && !this.updates.size && !this.calls.size && !this.statuses.size;
  }

  private open() {
    if (this.closeTimer) {
      clearTimeout(this.closeTimer);
      this.closeTimer = null;
    }
    if (this.channel) return;
    const emit = <T>(set: Set<(arg: T) => void>, arg: T) => {
      for (const fn of [...set]) fn(arg);
    };
    this.channel = this.supabase
      .channel("app-realtime")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, (payload) =>
        emit(this.inserts, payload.new as MessageRow),
      )
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "messages" }, (payload) =>
        emit(this.updates, payload.new as MessageRow),
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "calls" }, (payload) => {
        if (payload.eventType !== "INSERT" && payload.eventType !== "UPDATE") return;
        const row = payload.new as CallRow;
        for (const fn of [...this.calls]) fn(payload.eventType, row);
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          this.subscribed = true;
          emit(this.statuses, "SUBSCRIBED" as HubStatus);
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          const was = this.subscribed;
          this.subscribed = false;
          if (was || status !== "CLOSED") emit(this.statuses, "DOWN" as HubStatus);
        }
      });
  }

  private closeSoonIfIdle() {
    if (!this.idle || this.closeTimer) return;
    this.closeTimer = setTimeout(() => {
      this.closeTimer = null;
      if (!this.idle || !this.channel) return;
      const channel = this.channel;
      this.channel = null;
      this.subscribed = false;
      void this.supabase.removeChannel(channel);
    }, CLOSE_GRACE_MS);
  }
}

const hubs = new WeakMap<Client, RealtimeHub>();

/** The app's shared Realtime channel for this (browser) Supabase client. */
export function realtimeHub(supabase: Client): RealtimeHub {
  let hub = hubs.get(supabase);
  if (!hub) {
    hub = new RealtimeHub(supabase);
    hubs.set(supabase, hub);
  }
  return hub;
}
