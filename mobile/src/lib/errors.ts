const GENERIC = "Something went wrong. Please try again.";
const OFFLINE = "Can't reach the server. Check your connection and try again.";

/** A failure whose message can be shown to the user as is. */
export class AppError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    /** The request never reached the server (no network, timeout). */
    readonly offline = false,
  ) {
    super(message);
    this.name = "AppError";
  }
}

type Loose = { name?: string; message?: string; code?: string; status?: number; hint?: string } | null | undefined;
const loose = (e: unknown) => (typeof e === "object" ? (e as Loose) : null);

/**
 * Whether [error] means the request never reached the server (no internet,
 * DNS failure, airplane mode, timeout) rather than the server rejecting it.
 */
export function isOfflineError(error: unknown): boolean {
  if (error instanceof AppError) return error.offline;
  const e = loose(error);
  if (e?.name === "AuthRetryableFetchError") return !e.status;
  if (e?.name === "AbortError" || e?.name === "TimeoutError") return true;
  const text = e?.message ?? String(error);
  return /network request failed|failed to fetch|network error|timed out|timeout|ENOTFOUND|ECONNREFUSED|unable to resolve host/i.test(
    text,
  );
}

/** User-friendly message for Supabase Auth errors. */
export function authErrorMessage(error: unknown) {
  if (isOfflineError(error)) return OFFLINE;
  const e = loose(error);
  if (!e?.name?.startsWith("Auth")) return GENERIC;
  if (/sending .*email/i.test(e.message ?? "")) {
    return "We couldn't send the sign-in email right now. Please try again in a few minutes.";
  }
  if (e.name === "AuthRetryableFetchError") return "The server ran into a problem. Please try again shortly.";
  switch (e.code) {
    case "otp_expired":
      return "That code is invalid or has expired. Check it or request a new one.";
    case "over_email_send_rate_limit":
      return "Too many codes sent to this email. Please wait a few minutes and try again.";
    case "over_request_rate_limit":
      return "Too many attempts. Please wait a moment and try again.";
    case "email_address_invalid":
      return "Please enter a valid email address.";
    case "signup_disabled":
      return "New sign-ups are currently closed.";
    case "email_provider_disabled":
    case "otp_disabled":
      return "Email sign-in is currently unavailable.";
  }
  if (e.status === 429) return "Too many attempts. Please wait a moment and try again.";
  return GENERIC;
}

/** User-friendly message for database (PostgREST) errors. */
export function dbErrorMessage(error: unknown) {
  if (isOfflineError(error)) return OFFLINE;
  if (error instanceof AppError) return error.message;
  switch (loose(error)?.code) {
    case "23505":
      return "That username was just taken. Please pick another.";
    case "23514":
      return "Please check your details: something doesn't meet the requirements.";
    case "42501":
      return "Your session has expired. Please sign in again.";
    case "P0002":
      return "That user no longer exists.";
  }
  return GENERIC;
}

/** User-facing message for a failed chat/group RPC (mirrors web chat-actions.ts). */
export function chatActionError(error: unknown) {
  if (isOfflineError(error)) return "You're offline. Try again when you're connected.";
  if (error instanceof AppError) return error.message;
  const e = loose(error);
  switch (e?.message) {
    case "not a group admin":
      return "Only group admins can do that.";
    case "last admin":
      return "A group needs at least one admin. Make someone else an admin first.";
    case "too many members":
      return "Groups can have up to 100 members.";
    case "invalid title":
      return "Group names must be 1–60 characters.";
    case "no members":
      return "Add at least one other person.";
    case "not a member":
      return "You're no longer in this conversation.";
    case "not a group":
      return "That group no longer exists.";
  }
  if (e?.code === "42501") return "Your session has expired. Please sign in again.";
  if (e?.code === "P0002") return "That account is no longer available.";
  return GENERIC;
}

/** Throws the PostgREST error of a supabase-js response; returns its data. */
export function unwrap<T>(result: { data: T; error: unknown }): T {
  if (result.error) throw result.error;
  return result.data;
}
