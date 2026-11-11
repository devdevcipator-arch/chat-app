"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent, type ReactNode } from "react";
import { DEVICE_FILES_ACCEPT } from "@/lib/chat-upload";

const MAX_FILES = 10;

/**
 * The composer's 📎 button: a small menu to pick photos & videos from your
 * in-app Gallery (`onOpenGallery`), or files from the device (documents and
 * the rest), which go to `onFiles` and through the normal upload.
 */
export function AttachMenu({ onFiles, onOpenGallery }: { onFiles: (files: File[]) => void; onOpenGallery: () => void }) {
  const [isAttachMenuOpen, setIsAttachMenuOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const filesInput = useRef<HTMLInputElement>(null);

  const close = (refocus = false) => {
    setIsAttachMenuOpen(false);
    if (refocus) trigger.current?.focus();
  };

  // Outside click and Escape close it; the first item gets focus on open.
  // (role="menu" also tells the chat's "Esc leaves the chat" shortcut to wait.)
  useEffect(() => {
    if (!isAttachMenuOpen) return;
    menu.current?.querySelector<HTMLButtonElement>("[role=menuitem]")?.focus();
    const onPointer = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setIsAttachMenuOpen(false);
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      setIsAttachMenuOpen(false);
      trigger.current?.focus();
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [isAttachMenuOpen]);

  function pick(input: HTMLInputElement | null) {
    close();
    input?.click();
  }

  function handleFiles(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = ""; // so the same file can be picked again
    setIsAttachMenuOpen(false);
    if (files.length) onFiles(files.slice(0, MAX_FILES));
  }

  function onMenuKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Tab") return;
    const items = Array.from(menu.current?.querySelectorAll<HTMLButtonElement>("[role=menuitem]") ?? []);
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "Tab") return close();
    e.preventDefault();
    items[(i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
  }

  return (
    <div ref={root} className="relative shrink-0">
      <input ref={filesInput} type="file" accept={DEVICE_FILES_ACCEPT} multiple onChange={handleFiles} className="hidden" tabIndex={-1} aria-hidden />

      <button
        ref={trigger}
        type="button"
        onClick={() => setIsAttachMenuOpen((open) => !open)}
        onKeyDown={(e) => {
          if (e.key === "ArrowUp" && !isAttachMenuOpen) {
            e.preventDefault();
            setIsAttachMenuOpen(true);
          }
        }}
        aria-label="Attach"
        title="Attach"
        aria-haspopup="menu"
        aria-expanded={isAttachMenuOpen}
        className={`flex size-10 items-center justify-center rounded-full transition ${
          isAttachMenuOpen
            ? "bg-zinc-100 text-indigo-600 dark:bg-zinc-800 dark:text-indigo-400"
            : "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
        }`}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" className="size-5" aria-hidden>
          <path d="m21.4 11.1-9.2 9.2a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5" />
        </svg>
      </button>

      <AnimatePresence>
        {isAttachMenuOpen && (
          <motion.div
            ref={menu}
            role="menu"
            aria-label="Attach"
            onKeyDown={onMenuKeyDown}
            initial={{ opacity: 0, y: 6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.97 }}
            transition={{ duration: 0.12 }}
            style={{ transformOrigin: "bottom left" }}
            className="absolute bottom-full left-0 z-50 mb-3 flex min-w-[220px] flex-col gap-1 rounded-xl border border-zinc-200 bg-white p-1.5 shadow-xl dark:border-zinc-800 dark:bg-zinc-900"
          >
            <MenuItem
              onSelect={() => {
                close();
                onOpenGallery();
              }}
              label="Photos & Videos"
              hint="From My Gallery"
              tint="bg-violet-100 text-violet-600 dark:bg-violet-950/70 dark:text-violet-300"
              icon={
                <>
                  <rect x="3" y="4" width="18" height="16" rx="3" />
                  <circle cx="9" cy="10" r="1.8" />
                  <path d="M21 16l-5-5-8 8" />
                </>
              }
            />
            <MenuItem
              onSelect={() => pick(filesInput.current)}
              label="Device Files"
              hint="Photos, videos, PDF, Word, ZIP…"
              tint="bg-sky-100 text-sky-600 dark:bg-sky-950/70 dark:text-sky-300"
              icon={
                <>
                  <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
                  <path d="M14 3v5h5M9 13h6M9 17h4" />
                </>
              }
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function MenuItem({
  onSelect,
  label,
  hint,
  tint,
  icon,
}: {
  onSelect: () => void;
  label: string;
  hint: string;
  tint: string;
  icon: ReactNode;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onSelect}
      className="flex items-center gap-3 rounded-lg px-2.5 py-2 text-left outline-none transition hover:bg-zinc-100 focus-visible:bg-zinc-100 dark:hover:bg-zinc-800 dark:focus-visible:bg-zinc-800"
    >
      <span className={`flex size-9 shrink-0 items-center justify-center rounded-full ${tint}`} aria-hidden>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" className="size-[18px]">
          {icon}
        </svg>
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium text-zinc-900 dark:text-zinc-100">{label}</span>
        <span className="block truncate text-xs text-zinc-500">{hint}</span>
      </span>
    </button>
  );
}
