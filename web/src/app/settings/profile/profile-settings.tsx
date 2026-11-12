"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { useEffect, useRef, useState, useSyncExternalStore, type ChangeEvent, type FormEvent, type ReactNode } from "react";
import { BackIcon } from "@/app/gallery/icons";
import { Avatar } from "@/components/avatar";
import { PoweredBy } from "@/components/powered-by";
import { ConfirmDialog } from "@/components/dialog";
import { Toasts, useToasts } from "@/components/toasts";
import type { Profile } from "@/lib/auth";
import { UploadError } from "@/lib/media-client";
import { AVATAR_INPUT_TYPES, DISPLAY_NAME_MAX, asTheme, normalizeDisplayName, type ThemePreference } from "@/lib/profile";
import { removeAvatar, saveDisplayName, saveThemePreference, uploadAvatar } from "@/lib/profile-client";
import { createClient } from "@/lib/supabase/client";

const errorText = (e: unknown) => (e instanceof UploadError ? e.message : "Something went wrong. Please try again.");

/** false during SSR / hydration, true after: next-themes only knows the theme on the client. */
const useMounted = () =>
  useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

export function ProfileSettings({ me }: { me: Profile & { username: string } }) {
  const [supabase] = useState(createClient);
  const router = useRouter();
  const { toasts, push, dismiss } = useToasts();

  // --- Display name ------------------------------------------------------------
  const [savedName, setSavedName] = useState(me.displayName ?? "");
  const [name, setName] = useState(me.displayName ?? "");
  const [saving, setSaving] = useState(false);
  const normalized = normalizeDisplayName(name);
  const dirty = normalized !== normalizeDisplayName(savedName);
  const shownName = normalized || `@${me.username}`;

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!dirty || saving) return;
    setSaving(true);
    try {
      const saved = (await saveDisplayName(supabase, me.id, name)) ?? "";
      setSavedName(saved);
      setName(saved);
      push({ tone: "success", text: "Profile saved" });
      router.refresh(); // sidebar, chat list and headers pick up the new name
    } catch (err) {
      push({ tone: "error", text: errorText(err) });
    } finally {
      setSaving(false);
    }
  }

  // --- Avatar --------------------------------------------------------------------
  const [avatarKey, setAvatarKey] = useState(me.avatarUrl);
  const [preview, setPreview] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [removing, setRemoving] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const uploading = progress !== null;
  const avatarBusy = uploading || removing;

  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview]);

  async function pickPhoto(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow picking the same file again
    if (!file || avatarBusy) return;
    setPreview(URL.createObjectURL(file));
    setProgress(0);
    try {
      const key = await uploadAvatar(file, setProgress);
      setAvatarKey(key);
      push({ tone: "success", text: "Profile photo updated" });
      router.refresh();
    } catch (err) {
      push({ tone: "error", text: errorText(err) });
    } finally {
      setProgress(null);
      setPreview(null);
    }
  }

  async function doRemove() {
    setRemoving(true);
    try {
      await removeAvatar();
      setAvatarKey(null);
      setConfirmRemove(false);
      push({ tone: "success", text: "Profile photo removed" });
      router.refresh();
    } catch (err) {
      setConfirmRemove(false);
      push({ tone: "error", text: errorText(err) });
    } finally {
      setRemoving(false);
    }
  }

  // --- Theme ---------------------------------------------------------------------
  const { theme, setTheme } = useTheme();
  const mounted = useMounted();
  const currentTheme: ThemePreference = mounted ? asTheme(theme) : me.themePreference;

  async function chooseTheme(next: ThemePreference) {
    if (next === currentTheme) return;
    const before = currentTheme;
    setTheme(next); // instant; localStorage
    try {
      await saveThemePreference(supabase, me.id, next); // follows you to other devices
      router.refresh();
    } catch (err) {
      setTheme(before);
      push({ tone: "error", text: errorText(err) });
    }
  }

  return (
    <div className="min-h-dvh bg-zinc-50 dark:bg-zinc-950">
      <header className="sticky top-0 z-20 border-b border-zinc-200 bg-white/85 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/85">
        <div className="mx-auto flex h-16 max-w-2xl items-center gap-3 px-4">
          <Link
            href="/chat"
            className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-medium text-zinc-600 transition hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            <BackIcon />
            <span>Back to Chats</span>
          </Link>
          <h1 className="min-w-0 flex-1 truncate text-right text-lg font-semibold tracking-tight sm:text-left">
            My Profile &amp; Settings
          </h1>
        </div>
      </header>

      <form onSubmit={save} className="mx-auto max-w-2xl space-y-6 px-4 py-6 pb-28">
        <Section title="Profile" description="How you appear to people you chat with.">
          <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-center">
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              disabled={avatarBusy}
              aria-label="Change profile photo"
              className="group relative shrink-0 rounded-full focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-indigo-600 disabled:cursor-wait"
            >
              <Avatar name={shownName} src={preview ?? avatarKey} size="xl" />
              <span
                className={`absolute inset-0 flex items-center justify-center rounded-full bg-black/45 text-white transition ${
                  uploading ? "opacity-100" : "opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 pointer-coarse:opacity-100 pointer-coarse:bg-black/25"
                }`}
              >
                {uploading ? <ProgressRing value={progress ?? 0} /> : <CameraIcon />}
              </span>
            </button>
            <input
              ref={fileInput}
              type="file"
              accept={AVATAR_INPUT_TYPES.join(",")}
              onChange={pickPhoto}
              className="hidden"
              tabIndex={-1}
              aria-hidden
            />
            <div className="flex min-w-0 flex-1 flex-col items-center gap-3 sm:items-start">
              <div className="min-w-0 text-center sm:text-left">
                <p className="truncate text-lg font-semibold">{shownName}</p>
                <p className="text-xs text-zinc-500">PNG, JPG or WebP, up to 5 MB.</p>
              </div>
              <div className="flex flex-wrap justify-center gap-2">
                <button
                  type="button"
                  onClick={() => fileInput.current?.click()}
                  disabled={avatarBusy}
                  className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-3.5 py-2 text-sm font-medium text-white transition hover:bg-indigo-500 disabled:opacity-60"
                >
                  {uploading ? <Spinner /> : <CameraIcon small />}
                  {uploading ? `Uploading… ${Math.round((progress ?? 0) * 100)}%` : "Upload New Photo"}
                </button>
                {avatarKey && (
                  <button
                    type="button"
                    onClick={() => setConfirmRemove(true)}
                    disabled={avatarBusy}
                    className="rounded-lg border border-zinc-300 px-3.5 py-2 text-sm font-medium text-zinc-700 transition hover:border-red-300 hover:bg-red-50 hover:text-red-700 disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-200 dark:hover:border-red-900 dark:hover:bg-red-950/40 dark:hover:text-red-300"
                  >
                    Remove Photo
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className="mt-6 space-y-5">
            <div>
              <label htmlFor="username" className="mb-1.5 block text-sm font-medium">
                Username
              </label>
              <div className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-100 px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900">
                <span id="username" className="min-w-0 flex-1 truncate text-zinc-700 dark:text-zinc-300">
                  @{me.username}
                </span>
                <span className="shrink-0 rounded-full bg-zinc-200 px-2 py-0.5 text-[11px] font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                  Can&apos;t be changed
                </span>
              </div>
            </div>

            <div>
              <div className="mb-1.5 flex items-baseline justify-between gap-2">
                <label htmlFor="display-name" className="text-sm font-medium">
                  Display name
                </label>
                <span className={`text-xs tabular-nums ${normalized.length > DISPLAY_NAME_MAX ? "text-red-600" : "text-zinc-500"}`}>
                  {normalized.length}/{DISPLAY_NAME_MAX}
                </span>
              </div>
              <input
                id="display-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={DISPLAY_NAME_MAX + 20 /* room for whitespace that gets collapsed */}
                placeholder={`e.g. Amjad Khan (empty shows @${me.username})`}
                autoComplete="name"
                className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 dark:border-zinc-700 dark:bg-zinc-950"
              />
              <p className="mt-1.5 text-xs text-zinc-500">Extra spaces are removed. Leave it empty to show your @username.</p>
            </div>
          </div>
        </Section>

        <Section title="Appearance" description="Applies instantly and follows you to your other devices.">
          <div role="radiogroup" aria-label="Theme" className="grid gap-3 sm:grid-cols-3">
            <ThemeCard value="light" label="Light" icon="☀️" current={currentTheme} onSelect={chooseTheme} />
            <ThemeCard value="dark" label="Dark" icon="🌙" current={currentTheme} onSelect={chooseTheme} />
            <ThemeCard value="system" label="System Default" icon="💻" current={currentTheme} onSelect={chooseTheme} />
          </div>
        </Section>

        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-zinc-200 bg-white/90 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/90">
          <div className="mx-auto flex max-w-2xl items-center justify-end gap-3 px-4 py-3">
            <p className="mr-auto text-xs text-zinc-500">{dirty ? "You have unsaved changes." : "All changes saved."}</p>
            {dirty && (
              <button
                type="button"
                onClick={() => setName(savedName)}
                disabled={saving}
                className="rounded-lg px-3.5 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                Discard
              </button>
            )}
            <button
              type="submit"
              disabled={!dirty || saving || normalized.length > DISPLAY_NAME_MAX}
              aria-busy={saving || undefined}
              className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500 disabled:opacity-50"
            >
              {saving && <Spinner />}
              {saving ? "Saving…" : "Save Changes"}
            </button>
          </div>
        </div>
      </form>

      <PoweredBy className="pb-8" />

      <ConfirmDialog
        open={confirmRemove}
        title="Remove profile photo?"
        description="Your photo will be deleted and your initials shown instead."
        confirmLabel="Remove Photo"
        danger
        busy={removing}
        busyLabel="Removing…"
        onConfirm={() => void doRemove()}
        onClose={() => !removing && setConfirmRemove(false)}
      />
      <Toasts toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}

function Section({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/60">
      <h2 className="text-base font-semibold">{title}</h2>
      <p className="mb-5 text-sm text-zinc-500">{description}</p>
      {children}
    </section>
  );
}

function ThemeCard({
  value,
  label,
  icon,
  current,
  onSelect,
}: {
  value: ThemePreference;
  label: string;
  icon: string;
  current: ThemePreference;
  onSelect: (theme: ThemePreference) => void;
}) {
  const selected = value === current;
  const swatch = {
    light: "bg-white border-zinc-200",
    dark: "bg-zinc-900 border-zinc-700",
    system: "bg-gradient-to-r from-white from-50% to-zinc-900 to-50% border-zinc-300 dark:border-zinc-700",
  }[value];
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={() => onSelect(value)}
      className={`flex flex-col gap-3 rounded-xl border-2 p-3 text-left transition ${
        selected
          ? "border-indigo-600 bg-indigo-50 dark:border-indigo-500 dark:bg-indigo-950/40"
          : "border-zinc-200 hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:border-zinc-700 dark:hover:bg-zinc-800/50"
      }`}
    >
      <span className={`flex h-14 items-end gap-1 rounded-lg border p-2 ${swatch}`} aria-hidden>
        <span className="h-2 w-8 rounded-full bg-indigo-500" />
        <span className="h-2 w-5 rounded-full bg-zinc-400/70" />
      </span>
      <span className="flex items-center gap-2 text-sm font-medium">
        <span aria-hidden>{icon}</span>
        <span className="flex-1">{label}</span>
        <span
          aria-hidden
          className={`flex size-4 items-center justify-center rounded-full border-2 ${
            selected ? "border-indigo-600 bg-indigo-600" : "border-zinc-300 dark:border-zinc-600"
          }`}
        >
          {selected && <span className="size-1.5 rounded-full bg-white" />}
        </span>
      </span>
    </button>
  );
}

function Spinner() {
  return <span className="size-4 shrink-0 animate-spin rounded-full border-2 border-white/40 border-t-white" aria-hidden />;
}

function ProgressRing({ value }: { value: number }) {
  const r = 18;
  const c = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 44 44" className="size-12 -rotate-90" role="progressbar" aria-valuenow={Math.round(value * 100)} aria-valuemin={0} aria-valuemax={100} aria-label="Uploading photo">
      <circle cx="22" cy="22" r={r} fill="none" stroke="currentColor" strokeOpacity={0.3} strokeWidth={4} />
      <circle cx="22" cy="22" r={r} fill="none" stroke="currentColor" strokeWidth={4} strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - value)} className="transition-[stroke-dashoffset] duration-200" />
    </svg>
  );
}

function CameraIcon({ small }: { small?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" className={small ? "size-4" : "size-8"} aria-hidden>
      <path d="M14.5 4h-5L7.5 6.5H5A2 2 0 0 0 3 8.5v9A2 2 0 0 0 5 19.5h14a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2h-2.5z" />
      <circle cx="12" cy="13" r="3.5" />
    </svg>
  );
}
