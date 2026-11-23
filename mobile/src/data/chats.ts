import { Config } from "../lib/config";
import { AppError, unwrap } from "../lib/errors";
import { supabase } from "../lib/supabase";
import {
  type ChatDetails,
  type ChatMember,
  type ChatMessage,
  type ChatSummary,
  type GroupSearchResult,
  chatSummaryFromRow,
  groupSearchFromRow,
  messageFromRow,
  profileFromRow,
  profileName,
} from "../models/types";
import { notifyPush } from "../services/pushNotify";

type Row = Record<string, unknown>;

/** Chat reads/writes. Everything runs as the signed-in user, so RLS scopes it to my chats. */
export const ChatRepo = {
  async listMyChats(): Promise<ChatSummary[]> {
    const rows = unwrap(await supabase.rpc("list_my_chats")) as Row[];
    return rows.map(chatSummaryFromRow);
  },

  /** The existing direct chat with [otherUserId] (un-hiding it), or a new one. */
  async createDirectChat(otherUserId: string): Promise<string> {
    return unwrap(await supabase.rpc("create_direct_chat", { p_other_user: otherUserId })) as string;
  },

  async createGroup(title: string, memberIds: string[]): Promise<string> {
    return unwrap(await supabase.rpc("create_group_chat", { p_title: title, p_member_ids: memberIds })) as string;
  },

  /** Every group on the platform whose title contains [query] (2+ chars), mine or not. */
  async searchGroups(query: string): Promise<GroupSearchResult[]> {
    const rows = unwrap(await supabase.rpc("search_groups", { p_query: query })) as Row[];
    return rows.map(groupSearchFromRow);
  },

  /** Joins a group someone else created (no-op if I'm already in it). */
  async joinGroup(groupId: string): Promise<string> {
    return unwrap(await supabase.rpc("join_group", { p_group_id: groupId })) as string;
  },

  /** Title, members and my role/mute; null if I'm no longer in the chat. */
  async details(chatId: string): Promise<ChatDetails | null> {
    const [chat, participants, membership] = await Promise.all([
      supabase.from("chats").select("id, type, title").eq("id", chatId).maybeSingle(),
      supabase
        .from("chat_participants")
        .select("user_id, role, joined_at, profiles(id, username, display_name, avatar_url)")
        .eq("chat_id", chatId),
      supabase.rpc("get_chat_membership", { p_chat_id: chatId }),
    ]);
    const chatRow = unwrap(chat) as Row | null;
    const rows = unwrap(participants) as Row[];
    const mine = (unwrap(membership) as Row[])[0];
    if (!chatRow || !mine) return null;

    const members: ChatMember[] = rows
      .map((row) => {
        const p = row.profiles as Row | null;
        return {
          profile: p && typeof p === "object" ? profileFromRow(p) : { id: String(row.user_id), username: null, displayName: null, avatarUrl: null },
          isAdmin: row.role === "admin",
          joinedAt: String(row.joined_at),
        };
      })
      .sort((a, b) =>
        a.isAdmin !== b.isAdmin
          ? a.isAdmin
            ? -1
            : 1
          : profileName(a.profile).toLowerCase().localeCompare(profileName(b.profile).toLowerCase()),
      );

    return {
      id: String(chatRow.id),
      type: chatRow.type === "group" ? "group" : "direct",
      title: (chatRow.title as string | null) ?? null,
      members,
      isAdmin: mine.role === "admin",
      isMuted: mine.is_muted === true,
    };
  },

  /** The most recent messages, oldest first (RLS hides anything before "clear chat"). */
  async recentMessages(chatId: string): Promise<ChatMessage[]> {
    const rows = unwrap(
      await supabase
        .from("messages")
        .select()
        .eq("chat_id", chatId)
        .order("created_at", { ascending: false })
        .limit(Config.messagePageSize),
    ) as Row[];
    return rows.reverse().map(messageFromRow);
  },

  /** Inserts a message with a client-chosen id; `created_at` is set by the server. */
  async insertMessage(values: Row): Promise<ChatMessage> {
    const message = messageFromRow(unwrap(await supabase.from("messages").insert(values).select().single()) as Row);
    notifyPush({ type: "new_message", messageId: message.id });
    return message;
  },

  async fetchMessage(id: string): Promise<ChatMessage | null> {
    const row = unwrap(await supabase.from("messages").select().eq("id", id).maybeSingle()) as Row | null;
    return row ? messageFromRow(row) : null;
  },

  /** Saves an edit (text only, own message, within 10 minutes; enforced in SQL). */
  async editMessage(messageId: string, content: string): Promise<ChatMessage> {
    const { data, error } = await supabase.rpc("edit_message", { p_message_id: messageId, p_new_content: content });
    if (error) {
      if (error.hint === "edit_window_expired" || /within 10 minutes/i.test(error.message)) {
        throw new AppError("Editing time limit expired (10 minutes max)");
      }
      if (["22023", "22001", "42501"].includes(error.code)) throw new AppError(`${error.message}.`);
      throw new AppError("Couldn't edit the message. Please try again.");
    }
    return messageFromRow(data as Row);
  },

  async markRead(chatId: string) {
    // Unread badges are cosmetic; never fail a screen over them.
    await supabase.rpc("mark_chat_read", { p_chat_id: chatId }).then(
      () => {},
      () => {},
    );
  },

  async markVoicemailPlayed(messageId: string): Promise<string | null> {
    const { data, error } = await supabase.rpc("mark_voicemail_played", { p_message_id: messageId });
    return error || typeof data !== "string" ? null : data;
  },

  setMuted: async (chatId: string, muted: boolean) => {
    unwrap(await supabase.rpc("set_chat_muted", { p_chat_id: chatId, p_muted: muted }));
  },
  clearChat: async (chatId: string) => {
    unwrap(await supabase.rpc("clear_chat", { p_chat_id: chatId }));
  },
  /** "Delete conversation" for a direct chat (only for me). */
  hideChat: async (chatId: string) => {
    unwrap(await supabase.rpc("hide_chat", { p_chat_id: chatId }));
  },
  leaveGroup: async (chatId: string) => {
    unwrap(await supabase.rpc("leave_group", { p_chat_id: chatId }));
  },
  deleteGroup: async (chatId: string) => {
    unwrap(await supabase.rpc("delete_group", { p_chat_id: chatId }));
  },
  renameGroup: async (chatId: string, title: string) => {
    unwrap(await supabase.rpc("update_group", { p_chat_id: chatId, p_title: title }));
  },
  addMembers: async (chatId: string, userIds: string[]) => {
    unwrap(await supabase.rpc("add_group_members", { p_chat_id: chatId, p_member_ids: userIds }));
  },
  removeMember: async (chatId: string, userId: string) => {
    unwrap(await supabase.rpc("remove_group_member", { p_chat_id: chatId, p_user_id: userId }));
  },
  setRole: async (chatId: string, userId: string, admin: boolean) => {
    unwrap(await supabase.rpc("set_group_role", { p_chat_id: chatId, p_user_id: userId, p_role: admin ? "admin" : "member" }));
  },
};
