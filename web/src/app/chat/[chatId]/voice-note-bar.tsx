"use client";

import { motion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { AudioRecorder, RecorderError, type RecordedAudio } from "@/lib/audio-recorder";
import { formatDuration } from "@/lib/chat";

// The composer in "recording mode": trash on the left, then a red pulsing
// dot, pause/resume, timer and live level meter, and send on the right.
// Recording starts on mount; leaving (cancel, send, unmount, Escape)
// releases the mic. While paused the clock and the meter freeze; sending
// while paused sends everything recorded so far.

export const VOICE_NOTE_MAX_SECONDS = 300; // keep in sync with the DB check
const MIN_SECONDS = 1;
const METER_BARS = 28;
const CLOCK_MS = 200;

export function VoiceNoteBar({
  onSend,
  onClose,
  onNotice,
}: {
  onSend: (audio: RecordedAudio) => void;
  /** Leave recording mode (after cancel, send or an error). */
  onClose: () => void;
  /** Non-blocking message for the user (permission denied, too short...). */
  onNotice: (message: string) => void;
}) {
  const recorder = useRef<AudioRecorder | null>(null);
  const finished = useRef(false);
  const clock = useRef<number | null>(null);
  const [ready, setReady] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [levels, setLevels] = useState<number[]>([]);

  const stopClock = useCallback(() => {
    if (clock.current !== null) window.clearInterval(clock.current);
    clock.current = null;
  }, []);

  const cancel = useCallback(() => {
    if (finished.current) return;
    finished.current = true;
    stopClock();
    recorder.current?.cancel(); // releases the mic, paused or not
    onClose();
  }, [onClose, stopClock]);

  const send = useCallback(async () => {
    const rec = recorder.current;
    if (!rec || finished.current) return;
    finished.current = true;
    stopClock();
    const audio = await rec.stop(); // works from paused too: keeps what was recorded
    if (audio.seconds < MIN_SECONDS || audio.blob.size === 0) {
      onNotice("Voice message too short, so it was discarded.");
    } else {
      onSend(audio);
    }
    onClose();
  }, [onSend, onClose, onNotice, stopClock]);

  // Latest handlers for the long-lived timers below.
  const latest = useRef({ send, onClose, onNotice });
  useEffect(() => {
    latest.current = { send, onClose, onNotice };
  });

  /** Ticks the timer up from the recorder's (pause-excluding) elapsed time. */
  const startClock = useCallback(
    (rec: AudioRecorder) => {
      stopClock();
      clock.current = window.setInterval(() => {
        setElapsed(rec.elapsedSeconds);
        if (rec.elapsedSeconds >= VOICE_NOTE_MAX_SECONDS) void latest.current.send(); // hard limit
      }, CLOCK_MS);
    },
    [stopClock],
  );

  const togglePause = useCallback(() => {
    const rec = recorder.current;
    if (!rec || finished.current) return;
    if (rec.paused) {
      if (rec.resume()) {
        setIsPaused(false);
        startClock(rec);
      }
    } else if (rec.pause()) {
      stopClock();
      setElapsed(rec.elapsedSeconds); // show the exact frozen time
      setIsPaused(true);
    }
  }, [startClock, stopClock]);

  // Start on mount (deferred a tick so StrictMode only asks for the mic once).
  useEffect(() => {
    let disposed = false;
    const start = window.setTimeout(async () => {
      try {
        const rec = await AudioRecorder.start({
          onLevel: (rms) => {
            if (!disposed) setLevels((prev) => [...prev.slice(-(METER_BARS - 1)), rms]);
          },
        });
        if (disposed || finished.current) {
          rec.cancel();
          return;
        }
        recorder.current = rec;
        setReady(true);
        startClock(rec);
      } catch (e) {
        if (disposed) return;
        finished.current = true;
        latest.current.onNotice(e instanceof RecorderError ? e.message : "Couldn't start recording.");
        latest.current.onClose();
      }
    }, 0);
    return () => {
      disposed = true;
      window.clearTimeout(start);
      stopClock();
      if (!finished.current) recorder.current?.cancel();
      recorder.current = null;
    };
  }, [startClock, stopClock]);

  // Escape cancels.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") cancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cancel]);

  const remaining = VOICE_NOTE_MAX_SECONDS - elapsed;
  const bars = [...Array(Math.max(0, METER_BARS - levels.length)).fill(0), ...levels];
  const live = ready && !isPaused;

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.15 }}
      className="flex min-h-10 flex-1 items-center gap-2"
      role="group"
      aria-label={isPaused ? "Voice message recording paused" : "Recording voice message"}
    >
      <button
        type="button"
        onClick={cancel}
        aria-label="Cancel and delete recording"
        title="Delete"
        className="flex size-10 shrink-0 items-center justify-center rounded-full text-zinc-500 transition hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/50 dark:hover:text-red-400"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" className="size-5" aria-hidden>
          <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6" />
        </svg>
      </button>

      <div
        className={`flex h-10 min-w-0 flex-1 items-center gap-2 rounded-2xl border pr-3.5 pl-3 transition-colors ${
          isPaused
            ? "border-amber-200 bg-amber-50/70 dark:border-amber-900/60 dark:bg-amber-950/30"
            : "border-red-200 bg-red-50/60 dark:border-red-900/60 dark:bg-red-950/30"
        }`}
      >
        <span className="relative flex size-2.5 shrink-0" aria-hidden>
          {live && <span className="absolute inset-0 animate-ping rounded-full bg-red-500/60" />}
          <span
            className={`relative size-2.5 rounded-full ${
              isPaused ? "bg-amber-500" : ready ? "bg-red-600" : "bg-zinc-400"
            }`}
          />
        </span>

        {/* Always rendered (even at 00:00); only disabled until the mic is live. */}
        <button
          type="button"
          onClick={togglePause}
          disabled={!ready}
          aria-label={isPaused ? "Resume recording" : "Pause recording"}
          aria-pressed={isPaused}
          title={isPaused ? "Resume recording" : "Pause recording"}
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full shadow-sm transition disabled:cursor-wait disabled:opacity-60 ${
            isPaused
              ? "bg-red-600 text-white hover:bg-red-500"
              : "bg-white text-red-700 ring-1 ring-red-200 hover:bg-red-100 dark:bg-red-900/60 dark:text-red-100 dark:ring-red-800 dark:hover:bg-red-900"
          }`}
        >
          {isPaused ? (
            // Resume: back to the mic.
            <svg viewBox="0 0 24 24" width={18} height={18} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-[18px] w-[18px]" aria-hidden>
              <rect x="9" y="2.5" width="6" height="12" rx="3" />
              <path d="M5 11a7 7 0 0 0 14 0M12 18v3.5" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" width={18} height={18} fill="currentColor" className="h-[18px] w-[18px]" aria-hidden>
              <rect x="6" y="5" width="4" height="14" rx="1" />
              <rect x="14" y="5" width="4" height="14" rx="1" />
            </svg>
          )}
        </button>
        <span
          className={`shrink-0 text-sm font-medium tabular-nums ${
            isPaused ? "text-amber-700 dark:text-amber-300" : "text-red-700 dark:text-red-300"
          }`}
          aria-live="off"
        >
          {formatDuration(elapsed)}
        </span>
        {isPaused && (
          <span className="shrink-0 rounded-full bg-amber-200/70 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-amber-800 uppercase dark:bg-amber-900/60 dark:text-amber-200">
            Paused
          </span>
        )}
        {/* Frozen in place while paused: levels only arrive while recording. */}
        <span className="flex h-6 min-w-0 flex-1 items-center justify-end gap-[2px] overflow-hidden" aria-hidden>
          {bars.map((level, i) => (
            <span
              key={i}
              style={{ height: `${Math.max(12, Math.min(100, level * 400))}%` }}
              className={`w-[3px] shrink-0 rounded-full transition-[height] duration-100 ${
                isPaused ? "bg-amber-500/60" : "bg-red-500/70"
              }`}
            />
          ))}
        </span>
        <span className="sr-only" aria-live="polite">
          {!ready ? "Waiting for microphone" : isPaused ? "Recording paused" : "Recording"}
        </span>
        {live && remaining <= 15 && (
          <span className="shrink-0 text-xs text-red-600 tabular-nums dark:text-red-400">{Math.ceil(remaining)}s left</span>
        )}
        {!ready && <span className="shrink-0 text-xs text-zinc-500">Starting mic…</span>}
      </div>

      <button
        type="button"
        onClick={() => void send()}
        disabled={!ready}
        aria-label="Send voice message"
        title="Send"
        className="flex size-10 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-white transition hover:bg-indigo-500 disabled:opacity-40"
      >
        <svg viewBox="0 0 24 24" fill="currentColor" className="size-5" aria-hidden>
          <path d="M3.4 20.4 21 12 3.4 3.6l-.01 6.53L15 12l-11.61 1.87z" />
        </svg>
      </button>
    </motion.div>
  );
}
