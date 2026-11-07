import { createClient } from "@/lib/supabase/server";
import {
  MESSAGE_PAGE_SIZE,
  asChatType,
  asRole,
  toChatSummary,
  toMembers,
  type ChatDetails,
  type ChatMessage,
  type PublicProfile,
} from "@/lib/chat";

// Server-side chat reads. All queries run as the signed-in user, so RLS
// guarantees only the caller's own chats and messages are returned.

export async function getMyChats() {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_my_chats");
  if (error) {
    console.error("list_my_chats failed:", error.message);
    return [];
  }
  return data.map(toChatSummary);
}

/** The chat, its members and recent messages, or null if not a member. */
export async function getChat(chatId: string, meId: string): Promise<{
  details: ChatDetails;
  other: PublicProfile | null;
  messages: ChatMessage[];
} | null> {
  const supabase = await createClient();

  const [chat, participants, membership, messages] = await Promise.all([
    supabase.from("chats").select("id, type, title").eq("id", chatId).maybeSingle(),
    supabase
      .from("chat_participants")
      .select("user_id, role, joined_at, profiles(id, username, display_name, avatar_url)")
      .eq("chat_id", chatId),
    supabase.rpc("get_chat_membership", { p_chat_id: chatId }),
    supabase
      .from("messages")
      .select("*")
      .eq("chat_id", chatId)
      .order("created_at", { ascending: false })
      .limit(MESSAGE_PAGE_SIZE),
  ]);

  const mine = membership.data?.[0];
  if (chat.error || participants.error || membership.error || messages.error) return null;
  if (!chat.data || !mine) return null; // not a participant, or no such chat

  const members = toMembers(participants.data);
  const type = asChatType(chat.data.type);
  const other = type === "direct" ? (members.find((m) => m.id !== meId) ?? null) : null;

  return {
    details: {
      id: chat.data.id,
      type,
      title: chat.data.title,
      members,
      myRole: asRole(mine.role),
      isMuted: mine.is_muted,
    },
    other: other && { id: other.id, username: other.username, displayName: other.displayName, avatarUrl: other.avatarUrl },
    messages: messages.data.reverse() as ChatMessage[],
  };
}
