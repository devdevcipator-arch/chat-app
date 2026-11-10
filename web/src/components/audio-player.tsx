"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { formatDuration } from "@/lib/chat";

// Custom audio player for voice notes and voicemails: play/pause, a seekable
// waveform with elapsed / total time, and a 1x / 1.5x / 2x speed toggle.
// Used in chat bubbles and the voicemail recorder preview.
// Give it `key={src}` where the source can change, so playback state resets.

const SPEEDS = [1, 1.5, 2] as const;
const BAR_COUNT = 40;

/** Deterministic pseudo-waveform from a seed (the message id), 0.15–1 each. */
export function waveformFromSeed(seed: string, count = BAR_COUNT): number[] {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  const bars: number[] = [];
  for (let i = 0; i < count; i++) {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    const r = ((h ^= h >>> 16) >>> 0) / 4294967296;
    // Soft envelope so it reads like speech rather than noise.
    const envelope = 0.55 + 0.45 * Math.sin((Math.PI * (i + 0.5)) / count);
    bars.push(Math.max(0.15, Math.min(1, (0.25 + r * 0.75) * envelope)));
  }
  return bars;
}

/** Resamples measured levels to `count` bars, normalised to 0.15–1. */
export function normaliseLevels(levels: number[], count = BAR_COUNT): number[] {
  if (levels.length === 0) return waveformFromSeed("empty", count);
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    const from = Math.floor((i * levels.length) / count);
    const to = Math.max(from + 1, Math.floor(((i + 1) * levels.length) / count));
    let peak = 0;
    for (let j = from; j < to; j++) peak = Math.max(peak, levels[j] ?? 0);
    out.push(peak);
  }
  const max = Math.max(...out, 0.01);
  return out.map((v) => Math.max(0.15, v / max));
}

export function AudioPlayer({
  src,
  durationSeconds,
  bars,
  tone,
  label = "voice message",
  onFirstPlay,
}: {
  src: string;
  /**
   * Known length; browsers often report Infinity for fresh WebM recordings.
   * Null (e.g. an uploaded file) waits for the file's metadata.
   */
  durationSeconds: number | null;
  bars: number[];
  /** "accent" on an indigo bubble, "neutral" on a grey one, "dark" in the call UI. */
  tone: "accent" | "neutral" | "dark";
  /** For screen readers: "Play voicemail", "Seek voice message"... */
  label?: string;
  onFirstPlay?: () => void;
}) {
  const audio = useRef<HTMLAudioElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const firstPlayFired = useRef(false);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [mediaDuration, setMediaDuration] = useState<number | null>(null);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1);
  const [failed, setFailed] = useState(false);

  const duration = mediaDuration ?? durationSeconds ?? 0;
  const fraction = duration > 0 ? Math.min(1, current / duration) : 0;

  useEffect(() => {
    if (audio.current) audio.current.playbackRate = speed;
  }, [speed]);

  const toggle = useCallback(async () => {
    const el = audio.current;
    if (!el) return;
    if (!el.paused) {
      el.pause();
      return;
    }
    // Only one recording plays at a time.
    document.querySelectorAll<HTMLAudioElement>("audio[data-player]").forEach((other) => {
      if (other !== el) other.pause();
    });
    try {
      el.playbackRate = speed;
      await el.play();
      if (!firstPlayFired.current) {
        firstPlayFired.current = true;
        onFirstPlay?.();
      }
    } catch {
      setFailed(true);
    }
  }, [speed, onFirstPlay]);

  const seekTo = useCallback(
    (ratio: number) => {
      const el = audio.current;
      if (!el || !(duration > 0)) return;
      const t = Math.max(0, Math.min(1, ratio)) * duration;
      el.currentTime = t;
      setCurrent(t);
    },
    [duration],
  );

  const ratioAt = (clientX: number) => {
    const rect = track.current?.getBoundingClientRect();
    return rect && rect.width > 0 ? (clientX - rect.left) / rect.width : 0;
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    seekTo(ratioAt(e.clientX));
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) seekTo(ratioAt(e.clientX));
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = duration > 0 ? 5 / duration : 0;
    if (e.key === "ArrowRight") seekTo(fraction + step);
    else if (e.key === "ArrowLeft") seekTo(fraction - step);
    else if (e.key === "Home") seekTo(0);
    else if (e.key === "End") seekTo(1);
    else if (e.key === " " || e.key === "Enter") void toggle();
    else return;
    e.preventDefault();
  };

  const colors = useMemo(() => {
    switch (tone) {
      case "accent":
        return {
          button: "bg-white text-indigo-600 hover:bg-indigo-50",
          played: "bg-white",
          rest: "bg-white/40",
          text: "text-indigo-100",
          chip: "bg-white/15 text-white hover:bg-white/25",
        };
      case "dark":
        return {
          button: "bg-white text-zinc-900 hover:bg-zinc-200",
          played: "bg-indigo-400",
          rest: "bg-white/25",
          text: "text-white/60",
          chip: "bg-white/10 text-white hover:bg-white/20",
        };
      default:
        return {
          button: "bg-indigo-600 text-white hover:bg-indigo-500",
          played: "bg-indigo-600 dark:bg-indigo-400",
          rest: "bg-zinc-300 dark:bg-zinc-600",
          text: "text-zinc-500",
          chip: "bg-zinc-200 text-zinc-700 hover:bg-zinc-300 dark:bg-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-600",
        };
    }
  }, [tone]);

  return (
    <div className="flex w-full items-center gap-2.5">
      <audio
        ref={audio}
        data-player
        src={src}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setCurrent(0);
        }}
        onTimeUpdate={(e) => setCurrent(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => {
          const d = e.currentTarget.duration;
          if (Number.isFinite(d) && d > 0) setMediaDuration(d);
        }}
        onError={() => setFailed(true)}
        className="hidden"
      />

      <button
        type="button"
        onClick={() => void toggle()}
        disabled={failed}
        aria-label={playing ? `Pause ${label}` : `Play ${label}`}
        className={`flex size-10 shrink-0 items-center justify-center rounded-full shadow-sm transition active:scale-95 disabled:opacity-40 ${colors.button}`}
      >
        {playing ? (
          <svg viewBox="0 0 24 24" fill="currentColor" className="size-4" aria-hidden>
            <rect x="6" y="5" width="4" height="14" rx="1" />
            <rect x="14" y="5" width="4" height="14" rx="1" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" fill="currentColor" className="ml-0.5 size-4" aria-hidden>
            <path d="M7 5.5v13a1 1 0 0 0 1.5.86l10.6-6.5a1 1 0 0 0 0-1.72L8.5 4.64A1 1 0 0 0 7 5.5z" />
          </svg>
        )}
      </button>

      <div className="min-w-0 flex-1">
        <div
          ref={track}
          role="slider"
          tabIndex={0}
          aria-label={`Seek ${label}`}
          aria-valuemin={0}
          aria-valuemax={Math.round(duration)}
          aria-valuenow={Math.round(current)}
          aria-valuetext={`${formatDuration(current)} of ${formatDuration(duration)}`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onKeyDown={onKeyDown}
          className="flex h-8 cursor-pointer touch-none items-center gap-[2px] rounded outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
        >
          {bars.map((h, i) => (
            <span
              key={i}
              aria-hidden
              style={{ height: `${Math.round(h * 100)}%` }}
              className={`min-h-[3px] flex-1 rounded-full transition-colors duration-150 ${
                (i + 0.5) / bars.length <= fraction ? colors.played : colors.rest
              }`}
            />
          ))}
        </div>
        <div className={`mt-0.5 flex items-center justify-between text-[11px] tabular-nums ${colors.text}`}>
          {failed ? (
            <span>Can&apos;t play this recording</span>
          ) : (
            <>
              <span>{formatDuration(current)}</span>
              <span>{duration > 0 ? formatDuration(duration) : "--:--"}</span>
            </>
          )}
        </div>
      </div>

      <button
        type="button"
        onClick={() => setSpeed((s) => SPEEDS[(SPEEDS.indexOf(s) + 1) % SPEEDS.length])}
        aria-label={`Playback speed ${speed}x`}
        title="Playback speed"
        className={`shrink-0 rounded-full px-2 py-1 text-[11px] font-semibold tabular-nums transition ${colors.chip}`}
      >
        {speed}x
      </button>
    </div>
  );
}
