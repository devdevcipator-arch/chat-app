// Synthesized call tones (Web Audio), so there are no audio assets to ship.
//   "ring":     incoming call, two-tone trill
//   "ringback": outgoing call, the classic "ring ring" you hear while waiting

type Tone = "ring" | "ringback";

const PATTERNS: Record<Tone, { freqs: [number, number]; on: number; period: number; gain: number }> = {
  ring: { freqs: [880, 1100], on: 1.2, period: 3, gain: 0.12 },
  ringback: { freqs: [440, 480], on: 2, period: 6, gain: 0.06 },
};

/** Starts a looping tone; returns a function that stops it. Never throws. */
export function playTone(tone: Tone): () => void {
  if (typeof window === "undefined" || !("AudioContext" in window)) return () => {};
  let ctx: AudioContext;
  try {
    ctx = new AudioContext();
  } catch {
    return () => {};
  }
  const { freqs, on, period, gain } = PATTERNS[tone];

  const master = ctx.createGain();
  master.gain.value = 0;
  master.connect(ctx.destination);
  const oscillators = freqs.map((frequency) => {
    const osc = ctx.createOscillator();
    osc.frequency.value = frequency;
    osc.connect(master);
    osc.start();
    return osc;
  });

  // Schedule bursts a little ahead of time.
  let next = ctx.currentTime + 0.05;
  const schedule = () => {
    while (next < ctx.currentTime + period * 2) {
      if (tone === "ring") {
        // Trill: rapid on/off within the burst.
        for (let t = 0; t < on; t += 0.1) {
          master.gain.setValueAtTime(gain, next + t);
          master.gain.setValueAtTime(0, next + t + 0.05);
        }
      } else {
        master.gain.setValueAtTime(gain, next);
        master.gain.setValueAtTime(0, next + on);
      }
      next += period;
    }
  };
  schedule();
  const timer = window.setInterval(schedule, period * 1000);
  void ctx.resume().catch(() => {});

  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    window.clearInterval(timer);
    oscillators.forEach((osc) => osc.stop());
    void ctx.close().catch(() => {});
  };
}
