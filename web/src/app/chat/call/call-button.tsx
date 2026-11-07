"use client";

import type { CallTarget, CallType } from "@/lib/call/types";
import { profileName } from "@/lib/chat";
import { useCall } from "./call-provider";
import { PhoneIcon, VideoIcon } from "./icons";

/** Voice or video call button for a chat header (1-on-1 or group). */
export function CallButton({ target, type }: { target: CallTarget; type: CallType }) {
  const { call, controller } = useCall();
  const busy = call.phase !== "idle" && call.phase !== "ended";
  const unavailable = target.kind === "direct" && !target.peer;
  const kind = type === "video" ? "Video call" : "Voice call";
  const who = target.kind === "group" ? target.group.title : target.peer ? profileName(target.peer) : "";
  const label = unavailable
    ? "Can't call a deleted account"
    : busy
      ? "You're already in a call"
      : `${kind} ${who}`;

  function start() {
    if (!controller) return;
    if (target.kind === "group") void controller.startGroup(target.group, type);
    else if (target.peer) void controller.start(target.peer, type);
  }

  return (
    <button
      type="button"
      onClick={start}
      disabled={!controller || unavailable || busy}
      aria-label={label}
      title={label}
      className="flex size-10 shrink-0 items-center justify-center rounded-full text-zinc-500 transition hover:bg-zinc-100 hover:text-indigo-600 disabled:pointer-events-none disabled:opacity-40 dark:hover:bg-zinc-800 dark:hover:text-indigo-400"
    >
      {type === "video" ? <VideoIcon /> : <PhoneIcon />}
    </button>
  );
}
