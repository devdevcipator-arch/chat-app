"use client";

import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Avatar } from "@/components/avatar";
import {
  MESSAGE_MAX,
  MESSAGE_PAGE_SIZE,
  formatMessageTime,
  mergeMessages,
  profileName,
  type ChatMessage,
  type MessageRow,
  type PublicProfile,
} from "@/lib/chat";
import { createClient } from "@/lib/supabase/client";

type Props = {
  chatId: string;
  meId: string;
  other: PublicProfile | null;
  initialMessages: ChatMessage[];
};

export function ChatWindow({ chatId, meId, other, initialMessages }: Props) {
  const [supabase] = useState(createClient);
  const [messages, setMessages] = useState(initialMessages);
  const [connected, setConnected] = useState(true);

  const scroller = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  // Realtime: append new messages for this chat as they are inserted.
  useEffect(() => {
    const catchUp = async () => {
      // Covers anything sent between the server render and (re)subscribing.
      const { data } = await supabase
        .from("messages")
        .select("*")
        .eq("chat_id", chatId)
        .order("created_at", { ascending: false })
        .limit(MESSAGE_PAGE_SIZE);
      if (data) setMessages((prev) => mergeMessages(prev, data));
    };

    const channel = supabase
      .channel(`chat:${chatId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `chat_id=eq.${chatId}` },
        (payload) => setMessages((prev) => mergeMessages(prev, [payload.new as MessageRow])),
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          setConnected(true);
          void catchUp();
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          setConnected(false);
        }
      });

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [supabase, chatId]);

  // Keep the view pinned to the newest message unless the user scrolled up.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const send = useCallback(
    async (message: ChatMessage) => {
      const { data, error } = await supabase
        .from("messages")
        .insert({
          id: message.id,
          chat_id: chatId,
          sender_id: meId,
          message_type: "text",
          content: message.content,
        })
        .select()
        .single();

      setMessages((prev) =>
        mergeMessages(prev, [error || !data ? { ...message, status: "failed" } : data]),
      );
    },
    [supabase, chatId, meId],
  );

  function handleSend(content: string) {
    const optimistic: ChatMessage = {
      id: crypto.randomUUID(),
      chat_id: chatId,
      sender_id: meId,
      message_type: "text",
      content,
      media_url: null,
      created_at: new Date().toISOString(),
      status: "sending",
    };
    stickToBottom.current = true;
    setMessages((prev) => mergeMessages(prev, [optimistic]));
    void send(optimistic);
  }

  function retry(message: ChatMessage) {
    const again = { ...message, status: "sending" as const };
    setMessages((prev) => mergeMessages(prev, [again]));
    void send(again);
  }

  const name = profileName(other);

  return (
    <section className="flex min-w-0 flex-1 flex-col" aria-label={`Conversation with ${name}`}>
      <header className="flex h-16 shrink-0 items-center gap-3 border-b border-zinc-200 px-3 md:px-4 dark:border-zinc-800">
        <Link
          href="/chat"
          aria-label="Back to chats"
          className="-ml-1 rounded-lg p-2 text-zinc-500 hover:bg-zinc-100 md:hidden dark:hover:bg-zinc-800"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="size-5" aria-hidden>
            <path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </Link>
        <Avatar name={name} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{name}</p>
          {other?.username && <p className="truncate text-xs text-zinc-500">@{other.username}</p>}
        </div>
        {!connected && (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-300">
            Reconnecting…
          </span>
        )}
      </header>

      <div
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
        className="min-h-0 flex-1 overflow-y-auto px-3 py-4 md:px-6"
        role="log"
        aria-live="polite"
      >
        {messages.length === 0 ? (
          <div className="flex h-full items-center justify-center text-center text-sm text-zinc-500">
            <p>
              This is the start of your conversation with {name}.
              <br />
              Say hi 👋
            </p>
          </div>
        ) : (
          <ol className="flex flex-col gap-1">
            <AnimatePresence initial={false}>
              {messages.map((message, i) => {
                const mine = message.sender_id === meId;
                const grouped = messages[i - 1]?.sender_id === message.sender_id;
                return (
                  <MessageBubble
                    key={message.id}
                    message={message}
                    mine={mine}
                    grouped={grouped}
                    onRetry={() => retry(message)}
                  />
                );
              })}
            </AnimatePresence>
          </ol>
        )}
      </div>

      <Composer onSend={handleSend} />
    </section>
  );
}

function MessageBubble({
  message,
  mine,
  grouped,
  onRetry,
}: {
  message: ChatMessage;
  mine: boolean;
  grouped: boolean;
  onRetry: () => void;
}) {
  if (message.message_type === "system") {
    return (
      <li className="my-2 text-center text-xs text-zinc-500">{message.content}</li>
    );
  }

  return (
    <motion.li
      initial={{ opacity: 0, y: 8, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.18, ease: "easeOut" }}
      className={`flex ${mine ? "justify-end" : "justify-start"} ${grouped ? "" : "mt-2"}`}
    >
      <div className={`flex max-w-[80%] flex-col md:max-w-[65%] ${mine ? "items-end" : "items-start"}`}>
        <div
          className={`rounded-2xl px-3.5 py-2 text-[15px] leading-snug break-words whitespace-pre-wrap ${
            mine
              ? "rounded-br-md bg-indigo-600 text-white"
              : "rounded-bl-md bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100"
          } ${message.status === "sending" ? "opacity-70" : ""}`}
        >
          {message.message_type === "text" ? message.content : <em>Unsupported message type</em>}
        </div>
        <div className="mt-0.5 flex items-center gap-1.5 px-1 text-[11px] text-zinc-500">
          {message.status === "failed" ? (
            <>
              <span className="text-red-600 dark:text-red-400">Not sent</span>
              <button type="button" onClick={onRetry} className="font-medium text-indigo-600 hover:underline dark:text-indigo-400">
                Retry
              </button>
            </>
          ) : message.status === "sending" ? (
            <span>Sending…</span>
          ) : (
            <time suppressHydrationWarning dateTime={message.created_at}>
              {formatMessageTime(message.created_at)}
            </time>
          )}
        </div>
      </div>
    </motion.li>
  );
}

function Composer({ onSend }: { onSend: (content: string) => void }) {
  const [text, setText] = useState("");
  const input = useRef<HTMLTextAreaElement>(null);

  // Auto-grow up to ~6 lines.
  useLayoutEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [text]);

  function submit(e?: FormEvent) {
    e?.preventDefault();
    const content = text.trim();
    if (!content) return;
    onSend(content);
    setText("");
    input.current?.focus();
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  }

  return (
    <form
      onSubmit={submit}
      className="flex shrink-0 items-end gap-2 border-t border-zinc-200 p-3 dark:border-zinc-800"
    >
      <textarea
        ref={input}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        rows={1}
        maxLength={MESSAGE_MAX}
        placeholder="Message"
        aria-label="Message"
        autoFocus
        className="max-h-40 min-h-10 flex-1 resize-none rounded-2xl border border-zinc-300 bg-white px-4 py-2 text-[15px] outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 dark:border-zinc-700 dark:bg-zinc-900"
      />
      <button
        type="submit"
        disabled={!text.trim()}
        aria-label="Send message"
        className="flex size-10 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-white transition hover:bg-indigo-500 disabled:opacity-40"
      >
        <svg viewBox="0 0 24 24" fill="currentColor" className="size-5" aria-hidden>
          <path d="M3.4 20.4 21 12 3.4 3.6l-.01 6.53L15 12l-11.61 1.87z" />
        </svg>
      </button>
    </form>
  );
}
