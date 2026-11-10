"use client";

import { motion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { AudioRecorder, RecorderError, type RecordedAudio } from "@/lib/audio-recorder";
import { formatDuration } from "@/lib/chat";

// The composer in "recording mode": trash on the left, a red pulsing dot,
// timer and live level meter in the middle, send on the right. Recording
// starts on mount; leaving (cancel, send, unmount, Escape) releases the mic.

export const VOICE_NOTE_MAX_SECONDS = 300; // keep in sync with the DB check
const MIN_SECONDS = 1;
const METER_BARS = 28;

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
  const [ready, setReady] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [levels, setLevels] = useState<number[]>([]);

  const cancel = useCallback(() => {
    if (finished.current) return;
    finished.current = true;
    recorder.current?.cancel();
    onClose();
  }, [onClose]);

  const send = useCallback(async () => {
    const rec = recorder.current;
    if (!rec || finished.current) return;
    finished.current = true;
    const audio = await rec.stop();
    if (audio.seconds < MIN_SECONDS || audio.blob.size === 0) {
      onNotice("Voice message too short, so it was discarded.");
    } else {
      onSend(audio);
    }
    onClose();
  }, [onSend, onClose, onNotice]);

  // Latest handlers for the long-lived recording effect below.
  const latest = useRef({ send, onClose, onNotice });
  useEffect(() => {
    latest.current = { send, onClose, onNotice };
  });

  // Start on mount (deferred a tick so StrictMode only asks for the mic once).
  useEffect(() => {
    let disposed = false;
    let tick = 0;
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
        tick = window.setInterval(() => {
          setElapsed(rec.elapsedSeconds);
          if (rec.elapsedSeconds >= VOICE_NOTE_MAX_SECONDS) void latest.current.send(); // hard limit
        }, 200);
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
      window.clearInterval(tick);
      if (!finished.current) recorder.current?.cancel();
      recorder.current = null;
    };
  }, []);

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

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.15 }}
      className="flex min-h-10 flex-1 items-center gap-2"
      role="group"
      aria-label="Recording voice message"
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

      <div className="flex h-10 min-w-0 flex-1 items-center gap-3 rounded-2xl border border-red-200 bg-red-50/60 px-3.5 dark:border-red-900/60 dark:bg-red-950/30">
        <span className="relative flex size-2.5 shrink-0" aria-hidden>
          {ready && <span className="absolute inset-0 animate-ping rounded-full bg-red-500/60" />}
          <span className={`relative size-2.5 rounded-full ${ready ? "bg-red-600" : "bg-zinc-400"}`} />
        </span>
        <span className="shrink-0 text-sm font-medium text-red-700 tabular-nums dark:text-red-300" aria-live="off">
          {formatDuration(elapsed)}
        </span>
        <span className="flex h-6 min-w-0 flex-1 items-center justify-end gap-[2px] overflow-hidden" aria-hidden>
          {bars.map((level, i) => (
            <span
              key={i}
              style={{ height: `${Math.max(12, Math.min(100, level * 400))}%` }}
              className="w-[3px] shrink-0 rounded-full bg-red-500/70 transition-[height] duration-100"
            />
          ))}
        </span>
        <span className="sr-only" aria-live="polite">
          {ready ? "Recording" : "Waiting for microphone"}
        </span>
        {ready && remaining <= 15 && (
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
