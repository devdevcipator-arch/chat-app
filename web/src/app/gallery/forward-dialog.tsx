"use client";

import { useEffect, useState } from "react";
import { Avatar } from "@/components/avatar";
import { Dialog } from "@/components/dialog";
import { chatName, toChatSummary, type ChatSummary } from "@/lib/chat";
import { UploadError } from "@/lib/media-client";
import { createClient } from "@/lib/supabase/client";
import type { GalleryItem } from "@/lib/vault";
import { forwardGalleryItem } from "@/lib/vault-client";

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
  const [sendingTo, setSendingTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  async function send(chat: ChatSummary) {
    if (sendingTo) return;
    setSendingTo(chat.chatId);
    setError(null);
    try {
      await forwardGalleryItem(item.id, chat.chatId);
      onSent(chat);
    } catch (e) {
      setError(e instanceof UploadError ? e.message : "Couldn't send. Please try again.");
      setSendingTo(null);
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
      <ul className="mt-3 -mx-2 min-h-0 flex-1 overflow-y-auto">
        {visible.length === 0 ? (
          <li className="px-2 py-6 text-center text-sm text-zinc-500">
            {chats.length === 0 ? "You don't have any chats yet." : "No chats match your search."}
          </li>
        ) : (
          visible.map((chat) => {
            const name = chatName(chat);
            const group = chat.type === "group";
            const busy = sendingTo === chat.chatId;
            return (
              <li key={chat.chatId}>
                <button
                  type="button"
                  onClick={() => send(chat)}
                  disabled={!!sendingTo}
                  className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition hover:bg-zinc-100 disabled:cursor-default disabled:hover:bg-transparent dark:hover:bg-zinc-800"
                >
                  <Avatar name={name} group={group} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{name}</span>
                    <span className="block truncate text-xs text-zinc-500">
                      {group ? `Group · ${chat.memberCount} members` : chat.other?.username ? `@${chat.other.username}` : "Direct chat"}
                    </span>
                  </span>
                  <span
                    className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${
                      busy ? "bg-indigo-600 text-white" : "bg-indigo-50 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300"
                    }`}
                  >
                    {busy ? "Sending…" : "Send"}
                  </span>
                </button>
              </li>
            );
          })
        )}
      </ul>
    </>
  );
}
