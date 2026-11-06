import Link from "next/link";
import { FadeIn } from "@/components/fade-in";

export default function Home() {
  return (
    <main className="flex flex-1 items-center justify-center px-4">
      <div className="max-w-md text-center">
        <FadeIn>
          <h1 className="text-3xl font-semibold tracking-tight">Chat App</h1>
        </FadeIn>
        <FadeIn delay={0.1}>
          <p className="mt-3 text-zinc-600 dark:text-zinc-400">
            Private messaging with a built-in wallet. No phone number required.
          </p>
        </FadeIn>
        <FadeIn delay={0.2}>
          <Link
            href="/login"
            className="mt-8 inline-flex rounded-lg bg-indigo-600 px-5 py-2.5 font-medium text-white transition hover:bg-indigo-500"
          >
            Get started
          </Link>
        </FadeIn>
      </div>
    </main>
  );
}
