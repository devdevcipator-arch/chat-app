"use client";

import { usePathname } from "next/navigation";
import { Suspense, type ReactNode } from "react";

/** /chat/<id>(/...) is an open chat; /chat itself is the list. */
export const isChatOpenPath = (pathname: string) => /^\/chat\/[^/]+/.test(pathname);

function ChatOpenMarker() {
  return isChatOpenPath(usePathname()) ? <span data-chat-open hidden /> : null;
}

/**
 * The two-pane frame. On mobile only one pane shows: the list at /chat, the
 * conversation at /chat/[chatId].
 *
 * Which one is decided from the URL by a marker that lives here in the
 * layout, never inside a page: with Cache Components, pages you leave stay in
 * the document (hidden by <Activity>), so a marker inside the chat page would
 * still be found after closing the chat, hiding the list and leaving a blank
 * screen. The marker reads the URL, so it streams in behind <Suspense>.
 */
export function ChatFrame({ sidebar, children }: { sidebar: ReactNode; children: ReactNode }) {
  return (
    <div className="group/frame flex h-dvh">
      <Suspense fallback={null}>
        <ChatOpenMarker />
      </Suspense>
      <aside className="flex w-full shrink-0 flex-col border-zinc-200 bg-zinc-50 md:w-[25rem] md:flex-row md:border-r max-md:group-has-[[data-chat-open]]/frame:hidden dark:border-zinc-800 dark:bg-zinc-950">
        {sidebar}
      </aside>
      <main className="min-w-0 flex-1 max-md:hidden max-md:group-has-[[data-chat-open]]/frame:flex md:flex">
        {children}
      </main>
    </div>
  );
}
