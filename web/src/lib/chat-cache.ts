import { useMemo, useSyncExternalStore } from "react";
import type { ChatMessage, ChatSummary, MessageRow } from "@/lib/chat";

// Browser-side snapshot of the chat list and recent messages, so /chat and a
// conversation render instantly from the last known state while the server
// render streams in behind it (the Suspense fallbacks read it).
//
//   chat list         → localStorage   (survives a new tab / visit)
//   per-chat messages → sessionStorage (this tab only)
//
// Everything is wiped on sign-out and on reaching /login, so a shared browser
// never shows one account's chats to the next. Storage failures (private mode,
// quota, blocked) are ignored: the app simply streams as before.

const PREFIX = "chat-cache:v1:";
const LIST_KEY = `${PREFIX}list`;
const chatKey = (chatId: string) => `${PREFIX}chat:${chatId}`;
/** Enough to fill a screen; the server render brings the full page. */
const CACHED_MESSAGES = 40;

export type CachedList = { userId: string; chats: ChatSummary[] };
export type CachedChat = {
  userId: string;
  name: string;
  avatarUrl: string | null;
  group: boolean;
  messages: MessageRow[];
};

function write(storage: () => Storage, key: string, value: unknown) {
  try {
    storage().setItem(key, JSON.stringify(value));
  } catch {
    // Quota / private mode: no cache, no harm.
  }
}

function read(storage: () => Storage, key: string): string | null {
  try {
    return storage().getItem(key);
  } catch {
    return null;
  }
}

function parse<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

const local = () => window.localStorage;
const session = () => window.sessionStorage;

export function saveChatList(userId: string, chats: ChatSummary[]) {
  write(local, LIST_KEY, { userId, chats } satisfies CachedList);
}

export function saveChat(chatId: string, chat: Omit<CachedChat, "messages"> & { messages: ChatMessage[] }) {
  // Only what the server confirmed: no pending sends, previews or progress.
  const messages: MessageRow[] = chat.messages
    .filter((m) => !m.status)
    .slice(-CACHED_MESSAGES)
    .map((m) => {
      const row: ChatMessage = { ...m };
      delete row.localUrl;
      delete row.progress;
      delete row.error;
      return row as MessageRow;
    });
  write(session, chatKey(chatId), { ...chat, messages } satisfies CachedChat);
}

/** Sign-out / login: forget every cached chat. */
export function clearChatCache() {
  for (const storage of [local, session]) {
    try {
      const s = storage();
      for (const key of Object.keys(s)) if (key.startsWith(PREFIX)) s.removeItem(key);
    } catch {}
  }
}

const noSubscribe = () => () => {};

/**
 * Reads a cache entry during render. Null during SSR and hydration (the
 * server can't see browser storage), the stored value on client navigations.
 */
function useCached<T>(storage: () => Storage, key: string): T | null {
  const raw = useSyncExternalStore(
    noSubscribe,
    () => read(storage, key),
    () => null,
  );
  return useMemo(() => parse<T>(raw), [raw]);
}

export const useCachedChatList = () => useCached<CachedList>(local, LIST_KEY);
export const useCachedChat = (chatId: string) => useCached<CachedChat>(session, chatKey(chatId));
