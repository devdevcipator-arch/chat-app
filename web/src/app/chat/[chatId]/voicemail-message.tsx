"use client";

import { useMemo } from "react";
import { VoicemailPlayer, waveformFromSeed } from "@/components/voicemail-player";
import { formatDuration, formatMessageTime } from "@/lib/chat";

// A voicemail in the chat feed: badge, time and length up top, the custom
// player below. Recipients see a blue dot until they first press play;
// senders see whether it has been played yet.

export function VoicemailMessage({
  id,
  src,
  durationSeconds,
  createdAt,
  playedAt,
  mine,
  sending,
  onPlayed,
}: {
  id: string;
  src: string | null;
  durationSeconds: number;
  createdAt: string;
  playedAt: string | null;
  mine: boolean;
  sending: boolean;
  onPlayed: () => void;
}) {
  const bars = useMemo(() => waveformFromSeed(id), [id]);
  const unplayed = !mine && !playedAt;

  return (
    <div
      className={`w-72 max-w-[75vw] rounded-2xl px-3 pt-2.5 pb-2 ${
        mine
          ? "rounded-br-md bg-indigo-600 text-white"
          : "rounded-bl-md bg-zinc-100 text-zinc-900 ring-1 ring-indigo-500/10 dark:bg-zinc-800 dark:text-zinc-100"
      } ${sending ? "opacity-70" : ""}`}
    >
      <div className="mb-1.5 flex items-center gap-2 text-[11px]">
        <span
          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-semibold ${
            mine ? "bg-white/15 text-white" : "bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300"
          }`}
        >
          <span aria-hidden>🎙️</span> Voicemail
        </span>
        <span className={`tabular-nums ${mine ? "text-indigo-100" : "text-zinc-500"}`}>
          {formatDuration(durationSeconds)}
        </span>
        <span className="flex-1" />
        <time
          suppressHydrationWarning
          dateTime={createdAt}
          className={mine ? "text-indigo-100" : "text-zinc-500"}
        >
          {formatMessageTime(createdAt)}
        </time>
        {unplayed && (
          <span className="relative flex size-2.5" title="New voicemail">
            <span className="absolute inset-0 animate-ping rounded-full bg-sky-400/60" aria-hidden />
            <span className="relative size-2.5 rounded-full bg-sky-500" />
            <span className="sr-only">Not played yet</span>
          </span>
        )}
      </div>

      {src ? (
        <VoicemailPlayer
          key={src}
          src={src}
          durationSeconds={durationSeconds}
          bars={bars}
          tone={mine ? "accent" : "neutral"}
          onFirstPlay={unplayed ? onPlayed : undefined}
        />
      ) : (
        <p className={`py-2 text-xs ${mine ? "text-indigo-100" : "text-zinc-500"}`}>Recording unavailable</p>
      )}

      {mine && !sending && (
        <p className="mt-0.5 text-right text-[10px] text-indigo-100/80">{playedAt ? "Played" : "Not played yet"}</p>
      )}
    </div>
  );
}
