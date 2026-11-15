"use client";

import { useEffect, useState } from "react";
import { Avatar } from "@/components/avatar";
import { Spinner } from "@/components/auth-card";
import { profileName, type PublicProfile } from "@/lib/chat";
import { createClient } from "@/lib/supabase/client";
import { isValidUsername, normalizeUsername } from "@/lib/username";

type Lookup =
  | { kind: "found"; profile: PublicProfile }
  | { kind: "self" }
  | { kind: "none" }
  | { kind: "error"; message: string };

const DEBOUNCE_MS = 350;

/** The exact @username a search box holds, or null if it can't be one ("Book Club"). */
export function usernameQuery(query: string) {
  const candidate = query.trim().toLowerCase().replace(/^@/, "");
  const username = normalizeUsername(candidate);
  return username === candidate && isValidUsername(username) ? username : null;
}

/**
 * "Find People": looks up the exact @username typed in the Chats search box
 * so a new chat can be started. Renders nothing unless the query could be a
 * username. Existing chats and groups are listed above it by the sidebar.
 */
export function PeopleLookup({
  query,
  meId,
  onStartChat,
  onStarted,
}: {
  query: string;
  meId: string;
  onStartChat: (otherUserId: string) => Promise<string | null>;
  /** Called after a chat was started (to clear the search). */
  onStarted: () => void;
}) {
  const [supabase] = useState(createClient);
  const username = usernameQuery(query);
  // Results are keyed by the username they answer, so a stale one never shows.
  const [result, setResult] = useState<{ username: string; lookup: Lookup } | null>(null);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  useEffect(() => {
    if (!username) return;
    let stale = false;
    const timer = setTimeout(async () => {
      const { data, error } = await supabase.rpc("find_profile_by_username", { p_username: username });
      if (stale) return;
      const row = data?.[0];
      const lookup: Lookup = error
        ? { kind: "error", message: "Search failed. Try again." }
        : !row
          ? { kind: "none" }
          : row.id === meId
            ? { kind: "self" }
            : {
                kind: "found",
                profile: { id: row.id, username: row.username, displayName: row.display_name, avatarUrl: row.avatar_url },
              };
      setResult({ username, lookup });
    }, DEBOUNCE_MS);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [supabase, meId, username]);

  if (!username) return null;
  const lookup = result?.username === username ? result.lookup : null;

  async function start(profile: PublicProfile) {
    setStarting(true);
    setStartError(null);
    const error = await onStartChat(profile.id);
    setStarting(false);
    if (error) setStartError(error);
    else onStarted();
  }

  return (
    <div className="mx-1 rounded-lg border border-zinc-200 bg-white p-2.5 text-sm dark:border-zinc-800 dark:bg-zinc-900" aria-live="polite">
      {!lookup && (
        <p className="flex items-center gap-2 text-zinc-500">
          <Spinner /> Looking up @{username}…
        </p>
      )}
      {lookup?.kind === "none" && <p className="text-zinc-500">No one goes by @{username}.</p>}
      {lookup?.kind === "self" && <p className="text-zinc-500">That&apos;s you.</p>}
      {lookup?.kind === "error" && <p className="text-red-600 dark:text-red-400">{lookup.message}</p>}
      {lookup?.kind === "found" && (
        <div className="flex items-center gap-3">
          <Avatar name={profileName(lookup.profile)} src={lookup.profile.avatarUrl} size="sm" />
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium">{profileName(lookup.profile)}</p>
            <p className="truncate text-xs text-zinc-500">@{lookup.profile.username}</p>
          </div>
          <button
            type="button"
            onClick={() => void start(lookup.profile)}
            disabled={starting}
            className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-indigo-500 disabled:opacity-60"
          >
            {starting && <Spinner />}
            Start chat
          </button>
        </div>
      )}
      {startError && <p className="mt-2 text-red-600 dark:text-red-400">{startError}</p>}
    </div>
  );
}
