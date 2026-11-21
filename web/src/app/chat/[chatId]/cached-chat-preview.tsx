"use client";

import { useParams } from "next/navigation";
import { useLayoutEffect, useRef, type ReactNode } from "react";
import { Avatar } from "@/components/avatar";
import { messageSnippet } from "@/lib/chat";
import { useCachedChat } from "@/lib/chat-cache";
import { EarlyComposer } from "./early-composer";

/**
 * Shown the instant a conversation opens, while its server render streams in:
 * the header and last messages as this tab last saw them (lib/chat-cache.ts).
 * Read-only; the live ChatWindow replaces it a moment later. Falls back to
 * `skeleton` for a chat this tab hasn't opened yet.
 */
export function CachedChatPreview({ skeleton }: { skeleton: ReactNode }) {
  const { chatId } = useParams<{ chatId: string }>();
  const cached = useCachedChat(chatId);
  const scroller = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [cached]);

  if (!cached) return skeleton;

  return (
    <section className="flex min-w-0 flex-1 flex-col" aria-label={`Conversation with ${cached.name}`} aria-busy>
      <header className="box-content flex h-14 shrink-0 items-center gap-3 border-b border-zinc-200 px-4 pt-[env(safe-area-inset-top)] sm:h-16 dark:border-zinc-800">
        <Avatar name={cached.name} src={cached.avatarUrl} group={cached.group} />
        <p className="min-w-0 flex-1 truncate font-medium">{cached.name}</p>
      </header>
      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-6">
        <ul className="flex flex-col gap-1.5">
          {cached.messages.map((m) => {
            if (m.message_type === "system") {
              return (
                <li key={m.id} className="my-2 text-center text-xs text-zinc-500">
                  {m.content}
                </li>
              );
            }
            const mine = m.sender_id === cached.userId;
            const text = m.message_type === "text" ? m.content : messageSnippet(m.message_type, m.content, m.duration_seconds);
            return (
              <li key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[min(18rem,70vw)] min-w-0 rounded-2xl px-3.5 py-2 text-[15px] leading-snug break-words whitespace-pre-wrap [overflow-wrap:anywhere] ${
                    mine
                      ? "rounded-tr-md bg-indigo-600 text-white"
                      : "rounded-tl-md bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100"
                  }`}
                >
                  {text}
                </div>
              </li>
            );
          })}
        </ul>
      </div>
      <EarlyComposer />
    </section>
  );
}
