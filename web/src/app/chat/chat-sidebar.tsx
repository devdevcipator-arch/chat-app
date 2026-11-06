"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Avatar } from "@/components/avatar";
import {
  formatListTime,
  messageSnippet,
  profileName,
  toChatSummary,
  type ChatSummary,
  type MessageRow,
  type PublicProfile,
} from "@/lib/chat";
import { createClient } from "@/lib/supabase/client";
import { SignOutButton } from "./sign-out-button";
import { UserSearch } from "./user-search";

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
  const chatsRef = useRef(chats);

  useEffect(() => {
    chatsRef.current = chats;
  }, [chats]);

  const refresh = useCallback(async () => {
    const { data, error } = await supabase.rpc("list_my_chats");
    if (!error) setChats(data.map(toChatSummary));
  }, [supabase]);

  // Live updates: new messages in any of my chats (RLS filters the stream to
  // chats I'm in) and new chats someone else started with me.
  useEffect(() => {
    const channel = supabase
      .channel(`sidebar:${me.id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages" },
        (payload) => {
          const message = payload.new as MessageRow;
          if (!chatsRef.current.some((c) => c.chatId === message.chat_id)) {
            void refresh();
            return;
          }
          setChats((prev) => {
            const target = prev.find((c) => c.chatId === message.chat_id);
            if (!target) return prev;
            const updated: ChatSummary = {
              ...target,
              lastMessage: {
                content: message.content,
                type: message.message_type,
                senderId: message.sender_id,
                createdAt: message.created_at,
              },
            };
            return [updated, ...prev.filter((c) => c.chatId !== message.chat_id)];
          });
        },
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "chat_participants", filter: `user_id=eq.${me.id}` },
        () => void refresh(),
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [supabase, me.id, refresh]);

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
      <div className="px-4 pt-4 pb-3">
        <h1 className="text-lg font-semibold tracking-tight">Chats</h1>
      </div>

      <UserSearch meId={me.id} onStartChat={startChat} />

      <nav aria-label="Conversations" className="mt-3 min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {chats.length === 0 ? (
          <p className="mx-1 rounded-lg border border-dashed border-zinc-300 px-3 py-6 text-center text-sm text-zinc-500 dark:border-zinc-700">
            No conversations yet. Search for an @username to start one.
          </p>
        ) : (
          <ul className="space-y-0.5">
            {chats.map((chat) => {
              const href = `/chat/${chat.chatId}`;
              const active = pathname === href;
              const name = profileName(chat.other);
              const last = chat.lastMessage;
              const snippet = last
                ? `${last.senderId === me.id ? "You: " : ""}${messageSnippet(last.type, last.content)}`
                : "No messages yet";
              return (
                <li key={chat.chatId}>
                  <Link
                    href={href}
                    aria-current={active ? "page" : undefined}
                    className={`flex items-center gap-3 rounded-lg px-2 py-2 transition ${
                      active
                        ? "bg-indigo-50 dark:bg-indigo-950/50"
                        : "hover:bg-zinc-200/60 dark:hover:bg-zinc-800/60"
                    }`}
                  >
                    <Avatar name={name} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-2">
                        <p className="min-w-0 flex-1 truncate text-sm font-medium">{name}</p>
                        <time
                          suppressHydrationWarning
                          dateTime={last?.createdAt ?? chat.createdAt}
                          className="shrink-0 text-[11px] text-zinc-500"
                        >
                          {formatListTime(last?.createdAt ?? chat.createdAt)}
                        </time>
                      </div>
                      {chat.other?.username && (
                        <p className="truncate text-xs text-zinc-500">@{chat.other.username}</p>
                      )}
                      <p className="truncate text-xs text-zinc-600 dark:text-zinc-400">{snippet}</p>
                    </div>
                  </Link>
                </li>
              );
            })}
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
