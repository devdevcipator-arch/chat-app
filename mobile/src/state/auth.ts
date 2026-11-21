import { create } from "zustand";
import { Cache } from "../data/cache";
import { ProfileRepo } from "../data/profiles";
import { dbErrorMessage, isOfflineError } from "../lib/errors";
import { AUTH_STORAGE_KEY, storedUser, supabase } from "../lib/supabase";
import { removeKey } from "../lib/storage";
import type { Profile } from "../models/types";
import { Push } from "../services/push";
import { Network } from "./network";
import { Theme } from "./theme";

export type Stage = "loading" | "signedOut" | "onboarding" | "ready" | "error";

type AuthState = {
  stage: Stage;
  userId: string | null;
  email: string | null;
  profile: Profile | null;
  error: string | null;
};

const bare = (id: string): Profile => ({ id, username: null, displayName: null, avatarUrl: null });

/**
 * Decided synchronously from MMKV, so the first frame is already right: a
 * signed-in user with a cached profile lands on Chats instantly (offline too)
 * and the profile refreshes in the background.
 */
function initialState(): AuthState {
  const user = storedUser();
  if (!user) return { stage: "signedOut", userId: null, email: null, profile: null, error: null };
  Cache.setActiveUser(user.id, user.email);
  const cached = Cache.profile(user.id);
  return {
    stage: cached?.username ? "ready" : "loading",
    userId: user.id,
    email: user.email,
    profile: cached ?? bare(user.id),
    error: null,
  };
}

export const useAuth = create<AuthState>(initialState);

type Listener = (userId: string | null) => void;
const accountListeners = new Set<Listener>();
let generation = 0;
let profileSynced = false;
let started = false;

function setStage(patch: Partial<AuthState>) {
  const before = useAuth.getState().userId;
  useAuth.setState(patch);
  const after = useAuth.getState().userId;
  if (before !== after) for (const fn of accountListeners) fn(after);
}

async function syncProfile(userId: string, gen: number, blocking: boolean) {
  try {
    const profile = await withTimeout(ProfileRepo.fetchMine(userId), 20_000);
    Network.reportSuccess();
    if (gen !== generation) return;
    profileSynced = true;
    Cache.saveProfile(profile);
    Theme.applyFromProfile(profile.theme ?? "dark");
    setStage({ profile, stage: profile.username ? "ready" : "onboarding", error: null });
  } catch (e) {
    Network.reportFailure(e);
    if (gen !== generation || !blocking) return;
    if (isOfflineError(e)) {
      // Signed in, offline, nothing cached yet: open Chats anyway; the profile syncs on reconnect.
      setStage({ stage: "ready", profile: bare(userId) });
    } else {
      setStage({ stage: "error", error: dbErrorMessage(e) });
    }
  }
}

async function resolve(user: { id: string; email?: string | null } | null) {
  const gen = ++generation;
  profileSynced = false;
  if (!user) {
    Cache.clear();
    setStage({ stage: "signedOut", userId: null, email: null, profile: null, error: null });
    return;
  }
  Cache.setActiveUser(user.id, user.email);
  const cached = Cache.profile(user.id);
  if (cached?.username) {
    setStage({ stage: "ready", userId: user.id, email: user.email ?? null, profile: cached, error: null });
    void syncProfile(user.id, gen, false);
    return;
  }
  setStage({ stage: "loading", userId: user.id, email: user.email ?? null, profile: bare(user.id), error: null });
  await syncProfile(user.id, gen, true);
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((res, rej) => {
    const t = setTimeout(() => rej(Object.assign(new Error("timed out"), { name: "TimeoutError" })), ms);
    promise.then(
      (v) => {
        clearTimeout(t);
        res(v);
      },
      (e) => {
        clearTimeout(t);
        rej(e);
      },
    );
  });
}

export const Auth = {
  /** Wires the Supabase auth stream. Safe to call more than once. */
  start() {
    if (started) return;
    started = true;
    const { stage, userId } = useAuth.getState();
    if (stage === "loading" && userId) void syncProfile(userId, generation, true);
    else if (stage === "ready" && userId) void syncProfile(userId, generation, false);

    supabase.auth.onAuthStateChange((event, session) => {
      const current = useAuth.getState();
      switch (event) {
        case "SIGNED_OUT":
          // Explicit sign-out, or the server rejected the refresh token.
          void resolve(null);
          return;
        case "INITIAL_SESSION":
        case "SIGNED_IN":
        case "USER_UPDATED":
        case "TOKEN_REFRESHED":
          // A null session here is a failed (offline) recovery, never a sign-out.
          if (!session?.user) return;
          if (session.user.id === current.userId && current.stage !== "error") return;
          void resolve({ id: session.user.id, email: session.user.email });
          return;
      }
    });

    Network.onReconnect(() => {
      const { userId: id, stage: s } = useAuth.getState();
      if (!id) return;
      if (s === "error" || s === "loading") void syncProfile(id, generation, true);
      else if (!profileSynced) void syncProfile(id, generation, false);
    });
  },

  /** Retry from the error screen. */
  retry() {
    const { userId, email } = useAuth.getState();
    void resolve(userId ? { id: userId, email } : null);
  },

  /** The profile changed locally (settings, onboarding). */
  setProfile(profile: Profile) {
    profileSynced = true;
    Cache.saveProfile(profile);
    setStage({ profile, stage: profile.username ? "ready" : "onboarding" });
  },

  /**
   * Explicit sign-out: always works, offline too. supabase-js keeps the local
   * session when the server can't be reached, so it is removed by hand then.
   */
  async signOut() {
    // Remove this device's push token while the session can still delete it
    // (RLS: own rows only). Capped so an offline sign-out never hangs on it.
    await Promise.race([Push.beforeSignOut().catch(() => {}), new Promise((r) => setTimeout(r, 4000))]);
    const { error } = await supabase.auth.signOut({ scope: "local" }).catch((e: unknown) => ({ error: e }));
    if (error) {
      removeKey(AUTH_STORAGE_KEY);
      try {
        await (supabase.auth as unknown as { _removeSession: () => Promise<void> })._removeSession();
      } catch {}
    }
    await resolve(null);
  },

  /** Fires with the new user id (or null) whenever the signed-in account changes. */
  onAccountChange(fn: Listener) {
    accountListeners.add(fn);
    return () => {
      accountListeners.delete(fn);
    };
  },
};
