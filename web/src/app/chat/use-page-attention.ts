"use client";

import { useEffect, useSyncExternalStore } from "react";
import { pageIsActive } from "@/lib/notify";

function subscribe(onChange: () => void) {
  document.addEventListener("visibilitychange", onChange);
  window.addEventListener("focus", onChange);
  window.addEventListener("blur", onChange);
  return () => {
    document.removeEventListener("visibilitychange", onChange);
    window.removeEventListener("focus", onChange);
    window.removeEventListener("blur", onChange);
  };
}

/** True while this tab is visible and focused. */
export function usePageActive() {
  return useSyncExternalStore(subscribe, pageIsActive, () => true);
}

const PREFIX = /^\(\d+\+?\) /;

/**
 * Prefixes the tab title with the unread count, e.g. "(3) Chats · Chat App".
 * Next.js rewrites the title on navigation, so re-apply when it changes.
 */
export function useUnreadTitle(count: number) {
  useEffect(() => {
    const apply = () => {
      const base = document.title.replace(PREFIX, "");
      const next = count > 0 ? `(${count > 99 ? "99+" : count}) ${base}` : base;
      if (document.title !== next) document.title = next;
    };
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(document.head, { subtree: true, childList: true, characterData: true });
    return () => {
      observer.disconnect();
      document.title = document.title.replace(PREFIX, "");
    };
  }, [count]);
}
