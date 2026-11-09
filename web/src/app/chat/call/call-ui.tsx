"use client";

import { motion } from "motion/react";
import { useEffect, useId, useState, type ReactNode } from "react";
import type { CallController, MediaState } from "@/lib/call/controller";
import { callTypeOf, type CallPhase, type CallType } from "@/lib/call/types";

// Pieces shared by the voice and video call screens.

export type ShownPhase = Exclude<CallPhase, { phase: "idle" } | { phase: "incoming" }>;
/** Phases of a 1-on-1 call (everything but a group room). */
export type DirectPhase = Exclude<ShownPhase, { phase: "group" }>;
export type GroupPhase = Extract<ShownPhase, { phase: "group" }>;

export function phaseCallType(call: ShownPhase): CallType {
  return call.phase === "starting" || call.phase === "ended" || call.phase === "group"
    ? call.callType
    : callTypeOf(call.call);
}

export function statusText(call: ShownPhase, elapsed: string) {
  switch (call.phase) {
    case "starting":
      return "Starting…";
    case "outgoing":
      return "Ringing…";
    case "connecting":
      return "Connecting…";
    case "active":
      return call.reconnecting ? "Reconnecting…" : elapsed;
    case "group":
      if (call.status === "joining") return "Joining…";
      return call.reconnecting ? "Reconnecting…" : elapsed;
    case "ended":
      return call.message;
  }
}

export function useElapsed(since: number | null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (since === null) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [since]);
  return since === null ? 0 : Math.max(0, now - since);
}

/** 83_000 → "01:23", 3_723_000 → "1:02:03". */
export function formatDuration(ms: number) {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/** Timer text: since we connected (1-on-1), or since the room opened (group). */
export function useCallClock(call: ShownPhase) {
  const since =
    call.phase === "active"
      ? call.connectedAt
      : call.phase === "group" && call.status === "live" && call.call
        ? Date.parse(call.call.created_at)
        : null;
  return formatDuration(useElapsed(since));
}

export function RoundButton({
  label,
  active,
  disabled,
  onClick,
  children,
  size = "md",
  tone = "plain",
}: {
  label: string;
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
  size?: "sm" | "md";
  /** "accent": active means "on air" (screen sharing), shown in indigo, not white. */
  tone?: "plain" | "accent";
}) {
  const activeClass =
    tone === "accent"
      ? "bg-indigo-500 text-white shadow-lg shadow-indigo-500/40 ring-2 ring-indigo-300/60 hover:bg-indigo-400"
      : "bg-white text-zinc-900";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={active}
      title={label}
      className={`flex shrink-0 items-center justify-center rounded-full backdrop-blur transition active:scale-95 disabled:opacity-40 ${
        size === "sm" ? "size-12" : "size-14"
      } ${active ? activeClass : "bg-white/15 text-white hover:bg-white/25"}`}
    >
      {children}
    </button>
  );
}

/** Microphone / camera / speaker selection. */
export function DevicePicker({
  media,
  controller,
  video,
}: {
  media: MediaState;
  controller: CallController;
  video: boolean;
}) {
  const micId = useId();
  const cameraId = useId();
  const speakerId = useId();
  // Output selection needs setSinkId (Chromium; not Safari / most Firefox).
  const canPickSpeaker =
    typeof HTMLMediaElement !== "undefined" && "setSinkId" in HTMLMediaElement.prototype;
  const { microphones, speakers, cameras } = media.devices;
  const selectClass =
    "w-full rounded-lg bg-zinc-800 px-3 py-2 text-white outline-none focus:ring-2 focus:ring-indigo-400";

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8 }}
      className="mx-auto mb-4 w-full max-w-sm space-y-3 rounded-2xl bg-zinc-900/90 p-4 text-left text-sm text-white backdrop-blur"
    >
      <label htmlFor={micId} className="block space-y-1">
        <span className="text-white/60">Microphone</span>
        {microphones.length > 0 ? (
          <select
            id={micId}
            value={media.microphoneId ?? ""}
            onChange={(e) => void controller.setMicrophone(e.target.value)}
            className={selectClass}
          >
            {media.microphoneId === null && <option value="">Default</option>}
            {microphones.map((d, i) => (
              <option key={d.deviceId || i} value={d.deviceId}>
                {d.label || `Microphone ${i + 1}`}
              </option>
            ))}
          </select>
        ) : (
          <p className="text-white/50">No microphones detected.</p>
        )}
      </label>
      {video && (
        <label htmlFor={cameraId} className="block space-y-1">
          <span className="text-white/60">Camera</span>
          {cameras.length > 0 ? (
            <select
              id={cameraId}
              value={media.cameraId ?? ""}
              onChange={(e) => void controller.setCamera(e.target.value)}
              className={selectClass}
            >
              {!media.cameraId && <option value="">Default</option>}
              {cameras.map((d, i) => (
                <option key={d.deviceId || i} value={d.deviceId}>
                  {d.label || `Camera ${i + 1}`}
                </option>
              ))}
            </select>
          ) : (
            <p className="text-white/50">No cameras detected.</p>
          )}
        </label>
      )}
      {canPickSpeaker && speakers.length > 0 && (
        <label htmlFor={speakerId} className="block space-y-1">
          <span className="text-white/60">Speaker</span>
          <select
            id={speakerId}
            value={media.speakerId ?? "default"}
            onChange={(e) => void controller.setSpeaker(e.target.value)}
            className={selectClass}
          >
            {!speakers.some((d) => d.deviceId === "default") && <option value="default">Default</option>}
            {speakers.map((d, i) => (
              <option key={d.deviceId || i} value={d.deviceId}>
                {d.label || `Speaker ${i + 1}`}
              </option>
            ))}
          </select>
        </label>
      )}
    </motion.div>
  );
}
