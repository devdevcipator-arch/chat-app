"use client";

import { ThemeProvider as NextThemesProvider, useTheme } from "next-themes";
import { useEffect, type ReactNode } from "react";
import { DEFAULT_THEME, type ThemePreference } from "@/lib/profile";

// Light / Dark / System via next-themes: the choice lives in localStorage
// (instant, no flash on load) and in profiles.theme_preference (follows you
// to other devices; see ThemeSync).

export const THEME_STORAGE_KEY = "theme";

export function ThemeProvider({ children }: { children: ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme={DEFAULT_THEME}
      enableSystem
      storageKey={THEME_STORAGE_KEY}
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  );
}

/** Applies the theme saved on the profile, e.g. on a new device or after changing it elsewhere. */
export function ThemeSync({ preference }: { preference: ThemePreference }) {
  const { setTheme } = useTheme();
  useEffect(() => {
    setTheme(preference);
  }, [preference, setTheme]);
  return null;
}
