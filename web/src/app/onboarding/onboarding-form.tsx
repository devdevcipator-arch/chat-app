"use client";

import { AnimatePresence, motion } from "motion/react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { AuthCard, FormError, Spinner, buttonClass, inputClass } from "@/components/auth-card";
import { createClient } from "@/lib/supabase/client";
import { dbErrorMessage } from "@/lib/errors";
import { DISPLAY_NAME_MAX, USERNAME_MAX, isValidUsername, normalizeUsername } from "@/lib/username";

type Availability = "idle" | "invalid" | "checking" | "available" | "taken" | "error";

const DEBOUNCE_MS = 400;

const hints: Record<Availability, { text: string; className: string }> = {
  idle: { text: "3–20 characters: lowercase letters, numbers, underscores.", className: "text-zinc-500" },
  invalid: { text: "3–20 characters: lowercase letters, numbers, underscores.", className: "text-amber-600 dark:text-amber-400" },
  checking: { text: "Checking availability…", className: "text-zinc-500" },
  available: { text: "Available", className: "text-emerald-600 dark:text-emerald-400" },
  taken: { text: "That username is taken.", className: "text-red-600 dark:text-red-400" },
  error: { text: "Couldn't check right now. You can still try to continue.", className: "text-amber-600 dark:text-amber-400" },
};

export function OnboardingForm({ userId }: { userId: string }) {
  const router = useRouter();
  const [supabase] = useState(createClient);

  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [availability, setAvailability] = useState<Availability>("idle");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef("");

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  async function checkAvailability(candidate: string) {
    const { data, error } = await supabase.rpc("find_profile_by_username", {
      p_username: candidate,
    });
    if (latest.current !== candidate) return; // a newer keystroke won
    if (error) return setAvailability("error");
    const takenBySomeoneElse = (data ?? []).some((p) => p.id !== userId);
    setAvailability(takenBySomeoneElse ? "taken" : "available");
  }

  function handleUsernameChange(raw: string) {
    const value = normalizeUsername(raw);
    setUsername(value);
    setError(null);
    latest.current = value;
    if (timer.current) clearTimeout(timer.current);

    if (!value) return setAvailability("idle");
    if (!isValidUsername(value)) return setAvailability("invalid");

    setAvailability("checking");
    timer.current = setTimeout(() => void checkAvailability(value), DEBOUNCE_MS);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!isValidUsername(username)) return setAvailability("invalid");
    if (availability === "taken") return;

    setError(null);
    setPending(true);
    const { data, error } = await supabase
      .from("profiles")
      .update({ username, display_name: displayName.trim() || username })
      .eq("id", userId)
      .select("username")
      .maybeSingle();

    if (error || !data) {
      setPending(false);
      if (error?.code === "23505") setAvailability("taken");
      return setError(error ? dbErrorMessage(error) : dbErrorMessage({ code: "42501" }));
    }

    setDone(true);
    // Let the success animation play, then move on.
    setTimeout(() => {
      router.replace("/chat");
      router.refresh();
    }, 700);
  }

  const hint = hints[availability];
  const canSubmit =
    !pending && isValidUsername(username) && availability !== "taken" && availability !== "checking";

  return (
    <AuthCard>
      <AnimatePresence mode="wait" initial={false}>
        {done ? (
          <motion.div
            key="done"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="py-8 text-center"
          >
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: "spring", stiffness: 260, damping: 18 }}
              className="mx-auto flex size-12 items-center justify-center rounded-full bg-emerald-500 text-white"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} className="size-6" aria-hidden>
                <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </motion.div>
            <p className="mt-4 font-medium">You&apos;re all set, @{username}</p>
            <p className="mt-1 text-sm text-zinc-500">Opening your chats…</p>
          </motion.div>
        ) : (
          <motion.form key="form" exit={{ opacity: 0, scale: 0.97 }} onSubmit={handleSubmit} noValidate>
            <h1 className="text-xl font-semibold tracking-tight">Choose your identity</h1>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
              People find you by your @username. Your email stays private.
            </p>

            <label htmlFor="username" className="mt-6 block text-sm font-medium">
              Username
            </label>
            <div className="relative mt-1.5">
              <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-zinc-400">@</span>
              <input
                id="username"
                value={username}
                onChange={(e) => handleUsernameChange(e.target.value)}
                autoFocus
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                maxLength={USERNAME_MAX}
                placeholder="your_name"
                disabled={pending}
                aria-describedby="username-hint"
                aria-invalid={availability === "taken" || availability === "invalid" || undefined}
                className={`${inputClass} pl-7 pr-9`}
              />
              <span className="absolute inset-y-0 right-3 flex items-center">
                {availability === "checking" && <span className="text-zinc-400"><Spinner /></span>}
                {availability === "available" && <span className="text-emerald-500" aria-hidden>✓</span>}
                {availability === "taken" && <span className="text-red-500" aria-hidden>✕</span>}
              </span>
            </div>
            <p id="username-hint" aria-live="polite" className={`mt-1.5 text-xs ${hint.className}`}>
              {hint.text}
            </p>

            <label htmlFor="display-name" className="mt-5 block text-sm font-medium">
              Display name <span className="font-normal text-zinc-500">(optional)</span>
            </label>
            <input
              id="display-name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              maxLength={DISPLAY_NAME_MAX}
              autoComplete="nickname"
              placeholder={username || "Shown next to your messages"}
              disabled={pending}
              className={`${inputClass} mt-1.5`}
            />

            <FormError message={error} />

            <button type="submit" disabled={!canSubmit} className={`${buttonClass} mt-6`}>
              {pending && <Spinner />}
              {pending ? "Saving…" : "Continue"}
            </button>
          </motion.form>
        )}
      </AnimatePresence>
    </AuthCard>
  );
}
