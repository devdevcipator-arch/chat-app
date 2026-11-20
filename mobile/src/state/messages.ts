import { create } from "zustand";
import { Api, stringMap } from "../lib/api";
import { Cache } from "../data/cache";
import { ChatRepo } from "../data/chats";
import { fileSize, uploadFile } from "../data/upload";
import { AppError, isOfflineError } from "../lib/errors";
import { uuid } from "../lib/ids";
import { type MediaType, chatUploadLimit, chatUploadTypeFor, messageTypeFor } from "../lib/media";
import { mathResultMessage } from "../lib/math";
import { type ChatMessage, mergeMessages } from "../models/types";
import { Chats } from "./chats";
import { Network } from "./network";

/**
 * Messages per chat, local-first.
 *
 * - Hydrated synchronously from MMKV the first time a chat is shown.
 * - Optimistic sends: a message appears instantly as "sending" (clock icon)
 *   and is delivered by a per-chat queue, so order is preserved.
 * - Offline outbox: a send that fails because the network is down stays
 *   queued (still "sending") and is flushed on reconnect or next launch. A
 *   send the server rejects is marked "failed" with Retry.
 * - Client-chosen UUIDs make delivery idempotent: a retry that hits a
 *   duplicate key means the first attempt actually landed.
 */
type MessagesState = { byChat: Record<string, ChatMessage[]> };

export const useMessages = create<MessagesState>(() => ({ byChat: {} }));

let meId: string | null = null;
const persistTimers = new Map<string, ReturnType<typeof setTimeout>>();
const queues = new Map<string, Promise<void>>();
const inFlight = new Set<string>();

const EMPTY: ChatMessage[] = [];

/** Cache reads, memoized outside the store so rendering never writes state. */
const peeked = new Map<string, ChatMessage[]>();

function current(chatId: string): ChatMessage[] {
  const inStore = useMessages.getState().byChat[chatId];
  if (inStore) return inStore;
  let cached = peeked.get(chatId);
  if (!cached) {
    cached = (meId ? Cache.messages(meId, chatId) : null) ?? EMPTY;
    peeked.set(chatId, cached);
  }
  return cached;
}

function setList(chatId: string, list: ChatMessage[]) {
  useMessages.setState((s) => ({ byChat: { ...s.byChat, [chatId]: list } }));
  const user = meId;
  const prev = persistTimers.get(chatId);
  if (prev) clearTimeout(prev);
  persistTimers.set(
    chatId,
    setTimeout(() => {
      persistTimers.delete(chatId);
      if (user) Cache.saveMessages(user, chatId, useMessages.getState().byChat[chatId] ?? []);
    }, 600),
  );
}

function merge(chatId: string, incoming: ChatMessage[]) {
  setList(chatId, mergeMessages(current(chatId), incoming));
}

function patchMessage(chatId: string, id: string, patch: Partial<ChatMessage>) {
  const list = current(chatId);
  if (!list.some((m) => m.id === id)) return;
  setList(
    chatId,
    list.map((m) => (m.id === id ? { ...m, ...patch } : m)),
  );
}

const isDuplicate = (e: unknown) => (e as { code?: string } | null)?.code === "23505";

/** Delivers one pending message. Offline failures leave it queued. */
async function deliver(message: ChatMessage): Promise<boolean> {
  const user = meId;
  if (!user || inFlight.has(message.id)) return false;
  inFlight.add(message.id);
  try {
    const sent = message.type === "text" ? await deliverText(message, user) : await deliverMedia(message, user);
    Network.reportSuccess();
    merge(message.chatId, [sent.localUri ? sent : { ...sent, localUri: message.localUri ?? null }]);
    Chats.onMessage(sent);
    return true;
  } catch (e) {
    if (isDuplicate(e)) {
      const landed = await ChatRepo.fetchMessage(message.id).catch(() => null);
      if (landed) {
        merge(message.chatId, [{ ...landed, localUri: message.localUri ?? null }]);
        return true;
      }
    }
    if (isOfflineError(e)) {
      Network.reportFailure(e);
      patchMessage(message.chatId, message.id, { status: "sending", progress: null, error: null });
    } else {
      patchMessage(message.chatId, message.id, {
        status: "failed",
        progress: null,
        error: e instanceof AppError ? e.message : "Not sent. Please try again.",
      });
    }
    return false;
  } finally {
    inFlight.delete(message.id);
  }
}

async function deliverText(m: ChatMessage, senderId: string) {
  return ChatRepo.insertMessage({
    id: m.id,
    chat_id: m.chatId,
    sender_id: senderId,
    message_type: "text",
    content: m.content ?? "",
  });
}

/** Uploads through /api/media/upload-url (presigned R2 PUT) and posts the message. */
async function deliverMedia(m: ChatMessage, senderId: string) {
  const fileName = m.fileName ?? "file";
  const type = chatUploadTypeFor(fileName);
  if (!type || !m.localUri) throw new AppError("This file is no longer available on this device.");
  const size = m.fileSize ?? (await fileSize(m.localUri));
  if (!size) throw new AppError("That file is empty.");
  const limit = chatUploadLimit(type);
  if (size > limit) throw new AppError(`Files like this must be ${Math.round(limit / (1024 * 1024))} MB or smaller.`);

  const target = await Api.post("/api/media/upload-url", {
    chatId: m.chatId,
    fileName,
    fileType: type.mime,
    fileSize: size,
  });
  let lastTick = 0;
  await uploadFile({
    uploadUrl: String(target.uploadUrl),
    headers: stringMap(target.headers),
    uri: m.localUri,
    onProgress: (fraction) => {
      const now = Date.now();
      if (now - lastTick < 150) return;
      lastTick = now;
      patchMessage(m.chatId, m.id, { progress: fraction });
    },
  });

  // The server resolves the stored type from the file name (e.g. an .epub
  // picked as application/octet-stream) and says how to post it.
  const kind = m.type === "voicemail" ? "voicemail" : String(target.messageType ?? messageTypeFor(type));
  const row: Record<string, unknown> = {
    id: m.id,
    chat_id: m.chatId,
    sender_id: senderId,
    message_type: kind,
    // Videos and files show their original name in the bubble.
    content: kind === "video" || kind === "file" ? fileName : null,
    media_url: String(target.key),
    ...(m.durationSeconds != null ? { duration_seconds: m.durationSeconds } : {}),
  };
  // Optional extras, dropped if the server refuses them.
  const extras: Record<string, unknown> = {
    ...(kind === "file" ? { file_size: size } : {}),
    ...(m.callId ? { call_id: m.callId } : {}),
  };
  if (Object.keys(extras).length === 0) return ChatRepo.insertMessage(row);
  try {
    return await ChatRepo.insertMessage({ ...row, ...extras });
  } catch (e) {
    if (isDuplicate(e) || isOfflineError(e)) throw e;
    // PGRST204: file_size column missing; otherwise linking a voicemail to its call is a nicety.
    if ((e as { code?: string }).code === "PGRST204" && m.callId) return ChatRepo.insertMessage({ ...row, call_id: m.callId });
    return ChatRepo.insertMessage(row);
  }
}

/** Runs [task] after everything already queued for [chatId]. */
function enqueue(chatId: string, task: () => Promise<unknown>) {
  const next = (queues.get(chatId) ?? Promise.resolve()).then(task).then(
    () => {},
    () => {},
  );
  queues.set(chatId, next);
  return next;
}

function optimistic(chatId: string, patch: Partial<ChatMessage>, at = Date.now()): ChatMessage {
  return {
    id: uuid(),
    chatId,
    senderId: meId,
    type: "text",
    content: null,
    mediaUrl: null,
    createdAt: new Date(at).toISOString(),
    durationSeconds: null,
    fileSize: null,
    editedAt: null,
    callId: null,
    voicemailPlayedAt: null,
    status: "sending",
    ...patch,
  };
}

export const Messages = {
  attach(userId: string) {
    if (meId === userId) return;
    meId = userId;
    peeked.clear();
    useMessages.setState({ byChat: {} });
    // Resume the outbox from the last session.
    setTimeout(() => Messages.flushOutbox(), 1500);
  },

  detach() {
    meId = null;
    for (const t of persistTimers.values()) clearTimeout(t);
    persistTimers.clear();
    queues.clear();
    peeked.clear();
    useMessages.setState({ byChat: {} });
  },

  /** The chat's messages (synchronously from cache on first access). */
  get: (chatId: string) => current(chatId),

  /** Server copy of the latest page, merged with local and pending messages. */
  async sync(chatId: string) {
    const recent = await ChatRepo.recentMessages(chatId);
    merge(chatId, recent);
  },

  clearLocal(chatId: string) {
    setList(chatId, current(chatId).filter((m) => m.status !== "sent"));
  },

  /** Realtime insert / update (edits, voicemail played). Kept even for closed chats, so they open instantly. */
  onRemote(message: ChatMessage, isUpdate: boolean) {
    if (!meId) return;
    if (isUpdate && !current(message.chatId).some((m) => m.id === message.id)) return;
    merge(message.chatId, [message]);
  },

  sendText(chatId: string, content: string) {
    const m = optimistic(chatId, { content });
    merge(chatId, [m]);
    Chats.onMessage(m);
    void enqueue(chatId, () => deliver(m));
  },

  /** `/math`: the command as typed, then the answer as an ordinary text message. */
  sendMath(chatId: string, expression: string, formatted: string) {
    const now = Date.now();
    const question = optimistic(chatId, { content: `/math ${expression}` }, now);
    const answer = optimistic(chatId, { content: mathResultMessage(expression, formatted) }, now + 1);
    merge(chatId, [question, answer]);
    // One after the other: the server stamps created_at.
    Chats.onMessage(answer);
    void enqueue(chatId, async () => {
      if (await deliver(question)) await deliver(answer);
      else if (current(chatId).find((m) => m.id === question.id)?.status === "failed") {
        patchMessage(chatId, answer.id, { status: "failed", error: "Not sent." });
      }
      // Offline: both stay queued and flush in order on reconnect.
    });
  },

  /** Returns an error message, or null when queued. */
  sendFile(
    chatId: string,
    file: { uri: string; name: string; size?: number | null },
    opts: { durationSeconds?: number; messageType?: "voicemail"; callId?: string | null } = {},
  ): string | null {
    const type: MediaType | null = chatUploadTypeFor(file.name);
    if (!type) return "Executable files (.exe, .bat, …) can't be sent.";
    const m = optimistic(chatId, {
      type: opts.messageType ?? messageTypeFor(type),
      content: type.kind === "video" || type.kind === "file" ? file.name : null,
      durationSeconds: opts.durationSeconds ?? null,
      fileSize: file.size ?? null,
      callId: opts.callId ?? null,
      localUri: file.uri,
      fileName: file.name,
      progress: 0,
    });
    merge(chatId, [m]);
    Chats.onMessage(m);
    void enqueue(chatId, () => deliver(m));
    return null;
  },

  retry(message: ChatMessage) {
    patchMessage(message.chatId, message.id, { status: "sending", progress: 0, error: null });
    void enqueue(message.chatId, () => deliver({ ...message, status: "sending" }));
  },

  /** Removes a failed message that will never be sent. */
  discard(message: ChatMessage) {
    setList(
      message.chatId,
      current(message.chatId).filter((m) => m.id !== message.id),
    );
  },

  /** Re-sends every queued message (app start, reconnect). */
  flushOutbox() {
    const user = meId;
    if (!user || !Network.online) return;
    const chatIds = new Set([...Cache.messageChatIds(user), ...Object.keys(useMessages.getState().byChat)]);
    for (const chatId of chatIds) {
      for (const m of current(chatId)) {
        if (m.status === "sending" && !inFlight.has(m.id)) void enqueue(chatId, () => deliver(m));
      }
    }
  },

  async edit(message: ChatMessage, content: string) {
    const updated = await ChatRepo.editMessage(message.id, content);
    merge(message.chatId, [updated]);
  },

  markVoicemailPlayed(chatId: string, id: string, at: string) {
    patchMessage(chatId, id, { voicemailPlayedAt: at });
  },

  /** Adds an already-delivered message (e.g. a gallery forward). */
  addDelivered(message: ChatMessage) {
    merge(message.chatId, [message]);
    Chats.onMessage(message);
  },
};
