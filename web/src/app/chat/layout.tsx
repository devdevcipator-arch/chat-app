import type { Metadata } from "next";
import { Suspense } from "react";
import { getOnboardedProfile } from "@/lib/auth";
import { getMyChats } from "@/lib/chat-data";
import { ChatSidebar } from "./chat-sidebar";

export const metadata: Metadata = { title: "Chats · Chat App" };

// On mobile only one pane shows: the list at /chat, the conversation at
// /chat/[chatId]. Pages that are an open chat render `data-chat-open`.
export default function ChatLayout({ children }: LayoutProps<"/chat">) {
  return (
    <div className="group/frame flex h-dvh">
      <aside className="flex w-full shrink-0 flex-col border-zinc-200 bg-zinc-50 md:w-80 md:border-r max-md:group-has-[[data-chat-open]]/frame:hidden dark:border-zinc-800 dark:bg-zinc-950">
        <Suspense fallback={<SidebarSkeleton />}>
          <SidebarLoader />
        </Suspense>
      </aside>
      <main className="min-w-0 flex-1 max-md:hidden max-md:group-has-[[data-chat-open]]/frame:flex md:flex">
        {children}
      </main>
    </div>
  );
}

// Reads the session, so it streams in behind Suspense. This is also the
// server-side auth check for every /chat route.
async function SidebarLoader() {
  const me = await getOnboardedProfile();
  const chats = await getMyChats();
  return <ChatSidebar me={me} initialChats={chats} />;
}

function SidebarSkeleton() {
  return (
    <div className="flex flex-1 animate-pulse flex-col gap-4 p-4">
      <div className="h-6 w-20 rounded bg-zinc-200 dark:bg-zinc-800" />
      <div className="h-9 rounded-lg bg-zinc-200 dark:bg-zinc-800" />
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex items-center gap-3">
          <div className="size-10 rounded-full bg-zinc-200 dark:bg-zinc-800" />
          <div className="flex-1 space-y-1.5">
            <div className="h-3 w-28 rounded bg-zinc-200 dark:bg-zinc-800" />
            <div className="h-2.5 w-40 rounded bg-zinc-200 dark:bg-zinc-800" />
          </div>
        </div>
      ))}
    </div>
  );
}
