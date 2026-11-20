import { ChatListScreen } from "../../../features/chatList";

/** Chats: every conversation (direct + groups), newest activity first. */
export default function ChatsTab() {
  return <ChatListScreen groupsOnly={false} />;
}
