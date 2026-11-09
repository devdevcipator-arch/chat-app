import type { NextRequest } from "next/server";
import { redirectWithSession, updateSession } from "@/lib/supabase/proxy";

// Next.js 16 renamed `middleware.ts` to `proxy.ts`; this is the route guard.
// It is an optimistic check: pages re-verify on the server (see lib/auth.ts),
// and RLS is the real authorization boundary.

const matches = (path: string, base: string) =>
  path === base || path.startsWith(`${base}/`);

export async function proxy(request: NextRequest) {
  const { supabase, userId, response } = await updateSession(request);
  const path = request.nextUrl.pathname;

  const isLogin = matches(path, "/login");
  const isOnboarding = matches(path, "/onboarding");
  const isApp = matches(path, "/chat") || matches(path, "/gallery");

  if (!isLogin && !isOnboarding && !isApp) return response;

  if (!userId) {
    return isLogin ? response : redirectWithSession(request, "/login", response);
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

  if (isLogin || isOnboarding) {
    return redirectWithSession(request, "/chat", response);
  }

  return response;
}

export const config = {
  matcher: [
    // Skip static files, images and metadata files.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
