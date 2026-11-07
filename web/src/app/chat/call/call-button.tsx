"use client";

import type { CallPeer, CallType } from "@/lib/call/types";
import { profileName } from "@/lib/chat";
import { useCall } from "./call-provider";
import { PhoneIcon, VideoIcon } from "./icons";

/** Voice or video call button for a 1-on-1 chat header. */
export function CallButton({ peer, type }: { peer: CallPeer | null; type: CallType }) {
  const { call, controller } = useCall();
  const busy = call.phase !== "idle" && call.phase !== "ended";
  const disabled = !controller || !peer || busy;
  const kind = type === "video" ? "Video call" : "Voice call";
  const label = !peer
    ? "Can't call a deleted account"
    : busy
      ? "You're already in a call"
      : `${kind} ${profileName(peer)}`;

  return (
    <button
      type="button"
      onClick={() => peer && void controller?.start(peer, type)}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="flex size-10 shrink-0 items-center justify-center rounded-full text-zinc-500 transition hover:bg-zinc-100 hover:text-indigo-600 disabled:pointer-events-none disabled:opacity-40 dark:hover:bg-zinc-800 dark:hover:text-indigo-400"
    >
      {type === "video" ? <VideoIcon /> : <PhoneIcon />}
    </button>
  );
}
