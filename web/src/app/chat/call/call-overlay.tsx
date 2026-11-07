"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useId, useState } from "react";
import { Avatar } from "@/components/avatar";
import type { CallController, MediaState } from "@/lib/call/controller";
import type { CallPhase } from "@/lib/call/types";
import { profileName } from "@/lib/chat";
import { useCall } from "./call-provider";
import { ExpandIcon, MicIcon, MicOffIcon, MinimizeIcon, PhoneDownIcon, SettingsIcon } from "./icons";

type ShownPhase = Exclude<CallPhase, { phase: "idle" } | { phase: "incoming" }>;

/** Outgoing / connecting / active / ended call screen, minimizable to a pill. */
export function CallOverlay() {
  const { call, media, controller } = useCall();
  const [minimizedFor, setMinimizedFor] = useState<string | null>(null);

  const shown: ShownPhase | null = call.phase === "idle" || call.phase === "incoming" ? null : call;
  // Minimizing applies to one call; a new call opens full screen again.
  const callKey = shown ? ("call" in shown ? shown.call.id : `${shown.phase}:${shown.peer.id}`) : null;
  const minimized = !!callKey && minimizedFor === callKey;

  // Escape minimizes rather than hanging up.
  useEffect(() => {
    if (!callKey || minimized) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMinimizedFor(callKey);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [callKey, minimized]);

  return (
    <AnimatePresence>
      {shown && controller && !minimized && (
        <FullScreen
          key="full"
          call={shown}
          media={media}
          controller={controller}
          onMinimize={() => callKey && setMinimizedFor(callKey)}
        />
      )}
      {shown && controller && minimized && (
        <Pill key="pill" call={shown} media={media} controller={controller} onExpand={() => setMinimizedFor(null)} />
      )}
    </AnimatePresence>
  );
}

function statusText(call: ShownPhase, elapsed: string) {
  switch (call.phase) {
    case "starting":
      return "Starting…";
    case "outgoing":
      return "Ringing…";
    case "connecting":
      return "Connecting…";
    case "active":
      return call.reconnecting ? "Reconnecting…" : elapsed;
    case "ended":
      return call.message;
  }
}

function useElapsed(since: number | null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (since === null) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [since]);
  return since === null ? 0 : Math.max(0, now - since);
}

/** 83_000 → "01:23", 3_723_000 → "1:02:03". */
function formatDuration(ms: number) {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

type ViewProps = { call: ShownPhase; media: MediaState; controller: CallController };

function FullScreen({ call, media, controller, onMinimize }: ViewProps & { onMinimize: () => void }) {
  const elapsed = formatDuration(useElapsed(call.phase === "active" ? call.connectedAt : null));
  const name = profileName(call.peer);
  const ringing = call.phase === "starting" || call.phase === "outgoing";
  const live = call.phase === "connecting" || call.phase === "active";
  const ended = call.phase === "ended";
  const [showDevices, setShowDevices] = useState(false);

  return (
    <motion.div
      role="dialog"
      aria-modal="true"
      aria-label={`Voice call with ${name}`}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="fixed inset-0 z-40 flex flex-col bg-gradient-to-b from-zinc-900 via-zinc-950 to-black text-white"
    >
      <div className="flex h-16 shrink-0 items-center px-3">
        {!ended && (
          <button
            type="button"
            onClick={onMinimize}
            aria-label="Minimize call"
            title="Minimize (Esc)"
            className="rounded-full p-2.5 text-white/70 transition hover:bg-white/10 hover:text-white"
          >
            <MinimizeIcon />
          </button>
        )}
        <p className="flex-1 text-center text-xs font-medium tracking-wide text-white/50 uppercase">Voice call</p>
        <span className="w-10" />
      </div>

      <div className="flex flex-1 flex-col items-center justify-center gap-5 px-6 text-center">
        <div className="relative">
          {ringing && (
            <>
              <span className="absolute inset-0 animate-ping rounded-full bg-indigo-500/30" aria-hidden />
              <span className="absolute -inset-4 rounded-full border border-white/10" aria-hidden />
            </>
          )}
          {call.phase === "active" && !call.reconnecting && (
            <span className="absolute -inset-2 rounded-full border-2 border-emerald-400/60" aria-hidden />
          )}
          <Avatar name={name} size="xl" />
        </div>
        <div className="space-y-1.5">
          <h2 className="text-2xl font-semibold">{name}</h2>
          <p
            aria-live="polite"
            className={`text-base tabular-nums ${
              ended
                ? call.reason === "hangup"
                  ? "text-white/70"
                  : "text-red-300"
                : call.phase === "active" && call.reconnecting
                  ? "text-amber-300"
                  : "text-white/70"
            }`}
          >
            {statusText(call, elapsed)}
          </p>
          {media.muted && live && <p className="text-xs text-white/50">Your microphone is muted</p>}
        </div>

        {media.autoplayBlocked && live && (
          <button
            type="button"
            onClick={controller.resumePlayback}
            className="rounded-full bg-white/15 px-4 py-2 text-sm font-medium hover:bg-white/25"
          >
            Tap to turn on call audio
          </button>
        )}
      </div>

      <div className="relative shrink-0 px-6 pt-4 pb-[max(2.5rem,env(safe-area-inset-bottom))]">
        <AnimatePresence>
          {showDevices && !ended && <DevicePicker media={media} controller={controller} />}
        </AnimatePresence>

        <div className="flex items-center justify-center gap-6">
          {ended ? (
            <button
              type="button"
              onClick={controller.dismiss}
              className="rounded-full bg-white/15 px-6 py-3 text-sm font-medium transition hover:bg-white/25"
            >
              Close
            </button>
          ) : (
            <>
              <RoundButton
                label={media.muted ? "Unmute microphone" : "Mute microphone"}
                active={media.muted}
                disabled={call.phase === "starting"}
                onClick={() => void controller.toggleMute()}
              >
                {media.muted ? <MicOffIcon className="size-6" /> : <MicIcon className="size-6" />}
              </RoundButton>
              <button
                type="button"
                onClick={controller.hangUp}
                aria-label={live ? "End call" : "Cancel call"}
                title={live ? "End call" : "Cancel call"}
                className="flex size-16 items-center justify-center rounded-full bg-red-600 shadow-lg shadow-red-600/30 transition hover:bg-red-500 active:scale-95"
              >
                <PhoneDownIcon className="size-7" />
              </button>
              <RoundButton
                label="Audio settings"
                active={showDevices}
                disabled={call.phase === "starting"}
                onClick={() => setShowDevices((v) => !v)}
              >
                <SettingsIcon className="size-6" />
              </RoundButton>
            </>
          )}
        </div>
      </div>
    </motion.div>
  );
}

function RoundButton({
  label,
  active,
  disabled,
  onClick,
  children,
}: {
  label: string;
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={active}
      title={label}
      className={`flex size-14 items-center justify-center rounded-full transition active:scale-95 disabled:opacity-40 ${
        active ? "bg-white text-zinc-900" : "bg-white/15 text-white hover:bg-white/25"
      }`}
    >
      {children}
    </button>
  );
}

function DevicePicker({ media, controller }: { media: MediaState; controller: CallController }) {
  const micId = useId();
  const speakerId = useId();
  // Output selection needs setSinkId (Chromium; not Safari / most Firefox).
  const canPickSpeaker =
    typeof HTMLMediaElement !== "undefined" && "setSinkId" in HTMLMediaElement.prototype;
  const { microphones, speakers } = media.devices;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8 }}
      className="mx-auto mb-6 w-full max-w-sm space-y-3 rounded-2xl bg-white/10 p-4 text-left text-sm backdrop-blur"
    >
      <label htmlFor={micId} className="block space-y-1">
        <span className="text-white/60">Microphone</span>
        {microphones.length > 0 ? (
          <select
            id={micId}
            value={media.microphoneId ?? ""}
            onChange={(e) => void controller.setMicrophone(e.target.value)}
            className="w-full rounded-lg bg-zinc-800 px-3 py-2 text-white outline-none focus:ring-2 focus:ring-indigo-400"
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
      {canPickSpeaker && speakers.length > 0 && (
        <label htmlFor={speakerId} className="block space-y-1">
          <span className="text-white/60">Speaker</span>
          <select
            id={speakerId}
            value={media.speakerId ?? "default"}
            onChange={(e) => void controller.setSpeaker(e.target.value)}
            className="w-full rounded-lg bg-zinc-800 px-3 py-2 text-white outline-none focus:ring-2 focus:ring-indigo-400"
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

function Pill({ call, media, controller, onExpand }: ViewProps & { onExpand: () => void }) {
  const elapsed = formatDuration(useElapsed(call.phase === "active" ? call.connectedAt : null));
  const ended = call.phase === "ended";
  const live = call.phase === "connecting" || call.phase === "active";

  return (
    <motion.div
      role="region"
      aria-label="Ongoing call"
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 24 }}
      className="fixed right-3 bottom-24 z-40 md:right-4 md:bottom-4"
    >
      <div className="flex items-center gap-2 rounded-full bg-zinc-900 py-1.5 pr-1.5 pl-3 text-white shadow-2xl shadow-black/30 ring-1 ring-white/10">
        <button type="button" onClick={onExpand} className="flex min-w-0 items-center gap-2" aria-label="Open call screen">
          <span
            className={`size-2 shrink-0 rounded-full ${
              ended ? "bg-zinc-500" : call.phase === "active" && !call.reconnecting ? "bg-emerald-400" : "animate-pulse bg-amber-400"
            }`}
            aria-hidden
          />
          <span className="max-w-32 truncate text-sm font-medium">{profileName(call.peer)}</span>
          <span className="text-sm text-white/60 tabular-nums" aria-live="polite">
            {statusText(call, elapsed)}
          </span>
          <ExpandIcon className="size-4 text-white/50" />
        </button>
        {!ended && (
          <>
            <button
              type="button"
              onClick={() => void controller.toggleMute()}
              disabled={!live}
              aria-label={media.muted ? "Unmute microphone" : "Mute microphone"}
              aria-pressed={media.muted}
              className={`flex size-9 items-center justify-center rounded-full transition disabled:opacity-40 ${
                media.muted ? "bg-white text-zinc-900" : "bg-white/10 hover:bg-white/20"
              }`}
            >
              {media.muted ? <MicOffIcon className="size-4" /> : <MicIcon className="size-4" />}
            </button>
            <button
              type="button"
              onClick={controller.hangUp}
              aria-label="End call"
              className="flex size-9 items-center justify-center rounded-full bg-red-600 transition hover:bg-red-500"
            >
              <PhoneDownIcon className="size-4" />
            </button>
          </>
        )}
      </div>
    </motion.div>
  );
}
