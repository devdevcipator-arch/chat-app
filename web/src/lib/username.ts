// Must match the `username_format` check constraint in the database.
export const USERNAME_PATTERN = /^[a-z0-9_]{3,20}$/;
export const USERNAME_MAX = 20;
export const DISPLAY_NAME_MAX = 50;

/** Lowercases and strips characters that can never be part of a username. */
export function normalizeUsername(input: string) {
  return input.toLowerCase().replace(/^@/, "").replace(/[^a-z0-9_]/g, "").slice(0, USERNAME_MAX);
}

export function isValidUsername(value: string) {
  return USERNAME_PATTERN.test(value);
}
