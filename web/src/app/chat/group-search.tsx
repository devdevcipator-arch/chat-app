"use client";

import { useEffect, useState } from "react";
import { Avatar } from "@/components/avatar";
import { Spinner } from "@/components/auth-card";
import { createClient } from "@/lib/supabase/client";

export type GroupResult = {
  id: string;
  title: string;
  memberCount: number;
  isMember: boolean;
};

const DEBOUNCE_MS = 250;
const MIN_LENGTH = 2;

/**
 * "Discover Groups": searches every group on the platform by title
 * (debounced) and lists the ones not already shown under "Your Groups", with
 * Join (or Open, for a group I'm in that isn't in my loaded list).
 */
export function DiscoverGroups({
  query,
  knownChatIds,
  onJoin,
}: {
  query: string;
  /** Chats already listed locally; they're left out of the results. */
  knownChatIds: Set<string>;
  /** Returns an error message, or null on success. */
  onJoin: (group: GroupResult) => Promise<string | null>;
}) {
  const [supabase] = useState(createClient);
  const q = query.trim().replace(/^@/, "");
  const searchable = q.length >= MIN_LENGTH;
  // Keyed by the query they answer; stale results stay up while the next loads.
  const [result, setResult] = useState<{ query: string; groups: GroupResult[]; error: string | null } | null>(null);
  const [joiningId, setJoiningId] = useState<string | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);

  useEffect(() => {
    if (!searchable) return;
    let stale = false;
    const timer = setTimeout(async () => {
      const { data, error } = await supabase.rpc("search_groups", { p_query: q });
      if (stale) return;
      setResult({
        query: q,
        error: error ? "Group search failed. Try again." : null,
        groups: (data ?? []).map((row) => ({
          id: row.id,
          title: row.title ?? "Group",
          memberCount: row.member_count ?? 0,
          isMember: row.is_member === true,
        })),
      });
    }, DEBOUNCE_MS);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [supabase, q, searchable]);

  if (!searchable) return null;
  const loading = result?.query !== q;
  const shown = (result?.groups ?? []).filter((g) => !knownChatIds.has(g.id));

  async function join(group: GroupResult) {
    setJoiningId(group.id);
    setJoinError(null);
    const error = await onJoin(group);
    setJoiningId(null);
    setJoinError(error);
  }

  return (
    <section aria-label="Discover Groups" aria-live="polite">
      <h2 className="px-4 pb-1 text-[11px] font-semibold tracking-wide text-zinc-500 uppercase">
        Discover Groups
        {shown.length > 0 && <span className="ml-1 font-normal">· {shown.length}</span>}
      </h2>
      {shown.length === 0 ? (
        <p className="mx-4 flex items-center gap-2 px-1 py-2 text-sm text-zinc-500 md:mx-3">
          {loading ? (
            <>
              <Spinner /> Searching groups for “{q}”…
            </>
          ) : result?.error ? (
            <span className="text-red-600 dark:text-red-400">{result.error}</span>
          ) : (
            <>No other groups match “{q}”.</>
          )}
        </p>
      ) : (
        <ul className="pb-2 md:px-2">
          {shown.map((group) => (
            <li key={group.id} className="flex items-center gap-3.5 py-2.5 pr-3 pl-4 md:gap-3 md:rounded-lg md:py-2 md:pl-2">
              <Avatar name={group.title} src={null} group size="row" />
              <div className="min-w-0 flex-1 leading-snug">
                <p className="truncate text-[15px] font-medium md:text-sm">{group.title}</p>
                <p className="truncate text-xs text-zinc-500">
                  {group.memberCount === 1 ? "1 member" : `${group.memberCount} members`}
                </p>
              </div>
              <button
                type="button"
                onClick={() => void join(group)}
                disabled={joiningId !== null}
                aria-label={`${group.isMember ? "Open" : "Join"} ${group.title}`}
                className={`inline-flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition disabled:opacity-60 ${
                  group.isMember
                    ? "border border-zinc-300 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
                    : "bg-indigo-600 text-white hover:bg-indigo-500"
                }`}
              >
                {joiningId === group.id && <Spinner />}
                {group.isMember ? "Open" : "Join"}
              </button>
            </li>
          ))}
        </ul>
      )}
      {joinError && <p className="px-4 pb-2 text-sm text-red-600 dark:text-red-400">{joinError}</p>}
    </section>
  );
}
