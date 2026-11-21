import { notFound } from "next/navigation";
import { Suspense } from "react";
import { getOnboardedProfile, getSessionUserId } from "@/lib/auth";
import { UUID_PATTERN } from "@/lib/chat";
import { getChat } from "@/lib/chat-data";
import { CachedChatPreview } from "./cached-chat-preview";
import { ChatWindow } from "./chat-window";

export default function ChatPage({ params }: PageProps<"/chat/[chatId]">) {
  return (
    <div className="flex min-w-0 flex-1">
      <Suspense
        fallback={
          // Last known messages from this tab (lib/chat-cache.ts), else the skeleton.
          // Its own boundary: it reads the URL's chat id.
          <Suspense fallback={<ChatWindowSkeleton />}>
            <CachedChatPreview skeleton={<ChatWindowSkeleton />} />
          </Suspense>
        }
      >
        <ChatLoader params={params} />
      </Suspense>
    </div>
  );
}

// Params are runtime data under Cache Components, so this streams in.
async function ChatLoader({ params }: Pick<PageProps<"/chat/[chatId]">, "params">) {
  const { chatId } = await params;
  if (!UUID_PATTERN.test(chatId)) notFound();

  // The profile check and the chat reads run in parallel (one round-trip
  // instead of two); the user id comes from the already-verified JWT claims.
  const userId = await getSessionUserId();
  const [me, chat] = await Promise.all([getOnboardedProfile(), getChat(chatId, userId)]);
  if (!chat) notFound(); // not a participant, or no such chat

  return (
    <ChatWindow
      key={chatId}
      chatId={chatId}
      meId={me.id}
      other={chat.other}
      details={chat.details}
      initialMessages={chat.messages}
    />
  );
}

function ChatWindowSkeleton() {
  return (
    <div className="flex flex-1 animate-pulse flex-col">
      <div className="flex h-16 items-center gap-3 border-b border-zinc-200 px-4 dark:border-zinc-800">
        <div className="size-10 rounded-full bg-zinc-200 dark:bg-zinc-800" />
        <div className="h-3 w-32 rounded bg-zinc-200 dark:bg-zinc-800" />
      </div>
      <div className="flex-1" />
      <div className="h-16 border-t border-zinc-200 dark:border-zinc-800" />
    </div>
  );
}
