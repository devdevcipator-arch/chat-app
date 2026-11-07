"use client";

import { AnimatePresence, motion } from "motion/react";
import { useReducer, useSyncExternalStore } from "react";
import {
  dismissPrompt,
  notificationPermission,
  promptDismissed,
  requestNotificationPermission,
} from "@/lib/notify";

const noopSubscribe = () => () => {};

/** One-time banner asking to enable desktop notifications. */
export function NotificationPrompt() {
  // Bumped after the user answers, to re-read the browser state.
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const permission = useSyncExternalStore(noopSubscribe, notificationPermission, () => "unsupported" as const);
  const dismissed = useSyncExternalStore(noopSubscribe, promptDismissed, () => true);
  const show = permission === "default" && !dismissed;

  async function enable() {
    await requestNotificationPermission();
    dismissPrompt(); // asked once; never nag again whatever the answer
    rerender();
  }

  return (
    <AnimatePresence initial={false}>
      {show && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          exit={{ opacity: 0, height: 0 }}
          className="overflow-hidden px-3"
        >
          <div className="mt-3 rounded-lg border border-indigo-200 bg-indigo-50 p-3 text-sm dark:border-indigo-900 dark:bg-indigo-950/40">
            <p className="font-medium text-indigo-900 dark:text-indigo-200">Get notified of new messages</p>
            <p className="mt-0.5 text-xs text-indigo-800/80 dark:text-indigo-300/80">
              See a desktop notification when this tab is in the background.
            </p>
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={() => void enable()}
                className="rounded-md bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-indigo-500"
              >
                Enable
              </button>
              <button
                type="button"
                onClick={() => {
                  dismissPrompt();
                  rerender();
                }}
                className="rounded-md px-2.5 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-100 dark:text-indigo-300 dark:hover:bg-indigo-900/50"
              >
                Not now
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
