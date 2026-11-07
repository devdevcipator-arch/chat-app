import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { emitChatEvent } from "@/lib/chat-events";
import type { Database } from "@/lib/database.types";
import { asChatType, asRole, toMembers, type ChatDetails } from "@/lib/chat";

// Client-side conversation and group actions. Every one is an RPC whose
// permission checks run in the database; these wrappers only translate
// errors and broadcast the outcome to the rest of the page.

type Client = SupabaseClient<Database>;

/** Ok, or a message to show the user. */
export type ActionResult = { ok: true } | { ok: false; error: string };

const OK: ActionResult = { ok: true };

function errorMessage(error: PostgrestError): string {
  switch (error.message) {
    case "not a group admin":
      return "Only group admins can do that.";
    case "last admin":
      return "A group needs at least one admin. Make someone else an admin first.";
    case "too many members":
      return "Groups can have up to 100 members.";
    case "invalid title":
      return "Group names must be 1–60 characters.";
    case "no members":
      return "Add at least one other person.";
    case "not a member":
      return "You're no longer in this conversation.";
  }
  if (error.code === "42501") return "Your session has expired. Please sign in again.";
  return "Something went wrong. Please try again.";
}

const failure = (error: PostgrestError): ActionResult => ({ ok: false, error: errorMessage(error) });

export async function setMuted(supabase: Client, chatId: string, muted: boolean): Promise<ActionResult> {
  const { error } = await supabase.rpc("set_chat_muted", { p_chat_id: chatId, p_muted: muted });
  if (error) return failure(error);
  emitChatEvent({ type: "muted", chatId, muted });
  return OK;
}

export async function clearChat(supabase: Client, chatId: string): Promise<ActionResult> {
  const { error } = await supabase.rpc("clear_chat", { p_chat_id: chatId });
  if (error) return failure(error);
  emitChatEvent({ type: "cleared", chatId });
  return OK;
}

/** "Delete conversation" for a direct chat (only for me). */
export async function hideChat(supabase: Client, chatId: string): Promise<ActionResult> {
  const { error } = await supabase.rpc("hide_chat", { p_chat_id: chatId });
  if (error) return failure(error);
  emitChatEvent({ type: "removed", chatId });
  return OK;
}

export async function leaveGroup(supabase: Client, chatId: string): Promise<ActionResult> {
  const { error } = await supabase.rpc("leave_group", { p_chat_id: chatId });
  if (error) return failure(error);
  emitChatEvent({ type: "removed", chatId });
  return OK;
}

export async function deleteGroup(supabase: Client, chatId: string): Promise<ActionResult> {
  const { error } = await supabase.rpc("delete_group", { p_chat_id: chatId });
  if (error) return failure(error);
  emitChatEvent({ type: "removed", chatId });
  return OK;
}

export async function createGroup(
  supabase: Client,
  title: string,
  memberIds: string[],
): Promise<{ ok: true; chatId: string } | { ok: false; error: string }> {
  const { data, error } = await supabase.rpc("create_group_chat", { p_title: title, p_member_ids: memberIds });
  if (error) return { ok: false, error: errorMessage(error) };
  if (!data) return { ok: false, error: "Couldn't create the group." };
  return { ok: true, chatId: data };
}

/**
 * Opens the 1-on-1 chat with someone: the existing one (un-hidden if I had
 * deleted it) or a new one. Tells the sidebar to pick it up.
 */
export async function openDirectChat(
  supabase: Client,
  userId: string,
): Promise<{ ok: true; chatId: string } | { ok: false; error: string }> {
  const { data, error } = await supabase.rpc("create_direct_chat", { p_other_user: userId });
  if (error?.code === "P0002") return { ok: false, error: "That account is no longer available." };
  if (error) return { ok: false, error: errorMessage(error) };
  if (!data) return { ok: false, error: "Couldn't open the chat. Please try again." };
  emitChatEvent({ type: "updated", chatId: data });
  return { ok: true, chatId: data };
}

export async function renameGroup(supabase: Client, chatId: string, title: string): Promise<ActionResult> {
  const { error } = await supabase.rpc("update_group", { p_chat_id: chatId, p_title: title });
  if (error) return failure(error);
  emitChatEvent({ type: "updated", chatId });
  return OK;
}

export async function addMembers(supabase: Client, chatId: string, userIds: string[]): Promise<ActionResult> {
  const { error } = await supabase.rpc("add_group_members", { p_chat_id: chatId, p_member_ids: userIds });
  if (error) return failure(error);
  emitChatEvent({ type: "updated", chatId });
  return OK;
}

export async function removeMember(supabase: Client, chatId: string, userId: string): Promise<ActionResult> {
  const { error } = await supabase.rpc("remove_group_member", { p_chat_id: chatId, p_user_id: userId });
  if (error) return failure(error);
  emitChatEvent({ type: "updated", chatId });
  return OK;
}

export async function setRole(
  supabase: Client,
  chatId: string,
  userId: string,
  role: "admin" | "member",
): Promise<ActionResult> {
  const { error } = await supabase.rpc("set_group_role", { p_chat_id: chatId, p_user_id: userId, p_role: role });
  if (error) return failure(error);
  emitChatEvent({ type: "updated", chatId });
  return OK;
}

export async function markRead(supabase: Client, chatId: string) {
  await supabase.rpc("mark_chat_read", { p_chat_id: chatId });
}

/** Fresh title, members and my role/mute; null if I'm no longer in the chat. */
export async function fetchChatDetails(supabase: Client, chatId: string): Promise<ChatDetails | null> {
  const [chat, participants, membership] = await Promise.all([
    supabase.from("chats").select("id, type, title").eq("id", chatId).maybeSingle(),
    supabase
      .from("chat_participants")
      .select("user_id, role, joined_at, profiles(id, username, display_name, avatar_url)")
      .eq("chat_id", chatId),
    supabase.rpc("get_chat_membership", { p_chat_id: chatId }),
  ]);
  const mine = membership.data?.[0];
  if (!chat.data || participants.error || !mine) return null;
  return {
    id: chat.data.id,
    type: asChatType(chat.data.type),
    title: chat.data.title,
    members: toMembers(participants.data),
    myRole: asRole(mine.role),
    isMuted: mine.is_muted,
  };
}
