import { AUDIO_TYPES, type AudioMimeType } from "@/lib/media";

// Browser-only microphone recording (MediaRecorder) with a level meter.
// Framework-free: React components hold one instance per recording.

/** Recording formats in order of preference, with the type we upload as. */
const RECORDING_FORMATS: { recorder: string; upload: AudioMimeType }[] = [
  { recorder: "audio/webm;codecs=opus", upload: "audio/webm" },
  { recorder: "audio/webm", upload: "audio/webm" },
  { recorder: "audio/mp4", upload: "audio/mp4" }, // Safari
  { recorder: "audio/ogg;codecs=opus", upload: "audio/ogg" },
];

export type RecordingFormat = (typeof RECORDING_FORMATS)[number];

/** The best format this browser can record, or null if it can't record audio. */
export function pickRecordingFormat(): RecordingFormat | null {
  if (typeof window === "undefined" || typeof MediaRecorder === "undefined") return null;
  return RECORDING_FORMATS.find((f) => MediaRecorder.isTypeSupported(f.recorder)) ?? null;
}

/** Maps whatever the recorder actually produced to a type the upload API accepts. */
export function uploadTypeFor(recordedType: string, fallback: AudioMimeType): AudioMimeType {
  const base = recordedType.split(";")[0].trim().toLowerCase();
  return base in AUDIO_TYPES ? (base as AudioMimeType) : fallback;
}

export const canRecordAudio = () =>
  !!pickRecordingFormat() && typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia;

/** A user-facing reason recording couldn't start. */
export class RecorderError extends Error {}

function micErrorMessage(e: unknown) {
  const name = e instanceof DOMException ? e.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "Microphone access is blocked. Allow it in your browser's site settings to record voice messages.";
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") return "No microphone found.";
  if (name === "NotReadableError") return "Your microphone is in use by another app.";
  return "Couldn't start your microphone.";
}

export type RecordedAudio = {
  blob: Blob;
  type: AudioMimeType;
  seconds: number;
  /** RMS levels sampled every ~100 ms (for a waveform). */
  levels: number[];
};

export class AudioRecorder {
  private chunks: Blob[] = [];
  private startedAt = performance.now();
  private raf = 0;
  private context: AudioContext | null = null;
  private done = false;
  readonly levels: number[] = [];

  private constructor(
    private readonly stream: MediaStream,
    private readonly recorder: MediaRecorder,
    private readonly format: RecordingFormat,
    onLevel?: (rms: number) => void,
  ) {
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data);
    };
    this.meter(onLevel);
    recorder.start(250);
    this.startedAt = performance.now();
  }

  /** Asks for the mic and starts recording. Throws RecorderError. */
  static async start({ onLevel }: { onLevel?: (rms: number) => void } = {}): Promise<AudioRecorder> {
    const format = pickRecordingFormat();
    if (!format || !navigator.mediaDevices?.getUserMedia) {
      throw new RecorderError("This browser can't record audio.");
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch (e) {
      throw new RecorderError(micErrorMessage(e));
    }
    try {
      const recorder = new MediaRecorder(stream, { mimeType: format.recorder, audioBitsPerSecond: 64_000 });
      return new AudioRecorder(stream, recorder, format, onLevel);
    } catch {
      stream.getTracks().forEach((t) => t.stop());
      throw new RecorderError("This browser can't record audio.");
    }
  }

  get elapsedSeconds() {
    return (performance.now() - this.startedAt) / 1000;
  }

  /** Stops and returns the recording (resolves once the last chunk is in). */
  stop(): Promise<RecordedAudio> {
    const seconds = this.elapsedSeconds;
    return new Promise((resolve) => {
      const finish = () => {
        const type = uploadTypeFor(this.recorder.mimeType || this.format.recorder, this.format.upload);
        resolve({ blob: new Blob(this.chunks, { type }), type, seconds, levels: [...this.levels] });
      };
      if (this.recorder.state === "inactive") finish();
      else this.recorder.addEventListener("stop", finish, { once: true });
      this.release();
    });
  }

  /** Throws the recording away and releases the mic. */
  cancel() {
    this.chunks = [];
    this.release();
  }

  private release() {
    if (this.done) return;
    this.done = true;
    cancelAnimationFrame(this.raf);
    if (this.recorder.state !== "inactive") this.recorder.stop();
    this.stream.getTracks().forEach((t) => t.stop());
    void this.context?.close().catch(() => {});
    this.context = null;
  }

  private meter(onLevel?: (rms: number) => void) {
    let analyser: AnalyserNode;
    try {
      this.context = new AudioContext();
      analyser = this.context.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.6;
      this.context.createMediaStreamSource(this.stream).connect(analyser);
    } catch {
      this.context = null; // recording still works, just without a meter
      return;
    }
    const samples = new Uint8Array(analyser.fftSize);
    let last = 0;
    const tick = (now: number) => {
      if (this.done) return;
      analyser.getByteTimeDomainData(samples);
      let sum = 0;
      for (const v of samples) sum += ((v - 128) / 128) ** 2;
      const rms = Math.sqrt(sum / samples.length);
      if (now - last > 100) {
        this.levels.push(rms);
        last = now;
        onLevel?.(rms);
      }
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }
}
