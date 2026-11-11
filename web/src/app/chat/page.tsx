import { FadeIn } from "@/components/fade-in";

export default function ChatHome() {
  return (
    // Desktop only: on mobile /chat is the chat list (see layout.tsx).
    <div className="hidden flex-1 flex-col items-center justify-center p-8 md:flex">
      <FadeIn>
        <div className="max-w-xs text-center">
          <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600 dark:bg-indigo-950/60 dark:text-indigo-400">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="size-7" aria-hidden>
              <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z" strokeLinejoin="round" />
            </svg>
          </div>
          <h2 className="mt-4 font-semibold">No chat selected</h2>
          <p className="mt-1 text-sm text-zinc-500">
            Start a conversation by searching for someone&apos;s @username.
          </p>
        </div>
      </FadeIn>
    </div>
  );
}
