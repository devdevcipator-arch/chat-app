import { Api, stringMap } from "../lib/api";
import { AppError, unwrap } from "../lib/errors";
import { formatBytes, galleryUploadLimit, mediaTypeFor } from "../lib/media";
import { supabase } from "../lib/supabase";
import { type ChatMessage, type GalleryItem, galleryFromRow, messageFromRow } from "../models/types";
import { uploadFile } from "./upload";

/**
 * The personal gallery (vault): rows are read under RLS, while uploads,
 * deletes and forwards go through /api/gallery so R2 stays consistent.
 */
export const GalleryRepo = {
  async list(): Promise<GalleryItem[]> {
    const rows = unwrap(await supabase.from("user_gallery").select().order("created_at", { ascending: false }));
    return (rows as Record<string, unknown>[]).map(galleryFromRow);
  },

  /** upload-url → PUT to R2 → POST /api/gallery to save the row. */
  async upload(uri: string, fileName: string, size: number, onProgress?: (fraction: number) => void): Promise<GalleryItem> {
    const type = mediaTypeFor(fileName);
    if (!type) throw new AppError("Executable files (.exe, .bat, …) can't be uploaded.");
    if (size <= 0) throw new AppError("That file is empty.");
    const limit = galleryUploadLimit(type);
    if (size > limit) throw new AppError(`That file is too large (max ${formatBytes(limit)}).`);

    const target = await Api.post("/api/gallery/upload-url", { fileName, fileType: type.mime, fileSize: size });
    await uploadFile({ uploadUrl: String(target.uploadUrl), headers: stringMap(target.headers), uri, onProgress });
    const saved = await Api.post("/api/gallery", {
      fileId: target.fileId,
      fileName,
      fileType: target.fileType ?? type.mime,
    });
    return {
      id: String(saved.id),
      key: String(saved.key),
      fileName: String(saved.fileName),
      kind: saved.kind === "image" || saved.kind === "video" || saved.kind === "audio" ? saved.kind : "document",
      size: Number(saved.size),
      createdAt: String(saved.createdAt),
    };
  },

  /** Permanently deletes the item: the R2 object first, then the row (hard delete). */
  delete: (id: string) => Api.delete(`/api/gallery/${id}`),

  /** Copies the item into a chat and posts it as a message. */
  async forward(id: string, chatId: string): Promise<ChatMessage> {
    return messageFromRow(await Api.post(`/api/gallery/${id}/forward`, { chatId }));
  },
};
