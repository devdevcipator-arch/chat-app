import { create } from "zustand";
import { Cache } from "../data/cache";
import { ChatRepo } from "../data/chats";
import { dbErrorMessage } from "../lib/errors";
import { type ChatMessage, type ChatSummary, type GroupSearchResult, lastActivity } from "../models/types";
import { Network } from "./network";

type ChatsState = {
  /** Every conversation, newest activity first. */
  chats: ChatSummary[];
  /** True only on a first launch with nothing cached. */
  loading: boolean;
  error: string | null;
  /** The chat open on screen (its unread count stays 0). */
  openChatId: string | null;
};

export const useChats = create<ChatsState>(() => ({ chats: [], loading: true, error: null, openChatId: null }));

let meId: string | null = null;
let persistTimer: ReturnType<typeof setTimeout> | null = null;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;

const sortChats = (chats: ChatSummary[]) =>
  [...chats].sort((a, b) => Date.parse(lastActivity(b)) - Date.parse(lastActivity(a)));

function setChats(chats: ChatSummary[], extra: Partial<ChatsState> = {}) {
  useChats.setState({ chats: sortChats(chats), ...extra });
  if (persistTimer) clearTimeout(persistTimer);
  const user = meId;
  persistTimer = setTimeout(() => {
    if (user) Cache.saveChats(user, useChats.getState().chats);
  }, 500);
}

export const Chats = {
  /** Hydrates from the cache (0 ms) for [userId], then syncs in the background. */
  attach(userId: string) {
    if (meId === userId) return;
    meId = userId;
    const cached = Cache.chats(userId);
    useChats.setState({ chats: sortChats(cached ?? []), loading: cached == null, error: null, openChatId: null });
    void Chats.refresh();
  },

  detach() {
    meId = null;
    if (persistTimer) clearTimeout(persistTimer);
    if (refreshTimer) clearTimeout(refreshTimer);
    useChats.setState({ chats: [], loading: true, error: null, openChatId: null });
  },

  async refresh() {
    const user = meId;
    if (!user) return;
    try {
      const chats = await ChatRepo.listMyChats();
      Network.reportSuccess();
      if (meId !== user) return;
      const open = useChats.getState().openChatId;
      setChats(
        chats.map((c) => (c.chatId === open ? { ...c, unreadCount: 0 } : c)),
        { loading: false, error: null },
      );
    } catch (e) {
      // Cached chats stay on screen; the offline banner explains why.
      Network.reportFailure(e);
      if (meId === user) useChats.setState({ loading: false, error: dbErrorMessage(e) });
    }
  },

  refreshSoon() {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => void Chats.refresh(), 400);
  },

  /** A message arrived (Realtime) or was sent by me: bump the row. */
  onMessage(message: ChatMessage) {
    const { chats, openChatId } = useChats.getState();
    const chat = chats.find((c) => c.chatId === message.chatId);
    if (!chat || message.type === "system") {
      Chats.refreshSoon(); // a new chat, or a rename/membership change
      return;
    }
    // An echo of my own message that's already the preview: nothing to do.
    if (chat.lastMessage && message.senderId === meId && chat.lastMessage.content === message.content && message.status === "sent") {
      if (Date.parse(chat.lastMessage.createdAt) >= Date.parse(message.createdAt)) return;
    }
    const fromOther = message.senderId !== meId && openChatId !== message.chatId && message.status === "sent";
    const updated: ChatSummary = {
      ...chat,
      lastMessage: {
        content: message.content,
        type: message.type,
        senderId: message.senderId,
        senderName: chat.lastMessage?.senderId === message.senderId ? chat.lastMessage.senderName : null,
        createdAt: message.createdAt,
        durationSeconds: message.durationSeconds,
      },
      unreadCount: fromOther ? chat.unreadCount + 1 : chat.unreadCount,
    };
    setChats(chats.map((c) => (c.chatId === chat.chatId ? updated : c)));
  },

  setOpen(chatId: string | null) {
    useChats.setState({ openChatId: chatId });
    if (chatId) Chats.patch(chatId, { unreadCount: 0 });
  },

  patch(chatId: string, patch: Partial<ChatSummary>) {
    setChats(useChats.getState().chats.map((c) => (c.chatId === chatId ? { ...c, ...patch } : c)));
  },

  remove(chatId: string) {
    setChats(useChats.getState().chats.filter((c) => c.chatId !== chatId));
    if (meId) Cache.removeMessages(meId, chatId);
  },

  find: (chatId: string) => useChats.getState().chats.find((c) => c.chatId === chatId) ?? null,

  /** Joined a group from search: add a row now; the next refresh fills it in. */
  addJoinedGroup(chatId: string, group: GroupSearchResult) {
    if (Chats.find(chatId)) return;
    setChats([
      {
        chatId,
        type: "group",
        createdAt: new Date().toISOString(),
        other: null,
        lastMessage: null,
        title: group.title,
        avatarUrl: group.avatarUrl,
        memberCount: group.isMember ? group.memberCount : group.memberCount + 1,
        isAdmin: false,
        isMuted: false,
        unreadCount: 0,
      },
      ...useChats.getState().chats,
    ]);
  },
};

/** Unread total over [chats]: unmuted conversations only, never the open one. */
export const unreadOf = (chats: ChatSummary[], openChatId: string | null) =>
  chats.reduce((sum, c) => sum + (c.isMuted || c.chatId === openChatId ? 0 : c.unreadCount), 0);
