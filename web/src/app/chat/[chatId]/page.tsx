import { notFound } from "next/navigation";
import { Suspense } from "react";
import { getOnboardedProfile } from "@/lib/auth";
import { UUID_PATTERN } from "@/lib/chat";
import { getChat } from "@/lib/chat-data";
import { ChatWindow } from "./chat-window";

export default function ChatPage({ params }: PageProps<"/chat/[chatId]">) {
  return (
    <div className="flex min-w-0 flex-1">
      <Suspense fallback={<ChatWindowSkeleton />}>
        <ChatLoader params={params} />
      </Suspense>
    </div>
  );
}

// Params are runtime data under Cache Components, so this streams in.
async function ChatLoader({ params }: Pick<PageProps<"/chat/[chatId]">, "params">) {
  const { chatId } = await params;
  if (!UUID_PATTERN.test(chatId)) notFound();

  const me = await getOnboardedProfile();
  const chat = await getChat(chatId, me.id);
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
