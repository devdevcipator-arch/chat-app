import type { Database } from "@/lib/database.types";

// Shared (client + server) chat types and helpers.

type ChatRow = Database["public"]["Functions"]["list_my_chats"]["Returns"][number];
export type MessageRow = Database["public"]["Tables"]["messages"]["Row"];
export type ChatMessage = MessageRow & {
  status?: "sending" | "failed";
  /** Local object URL shown while (and after) uploading, to avoid flicker. */
  localUrl?: string;
  /** Upload progress 0–1 while sending media. */
  progress?: number;
  /** Why a send failed, shown under the bubble. */
  error?: string;
};

export type PublicProfile = {
  id: string;
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
};

export type ChatSummary = {
  chatId: string;
  type: string;
  createdAt: string;
  other: PublicProfile | null;
  lastMessage: {
    content: string | null;
    type: string;
    senderId: string | null;
    createdAt: string;
  } | null;
};

export const MESSAGE_MAX = 4000;
export const MESSAGE_PAGE_SIZE = 100;
export const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Columns of list_my_chats come from LEFT JOINs, so treat them as nullable
// even though the generated types say `string`.
export function toChatSummary(row: ChatRow): ChatSummary {
  const otherId = row.other_user_id as string | null;
  const lastAt = row.last_message_at as string | null;
  return {
    chatId: row.chat_id,
    type: row.chat_type,
    createdAt: row.chat_created_at,
    other: otherId
      ? {
          id: otherId,
          username: row.other_username ?? null,
          displayName: row.other_display_name ?? null,
          avatarUrl: row.other_avatar_url ?? null,
        }
      : null,
    lastMessage: lastAt
      ? {
          content: row.last_message_content ?? null,
          type: row.last_message_type,
          senderId: row.last_message_sender_id ?? null,
          createdAt: lastAt,
        }
      : null,
  };
}

export function profileName(profile: PublicProfile | null) {
  if (!profile) return "Deleted user";
  return profile.displayName || (profile.username ? `@${profile.username}` : "New user");
}

export function messageSnippet(type: string, content: string | null) {
  switch (type) {
    case "image":
      return "📷 Photo";
    case "audio":
      return "🎤 Voice message";
    case "file":
      return "📎 File";
    default:
      return content ?? "";
  }
}

/** Insert or replace messages by id, keeping chronological order. */
export function mergeMessages(current: ChatMessage[], incoming: ChatMessage[]) {
  const byId = new Map(current.map((m) => [m.id, m]));
  for (const message of incoming) {
    // Keep the local preview when the server copy replaces the optimistic one.
    const localUrl = message.localUrl ?? byId.get(message.id)?.localUrl;
    byId.set(message.id, localUrl ? { ...message, localUrl } : message);
  }
  return [...byId.values()].sort((a, b) => a.created_at.localeCompare(b.created_at));
}

const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();

/** "14:05", or "Mon 14:05" / "12 Mar, 14:05" for older messages. */
export function formatMessageTime(iso: string) {
  const date = new Date(iso);
  const time = date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  const now = new Date();
  if (sameDay(date, now)) return time;
  const ageDays = (now.getTime() - date.getTime()) / 86_400_000;
  if (ageDays < 6) return `${date.toLocaleDateString(undefined, { weekday: "short" })} ${time}`;
  return `${date.toLocaleDateString(undefined, { day: "numeric", month: "short" })}, ${time}`;
}

/** Compact time for the chat list: "14:05", "Mon", "12 Mar". */
export function formatListTime(iso: string) {
  const date = new Date(iso);
  const now = new Date();
  if (sameDay(date, now)) {
    return date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  }
  const ageDays = (now.getTime() - date.getTime()) / 86_400_000;
  if (ageDays < 6) return date.toLocaleDateString(undefined, { weekday: "short" });
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}
