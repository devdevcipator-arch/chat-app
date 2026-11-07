"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { fetchGroupCall, subscribeToChatCalls, type ActiveGroupCall } from "@/lib/call/signaling";
import type { GroupCallInfo } from "@/lib/call/types";
import { createClient } from "@/lib/supabase/client";
import { useCall } from "./call-provider";
import { PhoneIcon, VideoIcon } from "./icons";

/** Re-check this often even without Realtime pings, to drop abandoned rooms. */
const POLL_MS = 30_000;

/** The group's ongoing call, kept fresh via Realtime + a slow poll. */
function useActiveGroupCall(chatId: string) {
  const [supabase] = useState(createClient);
  const [active, setActive] = useState<ActiveGroupCall | null>(null);

  useEffect(() => {
    let cancelled = false;
    let inFlight = false;
    const load = async () => {
      if (inFlight) return;
      inFlight = true;
      const call = await fetchGroupCall(supabase, chatId);
      inFlight = false;
      if (!cancelled) setActive(call);
    };
    const unsubscribe = subscribeToChatCalls(supabase, chatId, () => void load());
    const timer = window.setInterval(() => void load(), POLL_MS);
    return () => {
      cancelled = true;
      unsubscribe();
      window.clearInterval(timer);
    };
  }, [supabase, chatId]);

  return active;
}

/** "📹 Video call ongoing · 3 in call · [Join]" under a group chat's header. */
export function GroupCallBanner({ group }: { group: GroupCallInfo }) {
  const active = useActiveGroupCall(group.chatId);
  const { call, controller } = useCall();
  const inThisCall = call.phase === "group" && call.group.chatId === group.chatId;
  const busyElsewhere = !inThisCall && call.phase !== "idle" && call.phase !== "ended";
  const video = active?.callType === "video";

  return (
    <AnimatePresence initial={false}>
      {active && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          exit={{ opacity: 0, height: 0 }}
          className="shrink-0 overflow-hidden"
        >
          <div
            role="status"
            className="flex items-center gap-2 border-b border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900 md:px-4 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-200"
          >
            <span className="relative flex size-2.5 shrink-0" aria-hidden>
              <span className="absolute inset-0 animate-ping rounded-full bg-emerald-500/60" />
              <span className="relative size-2.5 rounded-full bg-emerald-500" />
            </span>
            {video ? <VideoIcon className="size-4 shrink-0" /> : <PhoneIcon className="size-4 shrink-0" />}
            <p className="min-w-0 flex-1 truncate">
              <span className="font-medium">{video ? "Video call ongoing" : "Voice call ongoing"}</span>
              <span className="text-emerald-800/70 dark:text-emerald-300/70">
                {" "}
                · {active.participantIds.length} in call
              </span>
            </p>
            {inThisCall ? (
              <span className="shrink-0 text-xs font-medium text-emerald-700 dark:text-emerald-300">You&apos;re in this call</span>
            ) : (
              <button
                type="button"
                onClick={() => void controller?.startGroup(group, active.callType)}
                disabled={!controller || busyElsewhere}
                title={busyElsewhere ? "You're already in another call" : undefined}
                className="shrink-0 rounded-full bg-emerald-600 px-3 py-1 text-xs font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-50"
              >
                Join
              </button>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
