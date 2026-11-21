import type { NextRequest } from "next/server";
import { redirectWithSession, updateSession } from "@/lib/supabase/proxy";

// Next.js 16 renamed `middleware.ts` to `proxy.ts`; this is the route guard.
// It is an optimistic check: pages re-verify on the server (see lib/auth.ts),
// and RLS is the real authorization boundary.

/**
 * Set once a user is known to have finished onboarding (usernames can't be
 * removed afterwards), so the proxy stops querying `profiles` on every
 * navigation and prefetch. The value is the user id, so it never carries over
 * to another account; pages still verify on the server (getOnboardedProfile).
 */
const ONBOARDED_COOKIE = "onboarded";

const matches = (path: string, base: string) =>
  path === base || path.startsWith(`${base}/`);

export async function proxy(request: NextRequest) {
  const { supabase, userId, response } = await updateSession(request);
  const path = request.nextUrl.pathname;

  const isLogin = matches(path, "/login");
  const isOnboarding = matches(path, "/onboarding");
  const isApp = matches(path, "/chat") || matches(path, "/gallery") || matches(path, "/settings");

  if (!isLogin && !isOnboarding && !isApp) return response;

  if (!userId) {
    return isLogin ? response : redirectWithSession(request, "/login", response);
  }

  // Fast path: already onboarded, so an app route needs no database round-trip.
  if (request.cookies.get(ONBOARDED_COOKIE)?.value === userId) {
    return isApp ? response : redirectWithSession(request, "/chat", response);
  }

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("username")
    .eq("id", userId)
    .maybeSingle();

  // If the lookup fails, let the page's own server-side check decide.
  if (error) return response;

  if (!profile?.username) {
    return isOnboarding
      ? response
      : redirectWithSession(request, "/onboarding", response);
  }

  const done = isLogin || isOnboarding ? redirectWithSession(request, "/chat", response) : response;
  done.cookies.set(ONBOARDED_COOKIE, userId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  return done;
}

export const config = {
  matcher: [
    // Skip static files, images and metadata files.
    "/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|icon|apple-icon|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
