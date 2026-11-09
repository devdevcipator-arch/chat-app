"use client";

import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { AlertIcon, CheckIcon, CloseIcon } from "./icons";

export type Toast = {
  id: number;
  tone: "success" | "error";
  text: string;
  action?: { label: string; href: string };
};

const TOAST_MS = 4500;

export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    clearTimeout(timers.current.get(id));
    timers.current.delete(id);
  }, []);

  const push = useCallback(
    (toast: Omit<Toast, "id">) => {
      const id = nextId.current++;
      setToasts((prev) => [...prev.slice(-3), { ...toast, id }]);
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), TOAST_MS),
      );
    },
    [dismiss],
  );

  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach(clearTimeout);
  }, []);

  return { toasts, push, dismiss };
}

export function Toasts({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: number) => void }) {
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-4"
    >
      <AnimatePresence initial={false}>
        {toasts.map((toast) => (
          <motion.div
            key={toast.id}
            layout
            initial={{ opacity: 0, y: 16, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.96 }}
            transition={{ type: "spring", stiffness: 380, damping: 30 }}
            role={toast.tone === "error" ? "alert" : "status"}
            className="pointer-events-auto flex w-full max-w-sm items-center gap-3 rounded-xl bg-zinc-900 px-4 py-3 text-sm text-white shadow-xl dark:bg-zinc-100 dark:text-zinc-900"
          >
            <span
              className={`flex size-6 shrink-0 items-center justify-center rounded-full ${
                toast.tone === "success" ? "bg-emerald-500 text-white" : "bg-red-500 text-white"
              }`}
            >
              {toast.tone === "success" ? <CheckIcon className="size-3.5" /> : <AlertIcon className="size-3.5" />}
            </span>
            <p className="min-w-0 flex-1">{toast.text}</p>
            {toast.action && (
              <Link
                href={toast.action.href}
                className="shrink-0 font-semibold text-indigo-300 hover:underline dark:text-indigo-600"
              >
                {toast.action.label}
              </Link>
            )}
            <button
              type="button"
              onClick={() => onDismiss(toast.id)}
              aria-label="Dismiss"
              className="shrink-0 rounded-full p-1 opacity-70 transition hover:opacity-100"
            >
              <CloseIcon className="size-3.5" />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
