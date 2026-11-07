// In-page events so the sidebar and the open conversation stay in sync after
// an action taken in either one (e.g. muting from the header updates the
// sidebar). Browser-only; a no-op during server rendering.

export type ChatEvent =
  | { type: "muted"; chatId: string; muted: boolean }
  /** History cleared for me. */
  | { type: "cleared"; chatId: string }
  /** Gone from my list: deleted, left, or hidden. */
  | { type: "removed"; chatId: string }
  /** Title or membership changed: re-fetch. */
  | { type: "updated"; chatId: string }
  /** Unread count reset (the chat was read). */
  | { type: "read"; chatId: string };

const target = typeof window === "undefined" ? null : new EventTarget();
const NAME = "chat-event";

export function emitChatEvent(event: ChatEvent) {
  target?.dispatchEvent(new CustomEvent<ChatEvent>(NAME, { detail: event }));
}

/** Returns an unsubscribe function. */
export function onChatEvent(listener: (event: ChatEvent) => void) {
  if (!target) return () => {};
  const handler = (e: Event) => listener((e as CustomEvent<ChatEvent>).detail);
  target.addEventListener(NAME, handler);
  return () => target.removeEventListener(NAME, handler);
}
