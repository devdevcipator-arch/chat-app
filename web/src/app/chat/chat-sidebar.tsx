"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Avatar } from "@/components/avatar";
import { markRead } from "@/lib/chat-actions";
import { onChatEvent } from "@/lib/chat-events";
import {
  chatName,
  formatListTime,
  messageSnippet,
  profileName,
  toChatSummary,
  type ChatSummary,
  type MessageRow,
  type PublicProfile,
} from "@/lib/chat";
import { pageIsActive, playMessageSound, showMessageNotification } from "@/lib/notify";
import { createClient } from "@/lib/supabase/client";
import { ChatMenu } from "./chat-menu";
import { NewGroupButton } from "./new-group-dialog";
import { NotificationPrompt } from "./notification-prompt";
import { SignOutButton } from "./sign-out-button";
import { usePageActive, useUnreadTitle } from "./use-page-attention";
import { UserSearch } from "./user-search";

const CHAT_PATH = /^\/chat\/([0-9a-f-]{36})/i;

export function ChatSidebar({
  me,
  initialChats,
}: {
  me: PublicProfile & { username: string };
  initialChats: ChatSummary[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [supabase] = useState(createClient);
  const [chats, setChats] = useState(initialChats);
  const pageActive = usePageActive();
  const activeChatId = CHAT_PATH.exec(pathname)?.[1] ?? null;

  // Latest values for the realtime handler, which is subscribed once.
  const chatsRef = useRef(chats);
  const activeChatRef = useRef(activeChatId);
  useEffect(() => {
    chatsRef.current = chats;
    activeChatRef.current = activeChatId;
  }, [chats, activeChatId]);

  /** Sender names for group snippets / notifications, by user id. */
  const names = useRef(new Map<string, string>());
  const readTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(async () => {
    const { data, error } = await supabase.rpc("list_my_chats");
    if (error) return null;
    const next = data.map(toChatSummary);
    // The open chat is being read right now, whatever the server counted.
    const open = activeChatRef.current;
    const list = open && pageIsActive() ? next.map((c) => (c.chatId === open ? { ...c, unreadCount: 0 } : c)) : next;
    chatsRef.current = list;
    setChats(list);
    return list;
  }, [supabase]);

  const markReadSoon = useCallback(
    (chatId: string) => {
      if (readTimer.current) clearTimeout(readTimer.current);
      readTimer.current = setTimeout(() => void markRead(supabase, chatId), 800);
    },
    [supabase],
  );

  const senderName = useCallback(
    async (userId: string | null) => {
      if (!userId) return null;
      const cached = names.current.get(userId);
      if (cached) return cached;
      const { data } = await supabase
        .from("profiles")
        .select("id, username, display_name, avatar_url")
        .eq("id", userId)
        .maybeSingle();
      if (!data) return null;
      const name = profileName({
        id: data.id,
        username: data.username,
        displayName: data.display_name,
        avatarUrl: data.avatar_url,
      });
      names.current.set(userId, name);
      return name;
    },
    [supabase],
  );

  /** Sound + desktop notification for someone else's message. */
  const alertFor = useCallback(
    (chat: ChatSummary, message: MessageRow, sender: string | null) => {
      if (chat.isMuted || message.message_type === "system" || message.sender_id === me.id) return;
      playMessageSound();
      if (pageIsActive()) return;
      const name = chatName(chat);
      const snippet = messageSnippet(message.message_type, message.content);
      showMessageNotification({
        title: chat.type === "group" ? name : (sender ?? name),
        body: chat.type === "group" && sender ? `${sender}: ${snippet}` : snippet,
        tag: chat.chatId,
        onClick: () => router.push(`/chat/${chat.chatId}`),
      });
    },
    [me.id, router],
  );

  // Live updates for every chat I'm in (RLS filters the stream).
  useEffect(() => {
    async function onMessage(message: MessageRow) {
      const mine = message.sender_id === me.id;
      const sender = mine ? "You" : await senderName(message.sender_id);
      const known = chatsRef.current.find((c) => c.chatId === message.chat_id);

      if (!known) {
        // A new chat or group (or one I had hidden): the server has the details.
        const list = await refresh();
        const chat = list?.find((c) => c.chatId === message.chat_id);
        if (chat) alertFor(chat, message, sender);
        return;
      }

      const viewing = message.chat_id === activeChatRef.current && pageIsActive();
      const counts = !mine && !viewing && message.message_type !== "system";
      const updated: ChatSummary = {
        ...known,
        unreadCount: viewing ? 0 : known.unreadCount + (counts ? 1 : 0),
        lastMessage: {
          content: message.content,
          type: message.message_type,
          senderId: message.sender_id,
          senderName: sender,
          createdAt: message.created_at,
        },
      };
      setChats((prev) => [updated, ...prev.filter((c) => c.chatId !== message.chat_id)]);
      if (viewing && !mine) markReadSoon(message.chat_id);
      // System messages can mean a rename or membership change.
      if (message.message_type === "system" && known.type === "group") void refresh();
      alertFor(known, message, sender);
    }

    const channel = supabase
      .channel(`sidebar:${me.id}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, (payload) => {
        void onMessage(payload.new as MessageRow);
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") void refresh(); // catch up after reconnects
      });

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [supabase, me.id, refresh, senderName, alertFor, markReadSoon]);

  // Opening a chat (or coming back to the tab) reads it.
  useEffect(() => {
    if (!activeChatId || !pageActive) return;
    void markRead(supabase, activeChatId).then(() =>
      setChats((prev) =>
        prev.some((c) => c.chatId === activeChatId && c.unreadCount > 0)
          ? prev.map((c) => (c.chatId === activeChatId ? { ...c, unreadCount: 0 } : c))
          : prev,
      ),
    );
  }, [supabase, activeChatId, pageActive]);

  // Coming back to the tab: pick up removals and renames we can't stream.
  useEffect(() => {
    if (pageActive) void refresh();
  }, [pageActive, refresh]);

  // Actions taken elsewhere on the page (menus, group info).
  useEffect(
    () =>
      onChatEvent((event) => {
        switch (event.type) {
          case "muted":
            setChats((prev) => prev.map((c) => (c.chatId === event.chatId ? { ...c, isMuted: event.muted } : c)));
            break;
          case "cleared":
            setChats((prev) =>
              prev.map((c) => (c.chatId === event.chatId ? { ...c, lastMessage: null, unreadCount: 0 } : c)),
            );
            break;
          case "removed":
            setChats((prev) => prev.filter((c) => c.chatId !== event.chatId));
            break;
          case "read":
            setChats((prev) => prev.map((c) => (c.chatId === event.chatId ? { ...c, unreadCount: 0 } : c)));
            break;
          case "updated":
            void refresh();
            break;
        }
      }),
    [refresh],
  );

  useEffect(
    () => () => {
      if (readTimer.current) clearTimeout(readTimer.current);
    },
    [],
  );

  const totalUnread = chats.reduce((sum, c) => sum + (c.isMuted ? 0 : c.unreadCount), 0);
  useUnreadTitle(totalUnread);

  async function startChat(otherUserId: string): Promise<string | null> {
    const { data: chatId, error } = await supabase.rpc("create_direct_chat", {
      p_other_user: otherUserId,
    });
    if (error || !chatId) {
      return error?.code === "P0002" ? "That user no longer exists." : "Couldn't start the chat. Please try again.";
    }
    await refresh();
    router.push(`/chat/${chatId}`);
    return null;
  }

  const myName = me.displayName || me.username;

  return (
    <>
      <div className="flex items-center justify-between gap-2 px-4 pt-4 pb-3">
        <h1 className="text-lg font-semibold tracking-tight">Chats</h1>
        <div className="flex items-center gap-0.5">
          <Link
            href="/gallery"
            title="My Gallery"
            className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium text-indigo-600 transition hover:bg-indigo-50 dark:text-indigo-400 dark:hover:bg-indigo-950/50"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              className="size-4"
              aria-hidden
            >
              <rect x="3" y="3" width="18" height="18" rx="3" />
              <circle cx="9" cy="9" r="2" />
              <path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21" />
            </svg>
            Gallery
          </Link>
          <NewGroupButton
            meId={me.id}
            onCreated={async () => {
              await refresh();
            }}
          />
        </div>
      </div>

      <UserSearch meId={me.id} onStartChat={startChat} />
      <NotificationPrompt />

      <nav aria-label="Conversations" className="mt-3 min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {chats.length === 0 ? (
          <p className="mx-1 rounded-lg border border-dashed border-zinc-300 px-3 py-6 text-center text-sm text-zinc-500 dark:border-zinc-700">
            No conversations yet. Search for an @username to start one, or create a group.
          </p>
        ) : (
          <ul className="space-y-0.5">
            {chats.map((chat) => (
              <ChatRow key={chat.chatId} chat={chat} meId={me.id} active={chat.chatId === activeChatId} />
            ))}
          </ul>
        )}
      </nav>

      <div className="flex items-center gap-3 border-t border-zinc-200 p-3 dark:border-zinc-800">
        <Avatar name={myName} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{myName}</p>
          <p className="truncate text-xs text-zinc-500">@{me.username}</p>
        </div>
        <SignOutButton />
      </div>
    </>
  );
}

function ChatRow({ chat, meId, active }: { chat: ChatSummary; meId: string; active: boolean }) {
  const name = chatName(chat);
  const last = chat.lastMessage;
  const group = chat.type === "group";
  const unread = chat.unreadCount > 0 && !active;

  let snippet = "No messages yet";
  if (last) {
    const text = messageSnippet(last.type, last.content);
    if (last.type === "system") snippet = text;
    else if (last.senderId === meId) snippet = `You: ${text}`;
    else if (group && last.senderName) snippet = `${last.senderName}: ${text}`;
    else snippet = text;
  }
  const subtitle = group ? `${chat.memberCount} members` : chat.other?.username ? `@${chat.other.username}` : null;

  return (
    <li className="group/row relative">
      <Link
        href={`/chat/${chat.chatId}`}
        aria-current={active ? "page" : undefined}
        aria-label={`${name}${unread ? `, ${chat.unreadCount} unread` : ""}${chat.isMuted ? ", muted" : ""}`}
        className={`flex items-center gap-3 rounded-lg py-2 pr-10 pl-2 transition ${
          active ? "bg-indigo-50 dark:bg-indigo-950/50" : "hover:bg-zinc-200/60 dark:hover:bg-zinc-800/60"
        }`}
      >
        <Avatar name={name} group={group} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-1.5">
            <p className={`min-w-0 flex-1 truncate text-sm ${unread ? "font-semibold" : "font-medium"}`}>{name}</p>
            {chat.isMuted && <MutedIcon />}
            <time
              suppressHydrationWarning
              dateTime={last?.createdAt ?? chat.createdAt}
              className={`shrink-0 text-[11px] ${unread && !chat.isMuted ? "text-indigo-600 dark:text-indigo-400" : "text-zinc-500"}`}
            >
              {formatListTime(last?.createdAt ?? chat.createdAt)}
            </time>
          </div>
          {subtitle && <p className="truncate text-xs text-zinc-500">{subtitle}</p>}
          <div className="flex items-center gap-2">
            <p
              className={`min-w-0 flex-1 truncate text-xs ${
                unread ? "font-medium text-zinc-900 dark:text-zinc-100" : "text-zinc-600 dark:text-zinc-400"
              }`}
            >
              {snippet}
            </p>
            {unread && (
              <span
                aria-hidden
                className={`min-w-5 shrink-0 rounded-full px-1.5 text-center text-[11px] leading-5 font-semibold text-white ${
                  chat.isMuted ? "bg-zinc-400 dark:bg-zinc-600" : "bg-indigo-600"
                }`}
              >
                {chat.unreadCount > 99 ? "99+" : chat.unreadCount}
              </span>
            )}
          </div>
        </div>
      </Link>
      <div className="absolute top-2 right-1.5 opacity-100 transition md:opacity-0 md:group-focus-within/row:opacity-100 md:group-hover/row:opacity-100">
        <ChatMenu
          chatId={chat.chatId}
          type={chat.type}
          name={name}
          isMuted={chat.isMuted}
          isAdmin={chat.myRole === "admin"}
        />
      </div>
    </li>
  );
}

function MutedIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-3.5 shrink-0 self-center text-zinc-400"
      aria-hidden
    >
      <path d="M13.7 21a2 2 0 0 1-3.4 0M18.6 13A17.9 17.9 0 0 1 18 8M6.3 6.3A5.8 5.8 0 0 0 6 8c0 7-3 9-3 9h14M18 8a6 6 0 0 0-9.3-5M3 3l18 18" />
    </svg>
  );
}
