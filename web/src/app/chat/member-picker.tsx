"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Avatar } from "@/components/avatar";
import { profileName, type PublicProfile } from "@/lib/chat";
import { createClient } from "@/lib/supabase/client";
import { isValidUsername, normalizeUsername } from "@/lib/username";

// Multi-select of people: your existing direct-chat contacts, filterable,
// plus anyone found by exact @username (there's no public directory).

export function MemberPicker({
  meId,
  excludeIds = [],
  selected,
  onChange,
}: {
  meId: string;
  /** Already in the group. */
  excludeIds?: string[];
  selected: PublicProfile[];
  onChange: (next: PublicProfile[]) => void;
}) {
  const [supabase] = useState(createClient);
  const [contacts, setContacts] = useState<PublicProfile[] | null>(null);
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<PublicProfile | null | "none">(null);
  const latest = useRef("");

  useEffect(() => {
    let cancelled = false;
    void supabase.rpc("list_my_chats").then(({ data }) => {
      if (cancelled) return;
      const byId = new Map<string, PublicProfile>();
      for (const row of data ?? []) {
        const id = row.other_user_id as string | null;
        if (row.chat_type !== "direct" || !id || !row.other_username) continue;
        byId.set(id, {
          id,
          username: row.other_username,
          displayName: row.other_display_name ?? null,
          avatarUrl: row.other_avatar_url ?? null,
        });
      }
      setContacts([...byId.values()].sort((a, b) => profileName(a).localeCompare(profileName(b))));
    });
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  const excluded = useMemo(() => new Set([meId, ...excludeIds]), [meId, excludeIds]);
  const selectedIds = new Set(selected.map((p) => p.id));
  const needle = query.trim().toLowerCase().replace(/^@/, "");
  const visible = (contacts ?? []).filter(
    (p) =>
      !excluded.has(p.id) &&
      (!needle ||
        p.username?.toLowerCase().includes(needle) ||
        p.displayName?.toLowerCase().includes(needle)),
  );

  // Exact-username lookup for people you haven't chatted with yet.
  useEffect(() => {
    const username = normalizeUsername(query);
    latest.current = username;
    if (!isValidUsername(username) || contacts?.some((c) => c.username === username)) return;
    const timer = setTimeout(async () => {
      const { data } = await supabase.rpc("find_profile_by_username", { p_username: username });
      if (latest.current !== username) return;
      const row = data?.[0];
      setFound(
        row ? { id: row.id, username: row.username, displayName: row.display_name, avatarUrl: row.avatar_url } : "none",
      );
    }, 350);
    return () => clearTimeout(timer);
  }, [query, contacts, supabase]);

  /** The exact-username match, if it is current and not already listed. */
  const foundProfile =
    found && found !== "none" && normalizeUsername(query) === found.username && !excluded.has(found.id)
      ? found
      : null;

  function toggle(profile: PublicProfile) {
    onChange(selectedIds.has(profile.id) ? selected.filter((p) => p.id !== profile.id) : [...selected, profile]);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {selected.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label="Selected people">
          {selected.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => toggle(p)}
                aria-label={`Remove ${profileName(p)}`}
                className="flex items-center gap-1 rounded-full bg-indigo-50 py-1 pr-2 pl-2.5 text-xs font-medium text-indigo-700 hover:bg-indigo-100 dark:bg-indigo-950/60 dark:text-indigo-300"
              >
                {profileName(p)} <span aria-hidden>✕</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <input
        type="search"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setFound(null);
        }}
        placeholder="Search contacts or exact @username"
        aria-label="Search people"
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
        className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 dark:border-zinc-700 dark:bg-zinc-950"
      />

      <ul className="-mx-1 min-h-32 flex-1 overflow-y-auto" aria-label="People">
        {foundProfile && !visible.some((p) => p.id === foundProfile.id) && (
          <PersonRow
            profile={foundProfile}
            checked={selectedIds.has(foundProfile.id)}
            onToggle={toggle}
            hint="Found by username"
          />
        )}
        {visible.map((p) => (
          <PersonRow key={p.id} profile={p} checked={selectedIds.has(p.id)} onToggle={toggle} />
        ))}
        {contacts === null && <li className="px-1 py-3 text-sm text-zinc-500">Loading contacts…</li>}
        {contacts !== null && visible.length === 0 && !foundProfile && (
          <li className="px-1 py-3 text-sm text-zinc-500">
            {found === "none"
              ? `No one goes by @${normalizeUsername(query)}.`
              : needle
                ? "No matching contacts. Type someone's exact @username to find them."
                : "No contacts yet. Type someone's exact @username to add them."}
          </li>
        )}
      </ul>
    </div>
  );
}

function PersonRow({
  profile,
  checked,
  onToggle,
  hint,
}: {
  profile: PublicProfile;
  checked: boolean;
  onToggle: (p: PublicProfile) => void;
  hint?: string;
}) {
  return (
    <li>
      <label className="flex cursor-pointer items-center gap-3 rounded-lg px-1 py-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800">
        <Avatar name={profileName(profile)} src={profile.avatarUrl} size="sm" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{profileName(profile)}</span>
          <span className="block truncate text-xs text-zinc-500">
            @{profile.username}
            {hint && ` · ${hint}`}
          </span>
        </span>
        <input
          type="checkbox"
          checked={checked}
          onChange={() => onToggle(profile)}
          className="size-4 accent-indigo-600"
        />
      </label>
    </li>
  );
}
