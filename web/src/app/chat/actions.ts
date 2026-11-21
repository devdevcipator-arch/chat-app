"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  // The proxy's "already onboarded" shortcut (see src/proxy.ts).
  (await cookies()).delete("onboarded");
  redirect("/login");
}
