"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Dialog } from "@/components/dialog";
import { createGroup } from "@/lib/chat-actions";
import { GROUP_MEMBERS_MAX, GROUP_TITLE_MAX, type PublicProfile } from "@/lib/chat";
import { createClient } from "@/lib/supabase/client";
import { MemberPicker } from "./member-picker";

export function NewGroupButton({ meId, onCreated }: { meId: string; onCreated: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium text-indigo-600 transition hover:bg-indigo-50 dark:text-indigo-400 dark:hover:bg-indigo-950/50"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="size-4" aria-hidden>
          <path d="M12 5v14M5 12h14" strokeLinecap="round" />
        </svg>
        New group
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title="New group">
        <NewGroupForm meId={meId} onDone={() => setOpen(false)} onCreated={onCreated} />
      </Dialog>
    </>
  );
}

function NewGroupForm({
  meId,
  onDone,
  onCreated,
}: {
  meId: string;
  onDone: () => void;
  onCreated: () => Promise<void>;
}) {
  const [supabase] = useState(createClient);
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [members, setMembers] = useState<PublicProfile[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmed = title.trim();
  const tooMany = members.length + 1 > GROUP_MEMBERS_MAX;
  const canCreate = trimmed.length > 0 && members.length > 0 && !tooMany && !busy;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!canCreate) return;
    setBusy(true);
    setError(null);
    const result = await createGroup(
      supabase,
      trimmed,
      members.map((m) => m.id),
    );
    if (!result.ok) {
      setBusy(false);
      setError(result.error);
      return;
    }
    await onCreated();
    onDone();
    router.push(`/chat/${result.chatId}`);
  }

  return (
    <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col gap-3">
      <label className="block space-y-1">
        <span className="text-sm font-medium">Group name</span>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={GROUP_TITLE_MAX}
          required
          autoFocus
          placeholder="e.g. Weekend plans"
          className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 dark:border-zinc-700 dark:bg-zinc-950"
        />
      </label>

      <div className="flex min-h-0 flex-1 flex-col gap-1">
        <span className="text-sm font-medium">
          Members <span className="font-normal text-zinc-500">({members.length} selected)</span>
        </span>
        <MemberPicker meId={meId} selected={members} onChange={setMembers} />
      </div>

      {(error || tooMany) && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/50 dark:text-red-300">
          {error ?? `Groups can have up to ${GROUP_MEMBERS_MAX} members.`}
        </p>
      )}

      <div className="flex justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={onDone}
          className="rounded-lg px-3.5 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={!canCreate}
          className="rounded-lg bg-indigo-600 px-3.5 py-2 text-sm font-medium text-white transition hover:bg-indigo-500 disabled:opacity-50"
        >
          {busy ? "Creating…" : "Create group"}
        </button>
      </div>
    </form>
  );
}
