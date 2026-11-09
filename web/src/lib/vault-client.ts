import type { MessageRow } from "@/lib/chat";
import { UploadError, uploadToR2 } from "@/lib/media-client";
import {
  VAULT_MAX_BYTES,
  VAULT_TYPES,
  formatBytes,
  resolveVaultType,
  type GalleryItem,
  type VaultApiError,
  type VaultUploadUrlResponse,
} from "@/lib/vault";

// Browser-only helpers for the gallery API.

async function api<T>(url: string, init: RequestInit, fallback: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: init.body ? { "Content-Type": "application/json" } : undefined,
    });
  } catch {
    throw new UploadError("Can't reach the server. Check your connection.");
  }
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as VaultApiError | null;
    throw new UploadError(data?.error ?? fallback);
  }
  return (await res.json()) as T;
}

/** Throws a user-facing UploadError if the file can't go in the gallery. */
export function checkVaultFile(file: File) {
  const type = resolveVaultType(file);
  if (!type) throw new UploadError(`"${file.name}" isn't a supported file type.`);
  const max = VAULT_MAX_BYTES[VAULT_TYPES[type].kind];
  if (file.size > max) throw new UploadError(`"${file.name}" is larger than ${formatBytes(max)}.`);
  if (file.size === 0) throw new UploadError(`"${file.name}" is empty.`);
  return type;
}

const UPLOAD_TIMEOUT_MS = 10 * 60_000;

/** Validates, uploads straight to R2, then saves the gallery row. */
export async function uploadToGallery(file: File, onProgress: (fraction: number) => void): Promise<GalleryItem> {
  const type = checkVaultFile(file);
  const target = await api<VaultUploadUrlResponse>(
    "/api/gallery/upload-url",
    { method: "POST", body: JSON.stringify({ fileName: file.name, fileType: type, fileSize: file.size }) },
    "Couldn't prepare the upload.",
  );
  await uploadToR2(target, file, onProgress, UPLOAD_TIMEOUT_MS);
  return api<GalleryItem>(
    "/api/gallery",
    { method: "POST", body: JSON.stringify({ fileId: target.fileId, fileName: file.name, fileType: target.fileType }) },
    "Couldn't save to your gallery.",
  );
}

export const deleteGalleryItem = (id: string) =>
  api<{ deleted: string }>(`/api/gallery/${id}`, { method: "DELETE" }, "Couldn't delete that item.");

export const forwardGalleryItem = (id: string, chatId: string) =>
  api<MessageRow>(
    `/api/gallery/${id}/forward`,
    { method: "POST", body: JSON.stringify({ chatId }) },
    "Couldn't send to that chat.",
  );

export const galleryDownloadUrl = (id: string) => `/api/gallery/${id}/download`;
