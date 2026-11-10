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

export type ChatType = "direct" | "group";
export type MemberRole = "admin" | "member";

export type ChatSummary = {
  chatId: string;
  type: ChatType;
  createdAt: string;
  /** Group name (null for direct chats). */
  title: string | null;
  memberCount: number;
  myRole: MemberRole;
  isMuted: boolean;
  unreadCount: number;
  /** The other person in a direct chat. */
  other: PublicProfile | null;
  lastMessage: {
    content: string | null;
    type: string;
    senderId: string | null;
    senderName: string | null;
    createdAt: string;
    /** Voicemail length, for "🎙️ Voicemail · 00:34". */
    durationSeconds: number | null;
  } | null;
};

export type ChatMember = PublicProfile & { role: MemberRole; joinedAt: string };

/** What the chat page needs to render one conversation. */
export type ChatDetails = {
  id: string;
  type: ChatType;
  title: string | null;
  members: ChatMember[];
  myRole: MemberRole;
  isMuted: boolean;
};

export const GROUP_TITLE_MAX = 60;
export const GROUP_MEMBERS_MAX = 100;

export const asChatType = (value: string): ChatType => (value === "group" ? "group" : "direct");
export const asRole = (value: string | null | undefined): MemberRole => (value === "admin" ? "admin" : "member");

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
    type: asChatType(row.chat_type),
    createdAt: row.chat_created_at,
    title: (row.title as string | null) ?? null,
    memberCount: row.member_count ?? 0,
    myRole: asRole(row.my_role),
    isMuted: !!row.is_muted,
    unreadCount: row.unread_count ?? 0,
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
          senderName: (row.last_message_sender_name as string | null) ?? null,
          createdAt: lastAt,
          durationSeconds: (row.last_message_duration_seconds as number | null) ?? null,
        }
      : null,
  };
}

export function profileName(profile: PublicProfile | null) {
  if (!profile) return "Deleted user";
  return profile.displayName || (profile.username ? `@${profile.username}` : "New user");
}

type MemberRow = {
  user_id: string;
  role: string;
  joined_at: string;
  profiles: { id: string; username: string | null; display_name: string | null; avatar_url: string | null } | null;
};

/** Participant rows (with embedded profile) to members: admins first, then by name. */
export function toMembers(rows: MemberRow[]): ChatMember[] {
  return rows
    .map((row) => ({
      id: row.user_id,
      username: row.profiles?.username ?? null,
      displayName: row.profiles?.display_name ?? null,
      avatarUrl: row.profiles?.avatar_url ?? null,
      role: asRole(row.role),
      joinedAt: row.joined_at,
    }))
    .sort((a, b) =>
      a.role !== b.role ? (a.role === "admin" ? -1 : 1) : profileName(a).localeCompare(profileName(b)),
    );
}

/** Display name of a conversation: group title, or the other person. */
export function chatName(chat: { type: ChatType; title: string | null; other: PublicProfile | null }) {
  return chat.type === "group" ? chat.title || "Group" : profileName(chat.other);
}

/** Seconds as "MM:SS" (e.g. 34 -> "00:34"). */
export function formatDuration(totalSeconds: number) {
  const secs = Math.max(0, Math.floor(totalSeconds));
  return `${String(Math.floor(secs / 60)).padStart(2, "0")}:${String(secs % 60).padStart(2, "0")}`;
}

export function messageSnippet(type: string, content: string | null, durationSeconds?: number | null) {
  switch (type) {
    case "voicemail":
      return durationSeconds ? `🎙️ Voicemail · ${formatDuration(durationSeconds)}` : "🎙️ Voicemail";
    case "image":
      return "📷 Photo";
    case "audio":
      return "🎤 Voice message";
    case "video":
      return "🎬 Video";
    case "file":
      return content ? `📎 ${content}` : "📎 File";
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
