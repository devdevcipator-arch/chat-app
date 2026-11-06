import { isAuthError, isAuthRetryableFetchError } from "@supabase/supabase-js";

const GENERIC = "Something went wrong. Please try again.";
const OFFLINE = "Can't reach the server. Check your connection and try again.";
const EMAIL_FAILED = "We couldn't send the sign-in email right now. Please try again in a few minutes.";
const SERVER_PROBLEM = "The server ran into a problem. Please try again shortly.";

/** User-friendly message for Supabase Auth errors. */
export function authErrorMessage(error: unknown): string {
  if (error instanceof TypeError) return OFFLINE;

  // supabase-js reports every 5xx as a "retryable fetch error" too; only
  // status 0 means the request never reached the server.
  if (isAuthRetryableFetchError(error)) {
    if (!error.status) return OFFLINE;
    if (/sending .*email/i.test(error.message)) return EMAIL_FAILED;
    return SERVER_PROBLEM;
  }
  if (!isAuthError(error)) return GENERIC;
  if (/sending .*email/i.test(error.message)) return EMAIL_FAILED;

  switch (error.code) {
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
  if (error.status === 429) return "Too many attempts. Please wait a moment and try again.";
  return GENERIC;
}

/** User-friendly message for PostgREST (database) errors. */
export function dbErrorMessage(error: { code?: string } | null): string {
  switch (error?.code) {
    case "23505":
      return "That username was just taken. Please pick another.";
    case "23514":
      return "Please check your details: something doesn't meet the requirements.";
    case "42501":
      return "Your session has expired. Please sign in again.";
  }
  return GENERIC;
}
