import { createMMKV } from "react-native-mmkv";

/**
 * Synchronous on-device key/value store (MMKV, memory-mapped). Reads take
 * microseconds, so screens hydrate from it on their very first render.
 */
export const storage = createMMKV({ id: "chat-app" });

export function readJson<T>(key: string): T | null {
  try {
    const raw = storage.getString(key);
    return raw == null ? null : (JSON.parse(raw) as T);
  } catch {
    return null;
  }
}

export function writeJson(key: string, value: unknown) {
  try {
    storage.set(key, JSON.stringify(value));
  } catch {
    // The cache is an optimisation, never a source of errors.
  }
}

export function removeKey(key: string) {
  try {
    storage.remove(key);
  } catch {}
}

/** Adapter for supabase-js `auth.storage` (persists the session in MMKV). */
export const supabaseStorage = {
  getItem: (key: string) => storage.getString(key) ?? null,
  setItem: (key: string, value: string) => storage.set(key, value),
  removeItem: (key: string) => {
    storage.remove(key);
  },
};
