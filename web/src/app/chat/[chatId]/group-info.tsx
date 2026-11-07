"use client";

import { AnimatePresence, motion } from "motion/react";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { Avatar } from "@/components/avatar";
import { ConfirmDialog, Dialog } from "@/components/dialog";
import { Menu } from "@/components/menu";
import {
  addMembers,
  leaveGroup,
  removeMember,
  renameGroup,
  setRole,
  type ActionResult,
} from "@/lib/chat-actions";
import { GROUP_TITLE_MAX, profileName, type ChatDetails, type ChatMember, type PublicProfile } from "@/lib/chat";
import { createClient } from "@/lib/supabase/client";
import { MemberPicker } from "../member-picker";

/** Slide-over with the group's name and members, plus admin controls. */
export function GroupInfo({
  open,
  onClose,
  meId,
  details,
}: {
  open: boolean;
  onClose: () => void;
  meId: string;
  details: ChatDetails;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !document.querySelector("dialog[open]")) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-30 bg-zinc-950/30 md:hidden"
            aria-hidden
          />
          <motion.aside
            key="panel"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", stiffness: 400, damping: 40 }}
            aria-label="Group info"
            className="fixed inset-y-0 right-0 z-30 flex w-full flex-col border-l border-zinc-200 bg-white shadow-2xl md:w-96 dark:border-zinc-800 dark:bg-zinc-950"
          >
            <Panel details={details} meId={meId} onClose={onClose} />
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

type Pending =
  | { kind: "remove"; member: ChatMember }
  | { kind: "leave" };

function Panel({ details, meId, onClose }: { details: ChatDetails; meId: string; onClose: () => void }) {
  const [supabase] = useState(createClient);
  const router = useRouter();
  const isAdmin = details.myRole === "admin";
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const title = details.title ?? "Group";

  async function run(action: () => Promise<ActionResult>) {
    setBusy(true);
    setError(null);
    const result = await action();
    setBusy(false);
    if (!result.ok) setError(result.error);
    return result.ok;
  }

  async function confirmPending() {
    if (!pending) return;
    if (pending.kind === "remove") {
      if (await run(() => removeMember(supabase, details.id, pending.member.id))) setPending(null);
    } else if (await run(() => leaveGroup(supabase, details.id))) {
      setPending(null);
      onClose();
      router.push("/chat");
    }
  }

  return (
    <>
      <div className="flex h-16 shrink-0 items-center gap-2 border-b border-zinc-200 px-3 dark:border-zinc-800">
        <button
          type="button"
          onClick={onClose}
          aria-label="Close group info"
          className="rounded-lg p-2 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="size-5" aria-hidden>
            <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
          </svg>
        </button>
        <h2 className="font-semibold">Group info</h2>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <section className="flex flex-col items-center gap-3 border-b border-zinc-200 px-5 py-6 text-center dark:border-zinc-800">
          <Avatar name={title} size="xl" group />
          {editing ? (
            <RenameForm
              initial={title}
              onCancel={() => setEditing(false)}
              onSave={async (next) => {
                if (await run(() => renameGroup(supabase, details.id, next))) setEditing(false);
              }}
              busy={busy}
            />
          ) : (
            <div>
              <p className="text-xl font-semibold break-words">{title}</p>
              <p className="text-sm text-zinc-500">Group · {details.members.length} members</p>
              {isAdmin && (
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  className="mt-2 text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-400"
                >
                  Edit name
                </button>
              )}
            </div>
          )}
        </section>

        {error && !pending && (
          <p role="alert" className="mx-4 mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/50 dark:text-red-300">
            {error}
          </p>
        )}

        <section className="px-2 py-3" aria-labelledby="members-heading">
          <div className="flex items-center justify-between px-2 pb-2">
            <h3 id="members-heading" className="text-sm font-medium text-zinc-500">
              {details.members.length} members
            </h3>
            {isAdmin && (
              <button
                type="button"
                onClick={() => setAdding(true)}
                className="rounded-lg px-2 py-1 text-sm font-medium text-indigo-600 hover:bg-indigo-50 dark:text-indigo-400 dark:hover:bg-indigo-950/50"
              >
                + Add members
              </button>
            )}
          </div>
          <ul>
            {details.members.map((member) => {
              const isMe = member.id === meId;
              return (
                <li key={member.id} className="flex items-center gap-3 rounded-lg px-2 py-2">
                  <Avatar name={profileName(member)} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {isMe ? "You" : profileName(member)}
                    </p>
                    {member.username && <p className="truncate text-xs text-zinc-500">@{member.username}</p>}
                  </div>
                  {member.role === "admin" && (
                    <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300">
                      Admin
                    </span>
                  )}
                  {isAdmin && !isMe && (
                    <Menu
                      label={`Options for ${profileName(member)}`}
                      items={[
                        member.role === "admin"
                          ? {
                              label: "Dismiss as admin",
                              onSelect: () => void run(() => setRole(supabase, details.id, member.id, "member")),
                            }
                          : {
                              label: "Make group admin",
                              onSelect: () => void run(() => setRole(supabase, details.id, member.id, "admin")),
                            },
                        { label: "Remove from group", danger: true, onSelect: () => setPending({ kind: "remove", member }) },
                      ]}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        </section>

        <section className="border-t border-zinc-200 p-3 dark:border-zinc-800">
          <button
            type="button"
            onClick={() => setPending({ kind: "leave" })}
            className="w-full rounded-lg px-3 py-2 text-left text-sm font-medium text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40"
          >
            Leave group
          </button>
        </section>
      </div>

      <ConfirmDialog
        open={!!pending}
        title={pending?.kind === "remove" ? `Remove ${profileName(pending.member)}?` : "Leave group?"}
        description={
          pending?.kind === "remove"
            ? `They'll stop getting messages from "${title}".`
            : `You'll stop getting messages from "${title}". An admin can add you back.`
        }
        confirmLabel={pending?.kind === "remove" ? "Remove" : "Leave group"}
        danger
        busy={busy}
        error={pending ? error : null}
        onConfirm={() => void confirmPending()}
        onClose={() => {
          setPending(null);
          setError(null);
        }}
      />

      <Dialog open={adding} onClose={() => setAdding(false)} title="Add members">
        <AddMembersForm
          meId={meId}
          existingIds={details.members.map((m) => m.id)}
          onCancel={() => setAdding(false)}
          onAdd={async (ids) => addMembers(supabase, details.id, ids)}
          onDone={() => setAdding(false)}
        />
      </Dialog>
    </>
  );
}

function RenameForm({
  initial,
  busy,
  onSave,
  onCancel,
}: {
  initial: string;
  busy: boolean;
  onSave: (title: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  const trimmed = value.trim();

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!trimmed || trimmed === initial) return onCancel();
    void onSave(trimmed);
  }

  return (
    <form onSubmit={submit} className="flex w-full max-w-xs flex-col gap-2">
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && (e.stopPropagation(), onCancel())}
        maxLength={GROUP_TITLE_MAX}
        aria-label="Group name"
        autoFocus
        className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-center text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 dark:border-zinc-700 dark:bg-zinc-900"
      />
      <div className="flex justify-center gap-2">
        <button type="button" onClick={onCancel} className="rounded-lg px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800">
          Cancel
        </button>
        <button
          type="submit"
          disabled={busy || !trimmed}
          className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
        >
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
    </form>
  );
}

function AddMembersForm({
  meId,
  existingIds,
  onAdd,
  onCancel,
  onDone,
}: {
  meId: string;
  existingIds: string[];
  onAdd: (ids: string[]) => Promise<ActionResult>;
  onCancel: () => void;
  onDone: () => void;
}) {
  const [selected, setSelected] = useState<PublicProfile[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add() {
    setBusy(true);
    setError(null);
    const result = await onAdd(selected.map((p) => p.id));
    setBusy(false);
    if (result.ok) onDone();
    else setError(result.error);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <p className="text-sm text-zinc-500">New members won&apos;t see messages sent before they joined.</p>
      <MemberPicker meId={meId} excludeIds={existingIds} selected={selected} onChange={setSelected} />
      {error && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/50 dark:text-red-300">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="rounded-lg px-3.5 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800">
          Cancel
        </button>
        <button
          type="button"
          onClick={() => void add()}
          disabled={busy || selected.length === 0}
          className="rounded-lg bg-indigo-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
        >
          {busy ? "Adding…" : selected.length > 1 ? `Add ${selected.length} people` : "Add"}
        </button>
      </div>
    </div>
  );
}
