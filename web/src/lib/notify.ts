// In-app message sound and browser (desktop) notifications. Browser-only.

// --- Sound ------------------------------------------------------------------

let audio: AudioContext | null = null;
let lastSoundAt = 0;

/** A soft two-note "pop". Throttled so a burst of messages plays once. */
export function playMessageSound() {
  if (typeof window === "undefined" || !("AudioContext" in window)) return;
  const now = Date.now();
  if (now - lastSoundAt < 1200) return;
  lastSoundAt = now;
  try {
    audio ??= new AudioContext();
    const ctx = audio;
    // Browsers keep the context suspended until the user has interacted.
    if (ctx.state === "suspended") void ctx.resume().catch(() => {});
    const t = ctx.currentTime + 0.01;
    [
      { freq: 660, at: 0 },
      { freq: 880, at: 0.09 },
    ].forEach(({ freq, at }) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t + at);
      gain.gain.exponentialRampToValueAtTime(0.06, t + at + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + at + 0.22);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t + at);
      osc.stop(t + at + 0.25);
    });
  } catch {
    // Sound is a nicety; never let it break message handling.
  }
}

// --- Notifications ----------------------------------------------------------

export const notificationsSupported = () => typeof window !== "undefined" && "Notification" in window;

export function notificationPermission(): NotificationPermission | "unsupported" {
  return notificationsSupported() ? Notification.permission : "unsupported";
}

const PROMPT_DISMISSED_KEY = "notifications-prompt-dismissed";

export function promptDismissed() {
  try {
    return localStorage.getItem(PROMPT_DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}

export function dismissPrompt() {
  try {
    localStorage.setItem(PROMPT_DISMISSED_KEY, "1");
  } catch {
    // Private mode: the prompt just shows again next visit.
  }
}

/** Must be called from a user gesture (a click) in most browsers. */
export async function requestNotificationPermission() {
  if (!notificationsSupported()) return "unsupported" as const;
  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
}

/** Whether the user is looking at this tab right now. */
export const pageIsActive = () =>
  typeof document !== "undefined" && document.visibilityState === "visible" && document.hasFocus();

export function showMessageNotification({
  title,
  body,
  tag,
  onClick,
}: {
  title: string;
  body: string;
  /** One notification per chat: newer ones replace older ones. */
  tag: string;
  onClick: () => void;
}) {
  if (notificationPermission() !== "granted") return;
  try {
    const notification = new Notification(title, { body, tag, icon: "/favicon.ico", silent: true });
    notification.onclick = () => {
      window.focus();
      onClick();
      notification.close();
    };
  } catch {
    // Some mobile browsers only allow notifications from a service worker.
  }
}
