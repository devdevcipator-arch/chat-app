import { create } from "zustand";
import { storage } from "../lib/storage";
import { type ThemePreference, parseTheme } from "../models/types";
import { ProfileRepo } from "../data/profiles";

const KEY = "theme_preference";

/**
 * Light / Dark / System, as stored in profiles.theme_preference. Cached in
 * MMKV so the very first frame uses the right colours, and synced to the
 * profile so it follows the user across devices and the web.
 */
export const useThemePref = create<{ pref: ThemePreference }>(() => ({
  pref: parseTheme(storage.getString(KEY)),
}));

export const Theme = {
  /** Applies the server value (e.g. changed on the web) without writing back. */
  applyFromProfile(pref: ThemePreference) {
    storage.set(KEY, pref);
    useThemePref.setState({ pref });
  },
  /** Applies immediately; reverts and throws if saving to the profile fails. */
  async choose(pref: ThemePreference, userId: string) {
    const previous = useThemePref.getState().pref;
    useThemePref.setState({ pref });
    try {
      await ProfileRepo.saveTheme(userId, pref);
      storage.set(KEY, pref);
    } catch (e) {
      useThemePref.setState({ pref: previous });
      throw e;
    }
  },
};
