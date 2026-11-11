"use client";

import { useEffect, useState } from "react";
import { Avatar } from "@/components/avatar";
import { Dialog } from "@/components/dialog";
import { chatName, toChatSummary, type ChatSummary } from "@/lib/chat";
import { UploadError } from "@/lib/media-client";
import { createClient } from "@/lib/supabase/client";
import type { GalleryItem } from "@/lib/vault";
import { forwardGalleryItem } from "@/lib/vault-client";
import { CheckIcon } from "./icons";

export function ForwardDialog({
  item,
  chats,
  onChatsLoaded,
  onClose,
  onSent,
}: {
  item: GalleryItem | null;
  chats: ChatSummary[];
  onChatsLoaded: (chats: ChatSummary[]) => void;
  onClose: () => void;
  onSent: (chat: ChatSummary) => void;
}) {
  return (
    <Dialog open={!!item} onClose={onClose} title="Forward to…" description={item?.fileName}>
      {item && <ForwardPanel item={item} chats={chats} onChatsLoaded={onChatsLoaded} onSent={onSent} />}
    </Dialog>
  );
}

function ForwardPanel({
  item,
  chats,
  onChatsLoaded,
  onSent,
}: {
  item: GalleryItem;
  chats: ChatSummary[];
  onChatsLoaded: (chats: ChatSummary[]) => void;
  onSent: (chat: ChatSummary) => void;
}) {
  const [query, setQuery] = useState("");
  /** Picking a chat only selects it; nothing is sent until "Send" is pressed. */
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selected = chats.find((c) => c.chatId === selectedChatId) ?? null;

  // Refresh the list in the background: new chats may exist since page load.
  useEffect(() => {
    let cancelled = false;
    createClient()
      .rpc("list_my_chats")
      .then(({ data }) => {
        if (!cancelled && data) onChatsLoaded(data.map(toChatSummary));
      });
    return () => {
      cancelled = true;
    };
  }, [onChatsLoaded]);

  const q = query.trim().toLowerCase();
  const visible = q
    ? chats.filter(
        (c) => chatName(c).toLowerCase().includes(q) || (c.other?.username ?? "").toLowerCase().includes(q),
      )
    : chats;

  async function send() {
    if (!selected || sending) return;
    setSending(true);
    setError(null);
    try {
      await forwardGalleryItem(item.id, selected.chatId);
      onSent(selected); // closes the dialog, which also resets the selection
    } catch (e) {
      setError(e instanceof UploadError ? e.message : "Couldn't send. Please try again.");
      setSending(false);
    }
  }

  return (
    <>
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search chats and groups"
        aria-label="Search chats and groups"
        className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 dark:border-zinc-700 dark:bg-zinc-950"
      />
      {error && (
        <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/50 dark:text-red-300">
          {error}
        </p>
      )}
      <ul role="radiogroup" aria-label="Chats" className="mt-3 -mx-2 min-h-0 flex-1 space-y-0.5 overflow-y-auto">
        {visible.length === 0 ? (
          <li className="px-2 py-6 text-center text-sm text-zinc-500">
            {chats.length === 0 ? "You don't have any chats yet." : "No chats match your search."}
          </li>
        ) : (
          visible.map((chat) => {
            const name = chatName(chat);
            const group = chat.type === "group";
            const isSelected = chat.chatId === selectedChatId;
            return (
              <li key={chat.chatId}>
                <button
                  type="button"
                  role="radio"
                  aria-checked={isSelected}
                  onClick={() => {
                    setSelectedChatId(chat.chatId);
                    setError(null);
                  }}
                  disabled={sending}
                  className={`flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left ring-inset transition disabled:cursor-default ${
                    isSelected
                      ? "bg-indigo-50 ring-2 ring-indigo-500 dark:bg-indigo-950/50"
                      : "hover:bg-zinc-100 disabled:hover:bg-transparent dark:hover:bg-zinc-800"
                  }`}
                >
                  <Avatar name={name} src={group ? null : chat.other?.avatarUrl} group={group} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{name}</span>
                    <span className="block truncate text-xs text-zinc-500">
                      {group ? `Group · ${chat.memberCount} members` : chat.other?.username ? `@${chat.other.username}` : "Direct chat"}
                    </span>
                  </span>
                  <span
                    aria-hidden
                    className={`flex size-5 shrink-0 items-center justify-center rounded-full border-2 transition ${
                      isSelected ? "border-indigo-600 bg-indigo-600 text-white" : "border-zinc-300 dark:border-zinc-600"
                    }`}
                  >
                    {isSelected && <CheckIcon className="size-3" />}
                  </span>
                </button>
              </li>
            );
          })
        )}
      </ul>

      <div className="-mx-1 mt-3 flex items-center justify-end gap-2 border-t border-zinc-200 px-1 pt-3 dark:border-zinc-800">
        {!selected && <p className="mr-auto text-xs text-zinc-500">Choose a chat to forward to.</p>}
        <button
          type="button"
          onClick={() => void send()}
          disabled={!selected || sending}
          aria-busy={sending || undefined}
          className="inline-flex min-w-0 items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {sending ? (
            <span className="size-4 shrink-0 animate-spin rounded-full border-2 border-white/40 border-t-white" aria-hidden />
          ) : (
            <svg viewBox="0 0 24 24" fill="currentColor" className="size-4 shrink-0" aria-hidden>
              <path d="M3.4 20.4 21 12 3.4 3.6l-.01 6.53L15 12l-11.61 1.87z" />
            </svg>
          )}
          <span className="truncate">
            {sending ? "Sending…" : selected ? `Send to ${chatName(selected)}` : "Send"}
          </span>
        </button>
      </div>
    </>
  );
}
