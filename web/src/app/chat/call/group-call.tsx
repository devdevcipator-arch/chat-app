"use client";

import type { ICameraVideoTrack, IRemoteVideoTrack } from "agora-rtc-sdk-ng";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { Avatar } from "@/components/avatar";
import type { CallController, MediaState } from "@/lib/call/controller";
import { profileName } from "@/lib/chat";
import { DevicePicker, RoundButton, statusText, useCallClock, type GroupPhase } from "./call-ui";
import {
  ExpandIcon,
  MicIcon,
  MicOffIcon,
  MinimizeIcon,
  PhoneDownIcon,
  SettingsIcon,
  VideoIcon,
  VideoOffIcon,
} from "./icons";
import { VideoView } from "./video-view";

type Props = { call: GroupPhase; media: MediaState; controller: CallController };

type TileData = {
  /** Stable key: the user id, so tiles (and their video) survive re-layouts. */
  id: string;
  /** Name tag ("You" for me). */
  name: string;
  /** Name the avatar initials come from. */
  avatarName: string;
  isMe: boolean;
  muted: boolean;
  track: ICameraVideoTrack | IRemoteVideoTrack | null;
};

/** Me first, then everyone else in join order. */
function useTiles({ call, media, controller }: Props): TileData[] {
  const names = new Map(call.group.members.map((m) => [m.id, profileName(m)]));
  // media.videoVersion is bumped on every join / leave / track change, which
  // re-renders us to read the current participants.
  const remotes = controller.remoteParticipants.map(
    (p): TileData => ({
      id: p.uid,
      name: names.get(p.uid) ?? "Participant",
      avatarName: names.get(p.uid) ?? "Participant",
      isMe: false,
      muted: !p.audioOn,
      track: p.videoTrack,
    }),
  );
  const me: TileData = {
    id: controller.meId,
    name: "You",
    avatarName: names.get(controller.meId) ?? "You",
    isMe: true,
    muted: media.muted,
    track: media.cameraOn ? controller.localVideoTrack : null,
  };
  return [me, ...remotes];
}

/** 1 → full, 2 → split, 3–4 → 2×2, 5–9 → 3×3, more → 4 columns. */
function gridClass(count: number) {
  if (count <= 1) return "grid-cols-1";
  if (count === 2) return "grid-cols-1 sm:grid-cols-2";
  if (count <= 4) return "grid-cols-2";
  if (count <= 9) return "grid-cols-2 sm:grid-cols-3";
  return "grid-cols-3 lg:grid-cols-4";
}

function Tile({ tile, compact = false }: { tile: TileData; compact?: boolean }) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.94 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.94 }}
      transition={{ type: "spring", stiffness: 300, damping: 30 }}
      className="relative min-h-0 overflow-hidden rounded-2xl bg-zinc-900 ring-1 ring-white/10"
    >
      <AnimatePresence initial={false}>
        {tile.track ? (
          <motion.div key="video" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0">
            <VideoView track={tile.track} mirror={tile.isMe} className="size-full" />
          </motion.div>
        ) : (
          <motion.div
            key="avatar"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 flex items-center justify-center bg-gradient-to-b from-zinc-800 to-zinc-900"
          >
            <Avatar name={tile.avatarName} size={compact ? "md" : "lg"} />
          </motion.div>
        )}
      </AnimatePresence>
      <div className="absolute bottom-2 left-2 flex max-w-[calc(100%-1rem)] items-center gap-1.5 rounded-full bg-black/60 py-0.5 pr-2 pl-1.5 text-xs font-medium text-white backdrop-blur">
        {tile.muted ? (
          <span className="flex size-4 items-center justify-center rounded-full bg-red-600" title="Muted">
            <MicOffIcon className="size-3" />
          </span>
        ) : (
          <MicIcon className="size-3.5 text-white/80" />
        )}
        <span className="truncate">{tile.name}</span>
        <span className="sr-only">{tile.muted ? "(muted)" : ""}</span>
      </div>
    </motion.div>
  );
}

export function GroupCallScreen({ call, media, controller, onMinimize }: Props & { onMinimize: () => void }) {
  const tiles = useTiles({ call, media, controller });
  const clock = useCallClock(call);
  const [showDevices, setShowDevices] = useState(false);
  const video = call.callType === "video";
  const joining = call.status === "joining";
  const kind = video ? "Group video call" : "Group voice call";

  return (
    <motion.div
      role="dialog"
      aria-modal="true"
      aria-label={`${kind} in ${call.group.title}`}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="fixed inset-0 z-40 flex flex-col bg-zinc-950 text-white"
    >
      <div className="flex shrink-0 items-center gap-3 px-4 pt-4 pb-2">
        <Avatar name={call.group.title} group />
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{call.group.title}</p>
          <p
            aria-live="polite"
            className={`text-sm tabular-nums ${call.reconnecting ? "text-amber-300" : "text-white/60"}`}
          >
            {kind} · {tiles.length} in call · {statusText(call, clock)}
          </p>
        </div>
      </div>

      <AnimatePresence>
        {media.cameraError && (
          <motion.div
            role="alert"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="mx-4 overflow-hidden"
          >
            <div className="mb-2 flex items-start gap-2 rounded-xl bg-amber-500/90 px-3 py-2 text-sm text-amber-950">
              <span className="flex-1">{media.cameraError} You&apos;re in the call with audio.</span>
              <button type="button" onClick={controller.dismissCameraError} aria-label="Dismiss" className="px-1 opacity-70 hover:opacity-100">
                ✕
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Grid: tiles keep their key (user id), so joins and leaves re-flow
          the layout without restarting anyone's video. */}
      <div className={`grid min-h-0 flex-1 auto-rows-fr gap-2 p-2 md:gap-3 md:p-3 ${gridClass(tiles.length)}`}>
        <AnimatePresence mode="popLayout">
          {tiles.map((tile) => (
            <Tile key={tile.id} tile={tile} />
          ))}
        </AnimatePresence>
      </div>

      {tiles.length === 1 && !joining && (
        <p className="pointer-events-none absolute inset-x-0 top-1/2 text-center text-sm text-white/60">
          Waiting for others to join…
        </p>
      )}

      {media.autoplayBlocked && (
        <button
          type="button"
          onClick={controller.resumePlayback}
          className="absolute top-1/2 left-1/2 z-10 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/20 px-4 py-2 text-sm font-medium backdrop-blur hover:bg-white/30"
        >
          Tap to turn on call audio
        </button>
      )}

      <div className="shrink-0 px-4 pt-2 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        <AnimatePresence>
          {showDevices && <DevicePicker media={media} controller={controller} video={video} />}
        </AnimatePresence>
        <div className="flex items-center justify-center gap-3 md:gap-5">
          <RoundButton
            size="sm"
            label={media.muted ? "Unmute microphone" : "Mute microphone"}
            active={media.muted}
            disabled={joining && !call.call}
            onClick={() => void controller.toggleMute()}
          >
            {media.muted ? <MicOffIcon className="size-6" /> : <MicIcon className="size-6" />}
          </RoundButton>
          {video && (
            <RoundButton
              size="sm"
              label={media.cameraOn ? "Turn camera off" : "Turn camera on"}
              active={!media.cameraOn}
              disabled={media.cameraBusy}
              onClick={() => void controller.toggleCamera()}
            >
              {media.cameraOn ? <VideoIcon className="size-6" /> : <VideoOffIcon className="size-6" />}
            </RoundButton>
          )}
          <button
            type="button"
            onClick={controller.hangUp}
            aria-label="Leave call"
            title="Leave call"
            className="flex size-14 shrink-0 items-center justify-center rounded-full bg-red-600 shadow-lg shadow-red-600/30 transition hover:bg-red-500 active:scale-95 md:size-16"
          >
            <PhoneDownIcon className="size-7" />
          </button>
          <RoundButton
            size="sm"
            label="Audio and video settings"
            active={showDevices}
            onClick={() => setShowDevices((v) => !v)}
          >
            <SettingsIcon className="size-6" />
          </RoundButton>
          <RoundButton size="sm" label="Minimize (Esc)" active={false} onClick={onMinimize}>
            <MinimizeIcon className="size-6" />
          </RoundButton>
        </div>
      </div>
    </motion.div>
  );
}

/** Minimized group call: a compact bar with the room's status. */
export function GroupPill({ call, media, controller, onExpand }: Props & { onExpand: () => void }) {
  const tiles = useTiles({ call, media, controller });
  const clock = useCallClock(call);

  return (
    <motion.div
      role="region"
      aria-label={`Ongoing call in ${call.group.title}`}
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 24 }}
      className="fixed right-3 bottom-24 z-40 md:right-4 md:bottom-4"
    >
      <div className="flex items-center gap-2 rounded-full bg-zinc-900 py-1.5 pr-1.5 pl-3 text-white shadow-2xl shadow-black/30 ring-1 ring-white/10">
        <button type="button" onClick={onExpand} className="flex min-w-0 items-center gap-2" aria-label="Open call screen">
          <span
            className={`size-2 shrink-0 rounded-full ${
              call.status === "live" && !call.reconnecting ? "bg-emerald-400" : "animate-pulse bg-amber-400"
            }`}
            aria-hidden
          />
          <span className="max-w-32 truncate text-sm font-medium">{call.group.title}</span>
          <span className="text-sm text-white/60 tabular-nums" aria-live="polite">
            {tiles.length} · {statusText(call, clock)}
          </span>
          <ExpandIcon className="size-4 text-white/50" />
        </button>
        <button
          type="button"
          onClick={() => void controller.toggleMute()}
          aria-label={media.muted ? "Unmute microphone" : "Mute microphone"}
          aria-pressed={media.muted}
          className={`flex size-9 items-center justify-center rounded-full transition ${
            media.muted ? "bg-white text-zinc-900" : "bg-white/10 hover:bg-white/20"
          }`}
        >
          {media.muted ? <MicOffIcon className="size-4" /> : <MicIcon className="size-4" />}
        </button>
        <button
          type="button"
          onClick={controller.hangUp}
          aria-label="Leave call"
          className="flex size-9 items-center justify-center rounded-full bg-red-600 transition hover:bg-red-500"
        >
          <PhoneDownIcon className="size-4" />
        </button>
      </div>
    </motion.div>
  );
}
