"use client";

import type { ILocalVideoTrack, IRemoteVideoTrack } from "agora-rtc-sdk-ng";
import { AnimatePresence, motion } from "motion/react";
import { useRef, useState } from "react";
import { Avatar } from "@/components/avatar";
import type { CallController, MediaState } from "@/lib/call/controller";
import { profileName } from "@/lib/chat";
import { DevicePicker, RoundButton, statusText, useCallClock, type DirectPhase } from "./call-ui";
import {
  ExpandIcon,
  FlipIcon,
  MicIcon,
  MicOffIcon,
  MinimizeIcon,
  PhoneDownIcon,
  SettingsIcon,
} from "./icons";
import { CameraButton, PresentingStage, RemoteScreenStage, ScreenShareButton, ScreenShareNotice } from "./screen-share";
import { VideoView } from "./video-view";

type Props = { call: DirectPhase; media: MediaState; controller: CallController };

/** The tracks to show right now (null = show the avatar fallback). */
function useTracks(call: DirectPhase, media: MediaState, controller: CallController) {
  // media.cameraOn / remoteVideoOn / videoVersion change whenever a track
  // appears or goes away, which re-renders us to pick up the new track.
  const remote = media.remoteVideoOn ? controller.remoteVideoTrack : null;
  return {
    local: media.cameraOn ? controller.localVideoTrack : null,
    remote,
    /** Their video is a shared screen (their camera is paused meanwhile). */
    remoteIsScreen: !!remote && media.remoteScreenUids.includes(call.peer.id),
    screen: media.screenSharing ? controller.localScreenTrack : null,
  };
}

function remoteFallbackLabel(call: DirectPhase) {
  switch (call.phase) {
    case "starting":
      return "Starting…";
    case "outgoing":
      return "Ringing…";
    case "connecting":
      return "Connecting…";
    case "active":
      return call.reconnecting ? "Reconnecting…" : "Camera off";
    case "ended":
      return call.message;
  }
}

/** Video, or the person's avatar and name when there's no video. */
function Tile({
  track,
  mirror,
  name,
  label,
  compact,
  fit,
}: {
  track: ILocalVideoTrack | IRemoteVideoTrack | null;
  mirror?: boolean;
  name: string;
  label: string;
  compact?: boolean;
  /** "contain" for screens, so nothing gets cropped. */
  fit?: "cover" | "contain";
}) {
  return (
    <div className="relative size-full bg-zinc-900">
      <AnimatePresence initial={false}>
        {track ? (
          <motion.div
            key="video"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0"
          >
            <VideoView track={track} mirror={mirror} fit={fit} className="size-full" />
          </motion.div>
        ) : (
          <motion.div
            key="avatar"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-gradient-to-b from-zinc-800 to-zinc-950 text-center text-white"
          >
            <Avatar name={name} size={compact ? "md" : "xl"} />
            {compact ? (
              <p className="px-2 text-[11px] text-white/70">{label}</p>
            ) : (
              <>
                <p className="mt-2 text-xl font-semibold">{name}</p>
                <p className="text-sm text-white/60">{label}</p>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function VideoCallScreen({ call, media, controller, onMinimize }: Props & { onMinimize: () => void }) {
  const stage = useRef<HTMLDivElement>(null);
  const [swapped, setSwapped] = useState(false);
  const [showDevices, setShowDevices] = useState(false);
  const clock = useCallClock(call);
  const { local, remote, remoteIsScreen, screen } = useTracks(call, media, controller);
  const name = profileName(call.peer);
  const live = call.phase === "connecting" || call.phase === "active";
  // Whoever shares takes the main view; the other camera sits in the PiP.
  const sharingView = media.screenSharing || remoteIsScreen;

  const remoteTile = { track: remoteIsScreen ? null : remote, name, label: remoteIsScreen ? "Sharing their screen" : remoteFallbackLabel(call) };
  const localTile = {
    track: local,
    mirror: true,
    name: "You",
    label: media.screenSharing
      ? "Sharing your screen"
      : media.cameraError
        ? "Camera unavailable"
        : media.cameraBusy
          ? "Starting camera…"
          : "Camera off",
  };
  const main = swapped ? localTile : remoteTile;
  const pip = sharingView ? (remoteIsScreen ? localTile : remoteTile) : swapped ? remoteTile : localTile;
  const flip = () => {
    if (!sharingView) setSwapped((v) => !v);
  };

  return (
    <motion.div
      ref={stage}
      role="dialog"
      aria-modal="true"
      aria-label={`Video call with ${name}`}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="fixed inset-0 z-40 overflow-hidden bg-black text-white"
    >
      {/* Main view: a shared screen when someone presents, else a camera. */}
      <div className="absolute inset-0">
        {remoteIsScreen && remote ? (
          <div className="absolute inset-0 pt-20 pb-28">
            <RemoteScreenStage track={remote} name={name} />
          </div>
        ) : media.screenSharing ? (
          <PresentingStage track={screen} busy={media.screenBusy} onStop={() => void controller.toggleScreenShare()} />
        ) : (
          <Tile {...main} />
        )}
      </div>

      {/* Top bar */}
      <div className="absolute inset-x-0 top-0 z-10 bg-gradient-to-b from-black/70 to-transparent px-4 pt-4 pb-10">
        <p className="truncate text-lg font-semibold">{name}</p>
        <p
          aria-live="polite"
          className={`text-sm tabular-nums ${
            call.phase === "active" && call.reconnecting ? "text-amber-300" : "text-white/70"
          }`}
        >
          {statusText(call, clock)}
          {media.muted && live && " · Mic muted"}
          {media.screenSharing && " · You're sharing your screen"}
        </p>
      </div>

      {/* Camera problems never end the call: say so, and offer a retry. */}
      <AnimatePresence>
        {media.cameraError && (
          <motion.div
            role="alert"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="absolute inset-x-4 top-20 z-20 mx-auto flex max-w-md items-start gap-2 rounded-xl bg-amber-500/90 px-3 py-2 text-sm text-amber-950 shadow-lg md:right-auto md:left-1/2 md:-translate-x-1/2"
          >
            <span className="flex-1">{media.cameraError} The call continues{media.screenSharing ? "" : " with audio"}.</span>
            <button
              type="button"
              onClick={controller.dismissCameraError}
              aria-label="Dismiss"
              className="px-1 opacity-70 hover:opacity-100"
            >
              ✕
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <ScreenShareNotice
        media={media}
        controller={controller}
        className="absolute inset-x-4 top-36 z-20 mx-auto max-w-md md:right-auto md:left-1/2 md:w-[28rem] md:-translate-x-1/2"
      />

      {/* Picture-in-picture: drag it anywhere; tap to swap with the main view
          (while someone shares, the screen always stays in the main view). */}
      <motion.div
        drag
        dragConstraints={stage}
        dragMomentum={false}
        dragElastic={0.08}
        onTap={flip}
        role="button"
        tabIndex={0}
        aria-label={
          sharingView
            ? `${pip.name === "You" ? "Your" : `${name}'s`} camera`
            : swapped
              ? "Show the other person full screen"
              : "Show yourself full screen"
        }
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            flip();
          }
        }}
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        className="absolute top-24 right-4 z-10 h-44 w-28 cursor-grab touch-none overflow-hidden rounded-2xl shadow-2xl ring-1 ring-white/20 outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 active:cursor-grabbing md:top-20 md:h-36 md:w-60"
      >
        <Tile {...pip} compact />
      </motion.div>

      {media.autoplayBlocked && live && (
        <button
          type="button"
          onClick={controller.resumePlayback}
          className="absolute top-1/2 left-1/2 z-20 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/20 px-4 py-2 text-sm font-medium backdrop-blur hover:bg-white/30"
        >
          Tap to turn on call audio
        </button>
      )}

      {/* Controls */}
      <div className="absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/80 to-transparent px-4 pt-12 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        <AnimatePresence>
          {showDevices && <DevicePicker media={media} controller={controller} video />}
        </AnimatePresence>
        <div className="flex items-center justify-center gap-3 md:gap-5">
          <RoundButton
            size="sm"
            label={media.muted ? "Unmute microphone" : "Mute microphone"}
            active={media.muted}
            disabled={call.phase === "starting"}
            onClick={() => void controller.toggleMute()}
          >
            {media.muted ? <MicOffIcon className="size-6" /> : <MicIcon className="size-6" />}
          </RoundButton>
          <CameraButton media={media} controller={controller} disabled={call.phase === "starting"} />
          <ScreenShareButton media={media} controller={controller} disabled={!live} />
          <button
            type="button"
            onClick={controller.hangUp}
            aria-label={live ? "End call" : "Cancel call"}
            title={live ? "End call" : "Cancel call"}
            className="flex size-14 shrink-0 items-center justify-center rounded-full bg-red-600 shadow-lg shadow-red-600/30 transition hover:bg-red-500 active:scale-95 md:size-16"
          >
            <PhoneDownIcon className="size-7" />
          </button>
          <RoundButton
            size="sm"
            label="Camera, microphone and speaker settings"
            active={showDevices}
            disabled={call.phase === "starting"}
            onClick={() => setShowDevices((v) => !v)}
          >
            <SettingsIcon className="size-6" />
          </RoundButton>
          {!sharingView && (
            <RoundButton size="sm" label="Swap videos" active={swapped} onClick={flip}>
              <FlipIcon className="size-6" />
            </RoundButton>
          )}
          <RoundButton size="sm" label="Minimize to a floating window (Esc)" active={false} onClick={onMinimize}>
            <MinimizeIcon className="size-6" />
          </RoundButton>
        </div>
      </div>
    </motion.div>
  );
}

/** Minimized video call: a small draggable window over the app. */
export function VideoPill({ call, media, controller, onExpand }: Props & { onExpand: () => void }) {
  const bounds = useRef<HTMLDivElement>(null);
  const clock = useCallClock(call);
  const { remote, remoteIsScreen } = useTracks(call, media, controller);
  const name = profileName(call.peer);
  const live = call.phase === "connecting" || call.phase === "active";

  return (
    <motion.div
      ref={bounds}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="pointer-events-none fixed inset-3 z-40"
    >
      <motion.div
        drag
        dragConstraints={bounds}
        dragMomentum={false}
        dragElastic={0.08}
        role="region"
        aria-label={`Video call with ${name}`}
        className="pointer-events-auto absolute right-0 bottom-20 w-56 cursor-grab touch-none overflow-hidden rounded-xl bg-zinc-900 text-white shadow-2xl ring-1 ring-white/10 active:cursor-grabbing md:bottom-0 md:w-72"
      >
        <div className="aspect-video">
          <Tile track={remote} name={name} label={remoteFallbackLabel(call)} compact fit={remoteIsScreen ? "contain" : "cover"} />
        </div>
        <div className="flex items-center gap-1.5 bg-zinc-950/90 px-2 py-1.5">
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-medium">
              {remoteIsScreen ? `${name}'s screen` : media.screenSharing ? `${name} · You're sharing` : name}
            </p>
            <p className="text-[11px] text-white/60 tabular-nums">{statusText(call, clock)}</p>
          </div>
          <button
            type="button"
            onClick={() => void controller.toggleMute()}
            disabled={!live}
            aria-label={media.muted ? "Unmute microphone" : "Mute microphone"}
            aria-pressed={media.muted}
            className={`flex size-8 items-center justify-center rounded-full transition disabled:opacity-40 ${
              media.muted ? "bg-white text-zinc-900" : "bg-white/10 hover:bg-white/20"
            }`}
          >
            {media.muted ? <MicOffIcon className="size-4" /> : <MicIcon className="size-4" />}
          </button>
          <button
            type="button"
            onClick={onExpand}
            aria-label="Open call screen"
            className="flex size-8 items-center justify-center rounded-full bg-white/10 hover:bg-white/20"
          >
            <ExpandIcon className="size-4" />
          </button>
          <button
            type="button"
            onClick={controller.hangUp}
            aria-label="End call"
            className="flex size-8 items-center justify-center rounded-full bg-red-600 hover:bg-red-500"
          >
            <PhoneDownIcon className="size-4" />
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
