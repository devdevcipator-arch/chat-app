"use client";

import type { ReactNode } from "react";
import { useCachedChatList } from "@/lib/chat-cache";
import { ChatRow } from "./chat-sidebar";

/**
 * Sidebar placeholder while the server render streams in: the chat list as it
 * was last time (lib/chat-cache.ts), so the list is readable and clickable
 * immediately instead of a skeleton. Falls back to `skeleton` with no cache.
 */
export function CachedChatList({ skeleton }: { skeleton: ReactNode }) {
  const cached = useCachedChatList();
  if (!cached?.chats.length) return skeleton;
  return (
    <div className="flex min-h-0 w-full flex-1 flex-col md:w-80 md:flex-none" aria-busy>
      <div className="flex items-center px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-3">
        <h1 className="text-xl font-bold tracking-tight md:text-lg md:font-semibold">Chats</h1>
      </div>
      <div className="mx-4 mb-3 h-10 rounded-xl bg-zinc-200/70 md:h-9 dark:bg-zinc-800/70" aria-hidden />
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-6 md:mt-1 md:px-2 md:pb-0">
        <ul className="divide-y divide-zinc-200/70 md:space-y-0.5 md:divide-y-0 dark:divide-zinc-800/40">
          {cached.chats.map((chat) => (
            <ChatRow key={chat.chatId} chat={chat} meId={cached.userId} active={false} />
          ))}
        </ul>
      </div>
    </div>
  );
}
