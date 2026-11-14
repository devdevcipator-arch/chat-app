"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Avatar } from "@/components/avatar";
import { asCallType, type CallType } from "@/lib/call/types";
import { chatName, formatDuration, formatListTime, profileName, type ChatSummary, type PublicProfile } from "@/lib/chat";
import { createClient } from "@/lib/supabase/client";
import { useCall } from "./call/call-provider";
import { PhoneIcon, VideoIcon } from "./call/icons";

const CALL_LIMIT = 50;

type ProfileRow = { id: string; username: string | null; display_name: string | null; avatar_url: string | null };

type Direction = "incoming" | "outgoing" | "missed" | "declined" | "ongoing";

type CallLog = {
  id: string;
  chatId: string;
  type: CallType;
  isGroup: boolean;
  createdAt: string;
  direction: Direction;
  /** "Declined" / "No answer" etc. shown after the direction. */
  detail: string | null;
  durationSeconds: number | null;
  /** The other person (direct calls) or whoever started it (group calls). */
  peer: PublicProfile | null;
};

const toProfile = (row: ProfileRow | null): PublicProfile | null =>
  row ? { id: row.id, username: row.username, displayName: row.display_name, avatarUrl: row.avatar_url } : null;

function secondsBetween(from: string | null, to: string | null) {
  if (!from || !to) return null;
  const secs = (new Date(to).getTime() - new Date(from).getTime()) / 1000;
  return secs > 0 ? secs : null;
}

type Row = {
  id: string;
  chat_id: string;
  caller_id: string;
  callee_id: string | null;
  call_type: string;
  status: string;
  is_group: boolean;
  created_at: string;
  answered_at: string | null;
  ended_at: string | null;
  caller: ProfileRow | null;
  callee: ProfileRow | null;
  call_participants: { user_id: string }[];
};

function toLog(row: Row, meId: string): CallLog {
  const outgoing = row.caller_id === meId;
  const live = row.status === "ringing" || row.status === "accepted" || row.status === "active";
  let direction: Direction;
  let detail: string | null = null;

  if (live) {
    direction = "ongoing";
  } else if (row.is_group) {
    const joined = outgoing || row.call_participants.some((p) => p.user_id === meId);
    direction = outgoing ? "outgoing" : joined ? "incoming" : "missed";
  } else if (outgoing) {
    direction = "outgoing";
    if (row.status === "declined") detail = "Declined";
    else if (row.status === "missed") detail = "No answer";
    else if (row.status === "cancelled") detail = "Cancelled";
  } else if (row.status === "declined") {
    direction = "declined";
  } else if (row.status === "missed" || row.status === "cancelled") {
    direction = "missed";
  } else {
    direction = "incoming";
  }

  return {
    id: row.id,
    chatId: row.chat_id,
    type: asCallType(row.call_type),
    isGroup: row.is_group,
    createdAt: row.created_at,
    direction,
    detail,
    durationSeconds: live ? null : secondsBetween(row.answered_at, row.ended_at),
    peer: toProfile(row.is_group || !outgoing ? row.caller : row.callee),
  };
}

const DIRECTION_LABEL: Record<Direction, string> = {
  incoming: "Incoming",
  outgoing: "Outgoing",
  missed: "Missed",
  declined: "Declined",
  ongoing: "Ongoing",
};

/** Recent voice and video calls, newest first. */
export function CallsPanel({ meId, chats }: { meId: string; chats: ChatSummary[] }) {
  const [supabase] = useState(createClient);
  const { call, controller } = useCall();
  const phase = call.phase;
  const [logs, setLogs] = useState<CallLog[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [retries, setRetries] = useState(0);

  /** The latest call log, or null if it couldn't be loaded. */
  const fetchLogs = useCallback(async (): Promise<CallLog[] | null> => {
    const { data, error } = await supabase
      .from("calls")
      .select(
        `id, chat_id, caller_id, callee_id, call_type, status, is_group, created_at, answered_at, ended_at,
         caller:profiles!calls_caller_id_fkey(id, username, display_name, avatar_url),
         callee:profiles!calls_callee_id_fkey(id, username, display_name, avatar_url),
         call_participants(user_id)`,
      )
      .eq("call_participants.user_id", meId)
      .order("created_at", { ascending: false })
      .limit(CALL_LIMIT);
    if (error) return null;
    return (data as unknown as Row[]).map((row) => toLog(row, meId));
  }, [supabase, meId]);

  // Load on open, on retry, and whenever a call starts or finishes.
  useEffect(() => {
    let stale = false;
    void fetchLogs().then((next) => {
      if (stale) return;
      setFailed(next === null);
      if (next) setLogs(next);
    });
    return () => {
      stale = true;
    };
  }, [fetchLogs, phase, retries]);

  const busy = phase !== "idle" && phase !== "ended";

  if (logs === null && !failed) {
    return (
      <div className="flex-1 space-y-3 px-4 py-3" aria-busy>
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex animate-pulse items-center gap-3">
            <div className="size-10 rounded-full bg-zinc-200 dark:bg-zinc-800" />
            <div className="flex-1 space-y-1.5">
              <div className="h-3 w-28 rounded bg-zinc-200 dark:bg-zinc-800" />
              <div className="h-2.5 w-20 rounded bg-zinc-200 dark:bg-zinc-800" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (failed) {
    return (
      <div className="mx-3 mt-3 rounded-lg border border-dashed border-zinc-300 px-3 py-6 text-center text-sm text-zinc-500 dark:border-zinc-700">
        Couldn&apos;t load your calls.{" "}
        <button type="button" onClick={() => setRetries((n) => n + 1)} className="font-medium text-indigo-600 dark:text-indigo-400">
          Try again
        </button>
      </div>
    );
  }

  if (!logs?.length) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center px-6 py-10 text-center">
        <div className="flex size-12 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600 dark:bg-indigo-950/60 dark:text-indigo-400">
          <PhoneIcon className="size-6" />
        </div>
        <p className="mt-3 text-sm font-medium">No recent calls</p>
        <p className="mt-1 text-xs text-zinc-500">Calls you make or receive will show up here.</p>
      </div>
    );
  }

  const chatsById = new Map(chats.map((c) => [c.chatId, c]));

  return (
    <ul className="space-y-0.5 px-2 pt-1 pb-2">
      {logs.map((log) => {
        const chat = chatsById.get(log.chatId);
        const name = log.isGroup
          ? chat
            ? chatName(chat)
            : "Group"
          : profileName(log.peer ?? chat?.other ?? null);
        const bad = log.direction === "missed" || log.direction === "declined";
        const duration = log.durationSeconds ? formatDuration(log.durationSeconds) : null;
        const status = [DIRECTION_LABEL[log.direction], log.detail, duration].filter(Boolean).join(" · ");
        const peer = log.peer;
        const canRedial = !log.isGroup && !!peer && !busy && !!controller;
        const callLabel = `${log.type === "video" ? "Video" : "Voice"} call ${name}`;

        return (
          <li key={log.id} className="relative">
            <Link
              href={`/chat/${log.chatId}`}
              aria-label={`${name}, ${log.type} call, ${status}`}
              className="flex items-center gap-3 rounded-lg py-2 pr-12 pl-2 transition hover:bg-zinc-200/60 dark:hover:bg-zinc-800/60"
            >
              <Avatar name={name} src={log.isGroup ? null : peer?.avatarUrl} group={log.isGroup} />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-1.5">
                  <p className={`min-w-0 flex-1 truncate text-sm font-medium ${bad ? "text-red-600 dark:text-red-400" : ""}`}>
                    {name}
                  </p>
                  <time
                    suppressHydrationWarning
                    dateTime={log.createdAt}
                    className="shrink-0 text-[11px] text-zinc-500"
                  >
                    {formatListTime(log.createdAt)}
                  </time>
                </div>
                <p
                  className={`flex items-center gap-1 truncate text-xs ${
                    bad ? "text-red-600 dark:text-red-400" : "text-zinc-500"
                  }`}
                >
                  <span aria-hidden>{log.type === "video" ? "📹" : "📞"}</span>
                  <DirectionArrow direction={log.direction} />
                  <span className="truncate">{status}</span>
                </p>
              </div>
            </Link>
            <div className="absolute inset-y-0 right-1.5 flex items-center">
              {log.isGroup ? (
                <Link
                  href={`/chat/${log.chatId}`}
                  title={`Open ${name}`}
                  aria-label={`Open ${name} to call`}
                  className="flex size-9 items-center justify-center rounded-full text-zinc-500 transition hover:bg-zinc-200 hover:text-indigo-600 dark:hover:bg-zinc-800 dark:hover:text-indigo-400"
                >
                  {log.type === "video" ? <VideoIcon className="size-4.5" /> : <PhoneIcon className="size-4.5" />}
                </Link>
              ) : (
                <button
                  type="button"
                  disabled={!canRedial}
                  onClick={() => {
                    if (controller && peer) void controller.start({ ...peer, chatId: log.chatId }, log.type);
                  }}
                  title={busy ? "You're already in a call" : peer ? callLabel : "Can't call a deleted account"}
                  aria-label={busy ? "You're already in a call" : peer ? callLabel : "Can't call a deleted account"}
                  className="flex size-9 items-center justify-center rounded-full text-zinc-500 transition hover:bg-zinc-200 hover:text-indigo-600 disabled:pointer-events-none disabled:opacity-40 dark:hover:bg-zinc-800 dark:hover:text-indigo-400"
                >
                  {log.type === "video" ? <VideoIcon className="size-4.5" /> : <PhoneIcon className="size-4.5" />}
                </button>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function DirectionArrow({ direction }: { direction: Direction }) {
  if (direction === "ongoing") {
    return <span aria-hidden className="size-1.5 shrink-0 animate-pulse rounded-full bg-emerald-500" />;
  }
  // Outgoing points up-right; everything received points down-left.
  const d = direction === "outgoing" ? "M7 17 17 7M8 7h9v9" : "M17 7 7 17M16 17H7V8";
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-3 shrink-0"
      aria-hidden
    >
      <path d={d} />
    </svg>
  );
}
