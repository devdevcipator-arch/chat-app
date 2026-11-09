import type { Database } from "@/lib/database.types";
import { publicBase } from "@/lib/media";

// Shared (client + server) rules for the personal gallery ("vault").
// Keep the extensions in sync with the `media_url_is_object_key` check in
// supabase/migrations (forwarded items land in chats with these extensions).

export type VaultKind = "image" | "video" | "audio" | "document";

export const VAULT_TYPES = {
  "image/jpeg": { ext: "jpg", kind: "image" },
  "image/png": { ext: "png", kind: "image" },
  "image/webp": { ext: "webp", kind: "image" },
  "image/gif": { ext: "gif", kind: "image" },
  "video/mp4": { ext: "mp4", kind: "video" },
  "video/webm": { ext: "webm", kind: "video" },
  "video/quicktime": { ext: "mov", kind: "video" },
  "audio/mpeg": { ext: "mp3", kind: "audio" },
  "audio/mp4": { ext: "m4a", kind: "audio" },
  "audio/aac": { ext: "aac", kind: "audio" },
  "audio/ogg": { ext: "ogg", kind: "audio" },
  "audio/wav": { ext: "wav", kind: "audio" },
  "audio/webm": { ext: "webm", kind: "audio" },
  "application/pdf": { ext: "pdf", kind: "document" },
  "text/plain": { ext: "txt", kind: "document" },
  "text/csv": { ext: "csv", kind: "document" },
  "application/zip": { ext: "zip", kind: "document" },
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": { ext: "docx", kind: "document" },
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": { ext: "xlsx", kind: "document" },
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": { ext: "pptx", kind: "document" },
} as const satisfies Record<string, { ext: string; kind: VaultKind }>;

export type VaultMimeType = keyof typeof VAULT_TYPES;

export const VAULT_MAX_BYTES: Record<VaultKind, number> = {
  image: 20 * 1024 * 1024,
  video: 100 * 1024 * 1024,
  audio: 25 * 1024 * 1024,
  document: 25 * 1024 * 1024,
};

export const VAULT_ACCEPT = Object.keys(VAULT_TYPES).join(",");

export const isVaultMimeType = (type: string): type is VaultMimeType =>
  Object.prototype.hasOwnProperty.call(VAULT_TYPES, type);

/** Browsers leave some types blank or vendor-specific; fall back to the extension. */
const EXTENSION_TYPES: Record<string, VaultMimeType> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  mp4: "video/mp4",
  m4v: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  aac: "audio/aac",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  wav: "audio/wav",
  pdf: "application/pdf",
  txt: "text/plain",
  csv: "text/csv",
  zip: "application/zip",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

const TYPE_ALIASES: Record<string, VaultMimeType> = {
  "image/jpg": "image/jpeg",
  "audio/mp3": "audio/mpeg",
  "audio/x-m4a": "audio/mp4",
  "audio/x-wav": "audio/wav",
  "audio/wave": "audio/wav",
  "application/x-zip-compressed": "application/zip",
  "application/vnd.ms-excel": "text/csv", // Windows reports .csv like this
};

/** The canonical MIME type we will store a file as, or null if unsupported. */
export function resolveVaultType(file: { name: string; type: string }): VaultMimeType | null {
  const type = file.type.toLowerCase();
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (isVaultMimeType(type)) return type;
  const alias = TYPE_ALIASES[type];
  if (alias && (alias !== "text/csv" || ext === "csv")) return alias;
  return EXTENSION_TYPES[ext] ?? null;
}

/** Vault keys look like vault/<userId>/<fileId>.<ext>. */
export const VAULT_KEY_PATTERN = /^vault\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.[a-z0-9]{2,5}$/;

export const vaultKey = (userId: string, fileId: string, type: VaultMimeType) =>
  `vault/${userId}/${fileId}.${VAULT_TYPES[type].ext}`;

/** Public URL for a vault object key; null if it isn't one. */
export function vaultPublicUrl(key: string): string | null {
  if (!VAULT_KEY_PATTERN.test(key)) return null;
  const base = publicBase();
  return base ? `${base}/${key}` : null;
}

export const extensionOfKey = (key: string) => key.slice(key.lastIndexOf(".") + 1);

/** Which chat message type a forwarded item becomes. */
export const MESSAGE_TYPE_FOR: Record<VaultKind, "image" | "video" | "audio" | "file"> = {
  image: "image",
  video: "video",
  audio: "audio",
  document: "file",
};

export const asVaultKind = (value: string): VaultKind =>
  value === "image" || value === "video" || value === "audio" ? value : "document";

type GalleryRow = Database["public"]["Tables"]["user_gallery"]["Row"];

export type GalleryItem = {
  id: string;
  key: string;
  url: string | null;
  fileName: string;
  kind: VaultKind;
  size: number;
  createdAt: string;
};

export const toGalleryItem = (row: GalleryRow): GalleryItem => ({
  id: row.id,
  key: row.media_url,
  url: vaultPublicUrl(row.media_url),
  fileName: row.file_name,
  kind: asVaultKind(row.file_type),
  size: row.file_size,
  createdAt: row.created_at,
});

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

// --- API shapes --------------------------------------------------------------

export type VaultUploadUrlRequest = { fileName: string; fileType: string; fileSize: number };
export type VaultUploadUrlResponse = {
  fileId: string;
  fileType: VaultMimeType;
  uploadUrl: string;
  headers: Record<string, string>;
  expiresIn: number;
};
export type VaultFinalizeRequest = { fileId: string; fileName: string; fileType: string };
export type VaultForwardRequest = { chatId: string };
export type VaultApiError = { error: string };
