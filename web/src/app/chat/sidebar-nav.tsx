"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Avatar } from "@/components/avatar";
import { signOut } from "./actions";

export type SidebarTab = "chats" | "groups" | "calls";

type IconProps = { className?: string };
const iconProps = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
} as const;

export function MessageSquareIcon({ className = "size-5" }: IconProps) {
  return (
    <svg {...iconProps} className={className}>
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

export function UsersIcon({ className = "size-5" }: IconProps) {
  return (
    <svg {...iconProps} className={className}>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

export function PhoneNavIcon({ className = "size-5" }: IconProps) {
  return (
    <svg {...iconProps} className={className}>
      <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z" />
    </svg>
  );
}

export function GalleryIcon({ className = "size-5" }: IconProps) {
  return (
    <svg {...iconProps} className={className}>
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <circle cx="9" cy="9" r="2" />
      <path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21" />
    </svg>
  );
}

function LogOutIcon({ className = "size-5" }: IconProps) {
  return (
    <svg {...iconProps} className={className}>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
    </svg>
  );
}

const TABS: { id: SidebarTab; label: string; icon: (p: IconProps) => ReactNode }[] = [
  { id: "chats", label: "Chats", icon: MessageSquareIcon },
  { id: "groups", label: "Groups", icon: UsersIcon },
  { id: "calls", label: "Calls", icon: PhoneNavIcon },
];

export type TabBadges = Partial<Record<SidebarTab, number>>;

function Badge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span
      aria-hidden
      className="absolute -top-1.5 left-1/2 ml-1.5 min-w-4.5 rounded-full bg-indigo-600 px-1 text-center text-[10px] leading-4.5 font-semibold text-white ring-2 ring-zinc-100 dark:ring-zinc-950"
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}

function tabLabel(label: string, count = 0) {
  return count > 0 ? `${label}, ${count} unread` : label;
}

/** Desktop: slim vertical rail to the left of the list. */
export function NavRail({
  active,
  onChange,
  badges,
  me,
}: {
  active: SidebarTab;
  onChange: (tab: SidebarTab) => void;
  badges: TabBadges;
  me: { name: string; username: string; avatarUrl: string | null };
}) {
  return (
    <nav
      aria-label="Sections"
      className="hidden w-16 shrink-0 flex-col items-center justify-between border-r border-zinc-200 bg-zinc-100/80 py-3 md:flex dark:border-zinc-800 dark:bg-zinc-950"
    >
      <ul className="flex flex-col items-center gap-2">
        {TABS.map(({ id, label, icon: Icon }) => {
          const selected = active === id;
          return (
            <li key={id}>
              <button
                type="button"
                onClick={() => onChange(id)}
                aria-current={selected ? "page" : undefined}
                aria-label={tabLabel(label, badges[id])}
                className={`group/tab flex w-14 flex-col items-center gap-1 rounded-xl py-1.5 text-[10px] font-medium transition ${
                  selected
                    ? "text-indigo-600 dark:text-indigo-400"
                    : "text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
                }`}
              >
                <span
                  className={`relative flex h-8 w-12 items-center justify-center rounded-full transition ${
                    selected
                      ? "bg-indigo-100 dark:bg-indigo-950/70"
                      : "group-hover/tab:bg-zinc-200/80 dark:group-hover/tab:bg-zinc-800/70"
                  }`}
                >
                  <Icon />
                  <Badge count={badges[id] ?? 0} />
                </span>
                {label}
              </button>
            </li>
          );
        })}
      </ul>

      <div className="flex flex-col items-center gap-2">
        <Link
          href="/gallery"
          title="My Gallery"
          aria-label="My Gallery"
          className="flex size-10 items-center justify-center rounded-full text-zinc-500 transition hover:bg-zinc-200/80 hover:text-indigo-600 dark:hover:bg-zinc-800/70 dark:hover:text-indigo-400"
        >
          <GalleryIcon />
        </Link>
        <form action={signOut}>
          <button
            type="submit"
            title="Sign out"
            aria-label="Sign out"
            className="flex size-10 items-center justify-center rounded-full text-zinc-500 transition hover:bg-zinc-200/80 hover:text-zinc-900 dark:hover:bg-zinc-800/70 dark:hover:text-zinc-100"
          >
            <LogOutIcon />
          </button>
        </form>
        <Link
          href="/settings/profile"
          title="Profile & settings"
          aria-label={`${me.name}, @${me.username}: profile and settings`}
          className="rounded-full ring-indigo-500/40 transition hover:ring-4"
        >
          <Avatar name={me.name} src={me.avatarUrl} size="sm" />
        </Link>
      </div>
    </nav>
  );
}

/** Mobile: bottom tab bar under the list (hidden while a chat is open). */
export function BottomNav({
  active,
  onChange,
  badges,
}: {
  active: SidebarTab;
  onChange: (tab: SidebarTab) => void;
  badges: TabBadges;
}) {
  return (
    <nav
      aria-label="Sections"
      className="grid h-16 shrink-0 grid-cols-3 border-t border-zinc-200 bg-zinc-50 pb-[env(safe-area-inset-bottom)] md:hidden max-md:group-has-[[data-chat-open]]/frame:hidden dark:border-zinc-800 dark:bg-zinc-950"
    >
      {TABS.map(({ id, label, icon: Icon }) => {
        const selected = active === id;
        return (
          <button
            key={id}
            type="button"
            onClick={() => onChange(id)}
            aria-current={selected ? "page" : undefined}
            aria-label={tabLabel(label, badges[id])}
            className={`flex flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition ${
              selected ? "text-indigo-600 dark:text-indigo-400" : "text-zinc-500"
            }`}
          >
            <span
              className={`relative flex h-7 w-14 items-center justify-center rounded-full transition ${
                selected ? "bg-indigo-100 dark:bg-indigo-950/70" : ""
              }`}
            >
              <Icon />
              <Badge count={badges[id] ?? 0} />
            </span>
            {label}
          </button>
        );
      })}
    </nav>
  );
}
