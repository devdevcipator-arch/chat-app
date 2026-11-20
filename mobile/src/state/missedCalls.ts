import { create } from "zustand";
import { Cache } from "../data/cache";
import { supabase } from "../lib/supabase";
import type { CallRow } from "../models/types";
import { Network } from "./network";

/**
 * Unseen missed calls, for the Calls tab badge.
 *
 * Counts 1-on-1 calls to me that I didn't pick up (missed, declined, or hung
 * up by the caller before I answered: the calls the history shows in red)
 * made after `last_seen_calls_at`, which is kept on the device and moved to
 * "now" whenever the Calls tab is opened. The last count is cached so the
 * badge is right on launch and offline.
 */
export const UNSEEN_STATUSES = ["missed", "declined", "cancelled"];

export const useMissedCalls = create<{ count: number }>(() => ({ count: 0 }));

let meId: string | null = null;
let seenAt = new Date().toISOString();
let debounce: ReturnType<typeof setTimeout> | null = null;

export const countsAsMissed = (row: CallRow, me: string, since: string) =>
  !row.isGroup && row.calleeId === me && UNSEEN_STATUSES.includes(row.status) && Date.parse(row.createdAt) > Date.parse(since);

function set(user: string, count: number) {
  useMissedCalls.setState({ count });
  Cache.saveMissedCalls(user, count);
}

export const MissedCalls = {
  attach(userId: string) {
    if (meId === userId) return;
    meId = userId;
    const seen = Cache.callsSeenAt(userId);
    if (seen) seenAt = seen;
    else {
      // First run for this account: count from now, not the whole history.
      seenAt = new Date().toISOString();
      Cache.saveCallsSeenAt(userId, seenAt);
    }
    useMissedCalls.setState({ count: Cache.missedCalls(userId) });
    void MissedCalls.refresh();
  },

  detach() {
    meId = null;
    if (debounce) clearTimeout(debounce);
    useMissedCalls.setState({ count: 0 });
  },

  /** A call row changed (Realtime). */
  onCallRow(row: CallRow) {
    if (meId && countsAsMissed(row, meId, seenAt)) MissedCalls.refreshSoon();
  },

  refreshSoon() {
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => void MissedCalls.refresh(), 400);
  },

  /** Recounts on the server (RLS: only calls I'm part of). */
  async refresh() {
    const user = meId;
    if (!user) return;
    const since = seenAt;
    const { count, error } = await supabase
      .from("calls")
      .select("id", { count: "exact", head: true })
      .eq("callee_id", user)
      .eq("is_group", false)
      .in("status", UNSEEN_STATUSES)
      .gt("created_at", since);
    if (error) {
      Network.reportFailure(error);
      return;
    }
    // Stale if I switched accounts or opened the Calls tab meanwhile.
    if (meId === user && seenAt === since) set(user, count ?? 0);
  },

  /** The Calls tab was opened: everything up to now is seen. */
  markSeen() {
    const user = meId;
    if (!user) return;
    seenAt = new Date().toISOString();
    Cache.saveCallsSeenAt(user, seenAt);
    set(user, 0);
  },
};
