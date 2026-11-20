import { randomUUID } from "expo-crypto";

/**
 * RFC 4122 v4 UUID. Used as a client-chosen message id, so the optimistic
 * message, its Realtime echo, and any retry are all the same row.
 */
export const uuid = (): string => randomUUID();

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
