import { AUDIO_TYPES, MAX_UPLOAD_BYTES, extensionFor, isMediaMimeType, mediaKind } from "@/lib/media";
import { VAULT_MAX_BYTES, VAULT_TYPES, isVaultMimeType, resolveVaultType, type VaultMimeType } from "@/lib/vault";

// What can be uploaded straight into a chat (client + server). Images are
// re-encoded in the browser (see compressImage) and audio is sent as is, as
// before; videos and documents use the same types and limits as the gallery,
// whose extensions the media_url_is_object_key check already allows.

export type ChatUploadKind = "image" | "audio" | "video" | "file";

export type ChatUploadRule = { kind: ChatUploadKind; ext: string; maxBytes: number };

/** Rules for a canonical MIME type sent to /api/media/upload-url, or null if unsupported. */
export function chatUploadRule(fileType: string): ChatUploadRule | null {
  if (isMediaMimeType(fileType)) {
    const kind = mediaKind(fileType)!;
    return { kind, ext: extensionFor(fileType), maxBytes: MAX_UPLOAD_BYTES[kind] };
  }
  if (isVaultMimeType(fileType)) {
    const { kind, ext } = VAULT_TYPES[fileType];
    if (kind === "video") return { kind: "video", ext, maxBytes: VAULT_MAX_BYTES.video };
    if (kind === "document") return { kind: "file", ext, maxBytes: VAULT_MAX_BYTES.document };
  }
  return null;
}

/** The type a picked non-image file uploads as (fixing blank or vendor MIME types), or null. */
export function resolveChatFileType(file: { name: string; type: string }): VaultMimeType | null {
  const type = resolveVaultType(file);
  if (!type) return null;
  const { kind } = VAULT_TYPES[type];
  if (kind === "video" || kind === "document") return type;
  if (kind === "audio" && type in AUDIO_TYPES) return type;
  return null;
}

const extensionsOf = (kinds: string[]) =>
  [...new Set(Object.values(VAULT_TYPES).filter((t) => kinds.includes(t.kind)).map((t) => `.${t.ext}`))];

/** "Photos & Videos": opens the photo library on phones. */
export const GALLERY_ACCEPT = "image/*,video/*";

/** "Device Files": documents plus anything else we can send (opens the file browser). */
export const DEVICE_FILES_ACCEPT = [
  ...extensionsOf(["document", "audio", "video", "image"]),
  ...Object.keys(VAULT_TYPES),
  ...Object.keys(AUDIO_TYPES),
].join(",");

export const formatLimit = (bytes: number) => `${Math.round(bytes / (1024 * 1024))} MB`;
