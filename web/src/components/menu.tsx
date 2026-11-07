"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

// Dropdown menu (WAI-ARIA menu button). The popup is `position: fixed` and
// placed from the trigger's rect, so scrollable lists can't clip it.

export type MenuItem = {
  label: string;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
};

const MENU_WIDTH = 208;

export function Menu({
  label,
  items,
  triggerClassName = "",
}: {
  /** Accessible name of the trigger, e.g. "Chat options". */
  label: string;
  items: MenuItem[];
  triggerClassName?: string;
}) {
  const [position, setPosition] = useState<{ top: number; left: number; up: boolean } | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const open = position !== null;

  function openMenu() {
    const rect = trigger.current?.getBoundingClientRect();
    if (!rect) return;
    const up = rect.bottom + 8 + items.length * 40 > window.innerHeight;
    const left = Math.max(8, Math.min(rect.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - 8));
    setPosition({ top: up ? rect.top - 4 : rect.bottom + 4, left, up });
  }

  const close = (refocus = true) => {
    setPosition(null);
    if (refocus) trigger.current?.focus();
  };

  // Dismiss on outside click, scroll or resize; focus the first item on open.
  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLButtonElement>("[role=menuitem]:not(:disabled)")?.focus();
    const onPointer = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!menu.current?.contains(t) && !trigger.current?.contains(t)) setPosition(null);
    };
    const onDismiss = () => setPosition(null);
    document.addEventListener("pointerdown", onPointer);
    window.addEventListener("resize", onDismiss);
    window.addEventListener("scroll", onDismiss, true);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("resize", onDismiss);
      window.removeEventListener("scroll", onDismiss, true);
    };
  }, [open]);

  function onMenuKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const buttons = Array.from(
      menu.current?.querySelectorAll<HTMLButtonElement>("[role=menuitem]:not(:disabled)") ?? [],
    );
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "Escape" || e.key === "Tab") {
      e.preventDefault();
      close();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      buttons[(index + 1) % buttons.length]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      buttons[(index - 1 + buttons.length) % buttons.length]?.focus();
    } else if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      buttons[e.key === "Home" ? 0 : buttons.length - 1]?.focus();
    }
  }

  return (
    <>
      <button
        ref={trigger}
        type="button"
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={(e) => {
          e.preventDefault(); // don't follow a surrounding link
          e.stopPropagation();
          if (open) close(false);
          else openMenu();
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && !open) {
            e.preventDefault();
            openMenu();
          }
        }}
        className={`flex size-8 items-center justify-center rounded-full text-zinc-500 transition hover:bg-zinc-200/80 hover:text-zinc-800 dark:hover:bg-zinc-700/80 dark:hover:text-zinc-200 ${triggerClassName}`}
      >
        <DotsIcon />
      </button>
      <AnimatePresence>
        {position && (
          <motion.div
            ref={menu}
            id={menuId}
            role="menu"
            aria-label={label}
            onKeyDown={onMenuKeyDown}
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={{ duration: 0.12 }}
            style={{
              top: position.top,
              left: position.left,
              width: MENU_WIDTH,
              translateY: position.up ? "-100%" : 0,
              transformOrigin: position.up ? "bottom right" : "top right",
            }}
            className="fixed z-50 overflow-hidden rounded-xl border border-zinc-200 bg-white py-1 shadow-xl dark:border-zinc-800 dark:bg-zinc-900"
          >
            {items.map((item) => (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                disabled={item.disabled}
                onClick={() => {
                  close();
                  item.onSelect();
                }}
                className={`block w-full px-3.5 py-2 text-left text-sm transition outline-none hover:bg-zinc-100 focus:bg-zinc-100 disabled:opacity-40 dark:hover:bg-zinc-800 dark:focus:bg-zinc-800 ${
                  item.danger ? "text-red-600 dark:text-red-400" : ""
                }`}
              >
                {item.label}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

function DotsIcon(): ReactNode {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="size-5" aria-hidden>
      <circle cx="12" cy="5" r="1.8" />
      <circle cx="12" cy="12" r="1.8" />
      <circle cx="12" cy="19" r="1.8" />
    </svg>
  );
}
