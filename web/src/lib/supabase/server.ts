import { createServerClient } from "@supabase/ssr";
import { createClient as createBearerClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { cookies, headers } from "next/headers";

// Supabase client for Server Components, Server Actions and Route Handlers.
// Create a new one per request; never share it across requests.
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Called from a Server Component, where cookies are read-only.
            // Safe to ignore: proxy.ts refreshes the session cookie.
          }
        },
      },
    },
  );
}

const BEARER = /^Bearer\s+([A-Za-z0-9._-]+)$/i;

/**
 * The caller's verified user id and an RLS-scoped client, for API routes.
 *
 * Browsers authenticate with the session cookie; native apps (the Flutter
 * client) have no cookies and send `Authorization: Bearer <access token>`
 * instead. Either way the JWT is verified with getClaims() before use, and
 * every query still runs as that user, so RLS stays the boundary.
 */
export async function getApiAuth(): Promise<{ supabase: SupabaseClient<Database>; userId: string } | null> {
  const token = BEARER.exec((await headers()).get("authorization") ?? "")?.[1];
  if (token) {
    const supabase = createBearerClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
      {
        global: { headers: { Authorization: `Bearer ${token}` } },
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      },
    );
    const { data } = await supabase.auth.getClaims(token);
    const userId = data?.claims?.sub;
    return userId ? { supabase, userId } : null;
  }

  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  return userId ? { supabase, userId } : null;
}
