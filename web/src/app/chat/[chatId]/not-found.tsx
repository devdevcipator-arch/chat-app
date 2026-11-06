import Link from "next/link";

export default function ChatNotFound() {
  return (
    <div data-chat-open className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
      <h2 className="font-semibold">Chat not found</h2>
      <p className="max-w-xs text-sm text-zinc-500">
        This conversation doesn&apos;t exist or you&apos;re not part of it.
      </p>
      <Link href="/chat" className="text-sm font-medium text-indigo-600 hover:text-indigo-500 dark:text-indigo-400">
        Back to chats
      </Link>
    </div>
  );
}
