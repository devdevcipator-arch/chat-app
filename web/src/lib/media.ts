// Shared (client + server) media rules. Keep in sync with the
// `media_url_is_object_key` check in supabase/migrations.

export const IMAGE_TYPES = {
  "image/webp": "webp",
  "image/jpeg": "jpg",
  "image/png": "png",
} as const;

export const AUDIO_TYPES = {
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/aac": "aac",
  "audio/wav": "wav",
} as const;

export type ImageMimeType = keyof typeof IMAGE_TYPES;
export type AudioMimeType = keyof typeof AUDIO_TYPES;
export type MediaMimeType = ImageMimeType | AudioMimeType;
export type MediaKind = "image" | "audio";

export const MAX_UPLOAD_BYTES: Record<MediaKind, number> = {
  image: 2 * 1024 * 1024, // compressed client-side to ~200 KB; this is a hard cap
  audio: 10 * 1024 * 1024,
};

/** Images we can decode in the browser and re-encode before upload. */
export const ACCEPTED_IMAGE_INPUTS = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"];
export const ACCEPTED_FILE_INPUT = [...ACCEPTED_IMAGE_INPUTS, ...Object.keys(AUDIO_TYPES)].join(",");

export function mediaKind(type: string): MediaKind | null {
  if (type in IMAGE_TYPES) return "image";
  if (type in AUDIO_TYPES) return "audio";
  return null;
}

export function extensionFor(type: MediaMimeType): string {
  return type in IMAGE_TYPES
    ? IMAGE_TYPES[type as ImageMimeType]
    : AUDIO_TYPES[type as AudioMimeType];
}

export function isMediaMimeType(type: string): type is MediaMimeType {
  return mediaKind(type) !== null;
}

/**
 * Object keys look like chats/<chatId>/<userId>/<uuid>.<ext>. The extra
 * extensions (gif, video, documents) only arrive by forwarding from the
 * gallery (see lib/vault.ts); direct chat uploads stay images + audio.
 */
export const OBJECT_KEY_PATTERN =
  /^chats\/[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(webp|jpg|png|gif|webm|ogg|mp3|m4a|aac|wav|mp4|mov|pdf|txt|csv|zip|docx|xlsx|pptx)$/;

export function publicBase() {
  const raw = (process.env.NEXT_PUBLIC_R2_PUBLIC_DOMAIN ?? "").trim().replace(/\/+$/, "");
  if (!raw) return "";
  return /^https?:\/\//.test(raw) ? raw : `https://${raw}`;
}

/** Public URL for a stored object key; null if it isn't one of ours. */
export function mediaPublicUrl(key: string | null): string | null {
  if (!key || !OBJECT_KEY_PATTERN.test(key)) return null;
  const base = publicBase();
  return base ? `${base}/${key}` : null;
}

export type UploadUrlRequest = {
  chatId: string;
  fileName: string;
  fileType: string;
  fileSize: number;
};

export type UploadUrlResponse = {
  uploadUrl: string;
  publicUrl: string;
  key: string;
  /** Headers the PUT must send exactly (they are part of the signature). */
  headers: Record<string, string>;
  expiresIn: number;
};

export type UploadUrlError = { error: string };
