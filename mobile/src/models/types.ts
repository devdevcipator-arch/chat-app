import { Config } from "../lib/config";
import { formatDuration, mediaPublicUrl } from "../lib/media";

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

export type ThemePreference = "light" | "dark" | "system";

export const parseTheme = (value: unknown): ThemePreference =>
  value === "light" || value === "dark" || value === "system" ? value : "dark";

/** Public profile fields. Never includes email or other private data. */
export type Profile = {
  id: string;
  username: string | null;
  displayName: string | null;
  /** R2 object key (`avatars/<id>/<uuid>.<ext>`), not a URL. */
  avatarUrl: string | null;
  /** Only meaningful on the signed-in user's own profile. */
  theme?: ThemePreference;
};

type Row = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" ? v : null);
const num = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" && v !== "" ? Number(v) : null);

export const profileFromRow = (row: Row): Profile => ({
  id: String(row.id),
  username: str(row.username),
  displayName: str(row.display_name),
  avatarUrl: str(row.avatar_url),
  theme: parseTheme(row.theme_preference),
});

export const profileToRow = (p: Profile) => ({
  id: p.id,
  username: p.username,
  display_name: p.displayName,
  avatar_url: p.avatarUrl,
  theme_preference: p.theme ?? "dark",
});

export const hasUsername = (p: Profile | null | undefined) => !!p?.username;

/** Display name, falling back to @username; "Deleted user" for a missing account. */
export function profileName(p: Profile | null | undefined) {
  if (!p) return "Deleted user";
  if (p.displayName?.trim()) return p.displayName;
  return p.username ? `@${p.username}` : "New user";
}

export const avatarImageUrl = (p: Profile | null | undefined) => mediaPublicUrl(p?.avatarUrl);

// ---------------------------------------------------------------------------
// Chat list (list_my_chats RPC)
// ---------------------------------------------------------------------------

export type LastMessage = {
  content: string | null;
  type: string;
  senderId: string | null;
  senderName: string | null;
  createdAt: string;
  durationSeconds: number | null;
};

export type ChatSummary = {
  chatId: string;
  type: "direct" | "group";
  createdAt: string;
  other: Profile | null;
  lastMessage: LastMessage | null;
  title: string | null;
  avatarUrl: string | null;
  memberCount: number;
  isAdmin: boolean;
  isMuted: boolean;
  unreadCount: number;
};

/** Other-participant and last-message columns come from LEFT JOINs, so any of them may be null. */
export function chatSummaryFromRow(row: Row): ChatSummary {
  const otherId = str(row.other_user_id);
  const lastAt = str(row.last_message_at);
  return {
    chatId: String(row.chat_id),
    type: row.chat_type === "group" ? "group" : "direct",
    createdAt: String(row.chat_created_at),
    title: str(row.title),
    avatarUrl: str(row.avatar_url),
    memberCount: num(row.member_count) ?? 0,
    isAdmin: row.my_role === "admin",
    isMuted: row.is_muted === true,
    unreadCount: num(row.unread_count) ?? 0,
    other: otherId
      ? {
          id: otherId,
          username: str(row.other_username),
          displayName: str(row.other_display_name),
          avatarUrl: str(row.other_avatar_url),
        }
      : null,
    lastMessage: lastAt
      ? {
          content: str(row.last_message_content),
          type: str(row.last_message_type) ?? "text",
          senderId: str(row.last_message_sender_id),
          senderName: str(row.last_message_sender_name),
          createdAt: lastAt,
          durationSeconds: num(row.last_message_duration_seconds),
        }
      : null,
  };
}

export const isGroupChat = (c: { type: string }) => c.type === "group";

export const chatName = (c: ChatSummary) =>
  c.type === "group" ? (c.title?.trim() ? c.title : "Group") : profileName(c.other);

export const lastActivity = (c: ChatSummary) => c.lastMessage?.createdAt ?? c.createdAt;

/**
 * Search: groups match on their title; direct chats on the other person's
 * display name or @username. Case-insensitive; a leading "@" is ignored.
 */
export function chatMatches(c: ChatSummary, query: string) {
  const q = query.trim().toLowerCase().replace(/^@/, "");
  if (!q) return true;
  if (c.type === "group") return (c.title ?? "").toLowerCase().includes(q);
  return (
    (c.other?.displayName ?? "").toLowerCase().includes(q) ||
    (c.other?.username ?? "").toLowerCase().includes(q) ||
    chatName(c).toLowerCase().includes(q)
  );
}

/** One row of the `search_groups` RPC: any group on the platform. */
export type GroupSearchResult = {
  id: string;
  title: string;
  avatarUrl: string | null;
  memberCount: number;
  isMember: boolean;
};

export const groupSearchFromRow = (row: Row): GroupSearchResult => ({
  id: String(row.id),
  title: str(row.title) ?? "Group",
  avatarUrl: str(row.avatar_url),
  memberCount: num(row.member_count) ?? 0,
  isMember: row.is_member === true,
});

// ---------------------------------------------------------------------------
// Chat details
// ---------------------------------------------------------------------------

export type ChatMember = { profile: Profile; isAdmin: boolean; joinedAt: string };

export type ChatDetails = {
  id: string;
  type: "direct" | "group";
  title: string | null;
  /** Admins first, then by name. */
  members: ChatMember[];
  isAdmin: boolean;
  isMuted: boolean;
};

export const detailsOther = (d: ChatDetails, meId: string) => d.members.find((m) => m.profile.id !== meId)?.profile ?? null;

export const detailsName = (d: ChatDetails, meId: string) =>
  d.type === "group" ? (d.title?.trim() ? d.title : "Group") : profileName(detailsOther(d, meId));

export const detailsMember = (d: ChatDetails | null, id: string | null) =>
  (id && d?.members.find((m) => m.profile.id === id)?.profile) || null;

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

export type MessageStatus = "sent" | "sending" | "failed";

/** text | image | audio | video | file | voicemail | system */
export type ChatMessage = {
  id: string;
  chatId: string;
  senderId: string | null;
  type: string;
  content: string | null;
  /** R2 object key (`chats/<chat>/<sender>/<uuid>.<ext>`). */
  mediaUrl: string | null;
  createdAt: string;
  durationSeconds: number | null;
  /** Bytes, for file cards ("2.4 MB"); null for older messages. */
  fileSize: number | null;
  editedAt: string | null;
  callId: string | null;
  voicemailPlayedAt: string | null;

  // Local-only, while sending (kept in the outbox across launches).
  status: MessageStatus;
  localUri?: string | null;
  /** Original file name of a pending upload. */
  fileName?: string | null;
  progress?: number | null;
  error?: string | null;
};

export function messageFromRow(row: Row): ChatMessage {
  return {
    id: String(row.id),
    chatId: String(row.chat_id),
    senderId: str(row.sender_id),
    type: String(row.message_type),
    content: str(row.content),
    mediaUrl: str(row.media_url),
    createdAt: String(row.created_at),
    durationSeconds: num(row.duration_seconds),
    fileSize: num(row.file_size),
    editedAt: str(row.edited_at),
    callId: str(row.call_id),
    voicemailPlayedAt: str(row.voicemail_played_at),
    status: "sent",
  };
}

export const messagePublicUrl = (m: ChatMessage) => mediaPublicUrl(m.mediaUrl);

export const isMediaMessage = (m: ChatMessage) => ["image", "audio", "video", "file", "voicemail"].includes(m.type);

/** A call receipt posted by the server ("📞 Voice call · 01:23", "📹 Missed video call", …). */
export const isCallReceipt = (m: ChatMessage) =>
  m.type === "system" && (m.content?.startsWith("📞") === true || m.content?.startsWith("📹") === true);

/** Whether [meId] may still edit this message (text, own, within 10 minutes). */
export const canEdit = (m: ChatMessage, meId: string, now = Date.now()) =>
  m.type === "text" && m.senderId === meId && m.status === "sent" && now - Date.parse(m.createdAt) < Config.editWindowMs;

/** Insert or replace by id, keeping chronological order (local file kept so bubbles don't flicker). */
export function mergeMessages(current: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  const byId = new Map(current.map((m) => [m.id, m]));
  for (const m of incoming) {
    const prev = byId.get(m.id);
    byId.set(m.id, prev?.localUri && !m.localUri ? { ...m, localUri: prev.localUri } : m);
  }
  return [...byId.values()].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
}

/** Short preview used in the chat list (mirrors web messageSnippet). */
export function messageSnippet(type: string, content: string | null, durationSeconds?: number | null) {
  switch (type) {
    case "voicemail":
      return durationSeconds != null ? `🎙️ Voicemail · ${formatDuration(durationSeconds)}` : "🎙️ Voicemail";
    case "image":
      return content ? `📷 ${content}` : "📷 Photo";
    case "audio":
      return durationSeconds != null ? `🎤 Voice message · ${formatDuration(durationSeconds)}` : "🎤 Voice message";
    case "video":
      return "🎬 Video";
    case "file":
      return content ? `📎 ${content}` : "📎 File";
    default:
      return content ?? "";
  }
}

// ---------------------------------------------------------------------------
// Gallery (user_gallery)
// ---------------------------------------------------------------------------

export type GalleryKind = "image" | "video" | "audio" | "document";

export type GalleryItem = {
  id: string;
  /** `vault/<userId>/<fileId>.<ext>` */
  key: string;
  fileName: string;
  kind: GalleryKind;
  size: number;
  createdAt: string;
};

const galleryKind = (v: unknown): GalleryKind => (v === "image" || v === "video" || v === "audio" ? v : "document");

export const galleryFromRow = (row: Row): GalleryItem => ({
  id: String(row.id),
  key: String(row.media_url),
  fileName: String(row.file_name),
  kind: galleryKind(row.file_type),
  size: num(row.file_size) ?? 0,
  createdAt: String(row.created_at),
});

export const galleryUrl = (item: GalleryItem) => mediaPublicUrl(item.key);

// ---------------------------------------------------------------------------
// Calls
// ---------------------------------------------------------------------------

/** ringing | accepted | declined | cancelled | missed | ended | active */
export type CallRow = {
  id: string;
  chatId: string;
  callerId: string;
  calleeId: string | null;
  status: string;
  callType: "voice" | "video";
  isGroup: boolean;
  createdAt: string;
};

export const callFromRow = (row: Row): CallRow => ({
  id: String(row.id),
  chatId: String(row.chat_id),
  callerId: String(row.caller_id),
  calleeId: str(row.callee_id),
  status: String(row.status),
  callType: row.call_type === "video" ? "video" : "voice",
  isGroup: row.is_group === true,
  createdAt: String(row.created_at),
});

export type ActiveGroupCall = { callId: string; callType: "voice" | "video"; participantIds: string[] };
