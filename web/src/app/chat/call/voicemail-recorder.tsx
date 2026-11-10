"use client";

import { motion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Avatar } from "@/components/avatar";
import { VoicemailPlayer, normaliseLevels } from "@/components/voicemail-player";
import { VOICEMAIL_MAX_SECONDS, type CallPeer } from "@/lib/call/types";
import { formatDuration, profileName } from "@/lib/chat";
import type { AudioMimeType } from "@/lib/media";
import { UploadError } from "@/lib/media-client";
import { createClient } from "@/lib/supabase/client";
import { pickRecordingFormat, sendVoicemail, uploadTypeFor } from "@/lib/voicemail-client";
import { MicIcon } from "./icons";

// Record → preview → send a voicemail for someone who didn't pick up.
// Recording starts as soon as the modal opens (the user just asked for it).

type Recording = { blob: Blob; url: string; type: AudioMimeType; seconds: number; bars: number[] };

type Stage =
  | { stage: "requesting" }
  | { stage: "recording" }
  | { stage: "recorded"; recording: Recording }
  | { stage: "sending"; recording: Recording; progress: number }
  | { stage: "sent" }
  | { stage: "error"; message: string; recording: Recording | null };

/** Live state of an in-progress recording, outside React. */
type Live = {
  stream: MediaStream;
  recorder: MediaRecorder;
  context: AudioContext | null;
  startedAt: number;
  levels: number[];
  raf: number;
  tick: number;
  /** Set when the recording is thrown away rather than kept. */
  discard: boolean;
};

const MIN_SECONDS = 1;
const UNSUPPORTED = "This browser can't record audio.";

const canRecord = () => !!pickRecordingFormat() && !!navigator.mediaDevices?.getUserMedia;
const initialStage = (): Stage =>
  canRecord() ? { stage: "requesting" } : { stage: "error", message: UNSUPPORTED, recording: null };

function micErrorMessage(e: unknown) {
  const name = e instanceof DOMException ? e.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "Microphone access is blocked. Allow it in your browser's site settings and try again.";
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") return "No microphone found.";
  if (name === "NotReadableError") return "Your microphone is in use by another app.";
  return "Couldn't start your microphone.";
}

export function VoicemailRecorder({
  peer,
  callId,
  meId,
  onClose,
}: {
  peer: CallPeer;
  callId: string | null;
  meId: string;
  onClose: () => void;
}) {
  const [supabase] = useState(createClient);
  const [state, setState] = useState<Stage>(initialStage);
  const [elapsed, setElapsed] = useState(0);
  const live = useRef<Live | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const urls = useRef(new Set<string>());
  const mounted = useRef(true);
  /** Bumped by every begin() and on unmount, so a stale mic request bails out. */
  const generation = useRef(0);
  const name = profileName(peer);

  /** Releases the mic and audio graph. `discard` drops the recording. */
  const stopLive = useCallback((discard: boolean) => {
    const l = live.current;
    if (!l) return;
    live.current = null;
    l.discard = discard;
    cancelAnimationFrame(l.raf);
    window.clearInterval(l.tick);
    if (l.recorder.state !== "inactive") l.recorder.stop(); // onstop builds the recording
    l.stream.getTracks().forEach((t) => t.stop());
    void l.context?.close().catch(() => {});
  }, []);

  const begin = useCallback(async () => {
    const gen = ++generation.current;
    const current = () => mounted.current && gen === generation.current;
    stopLive(true);
    // Callers only start when canRecord(); no state changes before the first await.
    const format = pickRecordingFormat();
    if (!format || !navigator.mediaDevices?.getUserMedia) return;
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch (e) {
      if (current()) setState({ stage: "error", message: micErrorMessage(e), recording: null });
      return;
    }
    if (!current()) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }

    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, { mimeType: format.recorder, audioBitsPerSecond: 64_000 });
    } catch {
      stream.getTracks().forEach((t) => t.stop());
      setState({ stage: "error", message: UNSUPPORTED, recording: null });
      return;
    }

    // Level meter: drives the live waveform and becomes the preview waveform.
    let context: AudioContext | null = null;
    let analyser: AnalyserNode | null = null;
    try {
      context = new AudioContext();
      analyser = context.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.6;
      context.createMediaStreamSource(stream).connect(analyser);
    } catch {
      context = null; // the recording still works, just without a meter
      analyser = null;
    }

    const chunks: Blob[] = [];
    const l: Live = {
      stream,
      recorder,
      context,
      startedAt: performance.now(),
      levels: [],
      raf: 0,
      tick: 0,
      discard: false,
    };
    live.current = l;

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    recorder.onstop = () => {
      if (l.discard || !mounted.current) return;
      const seconds = Math.min(VOICEMAIL_MAX_SECONDS, (performance.now() - l.startedAt) / 1000);
      const type = uploadTypeFor(recorder.mimeType || format.recorder, format.upload);
      const blob = new Blob(chunks, { type });
      const url = URL.createObjectURL(blob);
      urls.current.add(url);
      setState({ stage: "recorded", recording: { blob, url, type, seconds, bars: normaliseLevels(l.levels) } });
    };

    const samples = analyser ? new Uint8Array(analyser.fftSize) : null;
    let lastSample = 0;
    const draw = (now: number) => {
      if (live.current !== l) return;
      if (analyser && samples) {
        analyser.getByteTimeDomainData(samples);
        let sum = 0;
        for (const v of samples) sum += ((v - 128) / 128) ** 2;
        const rms = Math.sqrt(sum / samples.length);
        if (now - lastSample > 100) {
          l.levels.push(rms);
          lastSample = now;
        }
        drawMeter(canvas.current, l.levels);
      }
      l.raf = requestAnimationFrame(draw);
    };
    l.raf = requestAnimationFrame(draw);

    l.tick = window.setInterval(() => {
      const secs = (performance.now() - l.startedAt) / 1000;
      setElapsed(secs);
      if (secs >= VOICEMAIL_MAX_SECONDS) stopLive(false); // hard limit
    }, 200);

    recorder.start(250);
    setElapsed(0);
    setState({ stage: "recording" });
  }, [stopLive]);

  // Start right away; release everything on close.
  useEffect(() => {
    mounted.current = true;
    const owned = urls.current;
    const generations = generation;
    // Deferred a tick: StrictMode's mount/unmount/mount then asks for the mic once.
    const start = window.setTimeout(() => {
      if (canRecord()) void begin();
    }, 0);
    return () => {
      window.clearTimeout(start);
      mounted.current = false;
      generations.current++;
      stopLive(true);
      owned.forEach((u) => URL.revokeObjectURL(u));
      owned.clear();
    };
  }, [begin, stopLive]);

  const busy = state.stage === "sending" || state.stage === "recording" || state.stage === "requesting";

  // Escape closes, except while recording or uploading (use the buttons).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  // Close shortly after a successful send.
  useEffect(() => {
    if (state.stage !== "sent") return;
    const id = window.setTimeout(onClose, 1_200);
    return () => window.clearTimeout(id);
  }, [state.stage, onClose]);

  async function send(recording: Recording) {
    setState({ stage: "sending", recording, progress: 0 });
    try {
      await sendVoicemail(supabase, {
        chatId: peer.chatId,
        senderId: meId,
        blob: recording.blob,
        type: recording.type,
        durationSeconds: recording.seconds,
        callId,
        onProgress: (progress) => {
          if (mounted.current) setState((s) => (s.stage === "sending" ? { ...s, progress } : s));
        },
      });
      if (mounted.current) setState({ stage: "sent" });
    } catch (e) {
      if (!mounted.current) return;
      const message = e instanceof UploadError ? e.message : "Voicemail not sent. Please try again.";
      setState({ stage: "error", message, recording });
    }
  }

  const recording =
    state.stage === "recorded" || state.stage === "sending" || state.stage === "error"
      ? (state as { recording: Recording | null }).recording
      : null;
  const tooShort = !!recording && recording.seconds < MIN_SECONDS;
  const remaining = Math.max(0, VOICEMAIL_MAX_SECONDS - elapsed);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && !busy && onClose()}
    >
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-labelledby="voicemail-title"
        initial={{ scale: 0.95, y: 12, opacity: 0 }}
        animate={{ scale: 1, y: 0, opacity: 1 }}
        exit={{ scale: 0.97, opacity: 0 }}
        transition={{ type: "spring", stiffness: 340, damping: 30 }}
        className="w-full max-w-sm overflow-hidden rounded-3xl bg-zinc-900 text-white shadow-2xl ring-1 ring-white/10"
      >
        <div className="flex items-center gap-3 border-b border-white/10 px-5 py-4">
          <Avatar name={name} />
          <div className="min-w-0 flex-1">
            <h2 id="voicemail-title" className="truncate font-semibold">
              Voicemail for {name}
            </h2>
            <p className="text-xs text-white/50">Up to {formatDuration(VOICEMAIL_MAX_SECONDS)}</p>
          </div>
        </div>

        <div className="px-5 pt-6 pb-5">
          {(state.stage === "requesting" || state.stage === "recording") && (
            <div className="flex flex-col items-center gap-5">
              <div className="relative flex size-24 items-center justify-center">
                {state.stage === "recording" && (
                  <>
                    <span className="absolute inset-0 animate-ping rounded-full bg-red-500/25" aria-hidden />
                    <span className="absolute -inset-2 animate-pulse rounded-full border border-red-400/30" aria-hidden />
                  </>
                )}
                <span
                  className={`relative flex size-20 items-center justify-center rounded-full ${
                    state.stage === "recording" ? "bg-red-600 shadow-lg shadow-red-600/40" : "bg-white/10"
                  }`}
                >
                  <MicIcon className="size-8" />
                </span>
              </div>
              <canvas ref={canvas} width={560} height={96} className="h-12 w-full" aria-hidden />
              <div className="text-center" aria-live="polite">
                <p className="text-3xl font-semibold tabular-nums">
                  {state.stage === "requesting" ? "00:00" : formatDuration(elapsed)}
                </p>
                <p className="mt-1 text-xs text-white/50">
                  {state.stage === "requesting"
                    ? "Waiting for your microphone…"
                    : remaining <= 10
                      ? `${Math.ceil(remaining)} s left`
                      : "Recording…"}
                </p>
              </div>
              <div className="h-1 w-full overflow-hidden rounded-full bg-white/10" aria-hidden>
                <div
                  className="h-full rounded-full bg-red-500 transition-[width] duration-200"
                  style={{ width: `${Math.min(100, (elapsed / VOICEMAIL_MAX_SECONDS) * 100)}%` }}
                />
              </div>
              <div className="flex w-full gap-2">
                <button
                  type="button"
                  onClick={() => {
                    stopLive(true);
                    onClose();
                  }}
                  className="flex-1 rounded-full bg-white/10 px-4 py-2.5 text-sm font-medium transition hover:bg-white/20"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => stopLive(false)}
                  disabled={state.stage !== "recording"}
                  className="flex flex-1 items-center justify-center gap-2 rounded-full bg-white px-4 py-2.5 text-sm font-semibold text-zinc-900 transition hover:bg-zinc-200 disabled:opacity-40"
                >
                  <span className="size-3 rounded-sm bg-red-600" aria-hidden />
                  Stop
                </button>
              </div>
            </div>
          )}

          {recording && (
            <div className="flex flex-col gap-4">
              <div className="rounded-2xl bg-white/5 p-3 ring-1 ring-white/10">
                <VoicemailPlayer
                  key={recording.url}
                  src={recording.url}
                  durationSeconds={recording.seconds}
                  bars={recording.bars}
                  tone="dark"
                />
              </div>

              {state.stage === "error" && (
                <p role="alert" className="rounded-xl bg-red-500/15 px-3 py-2 text-sm text-red-200">
                  {state.message}
                </p>
              )}
              {tooShort && state.stage !== "sending" && (
                <p className="text-center text-xs text-amber-300">That was too short. Record again?</p>
              )}

              {state.stage === "sending" ? (
                <div className="space-y-2" aria-live="polite">
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                    <div
                      className="h-full rounded-full bg-indigo-500 transition-[width] duration-200"
                      style={{ width: `${Math.round(state.progress * 100)}%` }}
                    />
                  </div>
                  <p className="text-center text-xs text-white/60">Sending voicemail… {Math.round(state.progress * 100)}%</p>
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={onClose}
                    className="rounded-full bg-white/10 px-3 py-2.5 text-sm font-medium transition hover:bg-white/20"
                  >
                    Discard
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setState(initialStage());
                      if (canRecord()) void begin();
                    }}
                    className="rounded-full bg-white/10 px-3 py-2.5 text-sm font-medium transition hover:bg-white/20"
                  >
                    Re-record
                  </button>
                  <button
                    type="button"
                    onClick={() => void send(recording)}
                    disabled={tooShort}
                    className="rounded-full bg-indigo-600 px-3 py-2.5 text-sm font-semibold transition hover:bg-indigo-500 disabled:opacity-40"
                  >
                    {state.stage === "error" ? "Retry" : "Send"}
                  </button>
                </div>
              )}
            </div>
          )}

          {state.stage === "error" && !recording && (
            <div className="flex flex-col items-center gap-4 text-center">
              <span className="flex size-16 items-center justify-center rounded-full bg-white/10">
                <MicIcon className="size-7 text-white/60" />
              </span>
              <p role="alert" className="text-sm text-red-200">
                {state.message}
              </p>
              <div className="flex w-full gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="flex-1 rounded-full bg-white/10 px-4 py-2.5 text-sm font-medium transition hover:bg-white/20"
                >
                  Close
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setState(initialStage());
                    if (canRecord()) void begin();
                  }}
                  className="flex-1 rounded-full bg-white px-4 py-2.5 text-sm font-semibold text-zinc-900 transition hover:bg-zinc-200"
                >
                  Try again
                </button>
              </div>
            </div>
          )}

          {state.stage === "sent" && (
            <div className="flex flex-col items-center gap-3 py-4 text-center" aria-live="polite">
              <motion.span
                initial={{ scale: 0.6, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                className="flex size-16 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-300"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="size-8" aria-hidden>
                  <path d="M5 12.5l4.5 4.5L19 7.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </motion.span>
              <p className="font-medium">Voicemail sent</p>
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}

/** Scrolling level bars, newest on the right. */
function drawMeter(el: HTMLCanvasElement | null, levels: number[]) {
  const ctx = el?.getContext("2d");
  if (!el || !ctx) return;
  const { width, height } = el;
  ctx.clearRect(0, 0, width, height);
  const barWidth = 6;
  const gap = 4;
  const count = Math.floor(width / (barWidth + gap));
  const recent = levels.slice(-count);
  ctx.fillStyle = "rgba(248, 113, 113, 0.9)";
  recent.forEach((level, i) => {
    const h = Math.max(4, Math.min(1, level * 4) * height);
    const x = width - (recent.length - i) * (barWidth + gap);
    const y = (height - h) / 2;
    ctx.beginPath();
    ctx.roundRect(x, y, barWidth, h, 3);
    ctx.fill();
  });
}
