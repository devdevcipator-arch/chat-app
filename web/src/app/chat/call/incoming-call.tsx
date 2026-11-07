"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef } from "react";
import { Avatar } from "@/components/avatar";
import { profileName } from "@/lib/chat";
import { useCall } from "./call-provider";
import { PhoneDownIcon, PhoneIcon } from "./icons";

/** Ringing banner with Accept / Decline. */
export function IncomingCall() {
  const { call, controller } = useCall();
  const incoming = call.phase === "incoming" ? call : null;
  const acceptButton = useRef<HTMLButtonElement>(null);

  const incomingId = incoming?.call.id ?? null;

  // Focus Accept so keyboard users can answer straight away.
  useEffect(() => {
    if (incomingId) acceptButton.current?.focus();
  }, [incomingId]);

  return (
    <AnimatePresence>
      {incoming && controller && (
        <motion.div
          key={incoming.call.id}
          role="alertdialog"
          aria-live="assertive"
          aria-label={`Incoming voice call from ${profileName(incoming.peer)}`}
          initial={{ opacity: 0, y: -24, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -24, scale: 0.96 }}
          transition={{ type: "spring", stiffness: 380, damping: 30 }}
          className="fixed inset-x-3 top-3 z-50 md:inset-x-auto md:right-4 md:top-4 md:w-96"
        >
          <div className="flex items-center gap-3 rounded-2xl border border-zinc-200 bg-white/95 p-3 shadow-2xl shadow-zinc-900/20 backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/95">
            <div className="relative">
              <span className="absolute inset-0 animate-ping rounded-full bg-emerald-400/40" aria-hidden />
              <Avatar name={profileName(incoming.peer)} size="lg" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold">{profileName(incoming.peer)}</p>
              <p className="text-sm text-zinc-500">Incoming voice call…</p>
            </div>
            <button
              type="button"
              onClick={controller.decline}
              aria-label="Decline call"
              title="Decline"
              className="flex size-12 shrink-0 items-center justify-center rounded-full bg-red-600 text-white shadow-lg shadow-red-600/30 transition hover:bg-red-500 active:scale-95"
            >
              <PhoneDownIcon className="size-6" />
            </button>
            <button
              ref={acceptButton}
              type="button"
              onClick={() => void controller.accept()}
              aria-label="Accept call"
              title="Accept"
              className="flex size-12 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white shadow-lg shadow-emerald-600/30 transition hover:bg-emerald-500 active:scale-95"
            >
              <PhoneIcon className="size-5 animate-[wiggle_1s_ease-in-out_infinite]" />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
