// Media rules shared with the web app (web/src/lib/media.ts, vault.ts,
// chat-upload.ts) and the `media_url_is_object_key` check in the database.
import { Config } from "./config";
import { DOCUMENT_MIME_TYPES, OCTET_STREAM, fileExtension, isBlockedExtension } from "./file-types";

export { fileExtension, formatBadge, isBlockedExtension } from "./file-types";

export type UploadKind = "image" | "audio" | "video" | "file";

export type MediaType = {
  mime: string;
  ext: string;
  kind: UploadKind;
};

const known = (mime: string, ext: string, kind: UploadKind): MediaType => ({ mime, ext, kind });

const TYPES: Record<string, MediaType> = {
  jpg: known("image/jpeg", "jpg", "image"),
  jpeg: known("image/jpeg", "jpg", "image"),
  png: known("image/png", "png", "image"),
  webp: known("image/webp", "webp", "image"),
  gif: known("image/gif", "gif", "image"),
  mp4: known("video/mp4", "mp4", "video"),
  m4v: known("video/mp4", "mp4", "video"),
  mov: known("video/quicktime", "mov", "video"),
  webm: known("video/webm", "webm", "video"),
  mp3: known("audio/mpeg", "mp3", "audio"),
  m4a: known("audio/mp4", "m4a", "audio"),
  aac: known("audio/aac", "aac", "audio"),
  ogg: known("audio/ogg", "ogg", "audio"),
  oga: known("audio/ogg", "ogg", "audio"),
  wav: known("audio/wav", "wav", "audio"),
  pdf: known("application/pdf", "pdf", "file"),
  txt: known("text/plain", "txt", "file"),
  csv: known("text/csv", "csv", "file"),
  zip: known("application/zip", "zip", "file"),
  docx: known("application/vnd.openxmlformats-officedocument.wordprocessingml.document", "docx", "file"),
  xlsx: known("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "xlsx", "file"),
  pptx: known("application/vnd.openxmlformats-officedocument.presentationml.presentation", "pptx", "file"),
};

/** The chat `message_type` an upload becomes. */
export const messageTypeFor = (type: MediaType) => type.kind;

/**
 * How a file uploads (by extension), or null for executables.
 *
 * Known media keep their kind; anything else (EPUB, office files, archives,
 * any other format) becomes a document under its own extension. The picker's
 * MIME type is never trusted: Android reports most documents as
 * application/octet-stream, and the server re-resolves from the name anyway.
 */
export function mediaTypeFor(fileName: string): MediaType | null {
  const ext = fileExtension(fileName);
  if (isBlockedExtension(ext)) return null;
  return TYPES[ext] ?? known(DOCUMENT_MIME_TYPES[ext] ?? OCTET_STREAM, ext || "bin", "file");
}

const PLAYABLE_AUDIO = new Set(["audio/mpeg", "audio/mp4", "audio/aac", "audio/ogg", "audio/wav", "audio/webm"]);

/**
 * How a picked file is sent into a chat. Chat images must be JPEG/PNG/WebP
 * (re-encoded small); a GIF or other media picked as a file goes as a file
 * card, the same rule as the server (web/src/lib/chat-upload.ts).
 */
export function chatUploadTypeFor(fileName: string): MediaType | null {
  const type = mediaTypeFor(fileName);
  if (!type) return null;
  const playable =
    type.kind === "image" ? type.mime !== "image/gif" : type.kind === "audio" ? PLAYABLE_AUDIO.has(type.mime) : true;
  return playable ? type : { ...type, kind: "file" };
}

const MB = 1024 * 1024;

/** Upper bounds enforced by /api/media/upload-url (chat). */
export function chatUploadLimit(type: MediaType) {
  switch (type.kind) {
    case "image":
      return 2 * MB; // chat images are re-encoded small; the server hard-caps at 2 MB
    case "audio":
      return 10 * MB;
    case "video":
      return 100 * MB;
    default:
      return 25 * MB;
  }
}

/** Upper bounds enforced by the gallery (vault) routes. */
export function galleryUploadLimit(type: MediaType) {
  switch (type.kind) {
    case "image":
      return 20 * MB;
    case "video":
      return 100 * MB;
    default:
      return 25 * MB;
  }
}

const OBJECT_KEY =
  /^(chats\/[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}|vault\/[0-9a-f-]{36}\/[0-9a-f-]{36}|avatars\/[0-9a-f-]{36}\/[0-9a-f-]{36})\.([a-z0-9]{1,10})$/;

/** Public URL for one of our R2 object keys; null for anything else. */
export function mediaPublicUrl(key: string | null | undefined): string | null {
  const match = key ? OBJECT_KEY.exec(key) : null;
  if (!key || !match || isBlockedExtension(match[2])) return null;
  const base = Config.r2PublicBase.replace(/\/+$/, "");
  if (!base) return null;
  return `${/^https?:\/\//.test(base) ? base : `https://${base}`}/${key}`;
}

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

/** Seconds as "MM:SS". */
export function formatDuration(totalSeconds: number) {
  const secs = Math.max(0, Math.floor(totalSeconds));
  return `${String(Math.floor(secs / 60)).padStart(2, "0")}:${String(secs % 60).padStart(2, "0")}`;
}

/** Icon name (Ionicons) for a file card. */
export function iconForFile(name: string): string {
  const ext = fileExtension(name);
  if (ext === "pdf") return "document-text-outline";
  if (["epub", "mobi", "azw3", "fb2", "djvu", "cbz", "cbr"].includes(ext)) return "book-outline";
  if (["zip", "rar", "7z", "tar", "gz"].includes(ext)) return "archive-outline";
  if (["xls", "xlsx", "ods", "csv"].includes(ext)) return "grid-outline";
  if (["ppt", "pptx", "odp", "key"].includes(ext)) return "easel-outline";
  if (["mp3", "m4a", "aac", "ogg", "wav", "flac"].includes(ext)) return "musical-notes-outline";
  if (["jpg", "jpeg", "png", "gif", "webp", "heic"].includes(ext)) return "image-outline";
  if (["mp4", "mov", "webm", "mkv"].includes(ext)) return "film-outline";
  if (ext === "apk") return "logo-android";
  return "document-outline";
}
