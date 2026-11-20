import { readJson, removeKey, storage, writeJson } from "../lib/storage";
import type { ChatDetails, ChatMessage, ChatSummary, Profile } from "../models/types";

/**
 * Local-first cache for the signed-in user: profile, chat list, recent
 * messages per chat (including the unsent outbox), call history, gallery.
 *
 * Everything is keyed by user id and wiped on sign-out. Writes for anyone but
 * the active user are dropped, so a screen flushing while it is torn down
 * after sign-out cannot re-populate what `clear()` just removed.
 */
const PREFIX = "cache.v1";
const LAST_USER = `${PREFIX}.lastUser`;

/** Chats whose messages are kept (most recently saved first). */
export const MAX_CACHED_CHATS = 40;
/** Delivered messages kept per chat (pending ones are always kept). */
export const MAX_MESSAGES_PER_CHAT = 100;

let activeUser: string | null = null;
const key = (userId: string, name: string) => `${PREFIX}.${userId}.${name}`;
const isActive = (userId: string) => userId === activeUser;

export const Cache = {
  setActiveUser(userId: string | null, email?: string | null) {
    activeUser = userId;
    if (userId) writeJson(LAST_USER, { id: userId, email: email ?? null });
  },

  lastUser: () => readJson<{ id: string; email: string | null }>(LAST_USER),

  profile(userId: string): Profile | null {
    const p = readJson<Profile>(key(userId, "profile"));
    return p?.id === userId ? p : null;
  },
  saveProfile(p: Profile) {
    if (isActive(p.id)) writeJson(key(p.id, "profile"), p);
  },

  chats: (userId: string) => readJson<ChatSummary[]>(key(userId, "chats")),
  saveChats(userId: string, chats: ChatSummary[]) {
    if (isActive(userId)) writeJson(key(userId, "chats"), chats);
  },

  messages: (userId: string, chatId: string) => readJson<ChatMessage[]>(key(userId, `messages.${chatId}`)),

  /** Keeps the newest delivered messages plus every pending one; evicts the least recently saved chats. */
  saveMessages(userId: string, chatId: string, messages: ChatMessage[]) {
    if (!isActive(userId)) return;
    const sent = messages.filter((m) => m.status === "sent");
    const keepFrom = Math.max(0, sent.length - MAX_MESSAGES_PER_CHAT);
    const oldestKept = sent[keepFrom]?.createdAt;
    const kept = messages.filter(
      (m) => m.status !== "sent" || (oldestKept != null && Date.parse(m.createdAt) >= Date.parse(oldestKept)),
    );
    // Progress is transient: a restarted upload starts from zero.
    writeJson(
      key(userId, `messages.${chatId}`),
      kept.map((m) => (m.status === "sending" ? { ...m, progress: null } : m)),
    );

    const indexKey = key(userId, "messageChats");
    const index = (readJson<string[]>(indexKey) ?? []).filter((id) => id !== chatId);
    index.unshift(chatId);
    while (index.length > MAX_CACHED_CHATS) removeKey(key(userId, `messages.${index.pop()}`));
    writeJson(indexKey, index);
  },
  removeMessages(userId: string, chatId: string) {
    removeKey(key(userId, `messages.${chatId}`));
    removeKey(key(userId, `details.${chatId}`));
  },

  /** Chat ids with cached messages (used to find pending outbox entries). */
  messageChatIds: (userId: string) => readJson<string[]>(key(userId, "messageChats")) ?? [],

  /** Members/title/role of a chat, so its header and call buttons work offline on the first frame. */
  details: (userId: string, chatId: string) => readJson<ChatDetails>(key(userId, `details.${chatId}`)),
  saveDetails(userId: string, details: ChatDetails) {
    if (isActive(userId)) writeJson(key(userId, `details.${details.id}`), details);
  },

  /** Raw rows last saved under [name] ('calls', 'gallery'). */
  rows: <T = Record<string, unknown>>(userId: string, name: string) => readJson<T[]>(key(userId, `rows.${name}`)),
  saveRows(userId: string, name: string, rows: unknown[]) {
    if (isActive(userId)) writeJson(key(userId, `rows.${name}`), rows);
  },

  /** When I last opened the Calls tab (`last_seen_calls_at`, device-local). */
  callsSeenAt: (userId: string) => storage.getString(key(userId, "lastSeenCallsAt")) ?? null,
  saveCallsSeenAt(userId: string, iso: string) {
    if (isActive(userId)) storage.set(key(userId, "lastSeenCallsAt"), iso);
  },
  missedCalls: (userId: string) => storage.getNumber(key(userId, "missedCalls")) ?? 0,
  saveMissedCalls(userId: string, count: number) {
    if (isActive(userId)) storage.set(key(userId, "missedCalls"), count);
  },

  /** Removes every cached entry (all users) and the last-user record. */
  clear() {
    activeUser = null;
    try {
      for (const k of storage.getAllKeys()) if (k.startsWith(`${PREFIX}.`)) storage.remove(k);
    } catch {}
  },
};
