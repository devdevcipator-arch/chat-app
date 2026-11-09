import { DeleteObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import type { NextRequest } from "next/server";
import { UUID_PATTERN } from "@/lib/chat";
import { getR2 } from "@/lib/r2";
import { VAULT_MAX_BYTES, VAULT_TYPES, resolveVaultType, toGalleryItem, vaultKey, type GalleryItem } from "@/lib/vault";
import { authed, fail, ok, readJson } from "@/lib/vault-server";

/**
 * POST /api/gallery
 * Body: { fileId, fileName, fileType }
 * Saves an uploaded file to the caller's gallery. The size and type are read
 * back from R2 (HeadObject), so the row always describes the real object.
 */
export async function POST(request: NextRequest) {
  const auth = await authed();
  if (!auth) return fail(401, "Please sign in again.");

  const body = await readJson(request);
  if (!body) return fail(400, "Invalid request body.");
  const { fileId, fileName, fileType } = body;
  if (typeof fileId !== "string" || !UUID_PATTERN.test(fileId)) return fail(400, "Invalid file.");
  if (typeof fileName !== "string" || fileName.trim().length === 0 || fileName.length > 255) {
    return fail(400, "Invalid file name.");
  }
  if (typeof fileType !== "string") return fail(400, "Invalid file type.");
  const type = resolveVaultType({ name: fileName, type: fileType });
  if (!type) return fail(415, "That file type isn't supported.");

  const r2 = getR2();
  if (!r2) return fail(503, "Media uploads aren't configured yet.");

  const id = fileId.toLowerCase();
  const key = vaultKey(auth.userId, id, type);
  let size: number;
  try {
    const head = await r2.client.send(new HeadObjectCommand({ Bucket: r2.bucket, Key: key }));
    size = head.ContentLength ?? 0;
    if (head.ContentType !== type) return fail(400, "The uploaded file doesn't match its type.");
  } catch {
    return fail(404, "Upload not found. Please try again.");
  }
  const kind = VAULT_TYPES[type].kind;
  if (size <= 0 || size > VAULT_MAX_BYTES[kind]) return fail(413, "That file is too large.");

  const { data, error } = await auth.supabase
    .from("user_gallery")
    .insert({
      id,
      user_id: auth.userId,
      media_url: key,
      file_name: fileName.trim(),
      file_type: kind,
      file_size: size,
    })
    .select()
    .single();

  if (error || !data) {
    console.error("user_gallery insert failed:", error?.message);
    // Duplicate id = this upload was already saved; anything else leaves an orphan.
    if (error?.code !== "23505") {
      await r2.client.send(new DeleteObjectCommand({ Bucket: r2.bucket, Key: key })).catch(() => {});
    }
    return fail(500, "Couldn't save to your gallery. Please try again.");
  }

  return ok<GalleryItem>(toGalleryItem(data), 201);
}
