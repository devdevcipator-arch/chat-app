import { useColorScheme, useWindowDimensions } from "react-native";
import { useThemePref } from "../state/theme";

// Devcipator palette (web/src/app/globals.css): neon-orange accent on a
// pitch-black canvas in dark mode, white in light mode.
export const BRAND = "#FF5722";

export type Palette = {
  dark: boolean;
  primary: string;
  onPrimary: string;
  bg: string;
  surface: string;
  surfaceHigh: string;
  surfaceHighest: string;
  text: string;
  muted: string;
  border: string;
  error: string;
  success: string;
  warning: string;
  bubbleMine: string;
  bubbleTheirs: string;
  overlay: string;
};

const dark: Palette = {
  dark: true,
  primary: BRAND,
  onPrimary: "#FFFFFF",
  bg: "#0A0A0A",
  surface: "#141414",
  surfaceHigh: "#1F1F1F",
  surfaceHighest: "#2C2C2C",
  text: "#F4F4F5",
  muted: "#9CA3AF",
  border: "#2C2C2C",
  error: "#F87171",
  success: "#22C55E",
  warning: "#F59E0B",
  bubbleMine: BRAND,
  bubbleTheirs: "#1F1F1F",
  overlay: "rgba(0,0,0,0.6)",
};

const light: Palette = {
  dark: false,
  primary: BRAND,
  onPrimary: "#FFFFFF",
  bg: "#FFFFFF",
  surface: "#F4F4F5",
  surfaceHigh: "#EDEDEF",
  surfaceHighest: "#E4E4E7",
  text: "#18181B",
  muted: "#71717A",
  border: "#E4E4E7",
  error: "#DC2626",
  success: "#16A34A",
  warning: "#D97706",
  bubbleMine: BRAND,
  bubbleTheirs: "#EDEDEF",
  overlay: "rgba(0,0,0,0.45)",
};

/** The active palette (Light / Dark / System from the user's preference). */
export function usePalette(): Palette {
  const pref = useThemePref((s) => s.pref);
  const system = useColorScheme();
  const isDark = pref === "system" ? system !== "light" : pref === "dark";
  return isDark ? dark : light;
}

/** Compact phones (narrower than 380 pt, e.g. iPhone SE) scale sizes down. */
export const COMPACT_WIDTH = 380;
const COMPACT_FACTOR = 0.88;

/** `s(16)` → 16 on standard phones, 14 on compact ones. */
export function useScale() {
  const { width } = useWindowDimensions();
  const compact = width < COMPACT_WIDTH;
  const s = (value: number) => (compact ? Math.round(value * COMPACT_FACTOR) : value);
  return { compact, s, width };
}

/** Clamp for OS font scaling so layouts never blow up (Settings → Display → Font size). */
export const MAX_FONT_SCALE = 1.1;
