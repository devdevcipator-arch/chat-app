"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Thumbnail } from "@/app/gallery/thumbnail";
import { Dialog } from "@/components/dialog";
import type { MessageRow } from "@/lib/chat";
import { UploadError } from "@/lib/media-client";
import { createClient } from "@/lib/supabase/client";
import { toGalleryItem, type GalleryItem } from "@/lib/vault";
import { forwardGalleryItem } from "@/lib/vault-client";

const MAX_PICK = 10;

/**
 * "Photos & Videos" from the 📎 menu: pick items from your in-app Gallery and
 * send them to this chat without leaving it. Sending uses the same server
 * route as the Gallery's Forward (it copies the file into the chat's folder).
 */
export function GalleryPicker({
  open,
  chatId,
  onClose,
  onSent,
}: {
  open: boolean;
  chatId: string;
  onClose: () => void;
  /** Rows that were posted, plus a message if some couldn't be sent. */
  onSent: (rows: MessageRow[], error: string | null) => void;
}) {
  const [sending, setSending] = useState(false);
  return (
    <Dialog
      open={open}
      onClose={() => !sending && onClose()}
      title="Photos & Videos"
      description="Choose from your Gallery to send here."
    >
      {open && <PickerPanel chatId={chatId} sending={sending} setSending={setSending} onSent={onSent} />}
    </Dialog>
  );
}

function PickerPanel({
  chatId,
  sending,
  setSending,
  onSent,
}: {
  chatId: string;
  sending: boolean;
  setSending: (sending: boolean) => void;
  onSent: (rows: MessageRow[], error: string | null) => void;
}) {
  const [items, setItems] = useState<GalleryItem[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [sentCount, setSentCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    createClient()
      .from("user_gallery")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(500)
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error || !data) setLoadError(true);
        else setItems(data.map(toGalleryItem).filter((i) => i.kind === "image" || i.kind === "video"));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function toggle(id: string) {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : prev.length >= MAX_PICK ? prev : [...prev, id],
    );
  }

  async function send() {
    if (sending || selected.length === 0) return;
    setSending(true);
    setSentCount(0);
    const rows: MessageRow[] = [];
    let error: string | null = null;
    for (const id of selected) {
      // One at a time, in the order picked, so they arrive in that order.
      try {
        rows.push(await forwardGalleryItem(id, chatId));
        setSentCount(rows.length);
      } catch (e) {
        error = e instanceof UploadError ? e.message : "Some items couldn't be sent.";
      }
    }
    setSending(false);
    onSent(rows, error);
  }

  if (loadError) {
    return <p className="py-8 text-center text-sm text-red-600 dark:text-red-400">Couldn&apos;t load your Gallery. Please try again.</p>;
  }

  if (!items) {
    return (
      <div className="grid animate-pulse grid-cols-3 gap-2 sm:grid-cols-4">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="aspect-square rounded-lg bg-zinc-200 dark:bg-zinc-800" />
        ))}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="py-8 text-center text-sm text-zinc-500">
        <p>No photos or videos in your Gallery yet.</p>
        <Link href="/gallery" className="mt-2 inline-block font-medium text-indigo-600 hover:underline dark:text-indigo-400">
          Open My Gallery to add some
        </Link>
      </div>
    );
  }

  const full = selected.length >= MAX_PICK;
  return (
    <>
      <ul className="-mx-1 grid min-h-0 flex-1 grid-cols-3 gap-2 overflow-y-auto p-1 sm:grid-cols-4" aria-label="Your photos and videos">
        {items.map((item) => {
          const order = selected.indexOf(item.id);
          const isSelected = order !== -1;
          return (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => toggle(item.id)}
                disabled={sending || (!isSelected && full)}
                aria-pressed={isSelected}
                aria-label={`${isSelected ? "Deselect" : "Select"} ${item.fileName}`}
                className={`group/card relative block aspect-square w-full overflow-hidden rounded-lg bg-zinc-100 outline-none transition focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:cursor-default dark:bg-zinc-800 ${
                  isSelected ? "ring-2 ring-indigo-600 ring-offset-2 ring-offset-white dark:ring-offset-zinc-900" : ""
                } ${!isSelected && full ? "opacity-40" : ""}`}
              >
                <Thumbnail item={item} />
                <span
                  aria-hidden
                  className={`absolute top-1.5 right-1.5 flex size-6 items-center justify-center rounded-full border-2 text-xs font-bold transition ${
                    isSelected ? "border-indigo-600 bg-indigo-600 text-white" : "border-white/90 bg-black/25"
                  }`}
                >
                  {isSelected ? order + 1 : ""}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      <div className="-mx-1 mt-3 flex items-center justify-end gap-2 border-t border-zinc-200 px-1 pt-3 dark:border-zinc-800">
        <p className="mr-auto text-xs text-zinc-500">
          {selected.length === 0 ? `Select up to ${MAX_PICK}.` : `${selected.length} selected${full ? " (max)" : ""}`}
        </p>
        <button
          type="button"
          onClick={() => void send()}
          disabled={selected.length === 0 || sending}
          aria-busy={sending || undefined}
          className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {sending ? (
            <span className="size-4 shrink-0 animate-spin rounded-full border-2 border-white/40 border-t-white" aria-hidden />
          ) : (
            <svg viewBox="0 0 24 24" fill="currentColor" className="size-4 shrink-0" aria-hidden>
              <path d="M3.4 20.4 21 12 3.4 3.6l-.01 6.53L15 12l-11.61 1.87z" />
            </svg>
          )}
          {sending ? `Sending ${sentCount + 1} of ${selected.length}…` : selected.length > 1 ? `Send ${selected.length}` : "Send"}
        </button>
      </div>
    </>
  );
}
