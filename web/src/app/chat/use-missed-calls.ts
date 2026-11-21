"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { realtimeHub } from "@/lib/realtime";
import { createClient } from "@/lib/supabase/client";

/** 1-on-1 calls to me that I didn't pick up (shown in red in the Calls list). */
const UNSEEN_STATUSES = ["missed", "declined", "cancelled"];

const storageKey = (meId: string) => `last_seen_calls_at:${meId}`;

/** When I last opened the Calls tab; the first visit starts counting from now. */
function readSeenAt(meId: string) {
  try {
    const stored = localStorage.getItem(storageKey(meId));
    if (stored) return stored;
    const now = new Date().toISOString();
    localStorage.setItem(storageKey(meId), now);
    return now;
  } catch {
    return new Date().toISOString();
  }
}

function writeSeenAt(meId: string) {
  try {
    localStorage.setItem(storageKey(meId), new Date().toISOString());
  } catch {
    // Private mode / blocked storage: the badge just resets per session.
  }
}

/**
 * Unseen missed calls for the Calls tab badge: missed / declined / cancelled
 * 1-on-1 calls to me since `last_seen_calls_at` (localStorage). Recounted
 * live from Realtime. Opening the Calls tab (markSeen) resets it, and calls
 * that arrive while it is in view count as seen.
 */
export function useMissedCalls(meId: string, viewing: boolean) {
  const [supabase] = useState(createClient);
  const [count, setCount] = useState(0);
  const viewingRef = useRef(viewing);
  useEffect(() => {
    viewingRef.current = viewing;
  }, [viewing]);

  const recount = useCallback(async () => {
    if (viewingRef.current) writeSeenAt(meId);
    const { count: next, error } = await supabase
      .from("calls")
      .select("id", { count: "exact", head: true })
      .eq("callee_id", meId)
      .eq("is_group", false)
      .in("status", UNSEEN_STATUSES)
      .gt("created_at", readSeenAt(meId));
    if (!error) setCount(next ?? 0);
  }, [supabase, meId]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const soon = () => {
      clearTimeout(timer);
      timer = setTimeout(() => void recount(), 400);
    };
    // The app's shared channel (lib/realtime.ts), narrowed to calls to me.
    const hub = realtimeHub(supabase);
    const offCall = hub.onCall((_event, call) => {
      if (call.callee_id === meId) soon();
    });
    const offStatus = hub.onStatus((status) => {
      if (status === "SUBSCRIBED") soon(); // initial count, and catch-up after reconnects
    });
    return () => {
      clearTimeout(timer);
      offCall();
      offStatus();
    };
  }, [supabase, meId, recount]);

  /** Call when the Calls tab is opened: everything up to now is seen. */
  const markSeen = useCallback(() => {
    writeSeenAt(meId);
    setCount(0);
  }, [meId]);

  return { count: viewing ? 0 : count, markSeen };
}
