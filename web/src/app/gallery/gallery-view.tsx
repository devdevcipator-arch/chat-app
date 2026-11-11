"use client";

import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useCallback, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { ConfirmDialog } from "@/components/dialog";
import { chatName, type ChatSummary } from "@/lib/chat";
import { UploadError } from "@/lib/media-client";
import { VAULT_ACCEPT, VAULT_MAX_BYTES, formatBytes, type GalleryItem } from "@/lib/vault";
import { checkVaultFile, deleteGalleryItem, galleryDownloadUrl, uploadToGallery } from "@/lib/vault-client";
import { ForwardDialog } from "./forward-dialog";
import {
  AlertIcon,
  BackIcon,
  CloseIcon,
  DownloadIcon,
  FileIcon,
  MusicIcon,
  PlayIcon,
  PlusIcon,
  ShareIcon,
  TrashIcon,
  UploadIcon,
} from "./icons";
import { MediaViewer } from "./media-viewer";
import { Toasts, useToasts } from "./toasts";

type Upload = { id: string; name: string; size: number; progress: number; error?: string };

const PARALLEL_UPLOADS = 3;

const errorText = (e: unknown, fallback = "Something went wrong. Please try again.") =>
  e instanceof UploadError ? e.message : fallback;

export function GalleryView({
  initialItems,
  initialChats,
}: {
  initialItems: GalleryItem[];
  initialChats: ChatSummary[];
}) {
  const [items, setItems] = useState(initialItems);
  const [chats, setChats] = useState(initialChats);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [viewing, setViewing] = useState<number | null>(null);
  const [forwarding, setForwarding] = useState<GalleryItem | null>(null);
  const [deleting, setDeleting] = useState<GalleryItem | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const { toasts, push, dismiss } = useToasts();

  // --- Upload ---------------------------------------------------------------

  const patchUpload = useCallback((id: string, changes: Partial<Upload>) => {
    setUploads((prev) => prev.map((u) => (u.id === id ? { ...u, ...changes } : u)));
  }, []);

  const uploadFiles = useCallback(
    async (files: File[]) => {
      const queue: { file: File; id: string }[] = [];
      for (const file of files) {
        try {
          checkVaultFile(file);
          queue.push({ file, id: crypto.randomUUID() });
        } catch (e) {
          push({ tone: "error", text: errorText(e) });
        }
      }
      if (queue.length === 0) return;

      setUploads((prev) => [
        ...queue.map(({ file, id }) => ({ id, name: file.name, size: file.size, progress: 0 })),
        ...prev,
      ]);

      let done = 0;
      const worker = async () => {
        for (let next = queue.shift(); next; next = queue.shift()) {
          const { file, id } = next;
          try {
            const item = await uploadToGallery(file, (progress) => patchUpload(id, { progress }));
            setItems((prev) => [item, ...prev.filter((i) => i.id !== item.id)]);
            setUploads((prev) => prev.filter((u) => u.id !== id));
            done++;
          } catch (e) {
            patchUpload(id, { error: errorText(e, "Upload failed. Please try again.") });
          }
        }
      };
      const total = queue.length;
      await Promise.all(Array.from({ length: Math.min(PARALLEL_UPLOADS, total) }, worker));
      if (done > 0) push({ tone: "success", text: done === 1 ? "Added to your gallery" : `${done} files added to your gallery` });
    },
    [patchUpload, push],
  );

  function onPick(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = ""; // allow picking the same file again
    void uploadFiles(files);
  }

  const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer.types).includes("Files");

  function onDragEnter(e: DragEvent) {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth.current++;
    setDragging(true);
  }
  function onDragLeave(e: DragEvent) {
    if (!hasFiles(e)) return;
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragging(false);
  }
  function onDragOver(e: DragEvent) {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  }
  function onDrop(e: DragEvent) {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    void uploadFiles(Array.from(e.dataTransfer.files));
  }

  // --- Item actions ----------------------------------------------------------

  const openPicker = () => fileInput.current?.click();

  function askDelete(item: GalleryItem) {
    if (!deleteBusy) setDeleting(item);
  }

  /** Permanent: the server purges the R2 file, then hard-deletes the row. */
  async function deleteItem(item: GalleryItem) {
    setDeleting(item); // keeps the dialog up with its spinner (also on Retry)
    setDeleteBusy(true);
    try {
      await deleteGalleryItem(item.id);
      setItems((prev) => prev.filter((i) => i.id !== item.id));
      setViewing(null); // close the full-screen viewer (it animates out)
      push({ tone: "success", text: "Item permanently deleted" });
    } catch (e) {
      push({
        tone: "error",
        text: errorText(e),
        action: { label: "Retry", onClick: () => void deleteItem(item) },
      });
    } finally {
      setDeleteBusy(false);
      setDeleting(null);
    }
  }

  const onSent = useCallback(
    (chat: ChatSummary) => {
      setForwarding(null);
      push({ tone: "success", text: `Forwarded to ${chatName(chat)}`, action: { label: "Open chat", href: `/chat/${chat.chatId}` } });
    },
    [push],
  );

  const closeViewer = useCallback(() => setViewing(null), []);
  const closeForward = useCallback(() => setForwarding(null), []);
  const totalBytes = items.reduce((sum, i) => sum + i.size, 0);

  return (
    <div
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
      onDrop={onDrop}
      className="relative min-h-dvh bg-white dark:bg-zinc-950"
    >
      <header className="sticky top-0 z-20 border-b border-zinc-200 bg-white/85 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/85">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4">
          <Link
            href="/chat"
            className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-medium text-zinc-600 transition hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            <BackIcon />
            <span className="max-sm:sr-only">Back to Chats</span>
          </Link>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-lg font-semibold tracking-tight">My Gallery</h1>
            <p className="truncate text-xs text-zinc-500">
              {items.length === 0 ? "Your private cloud vault" : `${items.length} item${items.length === 1 ? "" : "s"} · ${formatBytes(totalBytes)}`}
            </p>
          </div>
          <button
            type="button"
            onClick={openPicker}
            className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3.5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
          >
            <PlusIcon />
            Upload Media
          </button>
          <input ref={fileInput} type="file" multiple accept={VAULT_ACCEPT} onChange={onPick} className="hidden" />
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-5">
        <DropZone onBrowse={openPicker} compact={items.length > 0 || uploads.length > 0} />

        {uploads.length > 0 && (
          <ul className="mt-4 space-y-2" aria-label="Uploads">
            {uploads.map((u) => (
              <UploadRow key={u.id} upload={u} onDismiss={() => setUploads((prev) => prev.filter((x) => x.id !== u.id))} />
            ))}
          </ul>
        )}

        {items.length > 0 && (
          <ul className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            <AnimatePresence initial={false}>
              {items.map((item, index) => (
                <GalleryCard
                  key={item.id}
                  item={item}
                  onOpen={() => setViewing(index)}
                  onForward={() => setForwarding(item)}
                  onDelete={() => askDelete(item)}
                />
              ))}
            </AnimatePresence>
          </ul>
        )}
      </main>

      <AnimatePresence>
        {dragging && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center bg-indigo-600/10 p-6 backdrop-blur-[2px]"
          >
            <div className="flex flex-col items-center gap-3 rounded-3xl border-2 border-dashed border-indigo-500 bg-white/90 px-10 py-12 text-indigo-700 shadow-xl dark:bg-zinc-900/90 dark:text-indigo-300">
              <UploadIcon className="size-10" />
              <p className="text-base font-semibold">Drop to add to your gallery</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <MediaViewer
        items={items}
        index={viewing}
        onIndex={setViewing}
        onClose={closeViewer}
        onForward={setForwarding}
        onDelete={askDelete}
      />

      <ForwardDialog item={forwarding} chats={chats} onChatsLoaded={setChats} onClose={closeForward} onSent={onSent} />

      <ConfirmDialog
        open={!!deleting}
        title="Permanently delete item?"
        description="This will permanently delete this file from your personal vault and cloud storage. This action cannot be undone."
        confirmLabel="Delete Permanently"
        danger
        busy={deleteBusy}
        busyLabel="Deleting…"
        onConfirm={() => deleting && void deleteItem(deleting)}
        onClose={() => !deleteBusy && setDeleting(null)}
      />

      <Toasts toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}

// --- Pieces -----------------------------------------------------------------

function DropZone({ onBrowse, compact }: { onBrowse: () => void; compact: boolean }) {
  const limits = `Images up to ${formatBytes(VAULT_MAX_BYTES.image)}, videos up to ${formatBytes(VAULT_MAX_BYTES.video)}, audio and documents up to ${formatBytes(VAULT_MAX_BYTES.document)}`;

  if (compact) {
    return (
      <button
        type="button"
        onClick={onBrowse}
        className="flex w-full items-center gap-3 rounded-xl border border-dashed border-zinc-300 px-4 py-3 text-left text-sm text-zinc-500 transition hover:border-indigo-400 hover:bg-indigo-50/50 hover:text-indigo-700 dark:border-zinc-700 dark:hover:border-indigo-500 dark:hover:bg-indigo-950/30 dark:hover:text-indigo-300"
      >
        <UploadIcon className="size-5 shrink-0" />
        <span>
          <span className="font-medium">Drag & drop files anywhere</span> or click to browse
        </span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onBrowse}
      className="flex w-full flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-zinc-300 px-6 py-16 text-center transition hover:border-indigo-400 hover:bg-indigo-50/40 dark:border-zinc-700 dark:hover:border-indigo-500 dark:hover:bg-indigo-950/20"
    >
      <span className="flex size-14 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600 dark:bg-indigo-950/60 dark:text-indigo-400">
        <UploadIcon className="size-7" />
      </span>
      <span className="text-base font-semibold">Your gallery is empty</span>
      <span className="max-w-sm text-sm text-zinc-500">
        Drag & drop photos, videos, audio or documents here, or click to browse. Forward them to any chat whenever you like.
      </span>
      <span className="text-xs text-zinc-400">{limits}</span>
    </button>
  );
}

function UploadRow({ upload, onDismiss }: { upload: Upload; onDismiss: () => void }) {
  const pct = Math.round(upload.progress * 100);
  return (
    <li className="flex items-center gap-3 rounded-xl border border-zinc-200 px-3 py-2.5 dark:border-zinc-800">
      <span
        className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${
          upload.error ? "bg-red-50 text-red-600 dark:bg-red-950/50 dark:text-red-400" : "bg-indigo-50 text-indigo-600 dark:bg-indigo-950/60 dark:text-indigo-400"
        }`}
      >
        {upload.error ? <AlertIcon /> : <UploadIcon />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <p className="min-w-0 flex-1 truncate text-sm font-medium">{upload.name}</p>
          <span className="shrink-0 text-xs text-zinc-500">{upload.error ? formatBytes(upload.size) : `${pct}%`}</span>
        </div>
        {upload.error ? (
          <p className="truncate text-xs text-red-600 dark:text-red-400">{upload.error}</p>
        ) : (
          <div
            role="progressbar"
            aria-label={`Uploading ${upload.name}`}
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
            className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800"
          >
            <div className="h-full rounded-full bg-indigo-600 transition-[width] duration-200" style={{ width: `${pct}%` }} />
          </div>
        )}
      </div>
      {upload.error && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="shrink-0 rounded-full p-1.5 text-zinc-500 transition hover:bg-zinc-100 dark:hover:bg-zinc-800"
        >
          <CloseIcon />
        </button>
      )}
    </li>
  );
}

function GalleryCard({
  item,
  onOpen,
  onForward,
  onDelete,
}: {
  item: GalleryItem;
  onOpen: () => void;
  onForward: () => void;
  onDelete: () => void;
}) {
  const date = new Date(item.createdAt).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  const action =
    "flex size-8 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur transition hover:bg-black/75 focus-visible:outline-2 focus-visible:outline-white";

  return (
    <motion.li
      layout
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9 }}
      transition={{ duration: 0.2 }}
      className="group/card"
    >
      <div className="relative overflow-hidden rounded-xl bg-zinc-100 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
        <button
          type="button"
          onClick={onOpen}
          aria-label={`Open ${item.fileName}`}
          className="block aspect-square w-full focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-indigo-600"
        >
          <Thumbnail item={item} />
        </button>
        <div className="absolute top-2 right-2 flex gap-1.5 opacity-100 transition md:opacity-0 md:group-focus-within/card:opacity-100 md:group-hover/card:opacity-100">
          <button type="button" onClick={onForward} aria-label={`Forward ${item.fileName}`} title="Forward" className={action}>
            <ShareIcon />
          </button>
          <a href={galleryDownloadUrl(item.id)} aria-label={`Download ${item.fileName}`} title="Download" className={action}>
            <DownloadIcon />
          </a>
          <button
            type="button"
            onClick={onDelete}
            aria-label={`Delete ${item.fileName}`}
            title="Delete"
            className={`${action} hover:bg-red-600`}
          >
            <TrashIcon />
          </button>
        </div>
      </div>
      <div className="mt-1.5 px-0.5">
        <p className="truncate text-sm font-medium" title={item.fileName}>
          {item.fileName}
        </p>
        <p className="truncate text-xs text-zinc-500">
          {formatBytes(item.size)} · <time dateTime={item.createdAt} suppressHydrationWarning>{date}</time>
        </p>
      </div>
    </motion.li>
  );
}

function Thumbnail({ item }: { item: GalleryItem }) {
  const [failed, setFailed] = useState(false);

  if (item.kind === "image" && item.url && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={item.url}
        alt=""
        loading="lazy"
        decoding="async"
        onError={() => setFailed(true)}
        className="size-full object-cover transition duration-300 group-hover/card:scale-[1.03]"
      />
    );
  }

  if (item.kind === "video" && item.url && !failed) {
    return (
      <span className="relative block size-full bg-black">
        <video
          src={`${item.url}#t=0.1`}
          preload="metadata"
          muted
          playsInline
          onError={() => setFailed(true)}
          className="pointer-events-none size-full object-cover"
        />
        <span className="absolute inset-0 flex items-center justify-center">
          <span className="flex size-11 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur">
            <PlayIcon className="ml-0.5 size-5" />
          </span>
        </span>
      </span>
    );
  }

  const ext = item.key.split(".").pop()?.toUpperCase() ?? "";
  const audio = item.kind === "audio";
  return (
    <span
      className={`flex size-full flex-col items-center justify-center gap-2 ${
        audio
          ? "bg-gradient-to-br from-fuchsia-500 to-indigo-600 text-white"
          : "bg-gradient-to-br from-zinc-100 to-zinc-200 text-zinc-600 dark:from-zinc-800 dark:to-zinc-900 dark:text-zinc-300"
      }`}
    >
      {audio ? <MusicIcon className="size-9" /> : <FileIcon className="size-9" />}
      <span className={`rounded-md px-2 py-0.5 text-[11px] font-bold tracking-wide ${audio ? "bg-white/20" : "bg-white/70 dark:bg-black/30"}`}>
        {ext}
      </span>
    </span>
  );
}
