"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { MESSAGE_MAX } from "@/lib/chat";

// The message bar, shown the instant a conversation opens, while the live
// ChatWindow is still streaming in from the server. Same layout as the real
// Composer, so nothing jumps; you can start typing straight away and the text
// (and focus) carries over to the real composer when it mounts. Sending,
// attachments and voice notes switch on once the chat has loaded.

/** Text typed before the chat loaded, by chat id (read by the real Composer). */
const earlyDrafts = new Map<string, string>();

export const readEarlyDraft = (chatId: string) => earlyDrafts.get(chatId) ?? "";
export const clearEarlyDraft = (chatId: string) => earlyDrafts.delete(chatId);

/** The open chat, from the URL (no useParams: this renders in the static shell). */
const currentChatId = () => window.location.pathname.split("/")[2] ?? "";

const iconButton =
  "flex size-10 shrink-0 items-center justify-center rounded-full text-zinc-500 disabled:opacity-60";

export function EarlyComposer() {
  // Survives the placeholder being swapped (skeleton → cached preview). The
  // map is empty on a full page load, so the prerendered HTML always matches.
  const [text, setText] = useState(() => (typeof window === "undefined" ? "" : readEarlyDraft(currentChatId())));
  const input = useRef<HTMLTextAreaElement>(null);

  // Auto-grow up to ~6 lines, like the real composer.
  useLayoutEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [text]);

  return (
    <div className="shrink-0 border-t border-zinc-200 dark:border-zinc-800">
      <form
        onSubmit={(e) => e.preventDefault()}
        className="flex items-end gap-1.5 p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:gap-2 sm:p-3 sm:pb-[max(0.75rem,env(safe-area-inset-bottom))]"
      >
        <button type="button" disabled aria-label="Attach" title="Attach" className={iconButton}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" className="size-5" aria-hidden>
            <path d="m21.4 11.1-9.2 9.2a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5" />
          </svg>
        </button>
        <textarea
          ref={input}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            earlyDrafts.set(currentChatId(), e.target.value);
          }}
          // Enter sends once the chat is live; until then it just doesn't add a newline.
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) e.preventDefault();
          }}
          rows={1}
          maxLength={MESSAGE_MAX}
          placeholder="Message"
          aria-label="Message"
          autoFocus
          className="max-h-40 min-h-10 flex-1 resize-none rounded-2xl border border-zinc-300 bg-white px-3.5 py-2 text-base outline-none sm:px-4 md:text-[15px] transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 dark:border-zinc-700 dark:bg-zinc-900"
        />
        <button type="button" disabled aria-label="Record voice message" title="Record voice message" className={iconButton}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" className="size-5" aria-hidden>
            <rect x="9" y="2.5" width="6" height="12" rx="3" />
            <path d="M5 11a7 7 0 0 0 14 0M12 18v3.5" />
          </svg>
        </button>
        <button
          type="submit"
          disabled
          aria-label="Send message"
          className="flex size-10 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-white disabled:opacity-40"
        >
          <svg viewBox="0 0 24 24" fill="currentColor" className="size-5" aria-hidden>
            <path d="M3.4 20.4 21 12 3.4 3.6l-.01 6.53L15 12l-11.61 1.87z" />
          </svg>
        </button>
      </form>
    </div>
  );
}
