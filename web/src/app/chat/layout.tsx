import type { Metadata } from "next";
import { Suspense } from "react";
import { getOnboardedProfile } from "@/lib/auth";
import { getMyChats } from "@/lib/chat-data";
import { CallProvider } from "./call/call-provider";
import { ChatFrame } from "./chat-frame";
import { ChatSidebar } from "./chat-sidebar";

export const metadata: Metadata = { title: "Chats · Chat App" };

// On mobile only one pane shows (ChatFrame picks it from the URL): the list
// at /chat, the conversation at /chat/[chatId]. CallProvider lives here so
// calls ring on every /chat route and keep going while you switch chats.
export default function ChatLayout({ children }: LayoutProps<"/chat">) {
  return (
    <CallProvider>
      <ChatFrame
        sidebar={
          <Suspense fallback={<SidebarSkeleton />}>
            <SidebarLoader />
          </Suspense>
        }
      >
        {children}
      </ChatFrame>
    </CallProvider>
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
