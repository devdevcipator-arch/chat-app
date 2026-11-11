import { cache } from "react";
import { redirect } from "next/navigation";
import { asTheme, type ThemePreference } from "@/lib/profile";
import { createClient } from "@/lib/supabase/server";

// Server-side Data Access Layer for the signed-in user. Reads cookies, so
// callers must render behind a <Suspense> boundary (Cache Components).

export type Profile = {
  id: string;
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  themePreference: ThemePreference;
};

/** Verified user + profile. Redirects to /login when signed out. */
export const getSessionProfile = cache(async (): Promise<Profile> => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, username, display_name, avatar_url, theme_preference")
    .eq("id", userId)
    .maybeSingle();

  return {
    id: userId,
    username: profile?.username ?? null,
    displayName: profile?.display_name ?? null,
    avatarUrl: profile?.avatar_url ?? null,
    themePreference: asTheme(profile?.theme_preference),
  };
});

/** Like getSessionProfile, but also requires a finished onboarding. */
export async function getOnboardedProfile() {
  const profile = await getSessionProfile();
  if (!profile.username) redirect("/onboarding");
  return profile as Profile & { username: string };
}
