"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Avatar } from "@/components/avatar";
import { ThemeSync } from "@/components/theme";
import type { Profile } from "@/lib/auth";
import { markRead } from "@/lib/chat-actions";
import { onChatEvent } from "@/lib/chat-events";
import {
  chatMatches,
  chatName,
  formatListTime,
  messageSnippet,
  profileName,
  toChatSummary,
  type ChatSummary,
  type MessageRow,
} from "@/lib/chat";
import { pageIsActive, playMessageSound, showMessageNotification } from "@/lib/notify";
import { createClient } from "@/lib/supabase/client";
import { CallsPanel } from "./calls-panel";
import { ChatMenu } from "./chat-menu";
import { NewGroupButton } from "./new-group-dialog";
import { NotificationPrompt } from "./notification-prompt";
import { BottomNav, GalleryIcon, NavRail, type SidebarTab, type TabBadges } from "./sidebar-nav";
import { usePageActive, useUnreadTitle } from "./use-page-attention";
import { useMissedCalls } from "./use-missed-calls";
import { PeopleLookup, usernameQuery } from "./user-search";

const CHAT_PATH = /^\/chat\/([0-9a-f-]{36})/i;

export function ChatSidebar({
  me,
  initialChats,
}: {
  me: Profile & { username: string };
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
      const snippet = messageSnippet(message.message_type, message.content, message.duration_seconds);
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
          durationSeconds: message.duration_seconds,
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

  // Which list shows. Opening a chat of the other kind (a link, a
  // notification) switches to its tab so it stays visible in the list.
  const [tab, setTab] = useState<SidebarTab>("chats");
  const [syncedChatId, setSyncedChatId] = useState(activeChatId);
  if (syncedChatId !== activeChatId) {
    setSyncedChatId(activeChatId);
    const open = chats.find((c) => c.chatId === activeChatId);
    // Chats lists every conversation, so only a direct chat opened from the
    // Groups tab needs to switch tabs to stay visible.
    if (open && tab === "groups" && open.type !== "group") setTab("chats");
  }

  const [groupFilter, setGroupFilter] = useState("");
  const [chatQuery, setChatQuery] = useState("");
  // Chats: every conversation (direct + groups), newest activity first.
  // Groups: group chats only.
  const allChats = [...chats].sort((a, b) => lastActivity(b) - lastActivity(a));
  const allGroups = allChats.filter((c) => c.type === "group");
  // Chats search: direct chats by name / @username, groups by title.
  const chatSearch = chatQuery.trim();
  const shownChats = chatSearch ? allChats.filter((c) => chatMatches(c, chatSearch)) : allChats;
  const searchGroups = shownChats.filter((c) => c.type === "group");
  const searchDirects = shownChats.filter((c) => c.type !== "group");
  const groupQuery = groupFilter.trim();
  const groupChats = groupQuery ? allGroups.filter((c) => chatMatches(c, groupQuery)) : allGroups;
  const { count: missedCalls, markSeen: markCallsSeen } = useMissedCalls(me.id, tab === "calls");
  const selectTab = (next: SidebarTab) => {
    setTab(next);
    if (next === "calls") markCallsSeen(); // opening Calls clears its badge
  };
  const unreadOf = (list: ChatSummary[]) =>
    list.reduce((sum, c) => sum + (c.isMuted || c.chatId === activeChatId ? 0 : c.unreadCount), 0);
  const badges: TabBadges = { chats: unreadOf(allChats), groups: unreadOf(allGroups), calls: missedCalls };

  return (
    <>
      <NavRail
        active={tab}
        onChange={selectTab}
        badges={badges}
        me={{ name: myName, username: me.username, avatarUrl: me.avatarUrl }}
      />

      <div className="flex min-h-0 w-full flex-1 flex-col md:w-80 md:flex-none">
        <div className="flex items-center justify-between gap-2 px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-3">
          <h1 className="text-xl font-bold tracking-tight md:text-lg md:font-semibold">{TAB_TITLES[tab]}</h1>
          <div className="flex items-center gap-3 md:gap-0.5">
            {tab === "groups" && (
              <NewGroupButton
                meId={me.id}
                onCreated={async () => {
                  await refresh();
                }}
              />
            )}
            {/* On desktop the gallery and profile live in the rail. */}
            <Link
              href="/gallery"
              title="My Gallery"
              aria-label="My Gallery"
              className="flex size-9 items-center justify-center rounded-full text-indigo-600 transition hover:bg-indigo-50 md:hidden dark:text-indigo-400 dark:hover:bg-indigo-950/50"
            >
              <GalleryIcon />
            </Link>
            <Link
              href="/settings/profile"
              aria-label={`${myName}, @${me.username}: profile and settings`}
              className="flex size-9 items-center justify-center rounded-full md:hidden"
            >
              <Avatar name={myName} src={me.avatarUrl} size="sm" />
            </Link>
          </div>
        </div>

        {/* Always visible at the top: no extra tap to reveal search. */}
        {tab === "chats" && (
          <SearchBox
            value={chatQuery}
            onChange={setChatQuery}
            placeholder="Search chats & groups…"
            label="Search chats and groups, or find a user by @username"
          />
        )}
        {tab === "groups" && (
          <SearchBox value={groupFilter} onChange={setGroupFilter} placeholder="Search your groups…" label="Search your groups" />
        )}
        {tab !== "calls" && <NotificationPrompt />}

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-6 md:mt-1 md:pb-0">
          {tab === "calls" ? (
            <CallsPanel meId={me.id} chats={chats} />
          ) : tab === "chats" && chatSearch ? (
            // Searching: matching groups first, so existing groups are never
            // buried under direct chats or the @username lookup.
            <div className="space-y-3 pb-2">
              {searchGroups.length > 0 && (
                <SearchSection title="Groups" count={searchGroups.length}>
                  <ChatList chats={searchGroups} meId={me.id} activeChatId={activeChatId} empty="" />
                </SearchSection>
              )}
              {searchDirects.length > 0 && (
                <SearchSection title="Direct Chats" count={searchDirects.length}>
                  <ChatList chats={searchDirects} meId={me.id} activeChatId={activeChatId} empty="" />
                </SearchSection>
              )}
              {usernameQuery(chatSearch) ? (
                <SearchSection title="Find People (@username)">
                  <div className="px-2">
                    <PeopleLookup query={chatSearch} meId={me.id} onStartChat={startChat} onStarted={() => setChatQuery("")} />
                  </div>
                </SearchSection>
              ) : (
                shownChats.length === 0 && (
                  <p className="mx-3 rounded-lg border border-dashed border-zinc-300 px-3 py-6 text-center text-sm text-zinc-500 dark:border-zinc-700">
                    No matching chats or groups.
                  </p>
                )
              )}
            </div>
          ) : (
            <ChatList
              chats={tab === "groups" ? groupChats : shownChats}
              meId={me.id}
              activeChatId={activeChatId}
              empty={
                tab === "groups"
                  ? groupQuery
                    ? "No matching groups."
                    : "No groups yet. Create one with “New group”."
                  : chatSearch
                    ? "No matching chats."
                    : "No conversations yet. Search for an @username to start one."
              }
            />
          )}
        </div>

        <ThemeSync preference={me.themePreference} />
      </div>

      {/* Sign out lives on the Profile & Settings page on mobile. */}
      <BottomNav active={tab} onChange={selectTab} badges={badges} />
    </>
  );
}

function lastActivity(chat: ChatSummary) {
  return Date.parse(chat.lastMessage?.createdAt ?? chat.createdAt);
}

function SearchBox({
  value,
  onChange,
  placeholder,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  label: string;
}) {
  return (
    <div className="px-4 pt-1 pb-3.5 md:px-3 md:pt-0 md:pb-2">
      <div className="relative">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden className="pointer-events-none absolute inset-y-0 left-3 my-auto size-4 text-zinc-400">
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
        <input
          type="search"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          aria-label={label}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          className="h-11 w-full rounded-xl border border-zinc-200 bg-white pr-3 pl-9 md:h-9 md:rounded-lg text-base outline-none md:text-sm transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 dark:border-zinc-800 dark:bg-zinc-900"
        />
      </div>
    </div>
  );
}

function SearchSection({ title, count, children }: { title: string; count?: number; children: ReactNode }) {
  return (
    <section aria-label={title}>
      <h2 className="px-4 pb-1 text-[11px] font-semibold tracking-wide text-zinc-500 uppercase">
        {title}
        {count ? <span className="ml-1 font-normal">· {count}</span> : null}
      </h2>
      {children}
    </section>
  );
}

const TAB_TITLES: Record<SidebarTab, string> = { chats: "Chats", groups: "Groups", calls: "Calls" };

function ChatList({
  chats,
  meId,
  activeChatId,
  empty,
}: {
  chats: ChatSummary[];
  meId: string;
  activeChatId: string | null;
  empty: string;
}) {
  return (
    <nav aria-label="Conversations" className="pb-2 md:px-2">
      {chats.length === 0 ? (
        <p className="mx-4 rounded-lg border border-dashed md:mx-1 border-zinc-300 px-3 py-6 text-center text-sm text-zinc-500 dark:border-zinc-700">
          {empty}
        </p>
      ) : (
        <ul className="divide-y divide-zinc-200/70 md:space-y-0.5 md:divide-y-0 dark:divide-zinc-800/40">
          {chats.map((chat) => (
            <ChatRow key={chat.chatId} chat={chat} meId={meId} active={chat.chatId === activeChatId} />
          ))}
        </ul>
      )}
    </nav>
  );
}

function ChatRow({ chat, meId, active }: { chat: ChatSummary; meId: string; active: boolean }) {
  const name = chatName(chat);
  const last = chat.lastMessage;
  const group = chat.type === "group";
  const unread = chat.unreadCount > 0 && !active;

  let snippet = "No messages yet";
  if (last) {
    const text = messageSnippet(last.type, last.content, last.durationSeconds);
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
        className={`flex items-center gap-3.5 py-3.5 pr-11 pl-4 transition md:gap-3 md:rounded-lg md:py-2 md:pr-10 md:pl-2 ${
          active ? "bg-indigo-50 dark:bg-indigo-950/50" : "hover:bg-zinc-200/60 dark:hover:bg-zinc-800/60"
        }`}
      >
        <Avatar name={name} src={group ? null : chat.other?.avatarUrl} group={group} size="row" />
        <div className="min-w-0 flex-1 space-y-0.5 leading-snug">
          <div className="flex items-baseline gap-1.5">
            <p className={`min-w-0 flex-1 truncate text-[15px] md:text-sm ${unread ? "font-semibold" : "font-medium"}`}>{name}</p>
            {chat.isMuted && <MutedIcon />}
            <time
              suppressHydrationWarning
              dateTime={last?.createdAt ?? chat.createdAt}
              className={`shrink-0 text-[11px] ${unread && !chat.isMuted ? "text-indigo-600 dark:text-indigo-400" : "text-zinc-500"}`}
            >
              {formatListTime(last?.createdAt ?? chat.createdAt)}
            </time>
          </div>
          {subtitle && <p className="truncate text-xs leading-snug text-zinc-500">{subtitle}</p>}
          <div className="flex items-center gap-2">
            <p
              className={`min-w-0 flex-1 truncate text-[13px] leading-snug md:text-xs ${
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
      <div className="absolute top-3 right-2 opacity-100 md:top-2 md:right-1.5 transition md:opacity-0 md:group-focus-within/row:opacity-100 md:group-hover/row:opacity-100">
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
