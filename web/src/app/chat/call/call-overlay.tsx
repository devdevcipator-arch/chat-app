"use client";

import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useState } from "react";
import { Avatar } from "@/components/avatar";
import type { CallController, MediaState } from "@/lib/call/controller";
import type { CallPeer } from "@/lib/call/types";
import { profileName } from "@/lib/chat";
import {
  DevicePicker,
  RoundButton,
  phaseCallType,
  statusText,
  useCallClock,
  type DirectPhase,
  type ShownPhase,
} from "./call-ui";
import { useCall } from "./call-provider";
import { GroupCallScreen, GroupPill } from "./group-call";
import { ExpandIcon, MicIcon, MicOffIcon, MinimizeIcon, PhoneDownIcon, PhoneIcon, SettingsIcon } from "./icons";
import { VideoCallScreen, VideoPill } from "./video-call";
import { VoicemailRecorder } from "./voicemail-recorder";

/** Who we are leaving a voicemail for, and the call it follows. */
type VoicemailTarget = { peer: CallPeer; callId: string | null };

/** The call screen (1-on-1 voice/video or a group room), plus the voicemail recorder. */
export function CallOverlay() {
  const { controller } = useCall();
  const [voicemail, setVoicemail] = useState<VoicemailTarget | null>(null);
  const closeVoicemail = useCallback(() => setVoicemail(null), []);

  const recordVoicemail = useCallback(
    (target: VoicemailTarget) => {
      setVoicemail(target);
      controller?.dismiss(); // the call screen gives way to the recorder
    },
    [controller],
  );

  return (
    <>
      <CallScreens onRecordVoicemail={recordVoicemail} />
      <AnimatePresence>
        {voicemail && controller && (
          <VoicemailRecorder
            key="voicemail"
            peer={voicemail.peer}
            callId={voicemail.callId}
            meId={controller.meId}
            onClose={closeVoicemail}
          />
        )}
      </AnimatePresence>
    </>
  );
}

/** The call screen (1-on-1 voice/video or a group room), minimizable. */
function CallScreens({ onRecordVoicemail }: { onRecordVoicemail: (target: VoicemailTarget) => void }) {
  const { call, media, controller } = useCall();
  const [minimizedFor, setMinimizedFor] = useState<string | null>(null);

  const shown: ShownPhase | null = call.phase === "idle" || call.phase === "incoming" ? null : call;
  // Minimizing applies to one call; a new call opens full screen again.
  const callKey = !shown
    ? null
    : shown.phase === "group"
      ? `group:${shown.group.chatId}`
      : "call" in shown
        ? shown.call.id
        : `${shown.phase}:${shown.peer.id}`;
  const minimized = !!callKey && minimizedFor === callKey;
  // The "call ended" card is the same for every kind of call.
  const video = !!shown && shown.phase !== "ended" && phaseCallType(shown) === "video";
  const minimize = () => callKey && setMinimizedFor(callKey);
  const expand = () => setMinimizedFor(null);

  // Escape minimizes rather than hanging up (and closes the voicemail offer).
  const offering = shown?.phase === "ended" && !!shown.voicemail;
  useEffect(() => {
    if (!callKey || minimized) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (offering) controller?.dismiss();
      else setMinimizedFor(callKey);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [callKey, minimized, offering, controller]);

  if (!shown || !controller) return <AnimatePresence />;

  if (shown.phase === "group") {
    const props = { call: shown, media, controller };
    return (
      <AnimatePresence>
        {minimized ? (
          <GroupPill key="group-pill" {...props} onExpand={expand} />
        ) : (
          <GroupCallScreen key="group-full" {...props} onMinimize={minimize} />
        )}
      </AnimatePresence>
    );
  }

  const props = { call: shown, media, controller };
  return (
    <AnimatePresence>
      {!minimized &&
        (video ? (
          <VideoCallScreen key="video-full" {...props} onMinimize={minimize} />
        ) : (
          <FullScreen key="full" {...props} onMinimize={minimize} onRecordVoicemail={onRecordVoicemail} />
        ))}
      {minimized &&
        (video ? (
          <VideoPill key="video-pill" {...props} onExpand={expand} />
        ) : (
          <Pill key="pill" {...props} onExpand={expand} />
        ))}
    </AnimatePresence>
  );
}

type ViewProps = { call: DirectPhase; media: MediaState; controller: CallController };

function FullScreen({
  call,
  media,
  controller,
  onMinimize,
  onRecordVoicemail,
}: ViewProps & { onMinimize: () => void; onRecordVoicemail: (target: VoicemailTarget) => void }) {
  if (call.phase === "ended" && call.voicemail) {
    const { voicemail } = call;
    return (
      <Unavailable
        call={call}
        controller={controller}
        onRecordVoicemail={() => onRecordVoicemail({ peer: call.peer, callId: voicemail.callId })}
      />
    );
  }
  return <CallScreen call={call} media={media} controller={controller} onMinimize={onMinimize} />;
}

type EndedPhase = Extract<DirectPhase, { phase: "ended" }>;

/** After an unanswered outgoing call: leave a voicemail, call again, or close. */
function Unavailable({
  call,
  controller,
  onRecordVoicemail,
}: {
  call: EndedPhase;
  controller: CallController;
  onRecordVoicemail: () => void;
}) {
  const name = profileName(call.peer);
  return (
    <motion.div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="unavailable-title"
      aria-describedby="unavailable-subtitle"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="fixed inset-0 z-40 flex flex-col bg-gradient-to-b from-zinc-900 via-zinc-950 to-black text-white"
    >
      <div className="flex h-16 shrink-0 items-center justify-center px-3">
        <p className="text-xs font-medium tracking-wide text-white/50 uppercase">
          {call.callType === "video" ? "Video call" : "Voice call"}
        </p>
      </div>

      <div className="flex flex-1 flex-col items-center justify-center gap-5 px-6 text-center">
        <div className="relative">
          <span className="absolute -inset-3 rounded-full border border-white/10" aria-hidden />
          <Avatar name={name} size="xl" />
        </div>
        <div className="space-y-2">
          <h2 id="unavailable-title" className="text-2xl font-semibold">
            {name} is unavailable
          </h2>
          <p className="text-sm text-red-300" aria-live="polite">
            {call.message}
          </p>
          <p id="unavailable-subtitle" className="text-base text-white/70">
            Would you like to leave a voicemail or call back?
          </p>
        </div>
      </div>

      <div className="shrink-0 px-6 pt-4 pb-[max(2.5rem,env(safe-area-inset-bottom))]">
        <div className="mx-auto flex max-w-md flex-col gap-3 sm:flex-row-reverse">
          <button
            type="button"
            onClick={onRecordVoicemail}
            autoFocus
            className="flex flex-1 items-center justify-center gap-2 rounded-full bg-indigo-600 px-5 py-3 text-sm font-semibold shadow-lg shadow-indigo-600/30 transition hover:bg-indigo-500 active:scale-[0.98]"
          >
            <MicIcon className="size-5" />
            Record Voicemail
          </button>
          <button
            type="button"
            onClick={controller.callAgain}
            className="flex flex-1 items-center justify-center gap-2 rounded-full bg-emerald-600 px-5 py-3 text-sm font-semibold transition hover:bg-emerald-500 active:scale-[0.98]"
          >
            <PhoneIcon className="size-5" />
            Call Again
          </button>
          <button
            type="button"
            onClick={controller.dismiss}
            className="flex-1 rounded-full bg-white/15 px-5 py-3 text-sm font-medium transition hover:bg-white/25"
          >
            Close
          </button>
        </div>
      </div>
    </motion.div>
  );
}

function CallScreen({ call, media, controller, onMinimize }: ViewProps & { onMinimize: () => void }) {
  const elapsed = useCallClock(call);
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
          <Avatar name={name} size="xl" group={call.phase === "ended" && call.group} />
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
          {showDevices && !ended && <DevicePicker media={media} controller={controller} video={false} />}
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

function Pill({ call, media, controller, onExpand }: ViewProps & { onExpand: () => void }) {
  const elapsed = useCallClock(call);
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
