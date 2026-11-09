"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef } from "react";
import { formatBytes, type GalleryItem } from "@/lib/vault";
import { galleryDownloadUrl } from "@/lib/vault-client";
import { ChevronIcon, CloseIcon, DownloadIcon, FileIcon, MusicIcon, ShareIcon, TrashIcon } from "./icons";

export function MediaViewer({
  items,
  index,
  onIndex,
  onClose,
  onForward,
  onDelete,
}: {
  items: GalleryItem[];
  index: number | null;
  onIndex: (index: number) => void;
  onClose: () => void;
  onForward: (item: GalleryItem) => void;
  onDelete: (item: GalleryItem) => void;
}) {
  const item = index === null ? null : (items[index] ?? null);
  const open = !!item;
  const closeButton = useRef<HTMLButtonElement>(null);
  const hasPrev = index !== null && index > 0;
  const hasNext = index !== null && index < items.length - 1;

  // Latest navigation state for the key handler, which binds once per open.
  const nav = useRef({ index, hasPrev, hasNext, onIndex, onClose });
  useEffect(() => {
    nav.current = { index, hasPrev, hasNext, onIndex, onClose };
  });

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    closeButton.current?.focus();

    const onKey = (e: KeyboardEvent) => {
      const n = nav.current;
      // Dialogs (forward / delete) opened from here handle their own keys.
      if (document.querySelector("dialog[open]")) return;
      if (e.key === "Escape") n.onClose();
      else if (e.key === "ArrowLeft" && n.hasPrev && n.index !== null) n.onIndex(n.index - 1);
      else if (e.key === "ArrowRight" && n.hasNext && n.index !== null) n.onIndex(n.index + 1);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      previouslyFocused?.focus();
    };
  }, [open]);

  const toolButton =
    "flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-2 text-sm text-white backdrop-blur transition hover:bg-white/20";

  return (
    <AnimatePresence>
      {item && index !== null && (
        <motion.div
          key="viewer"
          role="dialog"
          aria-modal="true"
          aria-label={`Preview of ${item.fileName}`}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          onClick={onClose}
          className="fixed inset-0 z-50 flex flex-col bg-black/90 backdrop-blur-sm"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="flex items-center gap-2 p-3 text-white"
          >
            <div className="min-w-0 flex-1 px-1">
              <p className="truncate text-sm font-medium">{item.fileName}</p>
              <p className="text-xs text-white/60">
                {formatBytes(item.size)} · {new Date(item.createdAt).toLocaleDateString(undefined, { dateStyle: "medium" })}
                {items.length > 1 && ` · ${index + 1} of ${items.length}`}
              </p>
            </div>
            <button type="button" onClick={() => onForward(item)} className={toolButton}>
              <ShareIcon />
              <span className="max-sm:sr-only">Forward</span>
            </button>
            <a href={galleryDownloadUrl(item.id)} className={toolButton}>
              <DownloadIcon />
              <span className="max-sm:sr-only">Download</span>
            </a>
            <button type="button" onClick={() => onDelete(item)} className={`${toolButton} hover:bg-red-500/80`}>
              <TrashIcon />
              <span className="max-sm:sr-only">Delete</span>
            </button>
            <button
              ref={closeButton}
              type="button"
              onClick={onClose}
              aria-label="Close preview"
              className="rounded-full bg-white/10 p-2 text-white backdrop-blur transition hover:bg-white/20"
            >
              <CloseIcon className="size-5" />
            </button>
          </div>

          <div className="relative flex min-h-0 flex-1 items-center justify-center px-4 pb-4 sm:px-16">
            <motion.div
              key={item.id}
              initial={{ scale: 0.96, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: "spring", stiffness: 320, damping: 30 }}
              onClick={(e) => e.stopPropagation()}
              className="flex max-h-full max-w-full items-center justify-center"
            >
              <ViewerContent item={item} />
            </motion.div>

            {hasPrev && (
              <NavButton side="left" onClick={() => onIndex(index - 1)} />
            )}
            {hasNext && (
              <NavButton side="right" onClick={() => onIndex(index + 1)} />
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function NavButton({ side, onClick }: { side: "left" | "right"; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      aria-label={side === "left" ? "Previous item" : "Next item"}
      className={`absolute top-1/2 -translate-y-1/2 rounded-full bg-white/10 p-2.5 text-white backdrop-blur transition hover:bg-white/20 ${
        side === "left" ? "left-2 sm:left-4" : "right-2 sm:right-4"
      }`}
    >
      <ChevronIcon left={side === "left"} className="size-5" />
    </button>
  );
}

function ViewerContent({ item }: { item: GalleryItem }) {
  if (!item.url) {
    return <p className="text-sm text-white/70">This file isn&apos;t available right now.</p>;
  }

  switch (item.kind) {
    case "image":
      return (
        // R2 objects are served as-is; next/image would only re-proxy them.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={item.url}
          alt={item.fileName}
          className="max-h-[calc(100dvh-7rem)] max-w-full rounded-lg object-contain shadow-2xl"
        />
      );
    case "video":
      return (
        <video
          src={item.url}
          controls
          autoPlay
          playsInline
          className="max-h-[calc(100dvh-7rem)] max-w-full rounded-lg bg-black shadow-2xl"
        >
          <track kind="captions" />
        </video>
      );
    case "audio":
      return (
        <div className="flex w-[min(28rem,90vw)] flex-col items-center gap-5 rounded-2xl bg-white/5 p-8">
          <div className="flex size-24 items-center justify-center rounded-3xl bg-gradient-to-br from-fuchsia-500 to-indigo-600 text-white">
            <MusicIcon className="size-10" />
          </div>
          <audio src={item.url} controls autoPlay className="w-full">
            <track kind="captions" />
          </audio>
        </div>
      );
    default:
      if (item.key.endsWith(".pdf")) {
        return (
          <iframe
            src={item.url}
            title={item.fileName}
            className="h-[calc(100dvh-7rem)] w-[min(56rem,92vw)] rounded-lg bg-white"
          />
        );
      }
      return (
        <div className="flex w-[min(24rem,90vw)] flex-col items-center gap-4 rounded-2xl bg-white/5 p-8 text-center text-white">
          <div className="flex size-24 items-center justify-center rounded-3xl bg-white/10">
            <FileIcon className="size-10" />
          </div>
          <p className="text-sm text-white/70">No preview for this file type.</p>
          <a
            href={galleryDownloadUrl(item.id)}
            className="rounded-full bg-indigo-600 px-4 py-2 text-sm font-medium transition hover:bg-indigo-500"
          >
            Download {item.key.split(".").pop()?.toUpperCase()}
          </a>
        </div>
      );
  }
}
