import { Config } from "./config";
import { AppError } from "./errors";
import { supabase } from "./supabase";
import { Network } from "../state/network";

/**
 * Calls the web platform's API routes (/api/...) as the signed-in user.
 *
 * Native apps have no session cookie, so the Supabase access token is sent as
 * `Authorization: Bearer`; the routes verify it (web/src/lib/supabase/server.ts
 * → getApiAuth) and run their queries under RLS.
 */
async function authHeaders(json: boolean): Promise<Record<string, string>> {
  // getSession() refreshes an expired access token first when it can.
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new AppError("Please sign in again.", 401);
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
    ...(json ? { "Content-Type": "application/json" } : {}),
  };
}

async function send<T>(method: string, path: string, body?: unknown): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  let response: Response;
  try {
    response = await fetch(`${Config.apiBaseUrl}${path}`, {
      method,
      headers: await authHeaders(body !== undefined),
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (e) {
    if (e instanceof AppError) throw e;
    Network.reportFailure(e);
    // fetch only rejects when the request never got an answer: treat it as offline.
    throw new AppError(
      controller.signal.aborted
        ? "The server took too long to answer. Please try again."
        : "Can't reach the server. Check your connection.",
      undefined,
      true,
    );
  } finally {
    clearTimeout(timer);
  }
  Network.reportSuccess();

  let data: Record<string, unknown> | null = null;
  try {
    data = (await response.json()) as Record<string, unknown>;
  } catch {
    // Non-JSON body (e.g. a proxy error page).
  }
  if (response.ok) return (data ?? {}) as T;
  const error = typeof data?.error === "string" && data.error ? data.error : `Something went wrong (${response.status}).`;
  throw new AppError(error, response.status);
}

export const Api = {
  post: <T = Record<string, unknown>>(path: string, body: unknown) => send<T>("POST", path, body),
  put: <T = Record<string, unknown>>(path: string, body: unknown) => send<T>("PUT", path, body),
  delete: <T = Record<string, unknown>>(path: string) => send<T>("DELETE", path),
};

/** Header map from a JSON object of strings. */
export const stringMap = (value: unknown): Record<string, string> =>
  value && typeof value === "object"
    ? Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, String(v)]))
    : {};
