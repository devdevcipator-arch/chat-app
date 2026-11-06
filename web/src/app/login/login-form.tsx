"use client";

import { AnimatePresence, motion } from "motion/react";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { AuthCard, FormError, LockBadge, Spinner, buttonClass, inputClass } from "@/components/auth-card";
import { createClient } from "@/lib/supabase/client";
import { authErrorMessage } from "@/lib/errors";
import { OtpInput } from "./otp-input";

// Must match Auth > Providers > Email > "Email OTP Length" in Supabase.
const OTP_LENGTH = 6;
const RESEND_SECONDS = 60;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Step = "email" | "code";

export function LoginForm() {
  const router = useRouter();
  const [supabase] = useState(createClient);

  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendAt, setResendAt] = useState(0);
  const [now, setNow] = useState(0); // set from event handlers / the timer only

  const secondsLeft = Math.max(0, Math.ceil((resendAt - now) / 1000));

  useEffect(() => {
    if (resendAt <= Date.now()) return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [resendAt]);

  async function sendCode(address: string) {
    const { error } = await supabase.auth.signInWithOtp({
      email: address,
      options: { shouldCreateUser: true },
    });
    if (error) {
      setError(authErrorMessage(error));
      return false;
    }
    setResendAt(Date.now() + RESEND_SECONDS * 1000);
    setNow(Date.now());
    return true;
  }

  async function handleEmailSubmit(e: FormEvent) {
    e.preventDefault();
    const normalized = email.trim().toLowerCase();
    setEmail(normalized);
    if (!EMAIL_PATTERN.test(normalized)) {
      setError("Please enter a valid email address.");
      return;
    }
    setError(null);
    setPending(true);
    const sent = await sendCode(normalized);
    setPending(false);
    if (!sent) return;
    setCode("");
    setStep("code");
  }

  async function verify(token: string) {
    setError(null);
    setPending(true);
    const { data, error } = await supabase.auth.verifyOtp({ email, token, type: "email" });
    if (error || !data.user) {
      setPending(false);
      setCode("");
      return setError(authErrorMessage(error));
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("username")
      .eq("id", data.user.id)
      .maybeSingle();

    // Keep `pending` on so the form stays disabled during navigation.
    router.replace(profile?.username ? "/chat" : "/onboarding");
    router.refresh();
  }

  function handleCodeChange(value: string) {
    setCode(value);
    if (error) setError(null);
    if (value.length === OTP_LENGTH && !pending) void verify(value);
  }

  async function handleResend() {
    if (secondsLeft > 0 || pending) return;
    setError(null);
    setPending(true);
    await sendCode(email);
    setPending(false);
  }

  return (
    <AuthCard>
      <LockBadge />
      <AnimatePresence mode="wait" initial={false}>
        {step === "email" ? (
          <motion.form
            key="email"
            onSubmit={handleEmailSubmit}
            initial={{ opacity: 0, x: -24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -24 }}
            transition={{ duration: 0.2 }}
            noValidate
          >
            <h1 className="text-xl font-semibold tracking-tight">Sign in</h1>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
              We&apos;ll email you a {OTP_LENGTH}-digit code. No password, no phone number.
            </p>

            <label htmlFor="email" className="mt-6 block text-sm font-medium">
              Email
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              autoFocus
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              disabled={pending}
              className={`${inputClass} mt-1.5`}
            />
            <FormError message={error} />

            <button type="submit" disabled={pending || !email} className={`${buttonClass} mt-5`}>
              {pending && <Spinner />}
              {pending ? "Sending code…" : "Continue"}
            </button>

            <p className="mt-5 text-xs leading-relaxed text-zinc-500">
              Your email is only used to sign you in. Other people see your
              @username, never your email.
            </p>
          </motion.form>
        ) : (
          <motion.div
            key="code"
            initial={{ opacity: 0, x: 24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 24 }}
            transition={{ duration: 0.2 }}
          >
            <h1 className="text-xl font-semibold tracking-tight">Check your email</h1>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
              Enter the code we sent to{" "}
              <span className="font-medium text-zinc-900 dark:text-zinc-100">{email}</span>
            </p>

            <form
              className="mt-6"
              onSubmit={(e) => {
                e.preventDefault();
                if (code.length === OTP_LENGTH && !pending) void verify(code);
              }}
            >
              <OtpInput
                length={OTP_LENGTH}
                value={code}
                onChange={handleCodeChange}
                disabled={pending}
                invalid={!!error}
              />
              <FormError message={error} />

              <button
                type="submit"
                disabled={pending || code.length !== OTP_LENGTH}
                className={`${buttonClass} mt-5`}
              >
                {pending && <Spinner />}
                {pending ? "Verifying…" : "Verify"}
              </button>
            </form>

            <div className="mt-5 flex items-center justify-between text-sm">
              <button
                type="button"
                onClick={() => {
                  setStep("email");
                  setError(null);
                  setCode("");
                }}
                disabled={pending}
                className="text-zinc-600 hover:text-zinc-900 disabled:opacity-50 dark:text-zinc-400 dark:hover:text-zinc-100"
              >
                ← Change email
              </button>
              <button
                type="button"
                onClick={handleResend}
                disabled={secondsLeft > 0 || pending}
                className="font-medium text-indigo-600 hover:text-indigo-500 disabled:text-zinc-400 dark:text-indigo-400 dark:disabled:text-zinc-600"
              >
                {secondsLeft > 0 ? `Resend in ${secondsLeft}s` : "Resend code"}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </AuthCard>
  );
}
