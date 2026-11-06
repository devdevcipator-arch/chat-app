import { createClient } from "@/lib/supabase/server";
import {
  MESSAGE_PAGE_SIZE,
  toChatSummary,
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

/** The chat's other participant + recent messages, or null if not a member. */
export async function getChat(chatId: string, meId: string) {
  const supabase = await createClient();

  const [participants, messages] = await Promise.all([
    supabase
      .from("chat_participants")
      .select("user_id, profiles(id, username, display_name, avatar_url)")
      .eq("chat_id", chatId),
    supabase
      .from("messages")
      .select("*")
      .eq("chat_id", chatId)
      .order("created_at", { ascending: false })
      .limit(MESSAGE_PAGE_SIZE),
  ]);

  if (participants.error || messages.error || !participants.data.length) return null;

  const otherRow = participants.data.find((p) => p.user_id !== meId);
  const otherProfile = otherRow?.profiles;
  const other: PublicProfile | null = otherProfile
    ? {
        id: otherProfile.id,
        username: otherProfile.username,
        displayName: otherProfile.display_name,
        avatarUrl: otherProfile.avatar_url,
      }
    : null;

  return {
    other,
    messages: messages.data.reverse() as ChatMessage[],
  };
}
