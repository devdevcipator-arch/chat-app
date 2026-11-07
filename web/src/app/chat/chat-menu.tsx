"use client";

import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { ConfirmDialog, Dialog } from "@/components/dialog";
import { Menu, type MenuItem } from "@/components/menu";
import {
  clearChat,
  deleteGroup,
  hideChat,
  leaveGroup,
  setMuted,
  type ActionResult,
} from "@/lib/chat-actions";
import type { ChatType } from "@/lib/chat";
import { createClient } from "@/lib/supabase/client";

type Confirmable = "clear" | "delete" | "leave" | "delete-group";

const CONFIRM: Record<
  Confirmable,
  { title: string; description: (name: string) => string; label: string; danger: boolean }
> = {
  clear: {
    title: "Clear chat?",
    description: () => "All messages will be removed for you. Other people in the chat still see them.",
    label: "Clear chat",
    danger: true,
  },
  delete: {
    title: "Delete conversation?",
    description: (name) =>
      `Your conversation with ${name} will be removed from your list and its messages cleared for you. It comes back if they message you again.`,
    label: "Delete",
    danger: true,
  },
  leave: {
    title: "Leave group?",
    description: (name) => `You'll stop getting messages from "${name}". An admin can add you back.`,
    label: "Leave group",
    danger: true,
  },
  "delete-group": {
    title: "Delete group for everyone?",
    description: (name) => `"${name}" and all of its messages will be permanently deleted for every member.`,
    label: "Delete group",
    danger: true,
  },
};

/** The ⋯ menu for a conversation: mute, clear, delete / leave. */
export function ChatMenu({
  chatId,
  type,
  name,
  isMuted,
  isAdmin,
  extraItems = [],
  triggerClassName,
}: {
  chatId: string;
  type: ChatType;
  name: string;
  isMuted: boolean;
  isAdmin: boolean;
  /** Shown first, e.g. "Group info" in the chat header. */
  extraItems?: MenuItem[];
  triggerClassName?: string;
}) {
  const [supabase] = useState(createClient);
  const router = useRouter();
  const pathname = usePathname();
  const [confirm, setConfirm] = useState<Confirmable | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function toggleMute() {
    const result = await setMuted(supabase, chatId, !isMuted);
    if (!result.ok) setNotice(result.error);
  }

  async function runConfirmed(kind: Confirmable) {
    setBusy(true);
    setError(null);
    const actions: Record<Confirmable, () => Promise<ActionResult>> = {
      clear: () => clearChat(supabase, chatId),
      delete: () => hideChat(supabase, chatId),
      leave: () => leaveGroup(supabase, chatId),
      "delete-group": () => deleteGroup(supabase, chatId),
    };
    const result = await actions[kind]();
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setConfirm(null);
    if (kind !== "clear" && pathname === `/chat/${chatId}`) router.push("/chat");
  }

  const items: MenuItem[] = [
    ...extraItems,
    { label: isMuted ? "Unmute notifications" : "Mute notifications", onSelect: () => void toggleMute() },
    { label: "Clear chat", onSelect: () => setConfirm("clear") },
    ...(type === "direct"
      ? [{ label: "Delete conversation", danger: true, onSelect: () => setConfirm("delete") }]
      : [
          { label: "Leave group", danger: true, onSelect: () => setConfirm("leave") },
          ...(isAdmin ? [{ label: "Delete group", danger: true, onSelect: () => setConfirm("delete-group") }] : []),
        ]),
  ];

  const spec = confirm ? CONFIRM[confirm] : null;

  return (
    <>
      <Menu label={`Options for ${name}`} items={items} triggerClassName={triggerClassName} />
      <ConfirmDialog
        open={!!spec}
        title={spec?.title ?? ""}
        description={spec?.description(name) ?? ""}
        confirmLabel={spec?.label ?? ""}
        danger={spec?.danger}
        busy={busy}
        error={error}
        onConfirm={() => confirm && void runConfirmed(confirm)}
        onClose={() => {
          setConfirm(null);
          setError(null);
        }}
      />
      <Dialog open={!!notice} onClose={() => setNotice(null)} title="Couldn't update the chat" size="sm">
        <p className="text-sm text-zinc-600 dark:text-zinc-300">{notice}</p>
        <div className="mt-4 flex justify-end">
          <button
            type="button"
            onClick={() => setNotice(null)}
            className="rounded-lg bg-indigo-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-indigo-500"
          >
            OK
          </button>
        </div>
      </Dialog>
    </>
  );
}
