"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";

// Modal built on the native <dialog>: focus trapping, Escape and the top
// layer come from the browser. Children only render while open, so their
// state resets each time.

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  size = "md",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  size?: "sm" | "md";
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onClose={onClose}
      // A click on the dialog element itself is a click on the backdrop.
      onClick={(e) => e.target === e.currentTarget && onClose()}
      className={`m-auto w-[calc(100%-2rem)] rounded-2xl bg-white p-0 text-zinc-900 shadow-2xl backdrop:bg-zinc-950/50 backdrop:backdrop-blur-sm dark:bg-zinc-900 dark:text-zinc-100 ${
        size === "sm" ? "max-w-sm" : "max-w-md"
      }`}
    >
      {open && (
        <div className="flex max-h-[85dvh] flex-col p-5">
          <h2 id={titleId} className="text-lg font-semibold">
            {title}
          </h2>
          {description && (
            <p id={descriptionId} className="mt-1 text-sm text-zinc-500">
              {description}
            </p>
          )}
          <div className="mt-4 flex min-h-0 flex-1 flex-col">{children}</div>
        </div>
      )}
    </dialog>
  );
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  danger,
  busy,
  busyLabel = "Working…",
  error,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  danger?: boolean;
  busy?: boolean;
  /** Shown next to a spinner while busy. */
  busyLabel?: string;
  error?: string | null;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Dialog open={open} onClose={onClose} title={title} description={description} size="sm">
      {error && (
        <p role="alert" className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/50 dark:text-red-300">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg px-3.5 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={busy}
          autoFocus
          aria-busy={busy || undefined}
          className={`inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium text-white transition disabled:opacity-60 ${
            danger ? "bg-red-600 hover:bg-red-500" : "bg-indigo-600 hover:bg-indigo-500"
          }`}
        >
          {busy ? (
            <>
              <span className="size-4 animate-spin rounded-full border-2 border-white/40 border-t-white" aria-hidden />
              {busyLabel}
            </>
          ) : (
            confirmLabel
          )}
        </button>
      </div>
    </Dialog>
  );
}
