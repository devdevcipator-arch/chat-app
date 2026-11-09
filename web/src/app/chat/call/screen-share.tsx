"use client";

import type { ILocalVideoTrack, IRemoteVideoTrack } from "agora-rtc-sdk-ng";
import { AnimatePresence, motion } from "motion/react";
import type { ReactNode } from "react";
import type { CallController, MediaState } from "@/lib/call/controller";
import { RoundButton } from "./call-ui";
import { ScreenShareIcon, ScreenShareOffIcon, VideoIcon, VideoOffIcon } from "./icons";
import { VideoView } from "./video-view";

// Screen sharing pieces shared by the 1-on-1 and group video screens.

/** "Share screen" / "Stop sharing". Hidden where browsers can't capture (mobile). */
export function ScreenShareButton({
  media,
  controller,
  disabled,
}: {
  media: MediaState;
  controller: CallController;
  disabled?: boolean;
}) {
  if (!media.screenShareSupported) return null;
  const sharing = media.screenSharing;
  return (
    <RoundButton
      size="sm"
      tone="accent"
      label={sharing ? "Stop sharing your screen" : "Share your screen"}
      active={sharing}
      disabled={disabled || media.screenBusy}
      onClick={() => void controller.toggleScreenShare()}
    >
      {sharing ? <ScreenShareOffIcon className="size-6" /> : <ScreenShareIcon className="size-6" />}
    </RoundButton>
  );
}

/**
 * Camera on/off. While sharing, the screen holds the video slot, so the
 * button instead chooses whether the camera comes back afterwards.
 */
export function CameraButton({
  media,
  controller,
  disabled,
}: {
  media: MediaState;
  controller: CallController;
  disabled?: boolean;
}) {
  const sharing = media.screenSharing;
  const on = sharing ? media.cameraResumesAfterShare : media.cameraOn;
  const label = sharing
    ? on
      ? "Camera returns after sharing (tap to keep it off)"
      : "Camera stays off after sharing (tap to bring it back)"
    : on
      ? "Turn camera off"
      : "Turn camera on";
  return (
    <RoundButton
      size="sm"
      label={label}
      active={!on}
      disabled={disabled || media.cameraBusy || media.screenBusy}
      onClick={() => void controller.toggleCamera()}
    >
      {on ? <VideoIcon className="size-6" /> : <VideoOffIcon className="size-6" />}
    </RoundButton>
  );
}

/** Someone else's shared screen: letterboxed (never cropped) with a name tag. */
export function RemoteScreenStage({ track, name }: { track: IRemoteVideoTrack; name: string }) {
  return (
    <div className="relative size-full bg-black">
      <VideoView track={track} fit="contain" className="size-full" />
      <ScreenLabel>{name}&apos;s screen</ScreenLabel>
    </div>
  );
}

/**
 * Our own share. A full-size preview of the screen you're sharing loops
 * forever (the "hall of mirrors"), so show a small preview and say so.
 */
export function PresentingStage({
  track,
  onStop,
  busy,
}: {
  track: ILocalVideoTrack | null;
  onStop: () => void;
  busy: boolean;
}) {
  return (
    <div className="flex size-full flex-col items-center justify-center gap-5 bg-gradient-to-b from-indigo-950 via-zinc-950 to-black px-6 text-center text-white">
      {track && (
        <div className="aspect-video w-full max-w-md overflow-hidden rounded-xl ring-1 ring-white/15 shadow-2xl">
          <VideoView track={track} fit="contain" className="size-full" />
        </div>
      )}
      <div className="space-y-1">
        <p className="flex items-center justify-center gap-2 text-lg font-semibold">
          <span className="relative flex size-2.5" aria-hidden>
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-indigo-400 opacity-75" />
            <span className="relative inline-flex size-2.5 rounded-full bg-indigo-400" />
          </span>
          You are sharing your screen
        </p>
        <p className="text-sm text-white/60">Everyone in the call can see it. Your microphone stays on as usual.</p>
      </div>
      <button
        type="button"
        onClick={onStop}
        disabled={busy}
        className="rounded-full bg-red-600 px-5 py-2.5 text-sm font-semibold shadow-lg shadow-red-600/30 transition hover:bg-red-500 disabled:opacity-60"
      >
        Stop sharing
      </button>
    </div>
  );
}

export function ScreenLabel({ children }: { children: ReactNode }) {
  return (
    <div className="absolute top-3 left-3 z-10 flex max-w-[calc(100%-1.5rem)] items-center gap-1.5 rounded-full bg-black/65 py-1 pr-3 pl-2 text-xs font-medium text-white backdrop-blur">
      <ScreenShareIcon className="size-3.5 shrink-0 text-indigo-300" />
      <span className="truncate">{children}</span>
    </div>
  );
}

/** Screen-share problems never end the call: say so. */
export function ScreenShareNotice({ media, controller, className = "" }: { media: MediaState; controller: CallController; className?: string }) {
  return (
    <AnimatePresence>
      {media.screenError && (
        <motion.div
          role="alert"
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          className={`flex items-start gap-2 rounded-xl bg-amber-500/90 px-3 py-2 text-sm text-amber-950 shadow-lg ${className}`}
        >
          <span className="flex-1">{media.screenError}</span>
          <button type="button" onClick={controller.dismissScreenError} aria-label="Dismiss" className="px-1 opacity-70 hover:opacity-100">
            ✕
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
