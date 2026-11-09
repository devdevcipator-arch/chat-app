import { NextResponse } from "next/server";
import { UUID_PATTERN } from "@/lib/chat";
import { createClient } from "@/lib/supabase/server";
import type { VaultApiError } from "@/lib/vault";

// Server-only helpers for the /api/gallery routes.

const NO_STORE = { "Cache-Control": "no-store" };

export const fail = (status: number, error: string) =>
  NextResponse.json<VaultApiError>({ error }, { status, headers: NO_STORE });

export const ok = <T>(body: T, status = 200) => NextResponse.json<T>(body, { status, headers: NO_STORE });

/** The signed-in user's Supabase client and id, or null when signed out. */
export async function authed() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  return userId ? { supabase, userId } : null;
}

export async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await request.json();
    return typeof body === "object" && body !== null ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** The caller's own gallery row (RLS-scoped), or a ready error response. */
export async function loadOwnItem(id: string) {
  if (!UUID_PATTERN.test(id)) return { error: fail(404, "That item doesn't exist.") } as const;
  const auth = await authed();
  if (!auth) return { error: fail(401, "Please sign in again.") } as const;
  const { data, error } = await auth.supabase.from("user_gallery").select("*").eq("id", id).maybeSingle();
  if (error) return { error: fail(500, "Something went wrong. Please try again.") } as const;
  if (!data) return { error: fail(404, "That item doesn't exist.") } as const;
  return { ...auth, item: data } as const;
}

/** RFC 6266 Content-Disposition with a UTF-8 file name and an ASCII fallback. */
export function attachmentDisposition(fileName: string) {
  const ascii = fileName.replace(/[^\x20-\x7e]|["\\]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}
