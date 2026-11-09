import { randomUUID } from "node:crypto";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { NextRequest } from "next/server";
import { getR2 } from "@/lib/r2";
import { VAULT_MAX_BYTES, VAULT_TYPES, resolveVaultType, vaultKey, type VaultUploadUrlResponse } from "@/lib/vault";
import { authed, fail, ok, readJson } from "@/lib/vault-server";

const URL_TTL_SECONDS = 600;

/**
 * POST /api/gallery/upload-url
 * Body: { fileName, fileType, fileSize }
 * Returns a presigned R2 PUT URL for vault/<userId>/<fileId>.<ext>. The
 * signature covers Content-Type and Content-Length. After the PUT succeeds,
 * the client calls POST /api/gallery with the fileId to save the item.
 */
export async function POST(request: NextRequest) {
  const auth = await authed();
  if (!auth) return fail(401, "Please sign in again.");

  const body = await readJson(request);
  if (!body) return fail(400, "Invalid request body.");
  const { fileName, fileType, fileSize } = body;
  if (typeof fileName !== "string" || fileName.length === 0 || fileName.length > 255) {
    return fail(400, "Invalid file name.");
  }
  if (typeof fileType !== "string") return fail(400, "Invalid file type.");
  if (typeof fileSize !== "number" || !Number.isInteger(fileSize) || fileSize <= 0) {
    return fail(400, "Invalid file size.");
  }

  const type = resolveVaultType({ name: fileName, type: fileType });
  if (!type) return fail(415, "That file type isn't supported.");
  const { kind } = VAULT_TYPES[type];
  const max = VAULT_MAX_BYTES[kind];
  if (fileSize > max) {
    return fail(413, `${kind[0].toUpperCase()}${kind.slice(1)} files must be ${max / (1024 * 1024)} MB or smaller.`);
  }

  const r2 = getR2();
  if (!r2) return fail(503, "Media uploads aren't configured yet.");

  // Server-generated key: the client's file name never touches the path.
  const fileId = randomUUID();
  try {
    const uploadUrl = await getSignedUrl(
      r2.client,
      new PutObjectCommand({
        Bucket: r2.bucket,
        Key: vaultKey(auth.userId, fileId, type),
        ContentType: type,
        ContentLength: fileSize,
      }),
      { expiresIn: URL_TTL_SECONDS, signableHeaders: new Set(["content-type"]) },
    );
    return ok<VaultUploadUrlResponse>({
      fileId,
      fileType: type,
      uploadUrl,
      headers: { "Content-Type": type },
      expiresIn: URL_TTL_SECONDS,
    });
  } catch (error) {
    console.error("R2 vault presign failed:", error instanceof Error ? error.message : error);
    return fail(500, "Couldn't prepare the upload. Please try again.");
  }
}
