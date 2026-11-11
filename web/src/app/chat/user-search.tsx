"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { Avatar } from "@/components/avatar";
import { Spinner } from "@/components/auth-card";
import { profileName, type PublicProfile } from "@/lib/chat";
import { createClient } from "@/lib/supabase/client";
import { isValidUsername, normalizeUsername } from "@/lib/username";

type Result =
  | { kind: "idle" }
  | { kind: "searching" }
  | { kind: "found"; profile: PublicProfile }
  | { kind: "self" }
  | { kind: "none"; username: string }
  | { kind: "error"; message: string };

const DEBOUNCE_MS = 350;

export function UserSearch({
  meId,
  onStartChat,
}: {
  meId: string;
  onStartChat: (otherUserId: string) => Promise<string | null>;
}) {
  const [supabase] = useState(createClient);
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<Result>({ kind: "idle" });
  const [starting, setStarting] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef("");

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  async function lookup(username: string) {
    const { data, error } = await supabase.rpc("find_profile_by_username", {
      p_username: username,
    });
    if (latest.current !== username) return;
    if (error) return setResult({ kind: "error", message: "Search failed. Try again." });
    const row = data[0];
    if (!row) return setResult({ kind: "none", username });
    if (row.id === meId) return setResult({ kind: "self" });
    setResult({
      kind: "found",
      profile: {
        id: row.id,
        username: row.username,
        displayName: row.display_name,
        avatarUrl: row.avatar_url,
      },
    });
  }

  function handleChange(raw: string) {
    const username = normalizeUsername(raw);
    setQuery(username);
    latest.current = username;
    if (timer.current) clearTimeout(timer.current);
    if (!isValidUsername(username)) return setResult({ kind: "idle" });
    setResult({ kind: "searching" });
    timer.current = setTimeout(() => void lookup(username), DEBOUNCE_MS);
  }

  async function start(profile: PublicProfile) {
    setStarting(true);
    const error = await onStartChat(profile.id);
    setStarting(false);
    if (error) return setResult({ kind: "error", message: error });
    setQuery("");
    latest.current = "";
    setResult({ kind: "idle" });
  }

  return (
    <div className="px-3">
      <div className="relative">
        <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-zinc-400">@</span>
        <input
          type="search"
          value={query}
          onChange={(e) => handleChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && result.kind === "found" && !starting) void start(result.profile);
          }}
          placeholder="Find by exact username"
          aria-label="Find a user by exact username"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          className="w-full rounded-lg border border-zinc-200 bg-white py-2 pr-3 pl-7 text-sm outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 dark:border-zinc-800 dark:bg-zinc-900"
        />
      </div>

      <AnimatePresence initial={false}>
        {result.kind !== "idle" && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
            aria-live="polite"
          >
            <div className="mt-2 rounded-lg border border-zinc-200 bg-white p-2.5 text-sm dark:border-zinc-800 dark:bg-zinc-900">
              {result.kind === "searching" && (
                <p className="flex items-center gap-2 text-zinc-500">
                  <Spinner /> Searching…
                </p>
              )}
              {result.kind === "none" && <p className="text-zinc-500">No one goes by @{result.username}.</p>}
              {result.kind === "self" && <p className="text-zinc-500">That&apos;s you.</p>}
              {result.kind === "error" && <p className="text-red-600 dark:text-red-400">{result.message}</p>}
              {result.kind === "found" && (
                <div className="flex items-center gap-3">
                  <Avatar name={profileName(result.profile)} src={result.profile.avatarUrl} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{profileName(result.profile)}</p>
                    <p className="truncate text-xs text-zinc-500">@{result.profile.username}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void start(result.profile)}
                    disabled={starting}
                    className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-indigo-500 disabled:opacity-60"
                  >
                    {starting && <Spinner />}
                    Start chat
                  </button>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
