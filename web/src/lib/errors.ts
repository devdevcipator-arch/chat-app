import { isAuthError, isAuthRetryableFetchError } from "@supabase/supabase-js";

const GENERIC = "Something went wrong. Please try again.";
const OFFLINE = "Can't reach the server. Check your connection and try again.";

/** User-friendly message for Supabase Auth errors. */
export function authErrorMessage(error: unknown): string {
  if (isAuthRetryableFetchError(error) || error instanceof TypeError) {
    return OFFLINE;
  }
  if (!isAuthError(error)) return GENERIC;

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
