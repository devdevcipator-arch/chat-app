import { AUDIO_TYPES, IMAGE_TYPES, MAX_UPLOAD_BYTES, extensionFor, isMediaMimeType, mediaKind } from "@/lib/media";
import { VAULT_MAX_BYTES, resolveVaultType } from "@/lib/vault";

// What can be uploaded straight into a chat (client + server).
//
// Images are re-encoded in the browser (see compressImage) and recorded audio
// is sent as is. Everything else (videos, documents, ebooks, archives, any
// other format except executables) goes by its extension, with the same
// limits as the gallery.

export type ChatUploadKind = "image" | "audio" | "video" | "file";

export type ChatUploadRule = {
  kind: ChatUploadKind;
  /** Content-Type the object is stored (and signed) as. */
  mime: string;
  ext: string;
  maxBytes: number;
};

/**
 * Rules for a file sent to /api/media/upload-url, or null if it's refused.
 * A blank or application/octet-stream type (common for .epub and other files
 * on Android) is resolved from the file name.
 */
export function chatUploadRule(fileType: string, fileName = ""): ChatUploadRule | null {
  if (isMediaMimeType(fileType)) {
    const kind = mediaKind(fileType)!;
    return { kind, mime: fileType, ext: extensionFor(fileType), maxBytes: MAX_UPLOAD_BYTES[kind] };
  }
  const resolved = resolveVaultType({ name: fileName, type: fileType });
  if (!resolved) return null;
  const { mime, ext, kind } = resolved;
  if (kind === "video") return { kind: "video", mime, ext, maxBytes: VAULT_MAX_BYTES.video };
  if (kind === "audio" && mime in AUDIO_TYPES) return { kind: "audio", mime, ext, maxBytes: MAX_UPLOAD_BYTES.audio };
  if (kind === "image" && mime in IMAGE_TYPES) return { kind: "image", mime, ext, maxBytes: MAX_UPLOAD_BYTES.image };
  // Documents, and media we don't show inline (e.g. GIF), as file cards.
  return { kind: "file", mime, ext, maxBytes: VAULT_MAX_BYTES.document };
}

export const formatLimit = (bytes: number) => `${Math.round(bytes / (1024 * 1024))} MB`;
