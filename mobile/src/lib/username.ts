// Must match the `username_format` check constraint in the database.
export const USERNAME_PATTERN = /^[a-z0-9_]{3,20}$/;
export const USERNAME_MAX = 20;

/** Lowercases and strips characters that can never be part of a username. */
export function normalizeUsername(input: string) {
  return input
    .toLowerCase()
    .replace(/^@/, "")
    .replace(/[^a-z0-9_]/g, "")
    .slice(0, USERNAME_MAX);
}

export const isValidUsername = (value: string) => USERNAME_PATTERN.test(value);

/**
 * The exact @username a search query holds, or null if it can't be one
 * ("Book Club" has a space; "@Alice" is fine and becomes "alice").
 */
export function usernameQuery(query: string): string | null {
  const candidate = query.trim().toLowerCase().replace(/^@/, "");
  const username = normalizeUsername(candidate);
  return username === candidate && isValidUsername(username) ? username : null;
}

/** Trims and collapses whitespace; an empty name clears it. */
export const normalizeDisplayName = (value: string) => value.replace(/\s+/g, " ").trim();
