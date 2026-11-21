import { type AudioPlayer, createAudioPlayer, setAudioModeAsync } from "expo-audio";
import { File, Paths } from "expo-file-system";
import { Vibration } from "react-native";

/**
 * Call tones + vibration while a call rings. Tones are synthesized once into
 * small WAV files in the cache (mirrors web/src/lib/call/ringtone.ts), so no
 * audio assets ship with the app.
 *   "ring":     incoming call, two-tone trill + vibration
 *   "ringback": outgoing call, the "ring ring" you hear while waiting
 */
type Tone = "ring" | "ringback";

const PATTERNS: Record<Tone, { freqs: [number, number]; on: number; period: number; gain: number; trill: boolean }> = {
  ring: { freqs: [880, 1100], on: 1.2, period: 3, gain: 0.35, trill: true },
  ringback: { freqs: [440, 480], on: 2, period: 6, gain: 0.2, trill: false },
};

const RATE = 8000;

/** One period of the tone as 16-bit mono PCM WAV. */
function synthesize(tone: Tone): Uint8Array {
  const { freqs, on, period, gain, trill } = PATTERNS[tone];
  const samples = Math.round(period * RATE);
  const out = new Uint8Array(44 + samples * 2);
  const view = new DataView(out.buffer);
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) out[offset + i] = text.charCodeAt(i);
  };
  ascii(0, "RIFF");
  view.setUint32(4, 36 + samples * 2, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, RATE, true);
  view.setUint32(28, RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, "data");
  view.setUint32(40, samples * 2, true);
  for (let i = 0; i < samples; i++) {
    const t = i / RATE;
    let level = t < on ? 1 : 0;
    if (level && trill && t % 0.1 >= 0.06) level = 0; // rapid on/off within the burst
    // 10 ms fades so bursts don't click.
    const edge = Math.min(t, Math.abs(on - t)) / 0.01;
    if (level && edge < 1) level = edge;
    const value = level * gain * (Math.sin(2 * Math.PI * freqs[0] * t) + Math.sin(2 * Math.PI * freqs[1] * t)) * 0.5;
    view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, value)) * 32767, true);
  }
  return out;
}

async function toneUri(tone: Tone): Promise<string | null> {
  try {
    const file = new File(Paths.cache, `call-${tone}-v1.wav`);
    // A file cut short by a crash mid-write is just the 44-byte header (or less).
    if (!file.exists || (file.size ?? 0) <= 44) {
      file.create({ overwrite: true });
      await file.write(synthesize(tone));
    }
    return file.uri;
  } catch {
    return null;
  }
}

let current: Tone | null = null;
let player: AudioPlayer | null = null;

export const Ringer = {
  /** Starts (or switches to) a looping tone. Never throws. */
  start(tone: Tone) {
    if (current === tone) return;
    Ringer.stop();
    current = tone;
    if (tone === "ring") Vibration.vibrate([500, 1000], true);
    void (async () => {
      await setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: true }).catch(() => {});
      const uri = await toneUri(tone);
      if (!uri || current !== tone) return;
      try {
        const p = createAudioPlayer({ uri });
        p.loop = true;
        if (current !== tone) {
          p.remove();
          return;
        }
        player = p;
        p.play();
      } catch {
        // Vibration alone still signals the call.
      }
    })();
  },

  /** Silences everything immediately (accept, decline, cancel, timeout). */
  stop() {
    const was = current;
    current = null;
    if (was === "ring") Vibration.cancel();
    const p = player;
    player = null;
    if (p) {
      try {
        p.pause();
        p.remove();
      } catch {}
    }
  },
};
