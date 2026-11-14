"use client";

import { useEffect, useState } from "react";

/** Answer to a `/math` command, shown in place of the plain "🧮 … = …" text. */
export function MathResultCard({
  expression,
  result,
  mine,
  className = "",
}: {
  expression: string;
  result: string;
  mine: boolean;
  /** Sending / being-edited states from the bubble. */
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(t);
  }, [copied]);

  async function copy() {
    try {
      // The bare number pastes better into other tools than "1,234.5".
      await navigator.clipboard.writeText(result.replace(/,/g, ""));
      setCopied(true);
    } catch {
      // Clipboard blocked (insecure origin or denied); nothing useful to show.
    }
  }

  return (
    <div
      className={`min-w-44 rounded-2xl px-3.5 pt-2.5 pb-2 ${
        mine
          ? "rounded-br-md bg-indigo-600 text-white"
          : "rounded-bl-md bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100"
      } ${className}`}
    >
      <span
        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold tracking-wide ${
          mine ? "bg-white/20 text-white" : "bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300"
        }`}
      >
        <span aria-hidden>🧮</span> Math
      </span>
      <p
        className={`mt-1.5 font-mono text-[13px] break-all ${mine ? "text-white/80" : "text-zinc-600 dark:text-zinc-400"}`}
      >
        {expression}
      </p>
      <div className="mt-0.5 flex items-center justify-between gap-3">
        <p className="min-w-0 text-2xl font-bold break-all tabular-nums">
          <span className={mine ? "text-white/70" : "text-zinc-400 dark:text-zinc-500"}>= </span>
          {result}
        </p>
        <button
          type="button"
          onClick={() => void copy()}
          aria-label={copied ? "Copied" : `Copy result ${result}`}
          title={copied ? "Copied" : "Copy result"}
          className={`flex h-8 shrink-0 items-center gap-1 rounded-lg px-2 text-xs font-medium transition ${
            mine
              ? "bg-white/15 text-white hover:bg-white/25"
              : "bg-white text-zinc-600 hover:text-indigo-600 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:text-indigo-400"
          }`}
        >
          {copied ? (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" className="size-4" aria-hidden>
              <path d="M5 12.5l4.5 4.5L19 7.5" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" className="size-4" aria-hidden>
              <rect x="9" y="9" width="12" height="12" rx="2" />
              <path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" />
            </svg>
          )}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}
